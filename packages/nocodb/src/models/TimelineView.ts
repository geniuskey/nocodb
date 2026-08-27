import type { MetaType, TimelineType } from 'nocodb-sdk';
import type { NcContext } from '~/interface/config';
import View from '~/models/View';
import Noco from '~/Noco';
import NocoCache from '~/cache/NocoCache';
import { extractProps } from '~/helpers/extractProps';
import { CacheGetType, CacheScope, MetaTable } from '~/utils/globals';
import { prepareForDb, prepareForResponse } from '~/utils/modelUtils';

const TIMELINE_ZOOMS = new Set(['month']);
const TIMELINE_INITIAL_MODES = new Set(['closest_record', 'today']);

export default class TimelineView implements TimelineType {
  fk_view_id: string;
  fk_workspace_id?: string;
  base_id?: string;
  source_id?: string;
  fk_start_date_col_id: string;
  fk_end_date_col_id?: string | null;
  zoom?: string;
  initial_mode?: string;
  meta?: MetaType;

  constructor(data: TimelineView) {
    Object.assign(this, prepareForResponse(data));
    this.zoom = TIMELINE_ZOOMS.has(this.zoom) ? this.zoom : 'month';
    this.initial_mode = TIMELINE_INITIAL_MODES.has(this.initial_mode)
      ? this.initial_mode
      : 'today';
  }

  static async get(context: NcContext, viewId: string, ncMeta = Noco.ncMeta) {
    let view =
      viewId &&
      (await NocoCache.get(
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
      await NocoCache.set(`${CacheScope.TIMELINE_VIEW}:${viewId}`, view);
    }
    return view && new TimelineView(view);
  }

  static async insert(
    context: NcContext,
    view: Partial<TimelineView>,
    ncMeta = Noco.ncMeta,
  ) {
    const insertObj = extractProps(view, [
      'fk_view_id',
      'base_id',
      'source_id',
      'fk_start_date_col_id',
      'fk_end_date_col_id',
      'zoom',
      'initial_mode',
      'meta',
    ]);
    const viewRef = await View.get(context, insertObj.fk_view_id, ncMeta);
    if (!insertObj.source_id) insertObj.source_id = viewRef.source_id;
    insertObj.zoom = TIMELINE_ZOOMS.has(insertObj.zoom)
      ? insertObj.zoom
      : 'month';
    insertObj.initial_mode = TIMELINE_INITIAL_MODES.has(insertObj.initial_mode)
      ? insertObj.initial_mode
      : 'today';

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
      'fk_start_date_col_id',
      'fk_end_date_col_id',
      'zoom',
      'initial_mode',
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
      `${CacheScope.TIMELINE_VIEW}:${viewId}`,
      prepareForResponse(updateObj),
    );
    return res;
  }
}
