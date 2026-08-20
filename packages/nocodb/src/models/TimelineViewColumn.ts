import type { BoolType, TimelineColumnType } from 'nocodb-sdk';
import type { NcContext } from '~/interface/config';
import View from '~/models/View';
import Noco from '~/Noco';
import NocoCache from '~/cache/NocoCache';
import { extractProps } from '~/helpers/extractProps';
import { CacheGetType, CacheScope, MetaTable } from '~/utils/globals';

export default class TimelineViewColumn implements TimelineColumnType {
  id: string;
  show: BoolType;
  order: number;
  fk_view_id: string;
  fk_column_id: string;
  fk_workspace_id?: string;
  base_id?: string;
  source_id?: string;

  constructor(data: TimelineViewColumn) {
    Object.assign(this, data);
  }

  public static async get(
    context: NcContext,
    timelineViewColumnId: string,
    ncMeta = Noco.ncMeta,
  ) {
    let viewColumn =
      timelineViewColumnId &&
      (await NocoCache.get(
        context,
        `${CacheScope.TIMELINE_VIEW_COLUMN}:${timelineViewColumnId}`,
        CacheGetType.TYPE_OBJECT,
      ));

    if (!viewColumn) {
      viewColumn = await ncMeta.metaGet2(
        context.workspace_id,
        context.base_id,
        MetaTable.TIMELINE_VIEW_COLUMNS,
        timelineViewColumnId,
      );
      if (viewColumn) {
        await NocoCache.set(
          context,
          `${CacheScope.TIMELINE_VIEW_COLUMN}:${timelineViewColumnId}`,
          viewColumn,
        );
      }
    }

    return viewColumn && new TimelineViewColumn(viewColumn);
  }

  public static async list(
    context: NcContext,
    viewId: string,
    ncMeta = Noco.ncMeta,
  ): Promise<TimelineViewColumn[]> {
    const cachedList = await NocoCache.getList(
      context,
      CacheScope.TIMELINE_VIEW_COLUMN,
      [viewId],
    );
    let { list: columns } = cachedList;

    if (!cachedList.isNoneList && !columns.length) {
      columns = await ncMeta.metaList2(
        context.workspace_id,
        context.base_id,
        MetaTable.TIMELINE_VIEW_COLUMNS,
        {
          condition: { fk_view_id: viewId },
          orderBy: { order: 'asc' },
        },
      );
      await NocoCache.setList(
        context,
        CacheScope.TIMELINE_VIEW_COLUMN,
        [viewId],
        columns,
      );
    }

    columns.sort(
      (a, b) =>
        (a.order != null ? a.order : Infinity) -
        (b.order != null ? b.order : Infinity),
    );
    return columns.map((column) => new TimelineViewColumn(column));
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
    ]);

    insertObj.order ??= await ncMeta.metaGetNextOrder(
      MetaTable.TIMELINE_VIEW_COLUMNS,
      { fk_view_id: column.fk_view_id },
    );
    insertObj.show ??= true;

    if (!insertObj.source_id) {
      const viewRef = await View.get(context, insertObj.fk_view_id, ncMeta);
      insertObj.source_id = viewRef.source_id;
    }

    const { id } = await ncMeta.metaInsert2(
      context.workspace_id,
      context.base_id,
      MetaTable.TIMELINE_VIEW_COLUMNS,
      insertObj,
    );

    const view = await View.get(context, column.fk_view_id, ncMeta);
    await View.clearSingleQueryCache(context, view.fk_model_id, [view], ncMeta);

    const viewColumn = await this.get(context, id, ncMeta);
    await NocoCache.appendToList(
      context,
      CacheScope.TIMELINE_VIEW_COLUMN,
      [column.fk_view_id],
      `${CacheScope.TIMELINE_VIEW_COLUMN}:${id}`,
    );
    return viewColumn;
  }

  static async update(
    context: NcContext,
    columnId: string,
    body: Partial<TimelineViewColumn>,
    ncMeta = Noco.ncMeta,
  ) {
    const updateObj = extractProps(body, ['order', 'show']);
    const res = await ncMeta.metaUpdate(
      context.workspace_id,
      context.base_id,
      MetaTable.TIMELINE_VIEW_COLUMNS,
      updateObj,
      columnId,
    );

    await NocoCache.update(
      context,
      `${CacheScope.TIMELINE_VIEW_COLUMN}:${columnId}`,
      updateObj,
    );

    const timelineColumn = await this.get(context, columnId, ncMeta);
    const view = await View.get(context, timelineColumn.fk_view_id, ncMeta);
    await View.clearSingleQueryCache(context, view.fk_model_id, [view], ncMeta);

    return res;
  }
}
