import { Injectable, Logger } from '@nestjs/common';
import type {
  RecordTrashCreateReqType,
  RecordTrashIdsReqType,
} from 'nocodb-sdk';
import type { NcContext, NcRequest } from '~/interface/config';
import { validatePayload } from '~/helpers';
import { NcError } from '~/helpers/catchError';
import {
  hashTrashRecordId,
  RECORD_TRASH_MAX_BATCH_BYTES,
  RECORD_TRASH_MAX_BATCH_SIZE,
  RECORD_TRASH_MAX_RECORD_ID_BYTES,
  RECORD_TRASH_MAX_ROW_BYTES,
  serializedByteLength,
  snapshotTrashRow,
  trashExpiryFrom,
} from '~/helpers/recordTrash';
import { BaseTrashEntry, Model, RecordTrash, Source } from '~/models';
import NcConnectionMgrv2 from '~/utils/common/NcConnectionMgrv2';
import { PagedResponseImpl } from '~/helpers/PagedResponse';
import { DataTableService } from '~/services/data-table.service';
import { BaseModelDelete } from '~/db/BaseModelSqlv2/delete';

@Injectable()
export class RecordTrashService {
  private readonly logger = new Logger(RecordTrashService.name);

  constructor(private readonly dataTableService: DataTableService) {}

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

  private async getModelResources(context: NcContext, modelId: string) {
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
      if (serializedByteLength(rowData) > RECORD_TRASH_MAX_ROW_BYTES) {
        NcError.get(context).badRequest(
          `A record trash snapshot must not exceed ${RECORD_TRASH_MAX_ROW_BYTES} bytes`,
        );
      }
      batchBytes += serializedByteLength(rowData);
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
    param: { modelId: string; body: RecordTrashIdsReqType; req: NcRequest },
  ) {
    validatePayload(
      'swagger.json#/components/schemas/RecordTrashIdsReq',
      param.body,
    );
    const ids = this.validateTrashIds(context, param.body.trash_ids);
    const { baseModel } = await this.getModelResources(context, param.modelId);
    const records = await RecordTrash.listByIds(context, param.modelId, ids);
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

    for (const record of records) {
      const liveRecord = await baseModel.readByPk(
        record.record_id,
        false,
        {},
        {
          ignoreView: true,
          extractOnlyPrimaries: true,
        },
      );
      if (liveRecord) {
        NcError.get(context).unprocessableEntity(
          `Cannot restore record ${record.record_id}: its primary key is already in use`,
        );
      }
    }

    const restored = await this.dataTableService.dataInsert(context, {
      modelId: param.modelId,
      body: records.map((record) => record.row_data),
      cookie: param.req,
      // Trash restoration must preserve auto-increment primary keys. The
      // existing undo insertion path is the baseline's supported mechanism
      // for retaining those values across every database client.
      undo: true,
      internalFlags: { allowSystemColumn: true },
    });
    const restoredRows = Array.isArray(restored) ? restored : [restored];
    const restoredIds = restoredRows.map((row) =>
      String(baseModel.extractPksValues(row, true)),
    );
    if (
      restoredIds.length !== records.length ||
      records.some((record, index) => record.record_id !== restoredIds[index])
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
    return { restored: ids.length };
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

  async restoreBaseTrashEntry(
    context: NcContext,
    param: { trashEntryId: string; req: NcRequest },
  ) {
    const entry = await BaseTrashEntry.get(context, param.trashEntryId);
    if (!entry) NcError.get(context).notFound('Trash entry not found');
    if (entry.resource_type !== 'records') {
      NcError.get(context).unprocessableEntity(
        `Restore is not supported for ${entry.resource_type}`,
      );
    }
    if (new Date(entry.expires_at).getTime() <= Date.now()) {
      NcError.get(context).badRequest(
        'Expired trash entries cannot be restored',
      );
    }
    const { source } = await this.getModelResources(context, entry.resource_id);
    if (source.is_data_readonly) {
      NcError.get(context).sourceDataReadOnly(source.alias);
    }

    let restored = 0;
    // Each successful restore removes the first bounded page from the entry.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const records = await RecordTrash.listByEntryId(context, entry.id, {
        limit: RECORD_TRASH_MAX_BATCH_SIZE,
      });
      if (!records.length) break;
      const result = await this.restore(context, {
        modelId: entry.resource_id,
        body: { trash_ids: records.map((record) => record.id) },
        req: param.req,
      });
      restored += result.restored;
    }
    await BaseTrashEntry.deleteIfEmpty(context, entry.id);
    return { restored };
  }

  async emptyBaseTrash(context: NcContext) {
    return BaseTrashEntry.empty(context);
  }
}
