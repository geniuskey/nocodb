import { Inject, Injectable } from '@nestjs/common';
import { ProjectStatus } from 'nocodb-sdk';
import type { NcContext, NcRequest } from '~/interface/config';
import { JobTypes } from '~/interface/Jobs';
import { Base, Snapshot, SnapshotLock, Source } from '~/models';
import { SNAPSHOT_FORMAT_VERSION, SnapshotStatus } from '~/models/Snapshot';
import Noco from '~/Noco';
import { IJobsService } from '~/modules/jobs/jobs-service.interface';
import { BasesService } from '~/services/bases.service';
import { NcError } from '~/helpers/catchError';
import { MetaTable } from '~/utils/globals';
import { packageVersion } from '~/utils/packageVersion';

const MAX_SNAPSHOT_TITLE_LENGTH = 120;

@Injectable()
export class SnapshotsService {
  constructor(
    @Inject('JobsService') protected readonly jobsService: IJobsService,
    protected readonly basesService: BasesService,
  ) {}

  async list(context: NcContext, args: { limit?: number; offset?: number }) {
    const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 100);
    const offset = Math.max(Number(args.offset) || 0, 0);
    const [list, count] = await Promise.all([
      Snapshot.list(context, { limit, offset }),
      Snapshot.count(context),
    ]);
    return {
      list,
      pageInfo: {
        totalRows: count,
        page: Math.floor(offset / limit) + 1,
        pageSize: limit,
        isFirstPage: offset === 0,
        isLastPage: offset + list.length >= count,
      },
    };
  }

  async create(context: NcContext, param: { title?: string; req: NcRequest }) {
    const base = await Base.getWithInfo(context, context.base_id);
    if (!base) NcError.get(context).baseNotFound(context.base_id);
    const source = (await base.getSources())[0];
    if (!source) NcError.get(context).noSourcesFound();

    const title = this.validateTitle(
      param.title || `Snapshot ${new Date().toISOString()}`,
      context,
    );
    const snapshotId = await Noco.ncMeta.genNanoid(MetaTable.SNAPSHOT);
    await SnapshotLock.acquire(context, snapshotId);

    let storageBase: Base | undefined;
    let snapshot: Snapshot | undefined;
    try {
      storageBase = await this.basesService.baseCreate({
        base: {
          title: `snapshot-${snapshotId}`,
          status: ProjectStatus.JOB,
          fk_workspace_id: base.fk_workspace_id,
        } as any,
        user: param.req.user,
        req: param.req,
        internal: {
          isSnapshot: true,
          skipMembership: true,
          suppressEvents: true,
        },
      });

      snapshot = await Snapshot.create(context, {
        id: snapshotId,
        title,
        snapshot_base_id: storageBase.id,
        created_by: param.req.user?.id,
        status: SnapshotStatus.CREATING,
        format_version: SNAPSHOT_FORMAT_VERSION,
        source_version: packageVersion,
      });

      const job = await this.jobsService.add(JobTypes.CreateSnapshot, {
        context,
        user: param.req.user,
        sourceId: source.id,
        snapshotBaseId: storageBase.id,
        snapshot,
        req: this.jobRequest(param.req),
      });
      await Snapshot.update(context, snapshot.id, { job_id: String(job.id) });
      return { id: String(job.id), snapshot_id: snapshot.id };
    } catch (error) {
      if (snapshot) await Snapshot.delete(context, snapshot.id).catch(() => {});
      if (storageBase) {
        const storageContext = {
          workspace_id: storageBase.fk_workspace_id,
          base_id: storageBase.id,
        };
        await Base.delete(storageContext, storageBase.id).catch(() => {});
      }
      await SnapshotLock.release(context, snapshotId);
      throw error;
    }
  }

  async restore(
    context: NcContext,
    param: {
      snapshotId: string;
      title?: string;
      targetWorkspaceId?: string;
      req: NcRequest;
    },
  ) {
    const snapshot = await this.getReadySnapshot(context, param.snapshotId);
    const targetWorkspaceId = param.targetWorkspaceId || context.workspace_id;
    if (targetWorkspaceId !== context.workspace_id) {
      NcError.get(context).badRequest(
        'Cross-workspace snapshot restore is not available in this Community workspace',
      );
    }

    const sourceBase = await Base.get(context, context.base_id);
    const storageContext = {
      workspace_id: snapshot.fk_workspace_id || context.workspace_id,
      base_id: snapshot.snapshot_base_id,
      additionalContext: { allowSnapshotBase: true },
    };
    const storageBase = await Base.getSnapshotWithInfo(
      storageContext,
      snapshot.snapshot_base_id,
    );
    if (!storageBase) {
      NcError.get(context).badRequest('Snapshot storage is missing');
    }
    const storageSource = (await storageBase.getSources())[0];
    if (!storageSource)
      NcError.get(context).badRequest('Snapshot source is missing');

    await SnapshotLock.acquire(storageContext, snapshot.id);
    let targetBase: Base | undefined;
    try {
      await Snapshot.update(context, snapshot.id, {
        status: SnapshotStatus.RESTORING,
        error: null,
      });
      targetBase = await this.basesService.baseCreate({
        base: {
          title: this.validateTitle(
            param.title || `${sourceBase.title} restored`,
            context,
            50,
          ),
          status: ProjectStatus.JOB,
          fk_workspace_id: targetWorkspaceId,
        } as any,
        user: param.req.user,
        req: param.req,
      });
      const job = await this.jobsService.add(JobTypes.RestoreSnapshot, {
        context,
        user: param.req.user,
        sourceId: storageSource.id,
        targetBaseId: targetBase.id,
        targetContext: {
          workspace_id: targetWorkspaceId,
          base_id: targetBase.id,
        },
        snapshot,
        req: this.jobRequest(param.req),
      });
      await Snapshot.update(context, snapshot.id, { job_id: String(job.id) });
      return { id: String(job.id), base_id: targetBase.id };
    } catch (error) {
      await Snapshot.update(context, snapshot.id, {
        status: SnapshotStatus.READY,
      }).catch(() => {});
      if (targetBase) {
        await Base.delete(
          {
            workspace_id: targetBase.fk_workspace_id,
            base_id: targetBase.id,
          },
          targetBase.id,
        ).catch(() => {});
      }
      await SnapshotLock.release(storageContext, snapshot.id);
      throw error;
    }
  }

  async delete(context: NcContext, snapshotId: string) {
    const snapshot = await Snapshot.get(context, snapshotId);
    if (!snapshot) NcError.get(context).notFound('Snapshot not found');
    const storageContext = {
      workspace_id: snapshot.fk_workspace_id || context.workspace_id,
      base_id: snapshot.snapshot_base_id,
      additionalContext: { allowSnapshotBase: true },
    };
    if (await SnapshotLock.isActive(storageContext)) {
      NcError.get(context).badRequest('Snapshot is currently in use');
    }
    const storageBase = await Base.getSnapshotWithInfo(
      storageContext,
      snapshot.snapshot_base_id,
    );
    if (storageBase) await Base.delete(storageContext, storageBase.id);
    await Snapshot.delete(context, snapshot.id);
    return { deleted: true };
  }

  private async getReadySnapshot(context: NcContext, snapshotId: string) {
    const snapshot = await Snapshot.get(context, snapshotId);
    if (!snapshot) NcError.get(context).notFound('Snapshot not found');
    if (snapshot.status !== SnapshotStatus.READY) {
      NcError.get(context).badRequest('Snapshot is not ready to restore');
    }
    if (
      snapshot.format_version !== SNAPSHOT_FORMAT_VERSION ||
      snapshot.manifest?.format_version !== SNAPSHOT_FORMAT_VERSION
    ) {
      NcError.get(context).badRequest('Snapshot format is not supported');
    }
    if (
      snapshot.manifest.source_base_id !== context.base_id ||
      snapshot.manifest.storage_base_id !== snapshot.snapshot_base_id
    ) {
      NcError.get(context).badRequest('Snapshot manifest is invalid');
    }
    return snapshot;
  }

  private validateTitle(
    title: string,
    context: NcContext,
    max = MAX_SNAPSHOT_TITLE_LENGTH,
  ) {
    const normalized = String(title || '').trim();
    if (!normalized)
      NcError.get(context).badRequest('Snapshot title is required');
    if (normalized.length > max) {
      NcError.get(context).badRequest(`Title cannot exceed ${max} characters`);
    }
    return normalized;
  }

  private jobRequest(req: NcRequest): NcRequest {
    return {
      user: req.user,
      clientIp: req.clientIp,
      headers: req.headers,
    } as NcRequest;
  }
}
