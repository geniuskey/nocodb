import { Injectable } from '@nestjs/common';
import { AppEvents, EventType, UITypes, ViewTypes } from 'nocodb-sdk';
import type { GanttUpdateReqType, ViewCreateReqType } from 'nocodb-sdk';
import type { NcContext, NcRequest } from '~/interface/config';
import type { MetaService } from '~/meta/meta.service';
import {
  type ViewWebhookManager,
  ViewWebhookManagerBuilder,
} from '~/utils/view-webhook-manager';
import { AppHooksService } from '~/services/app-hooks/app-hooks.service';
import { validatePayload } from '~/helpers';
import { NcError } from '~/helpers/catchError';
import { Column, GanttView, Model, User, View } from '~/models';
import NocoCache from '~/cache/NocoCache';
import { CacheScope } from '~/utils/globals';
import NocoSocket from '~/socket/NocoSocket';
import { normalizeGanttWorkingCalendar } from '~/helpers/ganttWorkingCalendar';

@Injectable()
export class GanttsService {
  constructor(private readonly appHooksService: AppHooksService) {}

  async ganttViewGet(
    context: NcContext,
    param: { ganttViewId: string },
    ncMeta?: MetaService,
  ) {
    const view = await View.get(context, param.ganttViewId, ncMeta);
    if (!view || view.type !== ViewTypes.GANTT) {
      NcError.viewNotFound(param.ganttViewId);
    }
    return await GanttView.get(context, param.ganttViewId, ncMeta);
  }

  async ganttViewCreate(
    context: NcContext,
    param: {
      tableId: string;
      gantt: ViewCreateReqType;
      req: NcRequest;
      ownedBy?: string;
      viewWebhookManager?: ViewWebhookManager;
    },
    ncMeta?: MetaService,
  ) {
    validatePayload(
      'swagger.json#/components/schemas/ViewCreateReq',
      param.gantt,
    );

    const model = await Model.get(context, param.tableId, ncMeta);
    param.gantt.title = param.gantt.title?.trim();
    const existingView = await View.getByTitleOrId(
      context,
      {
        titleOrId: param.gantt.title,
        fk_model_id: param.tableId,
      },
      ncMeta,
    );

    if (existingView) {
      NcError.get(context).duplicateAlias({
        type: 'view',
        alias: param.gantt.title,
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
          ...param.gantt,
          fk_model_id: param.tableId,
          type: ViewTypes.GANTT,
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

    this.appHooksService.emit(AppEvents.GANTT_CREATE, {
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

  async ganttViewUpdate(
    context: NcContext,
    param: {
      viewId: string;
      gantt: GanttUpdateReqType;
      req: NcRequest;
      viewWebhookManager?: ViewWebhookManager;
    },
    ncMeta?: MetaService,
  ) {
    validatePayload(
      'swagger.json#/components/schemas/GanttUpdateReq',
      param.gantt,
    );

    const view = await View.get(context, param.viewId, ncMeta);
    if (!view || view.type !== ViewTypes.GANTT) {
      NcError.viewNotFound(param.viewId);
    }

    await this.validateColumnMappings(
      context,
      view.fk_model_id,
      param.gantt,
      ncMeta,
    );
    if ('working_calendar' in param.gantt) {
      try {
        param.gantt.working_calendar = normalizeGanttWorkingCalendar(
          param.gantt.working_calendar,
        );
      } catch (error) {
        NcError.get(context).badRequest((error as Error).message);
      }
    }

    const oldGanttView = await GanttView.get(context, param.viewId, ncMeta);
    const viewWebhookManager =
      param.viewWebhookManager ??
      (
        await (
          await new ViewWebhookManagerBuilder(context, ncMeta).withModelId(
            view.fk_model_id,
          )
        ).withViewId(param.viewId)
      ).forUpdate();

    await GanttView.update(context, param.viewId, param.gantt, ncMeta);

    const owner =
      view.owned_by && view.owned_by !== param.req.user?.id
        ? await User.get(view.owned_by, ncMeta)
        : param.req.user;

    this.appHooksService.emit(AppEvents.GANTT_UPDATE, {
      view,
      ganttView: param.gantt,
      oldGanttView,
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
    gantt: GanttUpdateReqType,
    ncMeta?: MetaService,
  ) {
    const mappings = [
      ['title', gantt.fk_title_column_id, undefined],
      ['start', gantt.fk_start_column_id, [UITypes.Date, UITypes.DateTime]],
      ['end', gantt.fk_end_column_id, [UITypes.Date, UITypes.DateTime]],
      [
        'progress',
        gantt.fk_progress_column_id,
        [UITypes.Number, UITypes.Decimal, UITypes.Percent],
      ],
      ['milestone', gantt.fk_milestone_column_id, [UITypes.Checkbox]],
    ] as const;

    for (const [name, columnId, allowedTypes] of mappings) {
      if (columnId === undefined || columnId === null) continue;

      const column = await Column.get(context, { colId: columnId }, ncMeta);
      if (!column || column.fk_model_id !== modelId) {
        NcError.get(context).badRequest(
          `Gantt ${name} column must belong to the view table`,
        );
      }
      if (
        allowedTypes &&
        !(allowedTypes as readonly string[]).includes(column.uidt)
      ) {
        const expected =
          name === 'start' || name === 'end'
            ? 'a Date or DateTime field'
            : name === 'progress'
            ? 'a Number, Decimal, or Percent field'
            : 'a Checkbox field';
        NcError.get(context).badRequest(
          `Gantt ${name} column must be ${expected}`,
        );
      }
    }
  }
}
