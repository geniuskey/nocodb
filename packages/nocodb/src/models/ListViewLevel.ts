import type { BoolType, MetaType } from 'nocodb-sdk';
import type { NcContext } from '~/interface/config';
import View from '~/models/View';
import Noco from '~/Noco';
import NocoCache from '~/cache/NocoCache';
import { extractProps } from '~/helpers/extractProps';
import { CacheDelDirection, CacheScope, MetaTable } from '~/utils/globals';
import { prepareForDb, prepareForResponse } from '~/utils/modelUtils';

export default class ListViewLevel {
  id: string;
  fk_view_id: string;
  fk_relation_column_id: string;
  fk_related_model_id: string;
  order: number;
  base_id?: string;
  source_id?: string;
  fields?: string[];
  where?: string;
  sort?: string | string[];
  show_empty?: BoolType;
  page_size?: number;
  recursive?: BoolType;
  max_depth?: number;
  meta?: MetaType;

  constructor(data: ListViewLevel) {
    Object.assign(this, prepareForResponse(data, ['fields', 'sort', 'meta']));
    this.show_empty = Boolean(this.show_empty);
    this.recursive = Boolean(this.recursive);
  }

  static async list(
    context: NcContext,
    viewId: string,
    ncMeta = Noco.ncMeta,
  ): Promise<ListViewLevel[]> {
    const cached = await NocoCache.getList(CacheScope.LIST_VIEW_LEVEL, [
      viewId,
    ]);
    let { list } = cached;
    if (!cached.isNoneList && !list.length) {
      list = await ncMeta.metaList2(
        context.workspace_id,
        context.base_id,
        MetaTable.LIST_VIEW_LEVELS,
        { condition: { fk_view_id: viewId }, orderBy: { order: 'asc' } },
      );
      list = list.map((level) =>
        prepareForResponse(level, ['fields', 'sort', 'meta']),
      );
      await NocoCache.setList(CacheScope.LIST_VIEW_LEVEL, [viewId], list);
    }
    return list
      .map((level) => new ListViewLevel(level))
      .sort((a, b) => a.order - b.order);
  }

  static async replace(
    context: NcContext,
    viewId: string,
    levels: Partial<ListViewLevel>[],
    ncMeta = Noco.ncMeta,
  ): Promise<ListViewLevel[]> {
    const view = await View.get(context, viewId, ncMeta);
    const rows = await Promise.all(
      levels.map(async (level, index) =>
        prepareForDb(
          {
            ...extractProps(level, [
              'fk_relation_column_id',
              'fk_related_model_id',
              'fields',
              'where',
              'sort',
              'show_empty',
              'page_size',
              'recursive',
              'max_depth',
              'meta',
            ]),
            id: await ncMeta.genNanoid(MetaTable.LIST_VIEW_LEVELS),
            fk_view_id: viewId,
            base_id: view.base_id,
            source_id: view.source_id,
            order: index + 1,
          },
          ['fields', 'sort', 'meta'],
        ),
      ),
    );
    const transaction = await ncMeta.startTransaction();
    try {
      await transaction.metaDelete(
        context.workspace_id,
        context.base_id,
        MetaTable.LIST_VIEW_LEVELS,
        { fk_view_id: viewId },
      );
      if (rows.length) {
        await transaction.bulkMetaInsert(
          context.workspace_id,
          context.base_id,
          MetaTable.LIST_VIEW_LEVELS,
          rows,
        );
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }

    await NocoCache.deepDel(
      `${CacheScope.LIST_VIEW_LEVEL}:${viewId}`,
      CacheDelDirection.PARENT_TO_CHILD,
    );

    return this.list(context, viewId, ncMeta);
  }

  static async deleteAll(
    context: NcContext,
    viewId: string,
    ncMeta = Noco.ncMeta,
  ) {
    await ncMeta.metaDelete(
      context.workspace_id,
      context.base_id,
      MetaTable.LIST_VIEW_LEVELS,
      { fk_view_id: viewId },
    );
    await NocoCache.deepDel(
      `${CacheScope.LIST_VIEW_LEVEL}:${viewId}`,
      CacheDelDirection.PARENT_TO_CHILD,
    );
  }
}
