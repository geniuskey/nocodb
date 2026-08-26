import { Injectable } from '@nestjs/common';
import { AppEvents, EventType, ViewTypes } from 'nocodb-sdk';
import type { ListUpdateReqType, ViewCreateReqType } from 'nocodb-sdk';
import type { NcContext, NcRequest } from '~/interface/config';
import type { MetaService } from '~/meta/meta.service';
import { AppHooksService } from '~/services/app-hooks/app-hooks.service';
import { validatePayload } from '~/helpers';
import { NcError } from '~/helpers/catchError';
import { ListView, Model, User, View } from '~/models';
import NocoCache from '~/cache/NocoCache';
import { CacheScope } from '~/utils/globals';
import NocoSocket from '~/socket/NocoSocket';

@Injectable()
export class ListsService {
  constructor(private readonly appHooksService: AppHooksService) {}

  async listViewGet(
    context: NcContext,
    param: { listViewId: string },
    ncMeta?: MetaService,
  ) {
    const view = await View.get(context, param.listViewId, ncMeta);
    if (!view || view.type !== ViewTypes.LIST) {
      NcError.viewNotFound(param.listViewId);
    }
    return await ListView.get(context, param.listViewId, ncMeta);
  }

  async listViewCreate(
    context: NcContext,
    param: { tableId: string; list: ViewCreateReqType; req: NcRequest },
    ncMeta?: MetaService,
  ) {
    validatePayload(
      'swagger.json#/components/schemas/ViewCreateReq',
      param.list,
    );
    const model = await Model.get(context, param.tableId, ncMeta);
    param.list.title = param.list.title?.trim();
    const existing = await View.getByTitleOrId(
      context,
      { titleOrId: param.list.title, fk_model_id: param.tableId },
      ncMeta,
    );
    if (existing) {
      NcError.get(context).duplicateAlias({
        type: 'view',
        alias: param.list.title,
        label: 'title',
        base: context.base_id,
        additionalTrace: { table: param.tableId },
      });
    }

    const { id } = await View.insertMetaOnly(
      context,
      {
        view: {
          ...param.list,
          fk_model_id: param.tableId,
          type: ViewTypes.LIST,
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
    this.appHooksService.emit(AppEvents.LIST_CREATE, {
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

  async listViewUpdate(
    context: NcContext,
    param: { listViewId: string; list: ListUpdateReqType; req: NcRequest },
    ncMeta?: MetaService,
  ) {
    validatePayload(
      'swagger.json#/components/schemas/ListUpdateReq',
      param.list,
    );
    const view = await View.get(context, param.listViewId, ncMeta);
    if (!view || view.type !== ViewTypes.LIST) {
      NcError.viewNotFound(param.listViewId);
    }
    const oldListView = await ListView.get(context, param.listViewId, ncMeta);
    await ListView.update(context, param.listViewId, param.list, ncMeta);
    let owner = param.req.user;
    if (view.owned_by && view.owned_by !== param.req.user?.id) {
      owner = await User.get(view.owned_by, ncMeta);
    }
    this.appHooksService.emit(AppEvents.LIST_UPDATE, {
      view,
      listView: param.list,
      oldListView,
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
