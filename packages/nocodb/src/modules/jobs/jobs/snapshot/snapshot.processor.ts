import { Injectable } from '@nestjs/common';
import type { Job } from 'bull';
import { packageVersion } from '~/utils/packageVersion';
import type {
  CreateSnapshotJobData,
  RestoreSnapshotJobData,
} from '~/interface/Jobs';
import { JobTypes } from '~/interface/Jobs';
import {
  buildSnapshotManifest,
  snapshotManifestMatches,
} from '~/helpers/baseSnapshot';
import { Base, Snapshot, SnapshotLock, Source } from '~/models';
import { SnapshotStatus } from '~/models/Snapshot';
import { DuplicateProcessor } from '~/modules/jobs/jobs/export-import/duplicate.processor';

@Injectable()
export class SnapshotProcessor {
  constructor(protected readonly duplicateProcessor: DuplicateProcessor) {}

  async create(job: Job<CreateSnapshotJobData>) {
    const {
      context,
      sourceId,
      snapshotBaseId,
      req,
      snapshot: snapshotData,
    } = job.data;
    const storageContext = {
      workspace_id: context.workspace_id,
      base_id: snapshotBaseId,
      additionalContext: { allowSnapshotBase: true },
    };
    try {
      const snapshot = await Snapshot.get(context, snapshotData.id as string);
      const sourceBase = await Base.get(context, context.base_id);
      const storageBase = await Base.getSnapshotWithInfo(
        storageContext,
        snapshotBaseId,
      );
      const source = await Source.get(context, sourceId);
      if (!snapshot || !sourceBase || !storageBase || !source) {
        throw new Error('Snapshot capture resources are missing');
      }
      await this.duplicateProcessor.duplicateBaseJob({
        sourceBase,
        targetBase: storageBase,
        dataSource: source,
        req,
        context,
        targetContext: storageContext,
        options: {
          excludeUsers: true,
        },
        operation: JobTypes.CreateSnapshot,
      });
      const manifest = await buildSnapshotManifest(
        storageContext,
        storageBase,
        packageVersion,
      );
      manifest.source_base_id = context.base_id;
      await Snapshot.update(context, snapshot.id, {
        status: SnapshotStatus.READY,
        manifest,
        completed_at: new Date().toISOString(),
        error: null,
      });
      return { snapshot_id: snapshot.id };
    } catch (error) {
      await Snapshot.update(context, snapshotData.id as string, {
        status: SnapshotStatus.FAILED,
        error: String(error?.message || error).slice(0, 4000),
        completed_at: new Date().toISOString(),
      }).catch(() => {});
      throw error;
    } finally {
      await SnapshotLock.release(context, snapshotData.id as string);
    }
  }

  async restore(job: Job<RestoreSnapshotJobData>) {
    const {
      context,
      sourceId,
      targetBaseId,
      targetContext,
      snapshot: snapshotData,
      req,
    } = job.data;
    const storageContext = {
      workspace_id: snapshotData.fk_workspace_id || context.workspace_id,
      base_id: snapshotData.snapshot_base_id as string,
      additionalContext: { allowSnapshotBase: true },
    };
    try {
      const snapshot = await Snapshot.get(context, snapshotData.id as string);
      const storageBase = await Base.getSnapshotWithInfo(
        storageContext,
        snapshotData.snapshot_base_id as string,
      );
      const targetBase = await Base.get(targetContext, targetBaseId);
      const source = await Source.get(storageContext, sourceId);
      if (!snapshot || !storageBase || !targetBase || !source) {
        throw new Error('Snapshot restore resources are missing');
      }
      const currentManifest = await buildSnapshotManifest(
        storageContext,
        storageBase,
        snapshot.source_version || packageVersion,
      );
      if (!snapshotManifestMatches(snapshot.manifest, currentManifest)) {
        throw new Error('Snapshot manifest validation failed');
      }
      await this.duplicateProcessor.duplicateBaseJob({
        sourceBase: storageBase,
        targetBase,
        dataSource: source,
        req,
        context: storageContext,
        targetContext,
        options: { excludeUsers: true },
        operation: JobTypes.RestoreSnapshot,
      });
      await Snapshot.update(context, snapshot.id, {
        status: SnapshotStatus.READY,
        error: null,
      });
      return { base_id: targetBase.id };
    } catch (error) {
      await Snapshot.update(context, snapshotData.id as string, {
        status: SnapshotStatus.READY,
        error: String(error?.message || error).slice(0, 4000),
      }).catch(() => {});
      throw error;
    } finally {
      await SnapshotLock.release(storageContext, snapshotData.id as string);
    }
  }
}
