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
  fk_trash_entry_id?: string;
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
        'fk_trash_entry_id',
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

  static async listByEntryId(
    context: NcContext,
    entryId: string,
    args: { limit?: number } = {},
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<RecordTrash[]> {
    const records = await ncMeta.metaList2(
      context.workspace_id,
      context.base_id,
      MetaTable.RECORD_TRASH,
      {
        condition: { fk_trash_entry_id: entryId },
        limit: args.limit,
        orderBy: { deleted_at: 'asc' },
      },
    );
    return records.map((record) => this.fromDb(record)!);
  }

  static async countByEntryId(
    context: NcContext,
    entryId: string,
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<number> {
    return ncMeta.metaCount(
      context.workspace_id,
      context.base_id,
      MetaTable.RECORD_TRASH,
      { condition: { fk_trash_entry_id: entryId } },
    );
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

  static async deleteExpiredBatch(
    cutoff: Date,
    limit: number,
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<{ selected: number; deleted: number }> {
    const formattedCutoff = ncMeta.formatDateTime(cutoff.toISOString());
    const candidates: Array<{
      base_id?: string;
      id: string;
      fk_trash_entry_id?: string;
    }> = await ncMeta
      .knex(MetaTable.RECORD_TRASH)
      .select('base_id', 'id', 'fk_trash_entry_id')
      .where('expires_at', '<=', formattedCutoff)
      .orderBy('expires_at', 'asc')
      .orderBy('id', 'asc')
      .limit(limit);

    if (!candidates.length) return { selected: 0, deleted: 0 };

    const idsByBase = candidates.reduce<Map<string | null, string[]>>(
      (groups, record) => {
        const baseId = record.base_id ?? null;
        const ids = groups.get(baseId) ?? [];
        ids.push(record.id);
        groups.set(baseId, ids);
        return groups;
      },
      new Map(),
    );
    const query = ncMeta
      .knex(MetaTable.RECORD_TRASH)
      .where('expires_at', '<=', formattedCutoff)
      .where(function () {
        for (const [baseId, ids] of idsByBase) {
          this.orWhere(function () {
            if (baseId === null) this.whereNull('base_id');
            else this.where('base_id', baseId);
            this.whereIn('id', ids);
          });
        }
      })
      .delete();
    const deleted = Number(await query);

    const entryIdsByBase = candidates.reduce<Map<string | null, string[]>>(
      (groups, record) => {
        if (!record.fk_trash_entry_id) return groups;
        const baseId = record.base_id ?? null;
        const ids = groups.get(baseId) ?? [];
        ids.push(record.fk_trash_entry_id);
        groups.set(baseId, ids);
        return groups;
      },
      new Map(),
    );
    if (entryIdsByBase.size) {
      const remainingEntries: Array<{
        base_id?: string;
        fk_trash_entry_id: string;
      }> = await ncMeta
        .knex(MetaTable.RECORD_TRASH)
        .select('base_id', 'fk_trash_entry_id')
        .where(function () {
          for (const [baseId, ids] of entryIdsByBase) {
            this.orWhere(function () {
              if (baseId === null) this.whereNull('base_id');
              else this.where('base_id', baseId);
              this.whereIn('fk_trash_entry_id', [...new Set(ids)]);
            });
          }
        });
      const remainingKeys = new Set(
        remainingEntries.map(
          (entry) => `${entry.base_id ?? ''}:${entry.fk_trash_entry_id}`,
        ),
      );
      const orphanIdsByBase = new Map<string | null, string[]>();
      for (const [baseId, ids] of entryIdsByBase) {
        const orphanIds = [...new Set(ids)].filter(
          (id) => !remainingKeys.has(`${baseId ?? ''}:${id}`),
        );
        if (orphanIds.length) orphanIdsByBase.set(baseId, orphanIds);
      }

      if (orphanIdsByBase.size)
        await ncMeta
          .knex(MetaTable.BASE_TRASH)
          .where('resource_type', 'records')
          .where(function () {
            for (const [baseId, ids] of orphanIdsByBase) {
              this.orWhere(function () {
                if (baseId === null) this.whereNull('base_id');
                else this.where('base_id', baseId);
                this.whereIn('id', ids);
              });
            }
          })
          .delete();
    }

    return {
      selected: candidates.length,
      deleted,
    };
  }
}
