import { Injectable } from '@nestjs/common';
import {
  AppEvents,
  EventType,
  isLinksOrLTAR,
  RelationTypes,
  ViewTypes,
} from 'nocodb-sdk';
import type {
  ListViewLevelType,
  ListUpdateReqType,
  ViewCreateReqType,
} from 'nocodb-sdk';
import type { NcContext, NcRequest } from '~/interface/config';
import type { MetaService } from '~/meta/meta.service';
import { AppHooksService } from '~/services/app-hooks/app-hooks.service';
import { validatePayload } from '~/helpers';
import { NcError } from '~/helpers/catchError';
import { ListView, ListViewLevel, Model, User, View } from '~/models';
import NocoCache from '~/cache/NocoCache';
import { CacheScope } from '~/utils/globals';
import NocoSocket from '~/socket/NocoSocket';

@Injectable()
export class ListsService {
  constructor(private readonly appHooksService: AppHooksService) {}

  private async validateLevels(
    context: NcContext,
    view: View,
    levels: ListViewLevelType[],
    ncMeta?: MetaService,
  ): Promise<Partial<ListViewLevel>[]> {
    if (levels.length > 3) {
      NcError.get(context).invalidRequestBody(
        'A List hierarchy supports at most three linked levels',
      );
    }

    let currentModel = await Model.get(context, view.fk_model_id, ncMeta);
    if (!currentModel) NcError.tableNotFound(view.fk_model_id);
    const visitedModels = new Set<string>([currentModel.id]);
    let effectiveDepth = 0;
    const normalized: Partial<ListViewLevel>[] = [];

    for (const [index, level] of levels.entries()) {
      const relationColumnId = level.fk_relation_column_id;
      const columns = await currentModel.getColumns(context, ncMeta);
      const relation = columns.find((column) => column.id === relationColumnId);
      const relationOptions = relation?.colOptions as
        | { type?: RelationTypes; fk_related_model_id?: string }
        | undefined;

      if (
        !relation ||
        !isLinksOrLTAR(relation) ||
        relationOptions?.type !== RelationTypes.HAS_MANY ||
        !relationOptions.fk_related_model_id
      ) {
        NcError.get(context).invalidRequestBody(
          `Hierarchy level ${
            index + 1
          } must reference a Has-Many field on the preceding table`,
        );
      }

      const relatedModel = await Model.get(
        context,
        relationOptions.fk_related_model_id,
        ncMeta,
      );
      if (!relatedModel) {
        NcError.get(context).invalidRequestBody(
          `Hierarchy level ${index + 1} references a table outside this base`,
        );
      }

      const selfReference = relatedModel.id === currentModel.id;
      const recursive = Boolean(level.recursive);
      if (recursive && !selfReference) {
        NcError.get(context).invalidRequestBody(
          'Recursive expansion is only valid for a self-referential Has-Many field',
        );
      }
      if (recursive && index !== levels.length - 1) {
        NcError.get(context).invalidRequestBody(
          'A recursive hierarchy level must be the final configured level',
        );
      }
      if (!selfReference && visitedModels.has(relatedModel.id)) {
        NcError.get(context).invalidRequestBody(
          'A table may appear only once in a List hierarchy',
        );
      }

      const maxDepth = recursive ? Number(level.max_depth ?? 1) : 1;
      if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 3) {
        NcError.get(context).invalidRequestBody(
          'Hierarchy max_depth must be an integer from 1 to 3',
        );
      }
      effectiveDepth += maxDepth;
      if (effectiveDepth > 3) {
        NcError.get(context).invalidRequestBody(
          'A List hierarchy supports at most three effective levels',
        );
      }

      const pageSize = Number(level.page_size ?? 25);
      if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
        NcError.get(context).invalidRequestBody(
          'Hierarchy page_size must be an integer from 1 to 100',
        );
      }

      const relatedColumns = await relatedModel.getColumns(context, ncMeta);
      const fieldIds = level.fields ?? [];
      if (new Set(fieldIds).size !== fieldIds.length) {
        NcError.get(context).invalidRequestBody(
          `Hierarchy level ${index + 1} contains duplicate fields`,
        );
      }
      if (
        fieldIds.some(
          (fieldId) => !relatedColumns.some((column) => column.id === fieldId),
        )
      ) {
        NcError.get(context).invalidRequestBody(
          `Hierarchy level ${index + 1} contains a field from another table`,
        );
      }

      normalized.push({
        fk_relation_column_id: relation.id,
        fk_related_model_id: relatedModel.id,
        fields: fieldIds,
        where: level.where?.trim() || undefined,
        sort: level.sort,
        show_empty: Boolean(level.show_empty),
        page_size: pageSize,
        recursive,
        max_depth: maxDepth,
        meta: level.meta,
      });

      visitedModels.add(relatedModel.id);
      currentModel = relatedModel;
    }

    return normalized;
  }

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
    if ('levels' in param.list) {
      const levels = await this.validateLevels(
        context,
        view,
        param.list.levels ?? [],
        ncMeta,
      );
      await ListViewLevel.replace(context, param.listViewId, levels, ncMeta);
    }
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
