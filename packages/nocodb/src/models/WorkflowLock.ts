import type { NcContext } from '~/interface/config';
import type { MetaService } from '~/meta/meta.service';
import Noco from '~/Noco';
import { MetaTable } from '~/utils/globals';

const LOCK_TIMEOUT_MINUTES = 15;

const expiresAt = (ncMeta: MetaService) =>
  ncMeta.formatDateTime(
    new Date(Date.now() + LOCK_TIMEOUT_MINUTES * 60_000).toISOString(),
  );

export default class WorkflowLock {
  static async acquire(
    context: NcContext,
    workflowId: string,
    executionId: string,
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<boolean> {
    const now = new Date();
    await ncMeta
      .knex(MetaTable.WORKFLOW_LOCKS)
      .where('workflow_id', workflowId)
      .where('expires_at', '<=', ncMeta.formatDateTime(now.toISOString()))
      .delete();
    const timestamp = ncMeta.formatDateTime(now.toISOString());
    try {
      await ncMeta.knex(MetaTable.WORKFLOW_LOCKS).insert({
        workflow_id: workflowId,
        execution_id: executionId,
        fk_workspace_id: context.workspace_id,
        base_id: context.base_id,
        expires_at: expiresAt(ncMeta),
        created_at: timestamp,
        updated_at: timestamp,
      });
      return true;
    } catch {
      return false;
    }
  }

  static async isActive(
    context: NcContext,
    workflowId: string,
    ncMeta: MetaService = Noco.ncMeta,
  ) {
    const query = ncMeta
      .knex(MetaTable.WORKFLOW_LOCKS)
      .where('workflow_id', workflowId)
      .where('base_id', context.base_id);
    if (context.workspace_id) {
      query.where('fk_workspace_id', context.workspace_id);
    }
    const row = await query.first();
    return Boolean(row && new Date(row.expires_at).getTime() > Date.now());
  }

  static async renew(
    context: NcContext,
    workflowId: string,
    executionId: string,
    ncMeta: MetaService = Noco.ncMeta,
  ) {
    const query = ncMeta
      .knex(MetaTable.WORKFLOW_LOCKS)
      .where('workflow_id', workflowId)
      .where('execution_id', executionId)
      .where('base_id', context.base_id);
    if (context.workspace_id) {
      query.where('fk_workspace_id', context.workspace_id);
    }
    return query.update({
      expires_at: expiresAt(ncMeta),
      updated_at: ncMeta.formatDateTime(new Date().toISOString()),
    });
  }

  static async release(
    context: NcContext,
    workflowId: string,
    executionId: string,
    ncMeta: MetaService = Noco.ncMeta,
  ) {
    const query = ncMeta
      .knex(MetaTable.WORKFLOW_LOCKS)
      .where('workflow_id', workflowId)
      .where('execution_id', executionId)
      .where('base_id', context.base_id);
    if (context.workspace_id) {
      query.where('fk_workspace_id', context.workspace_id);
    }
    await query.delete();
  }

  static async deleteForWorkflow(
    context: NcContext,
    workflowId: string,
    ncMeta: MetaService = Noco.ncMeta,
  ) {
    const query = ncMeta
      .knex(MetaTable.WORKFLOW_LOCKS)
      .where('workflow_id', workflowId)
      .where('base_id', context.base_id);
    if (context.workspace_id) {
      query.where('fk_workspace_id', context.workspace_id);
    }
    await query.delete();
  }
}
