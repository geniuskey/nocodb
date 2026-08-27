import type { ListType, MetaType } from 'nocodb-sdk';
import type { NcContext } from '~/interface/config';
import ListViewColumn from '~/models/ListViewColumn';
import ListViewLevel from '~/models/ListViewLevel';
import View from '~/models/View';
import Noco from '~/Noco';
import NocoCache from '~/cache/NocoCache';
import { extractProps } from '~/helpers/extractProps';
import { CacheGetType, CacheScope, MetaTable } from '~/utils/globals';
import { prepareForDb, prepareForResponse } from '~/utils/modelUtils';

export default class ListView implements ListType {
  fk_view_id: string;
  fk_workspace_id?: string;
  base_id?: string;
  source_id?: string;
  meta?: MetaType;
  row_height?: number;
  columns?: ListViewColumn[];
  levels?: ListViewLevel[];

  constructor(data: ListView) {
    Object.assign(this, prepareForResponse(data));
  }

  async getColumns(context: NcContext): Promise<ListViewColumn[]> {
    return (this.columns = await ListViewColumn.list(context, this.fk_view_id));
  }

  async getLevels(
    context: NcContext,
    ncMeta = Noco.ncMeta,
  ): Promise<ListViewLevel[]> {
    return (this.levels = await ListViewLevel.list(
      context,
      this.fk_view_id,
      ncMeta,
    ));
  }

  static async get(context: NcContext, viewId: string, ncMeta = Noco.ncMeta) {
    let view =
      viewId &&
      (await NocoCache.get(
        `${CacheScope.LIST_VIEW}:${viewId}`,
        CacheGetType.TYPE_OBJECT,
      ));
    if (!view) {
      view = await ncMeta.metaGet2(
        context.workspace_id,
        context.base_id,
        MetaTable.LIST_VIEW,
        { fk_view_id: viewId },
      );
      await NocoCache.set(`${CacheScope.LIST_VIEW}:${viewId}`, view);
    }
    if (!view) return undefined;
    const listView = new ListView(view);
    await listView.getLevels(context, ncMeta);
    return listView;
  }

  static async insert(
    context: NcContext,
    view: Partial<ListView>,
    ncMeta = Noco.ncMeta,
  ) {
    const insertObj = extractProps(view, [
      'fk_view_id',
      'base_id',
      'source_id',
      'row_height',
      'meta',
    ]);
    const viewRef = await View.get(context, insertObj.fk_view_id, ncMeta);
    if (!insertObj.source_id) insertObj.source_id = viewRef.source_id;

    await ncMeta.metaInsert2(
      context.workspace_id,
      context.base_id,
      MetaTable.LIST_VIEW,
      prepareForDb(insertObj),
      true,
    );
    if (view.levels?.length) {
      await ListViewLevel.replace(
        context,
        view.fk_view_id,
        view.levels,
        ncMeta,
      );
    }
    return this.get(context, view.fk_view_id, ncMeta);
  }

  static async update(
    context: NcContext,
    viewId: string,
    body: Pick<Partial<ListView>, 'row_height' | 'meta'>,
    ncMeta = Noco.ncMeta,
  ) {
    const updateObj = extractProps(body, ['row_height', 'meta']);
    const res = await ncMeta.metaUpdate(
      context.workspace_id,
      context.base_id,
      MetaTable.LIST_VIEW,
      prepareForDb(updateObj),
      { fk_view_id: viewId },
    );
    await NocoCache.update(
      `${CacheScope.LIST_VIEW}:${viewId}`,
      prepareForResponse(updateObj),
    );
    return res;
  }
}
