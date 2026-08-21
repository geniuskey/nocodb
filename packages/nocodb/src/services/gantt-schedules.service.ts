import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import dayjs from 'dayjs';
import { UITypes, ViewTypes } from 'nocodb-sdk';
import type {
  GanttCriticalPathType,
  GanttScheduleApplyReqType,
  GanttScheduleChangeType,
  GanttSchedulePlanType,
  GanttSchedulePreviewReqType,
} from 'nocodb-sdk';
import type { NcContext, NcRequest } from '~/interface/config';
import type { MetaService } from '~/meta/meta.service';
import Noco from '~/Noco';
import NcConnectionMgrv2 from '~/utils/common/NcConnectionMgrv2';
import { validatePayload } from '~/helpers';
import { NcError } from '~/helpers/catchError';
import { buildGanttCriticalPath } from '~/helpers/ganttCriticalPath';
import {
  buildGanttScheduleShifts,
  GANTT_SCHEDULE_DAY_MS,
  GANTT_SCHEDULE_MAX_ANCHORS,
  GANTT_SCHEDULE_MAX_TASKS,
  normalizeGanttRecordId,
  withGanttGraphLock,
} from '~/helpers/ganttDependency';
import { GanttDependency, GanttView, Model, Source, View } from '~/models';
import { MetaTable } from '~/utils/globals';
import { DataTableService } from '~/services/data-table.service';

type SchedulePlanInternal = GanttSchedulePlanType & { updates: any[] };

@Injectable()
export class GanttSchedulesService {
  constructor(private readonly dataTableService: DataTableService) {}

  private normalizeAnchors(context: NcContext, values: unknown[]) {
    if (!values.length || values.length > GANTT_SCHEDULE_MAX_ANCHORS) {
      NcError.get(context).badRequest(
        `Gantt schedule requires between 1 and ${GANTT_SCHEDULE_MAX_ANCHORS} anchor records`,
      );
    }
    const anchors = values.map(normalizeGanttRecordId);
    if (anchors.some((value) => !value)) {
      NcError.get(context).badRequest('Gantt schedule record IDs are invalid');
    }
    const unique = [...new Set(anchors as string[])].sort();
    if (unique.length !== anchors.length) {
      NcError.get(context).badRequest(
        'Gantt schedule anchor record IDs must be unique',
      );
    }
    return unique;
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

  private descendantsAndRequiredRecords(
    context: NcContext,
    anchors: string[],
    dependencies: GanttDependency[],
  ) {
    const outgoing = new Map<string, GanttDependency[]>();
    for (const dependency of dependencies) {
      outgoing.set(dependency.source_record_id, [
        ...(outgoing.get(dependency.source_record_id) ?? []),
        dependency,
      ]);
    }
    const anchorSet = new Set(anchors);
    const affected = new Set<string>();
    const pending = [...anchors];
    while (pending.length) {
      const current = pending.pop()!;
      for (const dependency of outgoing.get(current) ?? []) {
        const target = dependency.target_record_id;
        if (anchorSet.has(target) || affected.has(target)) continue;
        affected.add(target);
        if (affected.size > GANTT_SCHEDULE_MAX_TASKS) {
          NcError.get(context).badRequest(
            `Gantt schedule supports at most ${GANTT_SCHEDULE_MAX_TASKS} affected tasks`,
          );
        }
        pending.push(target);
      }
    }

    const required = new Set([...anchors, ...affected]);
    for (const dependency of dependencies) {
      if (affected.has(dependency.target_record_id)) {
        required.add(dependency.source_record_id);
      }
    }
    if (required.size > GANTT_SCHEDULE_MAX_TASKS) {
      NcError.get(context).badRequest(
        `Gantt schedule requires more than ${GANTT_SCHEDULE_MAX_TASKS} task records`,
      );
    }
    return { affected, required: [...required].sort() };
  }

  private value(record: Record<string, any>, column: any) {
    return (
      record[column.title] ?? record[column.column_name] ?? record[column.id]
    );
  }

  private dateValue(
    context: NcContext,
    recordId: string,
    value: unknown,
    column: any,
  ) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = dayjs(value as any);
    if (!parsed.isValid()) {
      NcError.get(context).badRequest(
        `Gantt schedule task has an invalid ${column.title} value: ${recordId}`,
      );
    }
    return {
      timestamp: parsed.valueOf(),
      text:
        column.uidt === UITypes.Date
          ? parsed.format('YYYY-MM-DD')
          : parsed.toISOString(),
    };
  }

  private shiftDate(text: string, column: any, deltaDays: number) {
    const shifted = dayjs(text).add(deltaDays, 'day');
    return column.uidt === UITypes.Date
      ? shifted.format('YYYY-MM-DD')
      : shifted.toISOString();
  }

  private async calculatePlan(
    context: NcContext,
    viewId: string,
    anchors: string[],
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<SchedulePlanInternal> {
    const view = await View.get(context, viewId, ncMeta);
    if (!view || view.type !== ViewTypes.GANTT) NcError.viewNotFound(viewId);
    const gantt = await GanttView.get(context, viewId, ncMeta);
    if (!gantt?.fk_start_column_id || !gantt?.fk_end_column_id) {
      NcError.get(context).badRequest(
        'Gantt start and end fields must be configured before scheduling tasks',
      );
    }

    const model = await Model.getByIdOrName(
      context,
      { id: view.fk_model_id },
      ncMeta,
    );
    if (!model) NcError.get(context).tableNotFound(view.fk_model_id);
    const columns = await model.getColumns(context, ncMeta);
    const startColumn = columns.find(
      (column) => column.id === gantt.fk_start_column_id,
    );
    const endColumn = columns.find(
      (column) => column.id === gantt.fk_end_column_id,
    );
    const titleColumn = columns.find(
      (column) => column.id === gantt.fk_title_column_id,
    );
    if (!startColumn || !endColumn) {
      NcError.get(context).badRequest('Gantt schedule fields no longer exist');
    }

    const dependencies = await GanttDependency.listAll(context, viewId, ncMeta);
    const { affected, required } = this.descendantsAndRequiredRecords(
      context,
      anchors,
      dependencies,
    );
    const source = await Source.get(context, model.source_id, false, ncMeta);
    const baseModel = await Model.getBaseModelSQL(context, {
      model,
      source,
      dbDriver: await NcConnectionMgrv2.get(source),
    });
    const records = await baseModel.chunkList({ pks: required });
    const recordById = new Map<string, Record<string, any>>();
    for (const record of records) {
      recordById.set(String(baseModel.extractPksValues(record, true)), record);
    }
    for (const recordId of required) {
      if (!recordById.has(recordId)) {
        NcError.get(context).badRequest(
          `Gantt schedule task does not exist: ${recordId}`,
        );
      }
    }

    const taskState = required.map((recordId) => {
      const record = recordById.get(recordId)!;
      const start = this.dateValue(
        context,
        recordId,
        this.value(record, startColumn),
        startColumn,
      );
      if (!start) {
        NcError.get(context).badRequest(
          `Gantt schedule task has no start value: ${recordId}`,
        );
      }
      const end = this.dateValue(
        context,
        recordId,
        this.value(record, endColumn),
        endColumn,
      );
      const finish = end
        ? end.timestamp +
          (endColumn.uidt === UITypes.Date ? GANTT_SCHEDULE_DAY_MS : 0)
        : start.timestamp;
      if (finish < start.timestamp) {
        NcError.get(context).badRequest(
          `Gantt schedule task ends before it starts: ${recordId}`,
        );
      }
      return {
        id: recordId,
        start: start.timestamp,
        finish,
        startText: start.text,
        endText: end?.text ?? null,
      };
    });

    let shifts;
    try {
      shifts = buildGanttScheduleShifts(taskState, dependencies, anchors);
    } catch (error) {
      NcError.get(context).badRequest((error as Error).message);
    }
    const stateById = new Map(taskState.map((task) => [task.id, task]));
    const updates: any[] = [];
    const changes: GanttScheduleChangeType[] = [];
    for (const shift of shifts!) {
      const record = recordById.get(shift.record_id)!;
      const state = stateById.get(shift.record_id)!;
      const aliasRecord = await model.mapColumnToAlias(
        context,
        record,
        columns,
      );
      const nextStart = this.shiftDate(
        state.startText,
        startColumn,
        shift.delta_days,
      );
      const nextEnd = state.endText
        ? this.shiftDate(state.endText, endColumn, shift.delta_days)
        : null;
      updates.push({
        ...Object.fromEntries(
          model.primaryKeys.map((column) => [
            column.title,
            aliasRecord[column.title],
          ]),
        ),
        [startColumn.title]: nextStart,
        ...(state.endText ? { [endColumn.title]: nextEnd } : {}),
      });
      changes.push({
        record_id: shift.record_id,
        ...(titleColumn
          ? {
              title: String(this.value(record, titleColumn) ?? shift.record_id),
            }
          : {}),
        previous_start: state.startText,
        previous_end: state.endText,
        next_start: nextStart,
        next_end: nextEnd,
        delta_days: shift.delta_days,
        driving_dependency_ids: shift.driving_dependency_ids,
      });
    }

    const hashInput = {
      view_id: viewId,
      anchor_record_ids: anchors,
      dependencies: dependencies.map((dependency) => ({
        id: dependency.id,
        source_record_id: dependency.source_record_id,
        target_record_id: dependency.target_record_id,
        dependency_type: dependency.dependency_type,
        lag_days: dependency.lag_days,
      })),
      tasks: taskState.map(({ id, startText, endText }) => ({
        id,
        start: startText,
        end: endText,
      })),
      changes,
    };
    return {
      plan_hash: createHash('sha256')
        .update(JSON.stringify(hashInput), 'utf8')
        .digest('hex'),
      anchor_record_ids: anchors,
      changes,
      unchanged_count: affected.size - changes.length,
      applied: false,
      updates,
    };
  }

  async criticalPath(
    context: NcContext,
    viewId: string,
  ): Promise<GanttCriticalPathType> {
    const view = await View.get(context, viewId);
    if (!view || view.type !== ViewTypes.GANTT) NcError.viewNotFound(viewId);
    const gantt = await GanttView.get(context, viewId);
    if (!gantt?.fk_start_column_id || !gantt?.fk_end_column_id) {
      NcError.get(context).badRequest(
        'Gantt start and end fields must be configured before analyzing critical paths',
      );
    }

    const dependencies = await GanttDependency.listAll(context, viewId);
    if (!dependencies.length) {
      return {
        analyzed_record_count: 0,
        component_count: 0,
        critical_record_ids: [],
        critical_dependency_ids: [],
        tasks: [],
        components: [],
      };
    }
    const recordIds = [
      ...new Set(
        dependencies.flatMap((dependency) => [
          dependency.source_record_id,
          dependency.target_record_id,
        ]),
      ),
    ].sort();
    if (recordIds.length > GANTT_SCHEDULE_MAX_TASKS) {
      NcError.get(context).badRequest(
        `Gantt critical-path analysis supports at most ${GANTT_SCHEDULE_MAX_TASKS} task records`,
      );
    }

    const model = await Model.getByIdOrName(context, {
      id: view.fk_model_id,
    });
    if (!model) NcError.get(context).tableNotFound(view.fk_model_id);
    const columns = await model.getColumns(context);
    const startColumn = columns.find(
      (column) => column.id === gantt.fk_start_column_id,
    );
    const endColumn = columns.find(
      (column) => column.id === gantt.fk_end_column_id,
    );
    const titleColumn = columns.find(
      (column) => column.id === gantt.fk_title_column_id,
    );
    if (!startColumn || !endColumn) {
      NcError.get(context).badRequest(
        'Gantt critical-path fields no longer exist',
      );
    }

    const source = await Source.get(context, model.source_id);
    const baseModel = await Model.getBaseModelSQL(context, {
      model,
      source,
      dbDriver: await NcConnectionMgrv2.get(source),
    });
    const records = await baseModel.chunkList({ pks: recordIds });
    const recordById = new Map<string, Record<string, any>>();
    for (const record of records) {
      recordById.set(String(baseModel.extractPksValues(record, true)), record);
    }

    const taskTitles = new Map<string, string>();
    const taskInputs = recordIds.map((recordId) => {
      const record = recordById.get(recordId);
      if (!record) {
        NcError.get(context).badRequest(
          `Gantt critical-path task does not exist: ${recordId}`,
        );
      }
      const start = this.dateValue(
        context,
        recordId,
        this.value(record, startColumn),
        startColumn,
      );
      if (!start) {
        NcError.get(context).badRequest(
          `Gantt critical-path task has no start value: ${recordId}`,
        );
      }
      const end = this.dateValue(
        context,
        recordId,
        this.value(record, endColumn),
        endColumn,
      );
      const finish = end
        ? end.timestamp +
          (endColumn.uidt === UITypes.Date ? GANTT_SCHEDULE_DAY_MS : 0)
        : start.timestamp;
      if (finish < start.timestamp) {
        NcError.get(context).badRequest(
          `Gantt critical-path task ends before it starts: ${recordId}`,
        );
      }
      if (titleColumn) {
        taskTitles.set(
          recordId,
          String(this.value(record, titleColumn) ?? recordId),
        );
      }
      return { id: recordId, duration: finish - start.timestamp };
    });

    let analysis;
    try {
      analysis = buildGanttCriticalPath(taskInputs, dependencies);
    } catch (error) {
      NcError.get(context).badRequest((error as Error).message);
    }
    const toDays = (value: number) =>
      Math.round((value / GANTT_SCHEDULE_DAY_MS) * 1_000_000) / 1_000_000;
    const tasks = analysis!.tasks.map((task) => ({
      record_id: task.record_id,
      ...(taskTitles.has(task.record_id)
        ? { title: taskTitles.get(task.record_id) }
        : {}),
      duration_days: toDays(task.duration),
      earliest_start_days: toDays(task.earliest_start),
      latest_start_days: toDays(task.latest_start),
      total_float_days: toDays(task.total_float),
      critical: task.critical,
    }));
    return {
      analyzed_record_count: tasks.length,
      component_count: analysis!.components.length,
      critical_record_ids: tasks
        .filter((task) => task.critical)
        .map((task) => task.record_id),
      critical_dependency_ids: analysis!.critical_dependency_ids,
      tasks,
      components: analysis!.components.map((component) => ({
        record_ids: component.record_ids,
        project_duration_days: toDays(component.project_duration),
      })),
    };
  }

  async preview(
    context: NcContext,
    viewId: string,
    body: GanttSchedulePreviewReqType,
  ): Promise<GanttSchedulePlanType> {
    validatePayload(
      'swagger.json#/components/schemas/GanttSchedulePreviewReq',
      body,
    );
    const anchors = this.normalizeAnchors(context, body.anchor_record_ids);
    const { updates: _updates, ...plan } = await this.calculatePlan(
      context,
      viewId,
      anchors,
    );
    return plan;
  }

  async apply(
    context: NcContext,
    viewId: string,
    body: GanttScheduleApplyReqType,
    req: NcRequest,
  ): Promise<GanttSchedulePlanType> {
    validatePayload(
      'swagger.json#/components/schemas/GanttScheduleApplyReq',
      body,
    );
    const anchors = this.normalizeAnchors(context, body.anchor_record_ids);
    return await withGanttGraphLock(viewId, async () => {
      const persist = async (ncMeta: MetaService) => {
        const plan = await this.calculatePlan(context, viewId, anchors, ncMeta);
        if (plan.plan_hash !== body.plan_hash) {
          NcError.get(context).badRequest(
            'Gantt schedule changed after preview; preview it again before applying',
          );
        }
        if (plan.updates.length) {
          const view = await View.get(context, viewId, ncMeta);
          await this.dataTableService.dataUpdate(context, {
            modelId: view.fk_model_id,
            viewId,
            body: plan.updates,
            cookie: req,
          });
        }
        const { updates: _updates, ...response } = plan;
        return { ...response, applied: true };
      };

      const client = String(Noco.ncMeta.knex.client.config.client ?? '');
      if (client.includes('sqlite')) {
        // SQLite metadata commonly shares the single local connection with
        // user data. Holding it while reading records would deadlock the pool.
        return await persist(Noco.ncMeta);
      }

      const trxMeta = await Noco.ncMeta.startTransaction();
      try {
        await this.lockGraph(context, viewId, trxMeta);
        const response = await persist(trxMeta);
        await trxMeta.commit();
        return response;
      } catch (error) {
        await trxMeta.rollback();
        throw error;
      }
    });
  }
}
