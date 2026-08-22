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
import { Model, RecordTrash, Source } from '~/models';
import NcConnectionMgrv2 from '~/utils/common/NcConnectionMgrv2';
import { PagedResponseImpl } from '~/helpers/PagedResponse';
import { DataTableService } from '~/services/data-table.service';

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
    return { model, baseModel, columns };
  }

  async list(
    context: NcContext,
    param: { modelId: string; limit?: string; offset?: string },
  ) {
    await this.getModelResources(context, param.modelId);
    const limit = param.limit === undefined ? 25 : Number(param.limit);
    const offset = param.offset === undefined ? 0 : Number(param.offset);
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
    const [records, count] = await Promise.all([
      RecordTrash.list(context, param.modelId, { limit, offset }),
      RecordTrash.count(context, param.modelId),
    ]);
    return new PagedResponseImpl(records, { limit, offset, count });
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
    ),
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

    const inserted = await RecordTrash.insertMany(context, snapshots);
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
      } catch (cleanupError) {
        this.logger.error(
          'Failed to remove trash snapshots after record deletion failed',
          cleanupError,
        );
      }
      throw error;
    }
    return { list: inserted };
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
    await RecordTrash.deleteMany(context, ids);
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
    await RecordTrash.deleteMany(context, ids);
    return { deleted: ids.length };
  }
}
