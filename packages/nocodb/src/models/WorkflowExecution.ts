import type { NcContext } from '~/interface/config';
import type { MetaService } from '~/meta/meta.service';
import { extractProps } from '~/helpers/extractProps';
import Noco from '~/Noco';
import { MetaTable } from '~/utils/globals';

const parseJson = (value: any) => {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
};

export enum WorkflowExecutionStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  SUCCESS = 'success',
  ERROR = 'error',
  CANCELLED = 'cancelled',
}

export default class WorkflowExecution {
  id: string;
  fk_workspace_id?: string;
  base_id?: string;
  fk_workflow_id: string;
  workflow_data?: any;
  execution_data?: any;
  trigger_data?: any;
  trigger_type?: string;
  idempotency_key?: string;
  result?: any;
  error?: string;
  job_id?: string;
  created_by?: string;
  finished?: boolean;
  status?: WorkflowExecutionStatus;
  started_at?: string;
  finished_at?: string;
  created_at?: string;
  updated_at?: string;

  constructor(data: Partial<WorkflowExecution>) {
    Object.assign(this, data);
  }

  static fromDb(data: any): WorkflowExecution | null {
    if (!data) return null;
    return new WorkflowExecution({
      ...data,
      finished:
        data.finished === true || data.finished === 1 || data.finished === '1',
      workflow_data: parseJson(data.workflow_data),
      execution_data: parseJson(data.execution_data),
      trigger_data: parseJson(data.trigger_data),
      result: parseJson(data.result),
    });
  }

  static async create(
    context: NcContext,
    data: Partial<WorkflowExecution>,
    ncMeta: MetaService = Noco.ncMeta,
  ) {
    const insert = extractProps(data, [
      'id',
      'fk_workflow_id',
      'workflow_data',
      'execution_data',
      'trigger_data',
      'trigger_type',
      'idempotency_key',
      'result',
      'error',
      'job_id',
      'created_by',
      'finished',
      'status',
      'started_at',
      'finished_at',
    ]);
    for (const field of [
      'workflow_data',
      'execution_data',
      'trigger_data',
      'result',
    ]) {
      if (field in insert) insert[field] = JSON.stringify(insert[field]);
    }
    return this.fromDb(
      await ncMeta.metaInsert2(
        context.workspace_id,
        context.base_id,
        MetaTable.WORKFLOW_EXECUTIONS,
        insert,
      ),
    );
  }

  static async get(
    context: NcContext,
    id: string,
    ncMeta: MetaService = Noco.ncMeta,
  ) {
    return this.fromDb(
      await ncMeta.metaGet2(
        context.workspace_id,
        context.base_id,
        MetaTable.WORKFLOW_EXECUTIONS,
        id,
      ),
    );
  }

  static async findByIdempotencyKey(
    context: NcContext,
    workflowId: string,
    idempotencyKey: string,
    ncMeta: MetaService = Noco.ncMeta,
  ) {
    const query = ncMeta
      .knex(MetaTable.WORKFLOW_EXECUTIONS)
      .where('base_id', context.base_id)
      .where('fk_workflow_id', workflowId)
      .where('idempotency_key', idempotencyKey);
    if (context.workspace_id) {
      query.where('fk_workspace_id', context.workspace_id);
    }
    return this.fromDb(await query.first());
  }

  static async list(
    context: NcContext,
    workflowId: string,
    args: { limit: number; offset: number },
    ncMeta: MetaService = Noco.ncMeta,
  ) {
    const rows = await ncMeta.metaList2(
      context.workspace_id,
      context.base_id,
      MetaTable.WORKFLOW_EXECUTIONS,
      {
        condition: { fk_workflow_id: workflowId },
        limit: args.limit,
        offset: args.offset,
        orderBy: { created_at: 'desc', id: 'desc' },
      },
    );
    return rows.map((row) => this.fromDb(row));
  }

  static async count(
    context: NcContext,
    workflowId: string,
    ncMeta: MetaService = Noco.ncMeta,
  ) {
    const query = ncMeta
      .knex(MetaTable.WORKFLOW_EXECUTIONS)
      .where('base_id', context.base_id)
      .where('fk_workflow_id', workflowId);
    if (context.workspace_id) {
      query.where('fk_workspace_id', context.workspace_id);
    }
    return Number(
      (await query.count('id', { as: 'count' }).first())?.count || 0,
    );
  }

  static async update(
    context: NcContext,
    id: string,
    data: Partial<WorkflowExecution>,
    ncMeta: MetaService = Noco.ncMeta,
  ) {
    const update = extractProps(data, [
      'execution_data',
      'result',
      'error',
      'job_id',
      'finished',
      'status',
      'started_at',
      'finished_at',
    ]);
    for (const field of ['execution_data', 'result']) {
      if (field in update) update[field] = JSON.stringify(update[field]);
    }
    await ncMeta.metaUpdate(
      context.workspace_id,
      context.base_id,
      MetaTable.WORKFLOW_EXECUTIONS,
      update,
      id,
    );
  }

  static async deleteForWorkflow(
    context: NcContext,
    workflowId: string,
    ncMeta: MetaService = Noco.ncMeta,
  ) {
    const executionQuery = ncMeta
      .knex(MetaTable.WORKFLOW_EXECUTIONS)
      .where('base_id', context.base_id)
      .where('fk_workflow_id', workflowId);
    if (context.workspace_id) {
      executionQuery.where('fk_workspace_id', context.workspace_id);
    }
    const ids = await executionQuery.clone().pluck('id');
    if (ids.length) {
      await ncMeta
        .knex(MetaTable.WORKFLOW_EXECUTION_NODES)
        .whereIn('fk_execution_id', ids)
        .delete();
    }
    await executionQuery.delete();
  }
}
