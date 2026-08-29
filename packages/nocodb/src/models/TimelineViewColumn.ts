import { type BoolType, VIEW_GRID_DEFAULT_WIDTH } from 'nocodb-sdk';
import type { NcContext } from '~/interface/config';
import View from '~/models/View';
import Noco from '~/Noco';
import NocoCache from '~/cache/NocoCache';
import { extractProps } from '~/helpers/extractProps';
import { CacheGetType, CacheScope, MetaTable } from '~/utils/globals';

export default class TimelineViewColumn {
  id: string;
  show: BoolType;
  order: number;
  width?: string;
  bold?: BoolType;
  italic?: BoolType;
  underline?: BoolType;
  fk_view_id: string;
  fk_column_id: string;
  fk_workspace_id?: string;
  base_id?: string;
  source_id?: string;

  constructor(data: TimelineViewColumn) {
    Object.assign(this, data);
  }

  static async list(
    context: NcContext,
    viewId: string,
    ncMeta = Noco.ncMeta,
  ): Promise<TimelineViewColumn[]> {
    const cached = await NocoCache.getList(CacheScope.TIMELINE_VIEW_COLUMN, [
      viewId,
    ]);
    let { list } = cached;
    if (!cached.isNoneList && !list.length) {
      list = await ncMeta.metaList2(
        context.workspace_id,
        context.base_id,
        MetaTable.TIMELINE_VIEW_COLUMNS,
        { condition: { fk_view_id: viewId }, orderBy: { order: 'asc' } },
      );
      await NocoCache.setList(CacheScope.TIMELINE_VIEW_COLUMN, [viewId], list);
    }
    list.sort(
      (a, b) =>
        (a.order != null ? a.order : Infinity) -
        (b.order != null ? b.order : Infinity),
    );
    return list.map((column) => new TimelineViewColumn(column));
  }

  static async get(context: NcContext, id: string, ncMeta = Noco.ncMeta) {
    let column =
      id &&
      (await NocoCache.get(
        `${CacheScope.TIMELINE_VIEW_COLUMN}:${id}`,
        CacheGetType.TYPE_OBJECT,
      ));
    if (!column) {
      column = await ncMeta.metaGet2(
        context.workspace_id,
        context.base_id,
        MetaTable.TIMELINE_VIEW_COLUMNS,
        id,
      );
      if (column) {
        await NocoCache.set(`${CacheScope.TIMELINE_VIEW_COLUMN}:${id}`, column);
      }
    }
    return column && new TimelineViewColumn(column);
  }

  static async insert(
    context: NcContext,
    column: Partial<TimelineViewColumn>,
    ncMeta = Noco.ncMeta,
  ) {
    const insertObj = extractProps(column, [
      'fk_view_id',
      'fk_column_id',
      'show',
      'base_id',
      'source_id',
      'order',
      'width',
      'bold',
      'italic',
      'underline',
    ]);
    insertObj.order =
      column.order ??
      (await ncMeta.metaGetNextOrder(MetaTable.TIMELINE_VIEW_COLUMNS, {
        fk_view_id: column.fk_view_id,
      }));
    insertObj.width = column.width ?? `${VIEW_GRID_DEFAULT_WIDTH}px`;
    if (!insertObj.source_id) {
      const view = await View.get(context, insertObj.fk_view_id, ncMeta);
      insertObj.source_id = view.source_id;
    }
    const { id } = await ncMeta.metaInsert2(
      context.workspace_id,
      context.base_id,
      MetaTable.TIMELINE_VIEW_COLUMNS,
      insertObj,
    );
    const view = await View.get(context, column.fk_view_id, ncMeta);
    await View.clearSingleQueryCache(
      context,
      view.fk_model_id,
      undefined,
      ncMeta,
    );
    const viewColumn = await this.get(context, id, ncMeta);
    await NocoCache.appendToList(
      CacheScope.TIMELINE_VIEW_COLUMN,
      [column.fk_view_id],
      `${CacheScope.TIMELINE_VIEW_COLUMN}:${id}`,
    );
    return viewColumn;
  }

  static async update(
    context: NcContext,
    id: string,
    body: Partial<TimelineViewColumn>,
    ncMeta = Noco.ncMeta,
  ) {
    const updateObj = extractProps(body, [
      'order',
      'show',
      'width',
      'bold',
      'italic',
      'underline',
    ]);
    const res = await ncMeta.metaUpdate(
      context.workspace_id,
      context.base_id,
      MetaTable.TIMELINE_VIEW_COLUMNS,
      updateObj,
      id,
    );
    await NocoCache.update(
      `${CacheScope.TIMELINE_VIEW_COLUMN}:${id}`,
      updateObj,
    );
    const timelineColumn = await this.get(context, id, ncMeta);
    const view = await View.get(context, timelineColumn.fk_view_id, ncMeta);
    await View.clearSingleQueryCache(context, view.fk_model_id, [view], ncMeta);
    return res;
  }
}
