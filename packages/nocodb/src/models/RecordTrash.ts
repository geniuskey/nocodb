import type { RecordTrashType } from 'nocodb-sdk';
import type { NcContext } from '~/interface/config';
import type { MetaService } from '~/meta/meta.service';
import Noco from '~/Noco';
import { extractProps } from '~/helpers/extractProps';
import { hashTrashRecordId } from '~/helpers/recordTrash';
import { MetaTable } from '~/utils/globals';

export default class RecordTrash implements RecordTrashType {
  id: string;
  fk_model_id: string;
  record_id: string;
  record_hash?: string;
  pk_data: Record<string, unknown>;
  row_data: Record<string, unknown>;
  deleted_by?: string;
  deleted_at: string;
  expires_at: string;
  source_id?: string;
  base_id?: string;
  fk_workspace_id?: string;
  created_at?: string;
  updated_at?: string;

  constructor(data: Partial<RecordTrash>) {
    Object.assign(this, data);
  }

  private static fromDb(data: any): RecordTrash | null {
    if (!data) return null;
    const { record_hash, ...publicData } = data;
    return new RecordTrash({
      ...publicData,
      pk_data:
        typeof publicData.pk_data === 'string'
          ? JSON.parse(publicData.pk_data)
          : publicData.pk_data,
      row_data:
        typeof publicData.row_data === 'string'
          ? JSON.parse(publicData.row_data)
          : publicData.row_data,
    });
  }

  static async insertMany(
    context: NcContext,
    records: Partial<RecordTrash>[],
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<RecordTrash[]> {
    const rows = records.map((record) => {
      const insertObj = extractProps(record, [
        'fk_model_id',
        'record_id',
        'pk_data',
        'row_data',
        'deleted_by',
        'deleted_at',
        'expires_at',
        'source_id',
      ]);
      return {
        ...insertObj,
        record_hash: hashTrashRecordId(insertObj.record_id),
        pk_data: JSON.stringify(insertObj.pk_data),
        row_data: JSON.stringify(insertObj.row_data),
      };
    });
    const inserted = await ncMeta.bulkMetaInsert(
      context.workspace_id,
      context.base_id,
      MetaTable.RECORD_TRASH,
      rows,
    );
    return inserted.map((record) => this.fromDb(record)!);
  }

  static async list(
    context: NcContext,
    modelId: string,
    args: { limit: number; offset: number },
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<RecordTrash[]> {
    const records = await ncMeta.metaList2(
      context.workspace_id,
      context.base_id,
      MetaTable.RECORD_TRASH,
      {
        condition: { fk_model_id: modelId },
        limit: args.limit,
        offset: args.offset,
        orderBy: { deleted_at: 'desc' },
      },
    );
    return records.map((record) => this.fromDb(record)!);
  }

  static async count(
    context: NcContext,
    modelId: string,
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<number> {
    return await ncMeta.metaCount(
      context.workspace_id,
      context.base_id,
      MetaTable.RECORD_TRASH,
      { condition: { fk_model_id: modelId } },
    );
  }

  static async listByIds(
    context: NcContext,
    modelId: string,
    ids: string[],
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<RecordTrash[]> {
    if (!ids.length) return [];
    const records = await ncMeta.metaList2(
      context.workspace_id,
      context.base_id,
      MetaTable.RECORD_TRASH,
      {
        condition: { fk_model_id: modelId },
        xcCondition: { id: { in: ids } },
        orderBy: { deleted_at: 'asc' },
      },
    );
    return records.map((record) => this.fromDb(record)!);
  }

  static async listByRecordHashes(
    context: NcContext,
    modelId: string,
    hashes: string[],
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<RecordTrash[]> {
    if (!hashes.length) return [];
    const records = await ncMeta.metaList2(
      context.workspace_id,
      context.base_id,
      MetaTable.RECORD_TRASH,
      {
        condition: { fk_model_id: modelId },
        xcCondition: { record_hash: { in: hashes } },
      },
    );
    return records.map((record) => this.fromDb(record)!);
  }

  static async deleteMany(
    context: NcContext,
    ids: string[],
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<void> {
    if (!ids.length) return;
    const query = ncMeta
      .knex(MetaTable.RECORD_TRASH)
      .whereIn('id', ids)
      .delete();
    ncMeta.contextCondition(
      query,
      context.workspace_id,
      context.base_id,
      MetaTable.RECORD_TRASH,
    );
    await query;
  }
}
