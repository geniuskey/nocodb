import type { BoolType, ListType, MetaType } from 'nocodb-sdk';
import type { NcContext } from '~/interface/config';
import ListViewColumn from '~/models/ListViewColumn';
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
  fk_title_column_id?: string;
  fk_subtitle_column_id?: string;
  fk_image_column_id?: string;
  density?: ListType['density'];
  show_field_labels?: BoolType;
  meta?: MetaType;
  columns?: ListViewColumn[];

  constructor(data: ListView) {
    Object.assign(this, data);
  }

  async getColumns(context: NcContext): Promise<ListViewColumn[]> {
    return (this.columns = await ListViewColumn.list(context, this.fk_view_id));
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
      await NocoCache.set(context, `${CacheScope.LIST_VIEW}:${viewId}`, view);
    }

    return view && new ListView(view);
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
      'fk_title_column_id',
      'fk_subtitle_column_id',
      'fk_image_column_id',
      'density',
      'show_field_labels',
      'meta',
    ]);
    const viewRef = await View.get(context, insertObj.fk_view_id, ncMeta);

    insertObj.source_id ||= viewRef.source_id;
    insertObj.density ??= 'comfortable';
    insertObj.show_field_labels ??= true;

    await ncMeta.metaInsert2(
      context.workspace_id,
      context.base_id,
      MetaTable.LIST_VIEW,
      prepareForDb(insertObj),
      true,
    );

    return this.get(context, view.fk_view_id, ncMeta);
  }

  static async update(
    context: NcContext,
    viewId: string,
    body: Partial<ListView>,
    ncMeta = Noco.ncMeta,
  ) {
    const updateObj = extractProps(body, [
      'fk_title_column_id',
      'fk_subtitle_column_id',
      'fk_image_column_id',
      'density',
      'show_field_labels',
      'meta',
    ]);

    const res = await ncMeta.metaUpdate(
      context.workspace_id,
      context.base_id,
      MetaTable.LIST_VIEW,
      prepareForDb(updateObj),
      { fk_view_id: viewId },
    );

    await NocoCache.update(
      context,
      `${CacheScope.LIST_VIEW}:${viewId}`,
      prepareForResponse(updateObj),
    );

    return res;
  }
}
