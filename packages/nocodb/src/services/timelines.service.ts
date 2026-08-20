import { Injectable } from '@nestjs/common';
import { AppEvents, EventType, UITypes, ViewTypes } from 'nocodb-sdk';
import type { TimelineUpdateReqType, ViewCreateReqType } from 'nocodb-sdk';
import type { NcContext, NcRequest } from '~/interface/config';
import type { MetaService } from '~/meta/meta.service';
import {
  type ViewWebhookManager,
  ViewWebhookManagerBuilder,
} from '~/utils/view-webhook-manager';
import { AppHooksService } from '~/services/app-hooks/app-hooks.service';
import { validatePayload } from '~/helpers';
import { NcError } from '~/helpers/catchError';
import { Column, Model, TimelineView, User, View } from '~/models';
import NocoCache from '~/cache/NocoCache';
import { CacheScope } from '~/utils/globals';
import NocoSocket from '~/socket/NocoSocket';

@Injectable()
export class TimelinesService {
  constructor(private readonly appHooksService: AppHooksService) {}

  async timelineViewGet(
    context: NcContext,
    param: { timelineViewId: string },
    ncMeta?: MetaService,
  ) {
    const view = await View.get(context, param.timelineViewId, ncMeta);
    if (!view || view.type !== ViewTypes.TIMELINE) {
      NcError.viewNotFound(param.timelineViewId);
    }
    return await TimelineView.get(context, param.timelineViewId, ncMeta);
  }

  async timelineViewCreate(
    context: NcContext,
    param: {
      tableId: string;
      timeline: ViewCreateReqType;
      req: NcRequest;
      ownedBy?: string;
      viewWebhookManager?: ViewWebhookManager;
    },
    ncMeta?: MetaService,
  ) {
    validatePayload(
      'swagger.json#/components/schemas/ViewCreateReq',
      param.timeline,
    );

    const model = await Model.get(context, param.tableId, ncMeta);
    param.timeline.title = param.timeline.title?.trim();
    const existingView = await View.getByTitleOrId(
      context,
      {
        titleOrId: param.timeline.title,
        fk_model_id: param.tableId,
      },
      ncMeta,
    );

    if (existingView) {
      NcError.get(context).duplicateAlias({
        type: 'view',
        alias: param.timeline.title,
        label: 'title',
        base: context.base_id,
        additionalTrace: { table: param.tableId },
      });
    }

    const viewWebhookManager =
      param.viewWebhookManager ??
      (
        await new ViewWebhookManagerBuilder(context, ncMeta).withModelId(
          param.tableId,
        )
      ).forCreate();

    const { id } = await View.insertMetaOnly(
      context,
      {
        view: {
          ...param.timeline,
          fk_model_id: param.tableId,
          type: ViewTypes.TIMELINE,
          base_id: model.base_id,
          source_id: model.source_id,
          created_by: param.req.user?.id,
          owned_by: param.ownedBy || param.req.user?.id,
        },
        model,
        req: param.req,
      },
      ncMeta,
    );

    const view = await View.get(context, id, ncMeta);
    await NocoCache.appendToList(
      context,
      CacheScope.VIEW,
      [view.fk_model_id],
      `${CacheScope.VIEW}:${id}`,
    );

    const owner = param.ownedBy
      ? await User.get(param.ownedBy, ncMeta)
      : param.req.user;

    this.appHooksService.emit(AppEvents.TIMELINE_CREATE, {
      view,
      req: param.req,
      owner,
      context,
    });

    await view.getView(context, ncMeta);
    NocoSocket.broadcastEvent(
      context,
      {
        event: EventType.META_EVENT,
        payload: { action: 'view_create', payload: view },
      },
      context.socket_id,
    );

    if (!param.viewWebhookManager) {
      (await viewWebhookManager.withNewViewId(view.id)).emit();
    }

    return view;
  }

  async timelineViewUpdate(
    context: NcContext,
    param: {
      viewId: string;
      timeline: TimelineUpdateReqType;
      req: NcRequest;
      viewWebhookManager?: ViewWebhookManager;
    },
    ncMeta?: MetaService,
  ) {
    validatePayload(
      'swagger.json#/components/schemas/TimelineUpdateReq',
      param.timeline,
    );

    const view = await View.get(context, param.viewId, ncMeta);
    if (!view || view.type !== ViewTypes.TIMELINE) {
      NcError.viewNotFound(param.viewId);
    }

    await this.validateColumnMappings(
      context,
      view.fk_model_id,
      param.timeline,
      ncMeta,
    );

    const oldTimelineView = await TimelineView.get(
      context,
      param.viewId,
      ncMeta,
    );
    const viewWebhookManager =
      param.viewWebhookManager ??
      (
        await (
          await new ViewWebhookManagerBuilder(context, ncMeta).withModelId(
            view.fk_model_id,
          )
        ).withViewId(param.viewId)
      ).forUpdate();

    await TimelineView.update(context, param.viewId, param.timeline, ncMeta);

    const owner =
      view.owned_by && view.owned_by !== param.req.user?.id
        ? await User.get(view.owned_by, ncMeta)
        : param.req.user;

    this.appHooksService.emit(AppEvents.TIMELINE_UPDATE, {
      view,
      timelineView: param.timeline,
      oldTimelineView,
      req: param.req,
      owner,
      context,
    });

    await view.getView(context, ncMeta);
    NocoSocket.broadcastEvent(
      context,
      {
        event: EventType.META_EVENT,
        payload: { action: 'view_update', payload: view },
      },
      context.socket_id,
    );

    if (!param.viewWebhookManager) {
      (await viewWebhookManager.withNewViewId(view.id)).emit();
    }

    return view;
  }

  private async validateColumnMappings(
    context: NcContext,
    modelId: string,
    timeline: TimelineUpdateReqType,
    ncMeta?: MetaService,
  ) {
    const mappings = [
      ['title', timeline.fk_title_column_id, false],
      ['start', timeline.fk_start_column_id, true],
      ['end', timeline.fk_end_column_id, true],
    ] as const;

    for (const [name, columnId, temporal] of mappings) {
      if (columnId === undefined || columnId === null) continue;

      const column = await Column.get(context, { colId: columnId }, ncMeta);
      if (!column || column.fk_model_id !== modelId) {
        NcError.get(context).badRequest(
          `Timeline ${name} column must belong to the view table`,
        );
      }
      if (
        temporal &&
        column.uidt !== UITypes.Date &&
        column.uidt !== UITypes.DateTime
      ) {
        NcError.get(context).badRequest(
          `Timeline ${name} column must be a Date or DateTime field`,
        );
      }
    }
  }
}
