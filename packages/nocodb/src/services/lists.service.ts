import { Injectable } from '@nestjs/common';
import { AppEvents, EventType, ViewTypes } from 'nocodb-sdk';
import type { ListUpdateReqType, ViewCreateReqType } from 'nocodb-sdk';
import type { NcContext, NcRequest } from '~/interface/config';
import type { MetaService } from '~/meta/meta.service';
import {
  type ViewWebhookManager,
  ViewWebhookManagerBuilder,
} from '~/utils/view-webhook-manager';
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

  async listViewCreate(
    context: NcContext,
    param: {
      tableId: string;
      list: ViewCreateReqType;
      req: NcRequest;
      ownedBy?: string;
      viewWebhookManager?: ViewWebhookManager;
    },
    ncMeta?: MetaService,
  ) {
    validatePayload(
      'swagger.json#/components/schemas/ViewCreateReq',
      param.list,
    );

    const model = await Model.get(context, param.tableId, ncMeta);
    param.list.title = param.list.title?.trim();
    const existingView = await View.getByTitleOrId(
      context,
      {
        titleOrId: param.list.title,
        fk_model_id: param.tableId,
      },
      ncMeta,
    );

    if (existingView) {
      NcError.get(context).duplicateAlias({
        type: 'view',
        alias: param.list.title,
        label: 'title',
        base: context.base_id,
        additionalTrace: { table: param.tableId },
      });
    }

    const viewWebhookManager =
      param.viewWebhookManager ??
      (
        await new ViewWebhookManagerBuilder(context, ncMeta).withModelId(
          param.tableId,
        )
      ).forCreate();

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
          owned_by: param.ownedBy || param.req.user?.id,
        },
        model,
        req: param.req,
      },
      ncMeta,
    );

    const view = await View.get(context, id, ncMeta);
    await NocoCache.appendToList(
      context,
      CacheScope.VIEW,
      [view.fk_model_id],
      `${CacheScope.VIEW}:${id}`,
    );

    const owner = param.ownedBy
      ? await User.get(param.ownedBy, ncMeta)
      : param.req.user;

    this.appHooksService.emit(AppEvents.LIST_CREATE, {
      view,
      req: param.req,
      owner,
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

    if (!param.viewWebhookManager) {
      (await viewWebhookManager.withNewViewId(view.id)).emit();
    }

    return view;
  }

  async listViewUpdate(
    context: NcContext,
    param: {
      viewId: string;
      list: ListUpdateReqType;
      req: NcRequest;
      viewWebhookManager?: ViewWebhookManager;
    },
    ncMeta?: MetaService,
  ) {
    validatePayload(
      'swagger.json#/components/schemas/ListUpdateReq',
      param.list,
    );

    const view = await View.get(context, param.viewId, ncMeta);
    if (!view || view.type !== ViewTypes.LIST) {
      NcError.viewNotFound(param.viewId);
    }

    const oldListView = await ListView.get(context, param.viewId, ncMeta);
    const viewWebhookManager =
      param.viewWebhookManager ??
      (
        await (
          await new ViewWebhookManagerBuilder(context, ncMeta).withModelId(
            view.fk_model_id,
          )
        ).withViewId(param.viewId)
      ).forUpdate();

    await ListView.update(context, param.viewId, param.list, ncMeta);

    const owner =
      view.owned_by && view.owned_by !== param.req.user?.id
        ? await User.get(view.owned_by, ncMeta)
        : param.req.user;

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

    if (!param.viewWebhookManager) {
      (await viewWebhookManager.withNewViewId(view.id)).emit();
    }

    return view;
  }
}
