import type { NcContext } from '~/interface/config';
import type { MetaService } from '~/meta/meta.service';
import Noco from '~/Noco';
import { NcError } from '~/helpers/catchError';
import { MetaTable } from '~/utils/globals';

const DEFAULT_CAPTURE_TIMEOUT_MINUTES = 360;

const captureTimeoutMinutes = () => {
  const configured = Number(process.env.NC_SNAPSHOT_CAPTURE_TIMEOUT_MINUTES);
  if (!Number.isFinite(configured)) return DEFAULT_CAPTURE_TIMEOUT_MINUTES;
  return Math.min(Math.max(Math.floor(configured), 5), 24 * 60);
};

export default class SnapshotLock {
  static async acquire(
    context: NcContext,
    snapshotId: string,
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<void> {
    const now = new Date();
    await ncMeta
      .knex(MetaTable.SNAPSHOT_LOCK)
      .where('base_id', context.base_id)
      .where('expires_at', '<=', ncMeta.formatDateTime(now.toISOString()))
      .delete();

    const expiresAt = new Date(
      now.getTime() + captureTimeoutMinutes() * 60_000,
    );
    try {
      const timestamp = ncMeta.formatDateTime(now.toISOString());
      await ncMeta.knex(MetaTable.SNAPSHOT_LOCK).insert({
        base_id: context.base_id,
        snapshot_id: snapshotId,
        fk_workspace_id: context.workspace_id,
        expires_at: ncMeta.formatDateTime(expiresAt.toISOString()),
        created_at: timestamp,
        updated_at: timestamp,
      });
    } catch {
      NcError.get(context).badRequest(
        'A snapshot is already being captured for this base',
      );
    }
  }

  static async isActive(
    context: NcContext,
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<boolean> {
    if (!context.base_id) return false;
    const row = await ncMeta
      .knex(MetaTable.SNAPSHOT_LOCK)
      .where('base_id', context.base_id)
      .first();
    if (!row) return false;
    return new Date(row.expires_at).getTime() > Date.now();
  }

  static async release(
    context: NcContext,
    snapshotId: string,
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<void> {
    await ncMeta
      .knex(MetaTable.SNAPSHOT_LOCK)
      .where('base_id', context.base_id)
      .where('snapshot_id', snapshotId)
      .delete();
  }
}
