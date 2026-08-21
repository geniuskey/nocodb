import { Injectable } from '@nestjs/common';
import { ViewTypes } from 'nocodb-sdk';
import type {
  GanttDependencyCreateReqType,
  GanttDependencyQueryReqType,
  GanttDependencyUpdateReqType,
} from 'nocodb-sdk';
import type { NcContext } from '~/interface/config';
import type { MetaService } from '~/meta/meta.service';
import Noco from '~/Noco';
import NcConnectionMgrv2 from '~/utils/common/NcConnectionMgrv2';
import { validatePayload } from '~/helpers';
import { NcError } from '~/helpers/catchError';
import { GanttDependency, Model, Source, View } from '~/models';
import { MetaTable } from '~/utils/globals';
import {
  GANTT_DEPENDENCY_MAX_EDGES,
  GANTT_DEPENDENCY_MAX_LAG_DAYS,
  GANTT_DEPENDENCY_MAX_RECORD_IDS,
  isGanttDependencyKind,
  normalizeGanttRecordId,
  wouldCreateGanttDependencyCycle,
} from '~/helpers/ganttDependency';
import { getCompositePkValue } from '~/helpers/dbHelpers';

@Injectable()
export class GanttDependenciesService {
  private async getGanttView(
    context: NcContext,
    viewId: string,
    ncMeta = Noco.ncMeta,
  ) {
    const view = await View.get(context, viewId, ncMeta);
    if (!view || view.type !== ViewTypes.GANTT) {
      NcError.viewNotFound(viewId);
    }
    return view;
  }

  private validateLag(context: NcContext, lagDays: unknown) {
    if (
      typeof lagDays !== 'number' ||
      !Number.isInteger(lagDays) ||
      Math.abs(lagDays) > GANTT_DEPENDENCY_MAX_LAG_DAYS
    ) {
      NcError.get(context).badRequest(
        `Gantt dependency lag_days must be an integer between -${GANTT_DEPENDENCY_MAX_LAG_DAYS} and ${GANTT_DEPENDENCY_MAX_LAG_DAYS}`,
      );
    }
  }

  private async assertRecordsExist(
    context: NcContext,
    view: View,
    recordIds: string[],
  ): Promise<string[]> {
    const model = await Model.getByIdOrName(context, { id: view.fk_model_id });
    if (!model) NcError.get(context).tableNotFound(view.fk_model_id);
    const source = await Source.get(context, model.source_id);
    const baseModel = await Model.getBaseModelSQL(context, {
      model,
      dbDriver: await NcConnectionMgrv2.get(source),
      source,
    });

    const canonicalRecordIds: string[] = [];
    for (const recordId of recordIds) {
      const record = await baseModel.readByPk(
        recordId,
        false,
        {},
        {
          ignoreView: true,
          extractOnlyPrimaries: true,
        },
      );
      if (!record) {
        NcError.get(context).badRequest(
          `Gantt dependency record does not exist: ${recordId}`,
        );
      }
      const canonicalRecordId = normalizeGanttRecordId(
        getCompositePkValue(model.primaryKeys, record),
      );
      if (!canonicalRecordId) {
        NcError.get(context).badRequest(
          `Gantt dependency record has an invalid primary key: ${recordId}`,
        );
      }
      canonicalRecordIds.push(canonicalRecordId);
    }
    return canonicalRecordIds;
  }

  private async lockGraph(
    context: NcContext,
    viewId: string,
    ncMeta: MetaService,
  ) {
    const query = ncMeta
      .knex(MetaTable.GANTT_VIEW)
      .where({ fk_view_id: viewId })
      .select('fk_view_id');
    ncMeta.contextCondition(
      query,
      context.workspace_id,
      context.base_id,
      MetaTable.GANTT_VIEW,
    );
    const client = String(ncMeta.knex.client.config.client ?? '');
    if (!client.includes('sqlite')) query.forUpdate();
    const row = await query.first();
    if (!row) NcError.viewNotFound(viewId);
  }

  async dependencyQuery(
    context: NcContext,
    param: { viewId: string; query: GanttDependencyQueryReqType },
  ) {
    validatePayload(
      'swagger.json#/components/schemas/GanttDependencyQueryReq',
      param.query,
    );
    await this.getGanttView(context, param.viewId);
    if (param.query.record_ids.length > GANTT_DEPENDENCY_MAX_RECORD_IDS) {
      NcError.get(context).badRequest(
        `Gantt dependency query supports at most ${GANTT_DEPENDENCY_MAX_RECORD_IDS} record IDs`,
      );
    }
    const recordIds = [
      ...new Set(
        param.query.record_ids.map(normalizeGanttRecordId).filter(Boolean),
      ),
    ] as string[];
    if (recordIds.length !== new Set(param.query.record_ids.map(String)).size) {
      NcError.get(context).badRequest(
        'Gantt dependency record IDs must be non-empty strings of at most 2048 bytes',
      );
    }
    return {
      list: await GanttDependency.listForRecords(
        context,
        param.viewId,
        recordIds,
      ),
    };
  }

  async dependencyCreate(
    context: NcContext,
    param: { viewId: string; dependency: GanttDependencyCreateReqType },
  ) {
    validatePayload(
      'swagger.json#/components/schemas/GanttDependencyCreateReq',
      param.dependency,
    );
    const view = await this.getGanttView(context, param.viewId);
    let sourceRecordId = normalizeGanttRecordId(
      param.dependency.source_record_id,
    );
    let targetRecordId = normalizeGanttRecordId(
      param.dependency.target_record_id,
    );
    if (!sourceRecordId || !targetRecordId) {
      NcError.get(context).badRequest(
        'Gantt dependency record IDs must be non-empty strings of at most 2048 bytes',
      );
    }
    if (sourceRecordId === targetRecordId) {
      NcError.get(context).badRequest('A Gantt task cannot depend on itself');
    }
    const dependencyType = param.dependency.dependency_type ?? 'finish_start';
    const lagDays = param.dependency.lag_days ?? 0;
    if (!isGanttDependencyKind(dependencyType)) {
      NcError.get(context).badRequest('Unsupported Gantt dependency type');
    }
    this.validateLag(context, lagDays);
    [sourceRecordId, targetRecordId] = await this.assertRecordsExist(
      context,
      view,
      [sourceRecordId, targetRecordId],
    );
    if (sourceRecordId === targetRecordId) {
      NcError.get(context).badRequest('A Gantt task cannot depend on itself');
    }

    const trxMeta = await Noco.ncMeta.startTransaction();
    try {
      await this.lockGraph(context, param.viewId, trxMeta);
      const dependencies = await GanttDependency.listAll(
        context,
        param.viewId,
        trxMeta,
      );
      if (dependencies.length >= GANTT_DEPENDENCY_MAX_EDGES) {
        NcError.get(context).badRequest(
          `A Gantt view supports at most ${GANTT_DEPENDENCY_MAX_EDGES} dependencies`,
        );
      }
      if (
        dependencies.some(
          (dependency) =>
            dependency.source_record_id === sourceRecordId &&
            dependency.target_record_id === targetRecordId,
        )
      ) {
        NcError.get(context).badRequest('This Gantt dependency already exists');
      }
      if (
        wouldCreateGanttDependencyCycle(
          dependencies,
          sourceRecordId,
          targetRecordId,
        )
      ) {
        NcError.get(context).badRequest(
          'This Gantt dependency would create a cycle',
        );
      }

      const created = await GanttDependency.insert(
        context,
        {
          fk_view_id: param.viewId,
          source_record_id: sourceRecordId,
          target_record_id: targetRecordId,
          dependency_type: dependencyType,
          lag_days: lagDays,
          source_id: view.source_id,
        },
        trxMeta,
      );
      await trxMeta.commit();
      return created;
    } catch (error) {
      await trxMeta.rollback();
      throw error;
    }
  }

  async dependencyUpdate(
    context: NcContext,
    param: {
      viewId: string;
      dependencyId: string;
      dependency: GanttDependencyUpdateReqType;
    },
  ) {
    validatePayload(
      'swagger.json#/components/schemas/GanttDependencyUpdateReq',
      param.dependency,
    );
    await this.getGanttView(context, param.viewId);
    if (
      param.dependency.dependency_type !== undefined &&
      !isGanttDependencyKind(param.dependency.dependency_type)
    ) {
      NcError.get(context).badRequest('Unsupported Gantt dependency type');
    }
    if (param.dependency.lag_days !== undefined) {
      this.validateLag(context, param.dependency.lag_days);
    }

    const trxMeta = await Noco.ncMeta.startTransaction();
    try {
      await this.lockGraph(context, param.viewId, trxMeta);
      const dependency = await GanttDependency.get(
        context,
        param.dependencyId,
        trxMeta,
      );
      if (!dependency || dependency.fk_view_id !== param.viewId) {
        NcError.get(context).badRequest(
          'Gantt dependency was not found in this view',
        );
      }
      const updated = await GanttDependency.update(
        context,
        param.dependencyId,
        param.dependency,
        trxMeta,
      );
      await trxMeta.commit();
      return updated;
    } catch (error) {
      await trxMeta.rollback();
      throw error;
    }
  }

  async dependencyDelete(
    context: NcContext,
    param: { viewId: string; dependencyId: string },
  ) {
    await this.getGanttView(context, param.viewId);
    const trxMeta = await Noco.ncMeta.startTransaction();
    try {
      await this.lockGraph(context, param.viewId, trxMeta);
      const dependency = await GanttDependency.get(
        context,
        param.dependencyId,
        trxMeta,
      );
      if (!dependency || dependency.fk_view_id !== param.viewId) {
        NcError.get(context).badRequest(
          'Gantt dependency was not found in this view',
        );
      }
      await GanttDependency.delete(context, param.dependencyId, trxMeta);
      await trxMeta.commit();
      return { id: param.dependencyId };
    } catch (error) {
      await trxMeta.rollback();
      throw error;
    }
  }
}
