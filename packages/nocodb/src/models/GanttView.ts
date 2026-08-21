import type { GanttType, GanttWorkingCalendarType, MetaType } from 'nocodb-sdk';
import type { NcContext } from '~/interface/config';
import Noco from '~/Noco';
import NocoCache from '~/cache/NocoCache';
import { extractProps } from '~/helpers/extractProps';
import GanttViewColumn from '~/models/GanttViewColumn';
import { CacheGetType, CacheScope, MetaTable } from '~/utils/globals';
import { prepareForDb, prepareForResponse } from '~/utils/modelUtils';
import {
  DEFAULT_GANTT_WORKING_CALENDAR,
  normalizeGanttWorkingCalendar,
} from '~/helpers/ganttWorkingCalendar';

export default class GanttView implements GanttType {
  fk_view_id: string;
  fk_workspace_id?: string;
  base_id?: string;
  source_id?: string;
  fk_title_column_id?: string;
  fk_start_column_id?: string;
  fk_end_column_id?: string;
  fk_progress_column_id?: string;
  fk_milestone_column_id?: string;
  zoom?: GanttType['zoom'];
  working_calendar?: GanttWorkingCalendarType;
  meta?: MetaType;
  columns?: GanttViewColumn[];

  constructor(data: GanttView) {
    const prepared = prepareForResponse({ ...data });
    Object.assign(this, prepared);
    try {
      this.working_calendar = normalizeGanttWorkingCalendar(
        (prepared.meta as any)?.working_calendar,
      );
    } catch {
      this.working_calendar = normalizeGanttWorkingCalendar(
        DEFAULT_GANTT_WORKING_CALENDAR,
      );
    }
  }

  public static async get(
    context: NcContext,
    viewId: string,
    ncMeta = Noco.ncMeta,
  ) {
    let view =
      viewId &&
      (await NocoCache.get(
        context,
        `${CacheScope.GANTT_VIEW}:${viewId}`,
        CacheGetType.TYPE_OBJECT,
      ));

    if (!view) {
      view = await ncMeta.metaGet2(
        context.workspace_id,
        context.base_id,
        MetaTable.GANTT_VIEW,
        { fk_view_id: viewId },
      );
      if (view) {
        await NocoCache.set(
          context,
          `${CacheScope.GANTT_VIEW}:${viewId}`,
          view,
        );
      }
    }

    return view && new GanttView(view);
  }

  static async insert(
    context: NcContext,
    view: Partial<GanttView>,
    ncMeta = Noco.ncMeta,
  ) {
    const insertObj = extractProps(view, [
      'base_id',
      'source_id',
      'fk_view_id',
      'fk_title_column_id',
      'fk_start_column_id',
      'fk_end_column_id',
      'fk_progress_column_id',
      'fk_milestone_column_id',
      'zoom',
      'meta',
    ]);
    insertObj.zoom ??= 'week';
    const workingCalendar = normalizeGanttWorkingCalendar(
      view.working_calendar,
    );
    const preparedMeta = prepareForResponse({ meta: insertObj.meta }).meta;
    insertObj.meta = {
      ...((preparedMeta as Record<string, any>) ?? {}),
      working_calendar: workingCalendar,
    };

    await ncMeta.metaInsert2(
      context.workspace_id,
      context.base_id,
      MetaTable.GANTT_VIEW,
      prepareForDb(insertObj),
      true,
    );

    return this.get(context, view.fk_view_id, ncMeta);
  }

  static async update(
    context: NcContext,
    viewId: string,
    body: Partial<GanttView>,
    ncMeta = Noco.ncMeta,
  ) {
    const updateObj = extractProps(body, [
      'fk_title_column_id',
      'fk_start_column_id',
      'fk_end_column_id',
      'fk_progress_column_id',
      'fk_milestone_column_id',
      'zoom',
      'meta',
    ]);
    if ('working_calendar' in body) {
      const current = await this.get(context, viewId, ncMeta);
      const bodyMeta = prepareForResponse({ meta: body.meta }).meta;
      updateObj.meta = {
        ...((current?.meta as Record<string, any>) ?? {}),
        ...((bodyMeta as Record<string, any>) ?? {}),
        working_calendar: normalizeGanttWorkingCalendar(body.working_calendar),
      };
    }

    const res = await ncMeta.metaUpdate(
      context.workspace_id,
      context.base_id,
      MetaTable.GANTT_VIEW,
      prepareForDb(updateObj),
      { fk_view_id: viewId },
    );

    await NocoCache.update(
      context,
      `${CacheScope.GANTT_VIEW}:${viewId}`,
      prepareForResponse(updateObj),
    );

    return res;
  }

  async getColumns(context: NcContext, ncMeta = Noco.ncMeta) {
    return (this.columns = await GanttViewColumn.list(
      context,
      this.fk_view_id,
      ncMeta,
    ));
  }
}
