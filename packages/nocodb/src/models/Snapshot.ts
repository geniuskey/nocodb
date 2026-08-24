import type { SnapshotType } from 'nocodb-sdk';
import type { NcContext } from '~/interface/config';
import type { MetaService } from '~/meta/meta.service';
import { extractProps } from '~/helpers/extractProps';
import Noco from '~/Noco';
import { MetaTable } from '~/utils/globals';

export const SNAPSHOT_FORMAT_VERSION = 1;

export enum SnapshotStatus {
  CREATING = 'creating',
  RESTORING = 'restoring',
  READY = 'ready',
  FAILED = 'failed',
}

export interface SnapshotManifest {
  format: 'nocodb-community-base-snapshot';
  format_version: number;
  source_version: string;
  source_base_id: string;
  storage_base_id: string;
  captured_at: string;
  tables: Array<{
    title: string;
    column_count: number;
    record_count: number;
  }>;
}

export default class Snapshot implements SnapshotType {
  id: string;
  title: string;
  base_id: string;
  snapshot_base_id: string;
  fk_workspace_id?: string;
  created_by?: string;
  status: SnapshotStatus;
  format_version: number;
  source_version?: string;
  manifest?: SnapshotManifest;
  job_id?: string;
  error?: string;
  completed_at?: string;
  created_at?: string;
  updated_at?: string;

  constructor(data: Partial<Snapshot>) {
    Object.assign(this, data);
  }

  private static fromDb(data: any): Snapshot | null {
    if (!data) return null;
    let manifest = data.manifest;
    if (typeof manifest === 'string') {
      try {
        manifest = JSON.parse(manifest);
      } catch {
        manifest = undefined;
      }
    }
    return new Snapshot({
      ...data,
      manifest,
    });
  }

  static async create(
    context: NcContext,
    data: Partial<Snapshot>,
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<Snapshot> {
    const insert: Record<string, any> = extractProps(data, [
      'id',
      'title',
      'snapshot_base_id',
      'created_by',
      'status',
      'format_version',
      'source_version',
      'manifest',
      'job_id',
      'error',
      'completed_at',
    ]);
    if (insert.manifest) insert.manifest = JSON.stringify(insert.manifest);
    const created = await ncMeta.metaInsert2(
      context.workspace_id,
      context.base_id,
      MetaTable.SNAPSHOT,
      insert,
    );
    return this.fromDb(created)!;
  }

  static async get(
    context: NcContext,
    id: string,
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<Snapshot | null> {
    return this.fromDb(
      await ncMeta.metaGet2(
        context.workspace_id,
        context.base_id,
        MetaTable.SNAPSHOT,
        id,
      ),
    );
  }

  static async list(
    context: NcContext,
    args: { limit: number; offset: number },
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<Snapshot[]> {
    const rows = await ncMeta.metaList2(
      context.workspace_id,
      context.base_id,
      MetaTable.SNAPSHOT,
      {
        limit: args.limit,
        offset: args.offset,
        orderBy: { created_at: 'desc', id: 'desc' },
      },
    );
    return rows.map((row) => this.fromDb(row)!);
  }

  static async count(
    context: NcContext,
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<number> {
    return ncMeta.metaCount(
      context.workspace_id,
      context.base_id,
      MetaTable.SNAPSHOT,
    );
  }

  static async update(
    context: NcContext,
    id: string,
    data: Partial<Snapshot>,
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<void> {
    const update: Record<string, any> = extractProps(data, [
      'title',
      'status',
      'format_version',
      'source_version',
      'manifest',
      'job_id',
      'error',
      'completed_at',
    ]);
    if (update.manifest) update.manifest = JSON.stringify(update.manifest);
    await ncMeta.metaUpdate(
      context.workspace_id,
      context.base_id,
      MetaTable.SNAPSHOT,
      update,
      id,
    );
  }

  static async delete(
    context: NcContext,
    id: string,
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<void> {
    await ncMeta.metaDelete(
      context.workspace_id,
      context.base_id,
      MetaTable.SNAPSHOT,
      id,
    );
  }
}
