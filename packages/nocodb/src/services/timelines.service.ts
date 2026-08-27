import { Injectable } from '@nestjs/common';
import { AppEvents, EventType, UITypes, ViewTypes } from 'nocodb-sdk';
import type { TimelineCreateReqType, TimelineUpdateReqType } from 'nocodb-sdk';
import type { NcContext, NcRequest } from '~/interface/config';
import type { MetaService } from '~/meta/meta.service';
import { AppHooksService } from '~/services/app-hooks/app-hooks.service';
import { validatePayload } from '~/helpers';
import { NcError } from '~/helpers/catchError';
import { Model, TimelineView, TimelineViewColumn, User, View } from '~/models';
import NocoCache from '~/cache/NocoCache';
import { CacheScope } from '~/utils/globals';
import NocoSocket from '~/socket/NocoSocket';

const timelineDateTypes = new Set([
  UITypes.Date,
  UITypes.DateTime,
  UITypes.CreatedTime,
  UITypes.LastModifiedTime,
]);

@Injectable()
export class TimelinesService {
  constructor(private readonly appHooksService: AppHooksService) {}

  private async validateDateConfiguration(
    context: NcContext,
    model: Model,
    configuration: {
      fk_start_date_col_id?: string;
      fk_end_date_col_id?: string | null;
    },
    ncMeta?: MetaService,
  ) {
    if (!configuration.fk_start_date_col_id) {
      NcError.get(context).invalidRequestBody(
        'Timeline start date field is required',
      );
    }

    const columns = await model.getColumns(context, ncMeta);
    const validateColumn = (columnId: string, label: string) => {
      const column = columns.find((candidate) => candidate.id === columnId);
      if (!column || !timelineDateTypes.has(column.uidt)) {
        NcError.get(context).invalidRequestBody(
          `Timeline ${label} field must be a date field on this table`,
        );
      }
      return column.id;
    };

    return {
      fk_start_date_col_id: validateColumn(
        configuration.fk_start_date_col_id,
        'start',
      ),
      fk_end_date_col_id: configuration.fk_end_date_col_id
        ? validateColumn(configuration.fk_end_date_col_id, 'end')
        : null,
    };
  }

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
      timeline: TimelineCreateReqType;
      req: NcRequest;
    },
    ncMeta?: MetaService,
  ) {
    validatePayload(
      'swagger.json#/components/schemas/TimelineCreateReq',
      param.timeline,
    );
    const model = await Model.get(context, param.tableId, ncMeta);
    if (!model) NcError.tableNotFound(param.tableId);

    let copiedTimeline: TimelineView | undefined;
    if (param.timeline.copy_from_id) {
      const copySource = await View.get(
        context,
        param.timeline.copy_from_id,
        ncMeta,
      );
      if (
        !copySource ||
        copySource.type !== ViewTypes.TIMELINE ||
        copySource.fk_model_id !== param.tableId
      ) {
        NcError.get(context).invalidRequestBody(
          'A Timeline can only be duplicated from the same table',
        );
      }
      copiedTimeline = await TimelineView.get(context, copySource.id, ncMeta);
    }

    const dateConfiguration = await this.validateDateConfiguration(
      context,
      model,
      {
        fk_start_date_col_id:
          param.timeline.fk_start_date_col_id ??
          copiedTimeline?.fk_start_date_col_id,
        fk_end_date_col_id:
          param.timeline.fk_end_date_col_id === undefined
            ? copiedTimeline?.fk_end_date_col_id
            : param.timeline.fk_end_date_col_id,
      },
      ncMeta,
    );

    param.timeline.title = param.timeline.title?.trim();
    const existing = await View.getByTitleOrId(
      context,
      { titleOrId: param.timeline.title, fk_model_id: param.tableId },
      ncMeta,
    );
    if (existing) {
      NcError.get(context).duplicateAlias({
        type: 'view',
        alias: param.timeline.title,
        label: 'title',
        base: context.base_id,
        additionalTrace: { table: param.tableId },
      });
    }

    const { id } = await View.insertMetaOnly(
      context,
      {
        view: {
          ...copiedTimeline,
          ...param.timeline,
          ...dateConfiguration,
          fk_model_id: param.tableId,
          type: ViewTypes.TIMELINE,
          base_id: model.base_id,
          source_id: model.source_id,
          created_by: param.req.user?.id,
          owned_by: param.req.user?.id,
        },
        model,
        req: param.req,
      },
      ncMeta,
    );
    const view = await View.get(context, id, ncMeta);
    await NocoCache.appendToList(
      CacheScope.VIEW,
      [view.fk_model_id],
      `${CacheScope.VIEW}:${id}`,
    );
    this.appHooksService.emit(AppEvents.TIMELINE_CREATE, {
      view,
      req: param.req,
      owner: param.req.user,
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
    return view;
  }

  async timelineViewUpdate(
    context: NcContext,
    param: {
      timelineViewId: string;
      timeline: TimelineUpdateReqType;
      req: NcRequest;
    },
    ncMeta?: MetaService,
  ) {
    validatePayload(
      'swagger.json#/components/schemas/TimelineUpdateReq',
      param.timeline,
    );
    const view = await View.get(context, param.timelineViewId, ncMeta);
    if (!view || view.type !== ViewTypes.TIMELINE) {
      NcError.viewNotFound(param.timelineViewId);
    }
    const model = await Model.get(context, view.fk_model_id, ncMeta);
    const oldTimelineView = await TimelineView.get(
      context,
      param.timelineViewId,
      ncMeta,
    );
    const dateConfiguration = await this.validateDateConfiguration(
      context,
      model,
      {
        fk_start_date_col_id:
          param.timeline.fk_start_date_col_id ??
          oldTimelineView.fk_start_date_col_id,
        fk_end_date_col_id:
          param.timeline.fk_end_date_col_id === undefined
            ? oldTimelineView.fk_end_date_col_id
            : param.timeline.fk_end_date_col_id,
      },
      ncMeta,
    );

    await TimelineView.update(
      context,
      param.timelineViewId,
      { ...param.timeline, ...dateConfiguration },
      ncMeta,
    );
    const timelineColumns = await TimelineViewColumn.list(
      context,
      param.timelineViewId,
      ncMeta,
    );
    const requiredColumnIds = new Set(
      [
        dateConfiguration.fk_start_date_col_id,
        dateConfiguration.fk_end_date_col_id,
      ].filter(Boolean),
    );
    await Promise.all(
      timelineColumns
        .filter(
          (column) =>
            requiredColumnIds.has(column.fk_column_id) && !column.show,
        )
        .map((column) =>
          TimelineViewColumn.update(
            context,
            column.id,
            { show: true },
            ncMeta,
          ),
        ),
    );
    let owner = param.req.user;
    if (view.owned_by && view.owned_by !== param.req.user?.id) {
      owner = await User.get(view.owned_by, ncMeta);
    }
    this.appHooksService.emit(AppEvents.TIMELINE_UPDATE, {
      view,
      timelineView: { ...param.timeline, ...dateConfiguration },
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
    return view;
  }
}
