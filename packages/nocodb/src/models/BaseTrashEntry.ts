import type { NcContext } from '~/interface/config';
import type { MetaService } from '~/meta/meta.service';
import Noco from '~/Noco';
import { extractProps } from '~/helpers/extractProps';
import { MetaTable } from '~/utils/globals';

export default class BaseTrashEntry {
  id: string;
  resource_type: 'records' | 'view' | 'table' | 'field';
  resource_id: string;
  resource_name?: string;
  storage_name?: string;
  original_type?: string;
  deleted_by?: string;
  deleted_at: string;
  expires_at: string;
  source_id?: string;
  parent_id?: string;
  base_id?: string;
  fk_workspace_id?: string;
  created_at?: string;
  updated_at?: string;

  constructor(data: Partial<BaseTrashEntry>) {
    Object.assign(this, data);
  }

  private static fromDb(data: any): BaseTrashEntry | null {
    return data ? new BaseTrashEntry(data) : null;
  }

  static async create(
    context: NcContext,
    entry: Partial<BaseTrashEntry>,
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<BaseTrashEntry> {
    const insertObj = extractProps(entry, [
      'resource_type',
      'resource_id',
      'resource_name',
      'storage_name',
      'original_type',
      'deleted_by',
      'deleted_at',
      'expires_at',
      'source_id',
      'parent_id',
    ]);
    return this.fromDb(
      await ncMeta.metaInsert2(
        context.workspace_id,
        context.base_id,
        MetaTable.BASE_TRASH,
        insertObj,
      ),
    )!;
  }

  static async get(
    context: NcContext,
    id: string,
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<BaseTrashEntry | null> {
    return this.fromDb(
      await ncMeta.metaGet2(
        context.workspace_id,
        context.base_id,
        MetaTable.BASE_TRASH,
        id,
      ),
    );
  }

  static async list(
    context: NcContext,
    args: { limit: number; offset: number },
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<BaseTrashEntry[]> {
    const entries = await ncMeta.metaList2(
      context.workspace_id,
      context.base_id,
      MetaTable.BASE_TRASH,
      {
        limit: args.limit,
        offset: args.offset,
        orderBy: { deleted_at: 'desc', id: 'desc' },
      },
    );
    return entries.map((entry) => this.fromDb(entry)!);
  }

  static async count(
    context: NcContext,
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<number> {
    return ncMeta.metaCount(
      context.workspace_id,
      context.base_id,
      MetaTable.BASE_TRASH,
    );
  }

  static async listByType(
    context: NcContext,
    resourceType: BaseTrashEntry['resource_type'],
    args: {
      limit?: number;
      offset?: number;
      sourceId?: string;
      parentId?: string;
    } = {},
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<BaseTrashEntry[]> {
    const entries = await ncMeta.metaList2(
      context.workspace_id,
      context.base_id,
      MetaTable.BASE_TRASH,
      {
        condition: {
          resource_type: resourceType,
          ...(args.sourceId ? { source_id: args.sourceId } : {}),
          ...(args.parentId ? { parent_id: args.parentId } : {}),
        },
        orderBy: { expires_at: 'asc', id: 'asc' },
        ...(args.limit !== undefined ? { limit: args.limit } : {}),
        ...(args.offset !== undefined ? { offset: args.offset } : {}),
      },
    );
    return entries.map((entry) => this.fromDb(entry)!);
  }

  static async listExpiredTables(
    cutoff: Date,
    limit: number,
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<BaseTrashEntry[]> {
    const rows = await ncMeta
      .knex(MetaTable.BASE_TRASH)
      .where('resource_type', 'table')
      .where('expires_at', '<=', ncMeta.formatDateTime(cutoff.toISOString()))
      .orderBy('expires_at', 'asc')
      .orderBy('id', 'asc')
      .limit(limit);
    return rows.map((entry) => this.fromDb(entry)!);
  }

  static async listExpiredFields(
    cutoff: Date,
    limit: number,
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<BaseTrashEntry[]> {
    const rows = await ncMeta
      .knex(MetaTable.BASE_TRASH)
      .where('resource_type', 'field')
      .where('expires_at', '<=', ncMeta.formatDateTime(cutoff.toISOString()))
      .orderBy('expires_at', 'asc')
      .orderBy('id', 'asc')
      .limit(limit);
    return rows.map((entry) => this.fromDb(entry)!);
  }

  static async delete(
    context: NcContext,
    id: string,
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<void> {
    await ncMeta.metaDelete(
      context.workspace_id,
      context.base_id,
      MetaTable.BASE_TRASH,
      id,
    );
  }

  static async deleteIfEmpty(
    context: NcContext,
    id: string,
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<void> {
    const query = ncMeta
      .knex(MetaTable.BASE_TRASH)
      .where('id', id)
      .whereIn('resource_type', ['records', 'view'])
      .whereNotExists(function () {
        this.select(1)
          .from(MetaTable.RECORD_TRASH)
          .whereRaw(
            `${MetaTable.RECORD_TRASH}.base_id = ${MetaTable.BASE_TRASH}.base_id`,
          )
          .whereRaw(
            `${MetaTable.RECORD_TRASH}.fk_trash_entry_id = ${MetaTable.BASE_TRASH}.id`,
          );
      })
      .whereNotExists(function () {
        this.select(1)
          .from(MetaTable.VIEW_TRASH)
          .whereRaw(
            `${MetaTable.VIEW_TRASH}.base_id = ${MetaTable.BASE_TRASH}.base_id`,
          )
          .whereRaw(
            `${MetaTable.VIEW_TRASH}.fk_trash_entry_id = ${MetaTable.BASE_TRASH}.id`,
          );
      })
      .delete();
    ncMeta.contextCondition(
      query,
      context.workspace_id,
      context.base_id,
      MetaTable.BASE_TRASH,
    );
    await query;
  }

  static async empty(
    context: NcContext,
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<{ deleted: number }> {
    return ncMeta.knex.transaction(async (trx) => {
      const recordQuery = trx(MetaTable.RECORD_TRASH).delete();
      ncMeta.contextCondition(
        recordQuery,
        context.workspace_id,
        context.base_id,
        MetaTable.RECORD_TRASH,
      );
      const recordDeleted = Number(await recordQuery);

      const viewQuery = trx(MetaTable.VIEW_TRASH).delete();
      ncMeta.contextCondition(
        viewQuery,
        context.workspace_id,
        context.base_id,
        MetaTable.VIEW_TRASH,
      );
      const viewDeleted = Number(await viewQuery);

      const entryQuery = trx(MetaTable.BASE_TRASH).delete();
      ncMeta.contextCondition(
        entryQuery,
        context.workspace_id,
        context.base_id,
        MetaTable.BASE_TRASH,
      );
      await entryQuery;
      return { deleted: recordDeleted + viewDeleted };
    });
  }
}
