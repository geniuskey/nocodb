import { Injectable, Logger } from '@nestjs/common';
import { ProjectRoles, UITypes } from 'nocodb-sdk';
import type {
  RecordTrashConflictAnalysisType,
  RecordTrashConflictIssueType,
  RecordTrashCreateReqType,
  RecordTrashIdsReqType,
  RecordTrashRestoreModeReqType,
  RecordTrashRestoreReqType,
} from 'nocodb-sdk';
import type { BaseModelSqlv2 } from '~/db/BaseModelSqlv2';
import type { NcContext, NcRequest } from '~/interface/config';
import type { Column } from '~/models';
import { validatePayload } from '~/helpers';
import { validateFuncOnColumn } from '~/helpers/dbHelpers';
import { NcError } from '~/helpers/catchError';
import {
  hashTrashRecordId,
  projectTrashRow,
  RECORD_TRASH_MAX_BATCH_BYTES,
  RECORD_TRASH_MAX_BATCH_SIZE,
  RECORD_TRASH_MAX_RECORD_ID_BYTES,
  RECORD_TRASH_MAX_ROW_BYTES,
  serializedByteLength,
  snapshotTrashFieldMap,
  snapshotTrashRow,
  trashExpiryFrom,
} from '~/helpers/recordTrash';
import {
  BaseTrashEntry,
  Model,
  RecordTrash,
  Source,
  ViewTrash,
} from '~/models';
import NcConnectionMgrv2 from '~/utils/common/NcConnectionMgrv2';
import { PagedResponseImpl } from '~/helpers/PagedResponse';
import { DataTableService } from '~/services/data-table.service';
import { BaseModelDelete } from '~/db/BaseModelSqlv2/delete';
import { processConcurrently } from '~/utils';
import { TablesService } from '~/services/tables.service';
import { ColumnsService } from '~/services/columns.service';

type RestoreMode = NonNullable<RecordTrashRestoreModeReqType['mode']>;

type ModelResources = {
  model: Model;
  source: Source;
  baseModel: BaseModelSqlv2;
  columns: Column[];
};

type PreparedTrashRecord = {
  record: RecordTrash;
  data: Record<string, unknown>;
  issues: RecordTrashConflictIssueType[];
};

type ConflictAnalysis = {
  analysis: RecordTrashConflictAnalysisType;
  prepared: PreparedTrashRecord[];
};

@Injectable()
export class RecordTrashService {
  private readonly logger = new Logger(RecordTrashService.name);

  constructor(
    private readonly dataTableService: DataTableService,
    private readonly tablesService: TablesService,
    private readonly columnsService: ColumnsService,
  ) {}

  private validateBatch(context: NcContext, values: unknown[], label: string) {
    if (!Array.isArray(values) || values.length === 0) {
      NcError.get(context).badRequest(
        `${label} must contain at least one item`,
      );
    }
    if (values.length > RECORD_TRASH_MAX_BATCH_SIZE) {
      NcError.get(context).badRequest(
        `${label} supports at most ${RECORD_TRASH_MAX_BATCH_SIZE} items`,
      );
    }
  }

  private validateTrashIds(context: NcContext, ids: string[]): string[] {
    this.validateBatch(context, ids, 'trash_ids');
    const normalized = ids.map((id) => String(id).trim());
    if (normalized.some((id) => !id)) {
      NcError.get(context).badRequest('trash_ids must be non-empty strings');
    }
    if (new Set(normalized).size !== normalized.length) {
      NcError.get(context).unprocessableEntity(
        'trash_ids must not contain duplicates',
      );
    }
    return normalized;
  }

  private validateRestoreMode(
    context: NcContext,
    mode?: RecordTrashRestoreModeReqType['mode'],
  ): RestoreMode {
    const normalized = mode ?? 'strict';
    if (!['strict', 'clean', 'force'].includes(normalized)) {
      NcError.get(context).badRequest(
        'Restore mode must be strict, clean, or force',
      );
    }
    return normalized;
  }

  private async getModelResources(
    context: NcContext,
    modelId: string,
  ): Promise<ModelResources> {
    const model = await Model.get(context, modelId);
    if (!model) NcError.get(context).tableNotFound(modelId);
    const source = await Source.get(context, model.source_id);
    const baseModel = await Model.getBaseModelSQL(context, {
      model,
      source,
      dbDriver: await NcConnectionMgrv2.get(source),
    });
    const columns = await model.getColumns(context);
    return { model, source, baseModel, columns };
  }

  private async getTrashRecords(
    context: NcContext,
    modelId: string,
    ids: string[],
  ): Promise<RecordTrash[]> {
    const records = await RecordTrash.listByIds(context, modelId, ids);
    if (records.length !== ids.length) {
      NcError.get(context).badRequest(
        'One or more trash snapshots do not exist for this table',
      );
    }
    if (
      records.some(
        (record) => new Date(record.expires_at).getTime() <= Date.now(),
      )
    ) {
      NcError.get(context).badRequest(
        'Expired trash snapshots cannot be restored',
      );
    }
    return records;
  }

  private addConflictIssue(
    prepared: PreparedTrashRecord,
    issue: RecordTrashConflictIssueType,
  ) {
    if (
      !prepared.issues.some(
        (candidate) =>
          candidate.type === issue.type &&
          candidate.column_id === issue.column_id,
      )
    ) {
      prepared.issues.push(issue);
    }
  }

  private isIssueClearable(column: Column): boolean {
    return !column.pk && !column.rqd && !column.ai && !column.system;
  }

  private uniqueBatchKey(value: unknown, caseInsensitive: boolean): string {
    if (value instanceof Date) return `date:${value.toISOString()}`;
    if (Buffer.isBuffer(value)) return `buffer:${value.toString('base64')}`;
    if (typeof value === 'string') {
      return `string:${caseInsensitive ? value.toLocaleLowerCase() : value}`;
    }
    return `${typeof value}:${JSON.stringify(value)}`;
  }

  private toConflictAnalysis(
    prepared: PreparedTrashRecord[],
  ): RecordTrashConflictAnalysisType {
    const conflicts = prepared
      .filter((item) => item.issues.length)
      .map((item) => ({
        trash_id: item.record.id,
        record_id: item.record.record_id,
        issues: item.issues,
      }));
    return {
      total: prepared.length,
      clean: prepared.length - conflicts.length,
      conflicted: conflicts.length,
      truncated: conflicts.length > RECORD_TRASH_MAX_BATCH_SIZE,
      conflicts: conflicts.slice(0, RECORD_TRASH_MAX_BATCH_SIZE),
    };
  }

  private async analyzeRecords(
    context: NcContext,
    resources: ModelResources,
    records: RecordTrash[],
  ): Promise<ConflictAnalysis> {
    const { baseModel, columns } = resources;
    const prepared: PreparedTrashRecord[] = records.map((record) => ({
      record,
      data: projectTrashRow(columns, record.row_data, record.field_map),
      issues: [],
    }));

    await processConcurrently(
      prepared,
      async (item) => {
        const liveRecord = await baseModel.readByPk(
          item.record.record_id,
          false,
          {},
          {
            ignoreView: true,
            extractOnlyPrimaries: true,
          },
        );
        if (liveRecord) {
          this.addConflictIssue(item, {
            type: 'primary_key',
            message: 'The primary key is already used by an active record',
            clearable: false,
          });
        }
      },
      10,
    );

    const validatedTypes = new Set([
      UITypes.Email,
      UITypes.URL,
      UITypes.PhoneNumber,
    ]);
    for (const item of prepared) {
      for (const column of columns) {
        if (
          !validatedTypes.has(column.uidt) ||
          !column.meta?.validate ||
          !column.validate ||
          !Object.prototype.hasOwnProperty.call(item.data, column.title)
        ) {
          continue;
        }
        try {
          await validateFuncOnColumn({
            value: item.data[column.title],
            column,
            apiVersion: context.api_version,
          });
        } catch {
          this.addConflictIssue(item, {
            type: 'format',
            column_id: column.id,
            field: column.title,
            message: `${column.title} no longer matches its validation rule`,
            clearable: this.isIssueClearable(column),
          });
        }
      }
    }

    const uniqueColumns = columns.filter((column) => column.unique);
    const activeChecks: Array<{
      item: PreparedTrashRecord;
      column: Column;
      value: unknown;
    }> = [];
    for (const column of uniqueColumns) {
      const grouped = new Map<string, PreparedTrashRecord[]>();
      for (const item of prepared) {
        if (!Object.prototype.hasOwnProperty.call(item.data, column.title)) {
          continue;
        }
        const value = item.data[column.title];
        if (value === null || value === undefined || value === '') continue;
        activeChecks.push({ item, column, value });
        const key = this.uniqueBatchKey(value, baseModel.isMySQL);
        const group = grouped.get(key) ?? [];
        group.push(item);
        grouped.set(key, group);
      }
      for (const group of grouped.values()) {
        if (group.length < 2) continue;
        for (const item of group) {
          this.addConflictIssue(item, {
            type: 'unique',
            column_id: column.id,
            field: column.title,
            message: `${column.title} duplicates another selected Trash record`,
            clearable: this.isIssueClearable(column),
          });
        }
      }
    }

    await processConcurrently(
      activeChecks,
      async ({ item, column, value }) => {
        const live = await baseModel
          .dbDriver(baseModel.tnPath)
          .select(column.column_name)
          .where(column.column_name, value)
          .first();
        if (live) {
          this.addConflictIssue(item, {
            type: 'unique',
            column_id: column.id,
            field: column.title,
            message: `${column.title} is already used by an active record`,
            clearable: this.isIssueClearable(column),
          });
        }
      },
      10,
    );

    return { analysis: this.toConflictAnalysis(prepared), prepared };
  }

  private pagination(
    context: NcContext,
    limitValue?: string,
    offsetValue?: string,
  ) {
    const limit = limitValue === undefined ? 25 : Number(limitValue);
    const offset = offsetValue === undefined ? 0 : Number(offsetValue);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > RECORD_TRASH_MAX_BATCH_SIZE
    ) {
      NcError.get(context).badRequest(
        `limit must be an integer between 1 and ${RECORD_TRASH_MAX_BATCH_SIZE}`,
      );
    }
    if (!Number.isInteger(offset) || offset < 0) {
      NcError.get(context).badRequest('offset must be a non-negative integer');
    }
    return { limit, offset };
  }

  async list(
    context: NcContext,
    param: { modelId: string; limit?: string; offset?: string },
  ) {
    await this.getModelResources(context, param.modelId);
    const { limit, offset } = this.pagination(
      context,
      param.limit,
      param.offset,
    );
    const [records, count] = await Promise.all([
      RecordTrash.list(context, param.modelId, { limit, offset }),
      RecordTrash.count(context, param.modelId),
    ]);
    return new PagedResponseImpl(records, { limit, offset, count });
  }

  async listBaseTrash(
    context: NcContext,
    param: { limit?: string; offset?: string },
  ) {
    const { limit, offset } = this.pagination(
      context,
      param.limit,
      param.offset,
    );
    const [entries, count] = await Promise.all([
      BaseTrashEntry.list(context, { limit, offset }),
      BaseTrashEntry.count(context),
    ]);
    const list = await Promise.all(
      entries.map(async (entry) => {
        if (
          entry.resource_type === 'table' ||
          entry.resource_type === 'field'
        ) {
          return { ...entry, record_count: 0, records: [] };
        }
        if (entry.resource_type === 'view') {
          const viewTrash = await ViewTrash.getByEntryId(context, entry.id);
          return {
            ...entry,
            parent_id: viewTrash?.fk_model_id,
            view_type: viewTrash?.view_type,
            record_count: 0,
            records: [],
          };
        }
        const [recordCount, records] = await Promise.all([
          RecordTrash.countByEntryId(context, entry.id),
          RecordTrash.listByEntryId(context, entry.id, { limit: 8 }),
        ]);
        return { ...entry, record_count: recordCount, records };
      }),
    );
    return new PagedResponseImpl(list, { limit, offset, count });
  }

  async trash(
    context: NcContext,
    param: {
      modelId: string;
      req: NcRequest;
      viewId?: string;
    } & (
      | { body: RecordTrashCreateReqType; recordIds?: never }
      | { body?: never; recordIds: string[] }
    ) & { trashEntryId?: string },
  ) {
    if (param.body) {
      validatePayload(
        'swagger.json#/components/schemas/RecordTrashCreateReq',
        param.body,
      );
    }
    const selectors = param.body?.records ?? param.recordIds;
    this.validateBatch(context, selectors, 'records');
    const { model, baseModel, columns } = await this.getModelResources(
      context,
      param.modelId,
    );
    const deletedAt = new Date();
    const expiresAt = trashExpiryFrom(deletedAt);
    const snapshots: Partial<RecordTrash>[] = [];
    const recordIds = new Set<string>();
    let batchBytes = 0;

    for (const selector of selectors) {
      const requestedId =
        typeof selector === 'string'
          ? selector
          : String(baseModel.extractPksValues(selector, true));
      const row = await baseModel.readByPk(
        requestedId,
        false,
        {},
        {
          ignoreView: true,
          getHiddenColumn: true,
        },
      );
      if (!row) NcError.get(context).recordNotFound(requestedId);
      const recordId = String(baseModel.extractPksValues(row, true));
      if (
        !recordId ||
        Buffer.byteLength(recordId, 'utf8') > RECORD_TRASH_MAX_RECORD_ID_BYTES
      ) {
        NcError.get(context).badRequest(
          `Record IDs must not exceed ${RECORD_TRASH_MAX_RECORD_ID_BYTES} bytes`,
        );
      }
      if (recordIds.has(recordId)) {
        NcError.get(context).unprocessableEntity(
          `Duplicate record with id ${recordId}`,
        );
      }
      recordIds.add(recordId);

      const pkData = model.primaryKeys.reduce<Record<string, unknown>>(
        (primary, column) => {
          primary[column.title] =
            row[column.title] ?? row[column.column_name] ?? row[column.id];
          return primary;
        },
        {},
      );
      const rowData = snapshotTrashRow(columns, row);
      const fieldMap = snapshotTrashFieldMap(columns, row);
      const snapshotBytes = serializedByteLength({
        row_data: rowData,
        field_map: fieldMap,
      });
      if (snapshotBytes > RECORD_TRASH_MAX_ROW_BYTES) {
        NcError.get(context).badRequest(
          `A record trash snapshot must not exceed ${RECORD_TRASH_MAX_ROW_BYTES} bytes`,
        );
      }
      batchBytes += snapshotBytes;
      if (batchBytes > RECORD_TRASH_MAX_BATCH_BYTES) {
        NcError.get(context).badRequest(
          `A record trash batch must not exceed ${RECORD_TRASH_MAX_BATCH_BYTES} bytes`,
        );
      }
      snapshots.push({
        fk_model_id: model.id,
        record_id: recordId,
        pk_data: pkData,
        row_data: rowData,
        field_map: fieldMap,
        deleted_by: param.req.user?.id ?? context.user?.id,
        deleted_at: deletedAt.toISOString(),
        expires_at: expiresAt.toISOString(),
        source_id: model.source_id,
      });
    }

    const existing = await RecordTrash.listByRecordHashes(
      context,
      model.id,
      [...recordIds].map(hashTrashRecordId),
    );
    if (existing.length) {
      NcError.get(context).unprocessableEntity(
        `A trash snapshot already exists for record ${existing[0].record_id}`,
      );
    }

    let entry = param.trashEntryId
      ? await BaseTrashEntry.get(context, param.trashEntryId)
      : null;
    if (param.trashEntryId && !entry) {
      NcError.get(context).badRequest('Trash entry does not exist');
    }
    if (
      entry &&
      (entry.resource_type !== 'records' || entry.resource_id !== model.id)
    ) {
      NcError.get(context).badRequest(
        'Trash entry does not belong to this table',
      );
    }
    const createdEntry = !entry;
    entry ??= await BaseTrashEntry.create(context, {
      resource_type: 'records',
      resource_id: model.id,
      resource_name: model.title,
      deleted_by: param.req.user?.id ?? context.user?.id,
      deleted_at: deletedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      source_id: model.source_id,
    });
    snapshots.forEach((snapshot) => {
      snapshot.fk_trash_entry_id = entry.id;
    });

    let inserted: RecordTrash[];
    try {
      inserted = await RecordTrash.insertMany(context, snapshots);
    } catch (error) {
      if (createdEntry) await BaseTrashEntry.deleteIfEmpty(context, entry.id);
      throw error;
    }
    try {
      await this.dataTableService.dataDelete(context, {
        modelId: model.id,
        viewId: param.viewId,
        body: snapshots.map((snapshot) => snapshot.pk_data),
        cookie: param.req,
      });
    } catch (error) {
      try {
        await RecordTrash.deleteMany(
          context,
          inserted.map((record) => record.id),
        );
        await BaseTrashEntry.deleteIfEmpty(context, entry.id);
      } catch (cleanupError) {
        this.logger.error(
          'Failed to remove trash snapshots after record deletion failed',
          cleanupError,
        );
      }
      throw error;
    }
    return { list: inserted, trash_entry_id: entry.id };
  }

  async trashAll(
    context: NcContext,
    param: {
      modelId: string;
      viewId?: string;
      query: { where?: string; skipPks?: string };
      req: NcRequest;
    },
  ) {
    const { model, baseModel } = await this.getModelResources(
      context,
      param.modelId,
    );
    const { qb } = await new BaseModelDelete(baseModel).prepareBulkDeleteAll({
      args: {
        where: param.query.where,
        viewId: param.viewId,
        skipPks: param.query.skipPks,
      },
      cookie: param.req,
    });
    const deleted: Record<string, unknown>[] = [];
    let trashEntryId: string | undefined;

    // Always query the first bounded page: each successful Trash operation
    // removes that page from the filtered live-record set.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const rows = await baseModel.execAndParse(
        qb
          .clone()
          .select(model.primaryKeys.map((column) => column.column_name))
          .limit(RECORD_TRASH_MAX_BATCH_SIZE),
        null,
        { raw: true },
      );
      if (!rows.length) break;

      const records = rows.map((row) =>
        model.primaryKeys.reduce<Record<string, unknown>>((primary, column) => {
          primary[column.title] = row[column.column_name];
          return primary;
        }, {}),
      );
      const result = await this.trash(context, {
        modelId: model.id,
        viewId: param.viewId,
        req: param.req,
        body: { records },
        trashEntryId,
      });
      trashEntryId = result.trash_entry_id;
      deleted.push(
        ...result.list.map(
          (record) => record.row_data as Record<string, unknown>,
        ),
      );
    }

    return deleted;
  }

  async restore(
    context: NcContext,
    param: { modelId: string; body: RecordTrashRestoreReqType; req: NcRequest },
  ) {
    validatePayload(
      'swagger.json#/components/schemas/RecordTrashRestoreReq',
      param.body,
    );
    const ids = this.validateTrashIds(context, param.body.trash_ids);
    const mode = this.validateRestoreMode(context, param.body.mode);
    const resources = await this.getModelResources(context, param.modelId);
    const records = await this.getTrashRecords(context, param.modelId, ids);
    const { analysis, prepared } = await this.analyzeRecords(
      context,
      resources,
      records,
    );

    if (mode === 'strict' && analysis.conflicted) {
      NcError.get(context).unprocessableEntity(
        `${analysis.conflicted} Trash record(s) have restore conflicts`,
      );
    }

    const selected = prepared
      .filter((item) => {
        if (!item.issues.length) return true;
        if (mode !== 'force') return false;
        return item.issues.every((issue) => issue.clearable);
      })
      .map((item) => {
        const data = { ...item.data };
        if (mode === 'force') {
          for (const issue of item.issues) {
            if (issue.clearable && issue.field) data[issue.field] = null;
          }
        }
        return { ...item, data };
      });

    if (!selected.length) {
      return {
        restored: 0,
        skipped: records.length,
        conflicted: analysis.conflicted,
      };
    }

    const restored = await this.dataTableService.dataInsert(context, {
      modelId: param.modelId,
      body: selected.map((item) => item.data),
      cookie: param.req,
      // Trash restoration must preserve auto-increment primary keys. The
      // existing undo insertion path is the baseline's supported mechanism
      // for retaining those values across every database client.
      undo: true,
      internalFlags: { allowSystemColumn: true },
    });
    const restoredRows = Array.isArray(restored) ? restored : [restored];
    const restoredIds = restoredRows.map((row) =>
      String(resources.baseModel.extractPksValues(row, true)),
    );
    if (
      restoredIds.length !== selected.length ||
      selected.some(
        (item, index) => item.record.record_id !== restoredIds[index],
      )
    ) {
      try {
        await this.dataTableService.dataDelete(context, {
          modelId: param.modelId,
          body: restoredRows,
          cookie: param.req,
        });
      } catch (cleanupError) {
        this.logger.error(
          'Failed to remove records whose restored primary keys did not match',
          cleanupError,
        );
      }
      NcError.get(context).internalServerError(
        'Restored record primary keys did not match their trash snapshots',
      );
    }
    const restoredTrashIds = selected.map((item) => item.record.id);
    const entryIds = [
      ...new Set(
        selected
          .map((item) => item.record.fk_trash_entry_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    await RecordTrash.deleteMany(context, restoredTrashIds);
    await Promise.all(
      entryIds.map((entryId) => BaseTrashEntry.deleteIfEmpty(context, entryId)),
    );
    return {
      restored: restoredTrashIds.length,
      skipped: records.length - restoredTrashIds.length,
      conflicted: analysis.conflicted,
    };
  }

  async analyze(
    context: NcContext,
    param: { modelId: string; body: RecordTrashIdsReqType },
  ): Promise<RecordTrashConflictAnalysisType> {
    validatePayload(
      'swagger.json#/components/schemas/RecordTrashIdsReq',
      param.body,
    );
    const ids = this.validateTrashIds(context, param.body.trash_ids);
    const resources = await this.getModelResources(context, param.modelId);
    const records = await this.getTrashRecords(context, param.modelId, ids);
    return (await this.analyzeRecords(context, resources, records)).analysis;
  }

  async permanentlyDelete(
    context: NcContext,
    param: { modelId: string; body: RecordTrashIdsReqType },
  ) {
    validatePayload(
      'swagger.json#/components/schemas/RecordTrashIdsReq',
      param.body,
    );
    const ids = this.validateTrashIds(context, param.body.trash_ids);
    await this.getModelResources(context, param.modelId);
    const records = await RecordTrash.listByIds(context, param.modelId, ids);
    if (records.length !== ids.length) {
      NcError.get(context).badRequest(
        'One or more trash snapshots do not exist for this table',
      );
    }
    const entryIds = [
      ...new Set(
        records
          .map((record) => record.fk_trash_entry_id)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    await RecordTrash.deleteMany(context, ids);
    await Promise.all(
      entryIds.map((entryId) => BaseTrashEntry.deleteIfEmpty(context, entryId)),
    );
    return { deleted: ids.length };
  }

  async analyzeBaseTrashEntry(
    context: NcContext,
    param: { trashEntryId: string },
  ): Promise<RecordTrashConflictAnalysisType> {
    const entry = await BaseTrashEntry.get(context, param.trashEntryId);
    if (!entry) NcError.get(context).notFound('Trash entry not found');
    if (new Date(entry.expires_at).getTime() <= Date.now()) {
      NcError.get(context).badRequest(
        'Expired trash entries cannot be restored',
      );
    }
    if (entry.resource_type !== 'records') {
      NcError.get(context).unprocessableEntity(
        `Conflict analysis is not supported for ${entry.resource_type}`,
      );
    }

    const resources = await this.getModelResources(context, entry.resource_id);
    const summary: RecordTrashConflictAnalysisType = {
      total: 0,
      clean: 0,
      conflicted: 0,
      truncated: false,
      conflicts: [],
    };
    let offset = 0;

    // Analyze bounded pages so a large grouped deletion does not need to be
    // loaded into application memory at once.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const records = await RecordTrash.listByEntryId(context, entry.id, {
        limit: RECORD_TRASH_MAX_BATCH_SIZE,
        offset,
      });
      if (!records.length) break;
      const page = (await this.analyzeRecords(context, resources, records))
        .analysis;
      summary.total += page.total;
      summary.clean += page.clean;
      summary.conflicted += page.conflicted;
      const remaining = RECORD_TRASH_MAX_BATCH_SIZE - summary.conflicts.length;
      if (remaining > 0) {
        summary.conflicts.push(...page.conflicts.slice(0, remaining));
      }
      offset += records.length;
    }
    summary.truncated = summary.conflicted > summary.conflicts.length;
    return summary;
  }

  async restoreBaseTrashEntry(
    context: NcContext,
    param: {
      trashEntryId: string;
      req: NcRequest;
      body?: RecordTrashRestoreModeReqType;
    },
  ) {
    validatePayload(
      'swagger.json#/components/schemas/RecordTrashRestoreModeReq',
      param.body ?? {},
    );
    const mode = this.validateRestoreMode(context, param.body?.mode);
    const entry = await BaseTrashEntry.get(context, param.trashEntryId);
    if (!entry) NcError.get(context).notFound('Trash entry not found');
    if (new Date(entry.expires_at).getTime() <= Date.now()) {
      NcError.get(context).badRequest(
        'Expired trash entries cannot be restored',
      );
    }
    if (entry.resource_type === 'view') {
      const roles = param.req.user?.base_roles ?? {};
      if (!roles[ProjectRoles.OWNER] && !roles[ProjectRoles.CREATOR]) {
        NcError.forbidden('Only base owners and creators can restore views');
      }
      const viewTrash = await ViewTrash.getByEntryId(context, entry.id);
      if (!viewTrash) {
        NcError.get(context).notFound('View trash snapshot not found');
      }
      const model = await Model.get(context, viewTrash.fk_model_id);
      if (!model) {
        NcError.get(context).badRequest(
          'The table that contained this view no longer exists',
        );
      }
      const source = await Source.get(context, model.source_id);
      if (source?.is_schema_readonly) {
        NcError.get(context).sourceMetaReadOnly(source.alias);
      }
      const restoredView = await ViewTrash.restore(context, entry.id);
      return {
        restored: 1,
        resource_type: 'view' as const,
        resource_id: restoredView.id,
        parent_id: restoredView.fk_model_id,
      };
    }
    if (entry.resource_type === 'table') {
      const roles = param.req.user?.base_roles ?? {};
      if (!roles[ProjectRoles.OWNER] && !roles[ProjectRoles.CREATOR]) {
        NcError.forbidden('Only base owners and creators can restore tables');
      }
      const restoredTable = await this.tablesService.restoreTableTrash(
        context,
        {
          entry,
          user: param.req.user,
          req: param.req,
        },
      );
      return {
        restored: 1,
        resource_type: 'table' as const,
        resource_id: restoredTable.id,
      };
    }
    if (entry.resource_type === 'field') {
      const roles = param.req.user?.base_roles ?? {};
      if (!roles[ProjectRoles.OWNER] && !roles[ProjectRoles.CREATOR]) {
        NcError.forbidden('Only base owners and creators can restore fields');
      }
      const restoredField = await this.columnsService.restoreFieldTrash(
        context,
        {
          entry,
          user: param.req.user,
          req: param.req,
        },
      );
      return {
        restored: 1,
        resource_type: 'field' as const,
        resource_id: restoredField.id,
        parent_id: restoredField.fk_model_id,
      };
    }
    if (entry.resource_type !== 'records') {
      NcError.get(context).unprocessableEntity(
        `Restore is not supported for ${entry.resource_type}`,
      );
    }
    const { source } = await this.getModelResources(context, entry.resource_id);
    if (source.is_data_readonly) {
      NcError.get(context).sourceDataReadOnly(source.alias);
    }

    if (mode === 'strict') {
      const analysis = await this.analyzeBaseTrashEntry(context, {
        trashEntryId: entry.id,
      });
      if (analysis.conflicted) {
        NcError.get(context).unprocessableEntity(
          `${analysis.conflicted} Trash record(s) have restore conflicts`,
        );
      }
    }

    let restored = 0;
    let skipped = 0;
    let conflicted = 0;
    let offset = 0;
    // Restored rows are removed from Trash. Advancing only past skipped rows
    // lets the next bounded query continue without missing shifted rows.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const records = await RecordTrash.listByEntryId(context, entry.id, {
        limit: RECORD_TRASH_MAX_BATCH_SIZE,
        offset,
      });
      if (!records.length) break;
      const result = await this.restore(context, {
        modelId: entry.resource_id,
        body: {
          trash_ids: records.map((record) => record.id),
          mode,
        },
        req: param.req,
      });
      restored += result.restored;
      skipped += result.skipped;
      conflicted += result.conflicted;
      offset += result.skipped;
    }
    await BaseTrashEntry.deleteIfEmpty(context, entry.id);
    return { restored, skipped, conflicted };
  }

  async emptyBaseTrash(context: NcContext) {
    const fieldDeleted = await this.columnsService.emptyFieldTrash(context);
    const tableDeleted = await this.tablesService.emptyTableTrash(context);
    const result = await BaseTrashEntry.empty(context);
    return { deleted: result.deleted + fieldDeleted + tableDeleted };
  }
}
