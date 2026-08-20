import type { MetaType, TimelineType } from 'nocodb-sdk';
import type { NcContext } from '~/interface/config';
import Noco from '~/Noco';
import NocoCache from '~/cache/NocoCache';
import { extractProps } from '~/helpers/extractProps';
import TimelineViewColumn from '~/models/TimelineViewColumn';
import { CacheGetType, CacheScope, MetaTable } from '~/utils/globals';
import { prepareForDb, prepareForResponse } from '~/utils/modelUtils';

export default class TimelineView implements TimelineType {
  fk_view_id: string;
  fk_workspace_id?: string;
  base_id?: string;
  source_id?: string;
  fk_title_column_id?: string;
  fk_start_column_id?: string;
  fk_end_column_id?: string;
  zoom?: TimelineType['zoom'];
  meta?: MetaType;
  columns?: TimelineViewColumn[];

  constructor(data: TimelineView) {
    Object.assign(this, data);
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
        `${CacheScope.TIMELINE_VIEW}:${viewId}`,
        CacheGetType.TYPE_OBJECT,
      ));

    if (!view) {
      view = await ncMeta.metaGet2(
        context.workspace_id,
        context.base_id,
        MetaTable.TIMELINE_VIEW,
        { fk_view_id: viewId },
      );
      if (view) {
        await NocoCache.set(
          context,
          `${CacheScope.TIMELINE_VIEW}:${viewId}`,
          view,
        );
      }
    }

    return view && new TimelineView(view);
  }

  static async insert(
    context: NcContext,
    view: Partial<TimelineView>,
    ncMeta = Noco.ncMeta,
  ) {
    const insertObj = extractProps(view, [
      'base_id',
      'source_id',
      'fk_view_id',
      'fk_title_column_id',
      'fk_start_column_id',
      'fk_end_column_id',
      'zoom',
      'meta',
    ]);
    insertObj.zoom ??= 'week';

    await ncMeta.metaInsert2(
      context.workspace_id,
      context.base_id,
      MetaTable.TIMELINE_VIEW,
      prepareForDb(insertObj),
      true,
    );

    return this.get(context, view.fk_view_id, ncMeta);
  }

  static async update(
    context: NcContext,
    viewId: string,
    body: Partial<TimelineView>,
    ncMeta = Noco.ncMeta,
  ) {
    const updateObj = extractProps(body, [
      'fk_title_column_id',
      'fk_start_column_id',
      'fk_end_column_id',
      'zoom',
      'meta',
    ]);

    const res = await ncMeta.metaUpdate(
      context.workspace_id,
      context.base_id,
      MetaTable.TIMELINE_VIEW,
      prepareForDb(updateObj),
      { fk_view_id: viewId },
    );

    await NocoCache.update(
      context,
      `${CacheScope.TIMELINE_VIEW}:${viewId}`,
      prepareForResponse(updateObj),
    );

    return res;
  }

  async getColumns(context: NcContext, ncMeta = Noco.ncMeta) {
    return (this.columns = await TimelineViewColumn.list(
      context,
      this.fk_view_id,
      ncMeta,
    ));
  }
}
