import { Inject, Injectable, Logger } from '@nestjs/common';
import { nanoid } from 'nanoid';
import type { NcContext, NcRequest } from '~/interface/config';
import { JobTypes } from '~/interface/Jobs';
import {
  WORKFLOW_ACTION_LOG,
  WORKFLOW_DEFINITION_VERSION,
  WORKFLOW_TRIGGER_MANUAL,
  WORKFLOW_TRIGGER_RECORD_CREATED,
  validateWorkflowDefinition,
} from '~/helpers/workflowEngine';
import { NcError } from '~/helpers/catchError';
import {
  Base,
  Model,
  Workflow,
  WorkflowExecution,
  WorkflowExecutionNode,
  WorkflowLock,
} from '~/models';
import { WorkflowExecutionStatus } from '~/models/WorkflowExecution';
import Noco from '~/Noco';
import { IJobsService } from '~/modules/jobs/jobs-service.interface';
import { MetaTable } from '~/utils/globals';

@Injectable()
export class WorkflowsService {
  protected readonly logger = new Logger(WorkflowsService.name);

  constructor(
    @Inject('JobsService') protected readonly jobsService: IJobsService,
  ) {}

  async list(context: NcContext, args: { limit?: number; offset?: number }) {
    await this.requireBase(context);
    const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 100);
    const offset = Math.max(Number(args.offset) || 0, 0);
    const [list, count] = await Promise.all([
      Workflow.list(context, { limit, offset }),
      Workflow.count(context),
    ]);
    return this.paginated(list, count, limit, offset);
  }

  async get(context: NcContext, workflowId: string) {
    await this.requireBase(context);
    return this.requireWorkflow(context, workflowId);
  }

  async create(
    context: NcContext,
    param: {
      body: Record<string, any>;
      req: NcRequest;
    },
  ) {
    await this.requireBase(context);
    const definition = this.definitionFrom(param.body);
    await this.validateDefinitionReferences(
      context,
      this.validateDefinition(context, definition),
    );
    const id = await Noco.ncMeta.genNanoid(MetaTable.WORKFLOWS);
    return Workflow.create(context, {
      id,
      title: this.title(context, param.body.title),
      description: this.description(context, param.body.description),
      enabled: Boolean(param.body.enabled),
      definition_version: WORKFLOW_DEFINITION_VERSION,
      concurrency_limit: 1,
      nodes: definition.nodes,
      edges: definition.edges,
      meta: {},
      created_by: param.req.user?.id,
      updated_by: param.req.user?.id,
    });
  }

  async update(
    context: NcContext,
    workflowId: string,
    param: { body: Record<string, any>; req: NcRequest },
  ) {
    const existing = await this.requireWorkflow(context, workflowId);
    const definition = this.definitionFrom({
      definition_version: WORKFLOW_DEFINITION_VERSION,
      nodes: param.body.nodes ?? existing.nodes,
      edges: param.body.edges ?? existing.edges,
    });
    await this.validateDefinitionReferences(
      context,
      this.validateDefinition(context, definition),
    );
    return Workflow.update(context, workflowId, {
      ...(param.body.title !== undefined
        ? { title: this.title(context, param.body.title) }
        : {}),
      ...(param.body.description !== undefined
        ? { description: this.description(context, param.body.description) }
        : {}),
      ...(param.body.enabled !== undefined
        ? { enabled: Boolean(param.body.enabled) }
        : {}),
      definition_version: WORKFLOW_DEFINITION_VERSION,
      concurrency_limit: 1,
      nodes: definition.nodes,
      edges: definition.edges,
      updated_by: param.req.user?.id,
    });
  }

  async delete(context: NcContext, workflowId: string) {
    await this.requireWorkflow(context, workflowId);
    if (await WorkflowLock.isActive(context, workflowId)) {
      NcError.get(context).badRequest('Cannot delete a running workflow');
    }
    await WorkflowLock.deleteForWorkflow(context, workflowId);
    await WorkflowExecution.deleteForWorkflow(context, workflowId);
    await Workflow.delete(context, workflowId);
    return { deleted: true };
  }

  async trigger(
    context: NcContext,
    workflowId: string,
    param: {
      inputs?: unknown;
      idempotencyKey?: string;
      req: NcRequest;
    },
  ) {
    const workflow = await this.requireWorkflow(context, workflowId);
    if (!workflow.enabled) {
      NcError.get(context).badRequest(
        'Workflow must be enabled before it can run',
      );
    }
    const definition = this.definitionFrom(workflow);
    const ordered = this.validateDefinition(context, definition);
    if (ordered[0].type !== WORKFLOW_TRIGGER_MANUAL) {
      NcError.get(context).badRequest(
        'Only workflows with a manual trigger can use the manual trigger endpoint',
      );
    }

    return this.enqueue(context, workflow, definition, {
      triggerType: WORKFLOW_TRIGGER_MANUAL,
      triggerData: param.inputs ?? {},
      idempotencyKey: param.idempotencyKey,
      user: param.req.user,
      persistConcurrencyFailure: false,
    });
  }

  async triggerRecordCreated(
    context: NcContext,
    param: {
      newData: unknown;
      user?: NcRequest['user'];
      viewId?: string;
      modelId?: string;
    },
  ) {
    if (
      !param.modelId ||
      param.newData === undefined ||
      param.newData === null
    ) {
      return;
    }
    const records = Array.isArray(param.newData)
      ? param.newData
      : [param.newData];
    if (!records.length) return;

    const eventId = nanoid();
    const workflows = await Workflow.listEnabled(context);
    for (const workflow of workflows) {
      try {
        const definition = this.definitionFrom(workflow);
        const ordered = this.validateDefinition(context, definition);
        const trigger = ordered[0];
        if (
          trigger.type !== WORKFLOW_TRIGGER_RECORD_CREATED ||
          trigger.data.config?.table_id !== param.modelId
        ) {
          continue;
        }
        await this.enqueue(context, workflow, definition, {
          triggerType: WORKFLOW_TRIGGER_RECORD_CREATED,
          triggerData: {
            event: 'record.created',
            table_id: param.modelId,
            view_id: param.viewId || null,
            record: records[0],
            records,
            count: records.length,
          },
          idempotencyKey: `record-created:${eventId}`,
          user: param.user,
          persistConcurrencyFailure: true,
        });
      } catch (error) {
        this.logger.error({
          error,
          details: 'Unable to queue a record-created workflow execution',
          workflowId: workflow.id,
          modelId: param.modelId,
        });
      }
    }
  }

  private async enqueue(
    context: NcContext,
    workflow: Workflow,
    definition: ReturnType<WorkflowsService['definitionFrom']>,
    param: {
      triggerType:
        | typeof WORKFLOW_TRIGGER_MANUAL
        | typeof WORKFLOW_TRIGGER_RECORD_CREATED;
      triggerData: unknown;
      idempotencyKey?: string;
      user?: NcRequest['user'];
      persistConcurrencyFailure: boolean;
    },
  ) {
    const workflowId = workflow.id;
    if (!workflowId) throw new Error('Workflow ID is missing');
    const inputs = param.triggerData ?? {};

    if (JSON.stringify(inputs).length > 64_000) {
      NcError.get(context).badRequest('Workflow trigger input is too large');
    }
    const idempotencyKey =
      this.idempotencyKey(context, param.idempotencyKey) || nanoid();
    const replay = await WorkflowExecution.findByIdempotencyKey(
      context,
      workflowId,
      idempotencyKey,
    );
    if (replay) {
      return {
        id: replay.job_id || replay.id,
        execution_id: replay.id,
        replayed: true,
      };
    }

    const executionId = await Noco.ncMeta.genNanoid(
      MetaTable.WORKFLOW_EXECUTIONS,
    );
    if (!(await WorkflowLock.acquire(context, workflowId, executionId))) {
      if (param.persistConcurrencyFailure) {
        const error = 'Workflow concurrency limit reached';
        await WorkflowExecution.create(context, {
          id: executionId,
          fk_workflow_id: workflowId,
          workflow_data: this.executionDefinition(workflow, definition),
          trigger_type: param.triggerType,
          trigger_data: inputs,
          idempotency_key: idempotencyKey,
          created_by: param.user?.id,
          status: WorkflowExecutionStatus.ERROR,
          error,
          finished: true,
          finished_at: new Date().toISOString(),
        });
        await Workflow.incrementTriggerCount(context, workflowId);
        return {
          id: executionId,
          execution_id: executionId,
          replayed: false,
        };
      }
      NcError.get(context).badRequest(
        'This workflow already has an active execution',
      );
    }

    let execution: WorkflowExecution | null = null;
    try {
      execution = await WorkflowExecution.create(context, {
        id: executionId,
        fk_workflow_id: workflowId,
        workflow_data: this.executionDefinition(workflow, definition),
        trigger_type: param.triggerType,
        trigger_data: inputs,
        idempotency_key: idempotencyKey,
        job_id: executionId,
        created_by: param.user?.id,
        status: WorkflowExecutionStatus.QUEUED,
        finished: false,
      });
      const job = await this.jobsService.add(
        JobTypes.ExecuteWorkflow,
        {
          context,
          user: param.user || {},
          workflowId,
          executionId,
        },
        { jobId: executionId },
      );
      await Workflow.incrementTriggerCount(context, workflowId);
      return {
        id: String(job.id),
        execution_id: executionId,
        replayed: false,
      };
    } catch (error) {
      if (execution) {
        await WorkflowExecution.update(context, executionId, {
          status: WorkflowExecutionStatus.ERROR,
          error: String(error?.message || error).slice(0, 4_000),
          finished: true,
          finished_at: new Date().toISOString(),
        }).catch(() => {});
      }
      await WorkflowLock.release(context, workflowId, executionId);
      if (!execution) {
        const existing = await WorkflowExecution.findByIdempotencyKey(
          context,
          workflowId,
          idempotencyKey,
        );
        if (existing) {
          return {
            id: existing.job_id || existing.id,
            execution_id: existing.id,
            replayed: true,
          };
        }
      }
      throw error;
    }
  }

  async listExecutions(
    context: NcContext,
    workflowId: string,
    args: { limit?: number; offset?: number },
  ) {
    await this.requireWorkflow(context, workflowId);
    const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 100);
    const offset = Math.max(Number(args.offset) || 0, 0);
    const [list, count] = await Promise.all([
      WorkflowExecution.list(context, workflowId, { limit, offset }),
      WorkflowExecution.count(context, workflowId),
    ]);
    return this.paginated(list, count, limit, offset);
  }

  async getExecution(
    context: NcContext,
    workflowId: string,
    executionId: string,
  ) {
    await this.requireWorkflow(context, workflowId);
    const execution = await WorkflowExecution.get(context, executionId);
    if (!execution || execution.fk_workflow_id !== workflowId) {
      NcError.get(context).notFound('Workflow execution not found');
    }
    return {
      ...execution,
      nodes: await WorkflowExecutionNode.list(context, executionId),
    };
  }

  private definitionFrom(data: Record<string, any>) {
    return {
      definition_version:
        data.definition_version ?? WORKFLOW_DEFINITION_VERSION,
      nodes: data.nodes || [
        {
          id: 'manual_trigger',
          type: WORKFLOW_TRIGGER_MANUAL,
          data: { title: 'Manual trigger', config: {} },
        },
        {
          id: 'log_action',
          type: WORKFLOW_ACTION_LOG,
          data: {
            title: 'Log message',
            config: { message: 'Workflow started' },
          },
        },
      ],
      edges: data.edges || [
        {
          id: 'manual_trigger_to_log_action',
          source: 'manual_trigger',
          target: 'log_action',
        },
      ],
    };
  }

  private async requireBase(context: NcContext) {
    const base = await Base.get(context, context.base_id);
    if (!base) NcError.get(context).baseNotFound(context.base_id);
    return base;
  }

  private async requireWorkflow(context: NcContext, workflowId: string) {
    await this.requireBase(context);
    const workflow = await Workflow.get(context, workflowId);
    if (!workflow) NcError.get(context).notFound('Workflow not found');
    return workflow;
  }

  private validateDefinition(context: NcContext, definition: any) {
    try {
      return validateWorkflowDefinition(definition);
    } catch (error) {
      NcError.get(context).badRequest(String(error?.message || error));
    }
  }

  private async validateDefinitionReferences(
    context: NcContext,
    ordered: ReturnType<typeof validateWorkflowDefinition>,
  ) {
    const trigger = ordered[0];
    if (trigger.type === WORKFLOW_TRIGGER_RECORD_CREATED) {
      const table = await Model.get(context, trigger.data.config?.table_id);
      if (!table) {
        NcError.get(context).badRequest(
          'Record-created trigger table was not found in this base',
        );
      }
    }
  }

  private executionDefinition(
    workflow: Workflow,
    definition: ReturnType<WorkflowsService['definitionFrom']>,
  ) {
    return {
      id: workflow.id,
      title: workflow.title,
      definition_version: WORKFLOW_DEFINITION_VERSION,
      nodes: definition.nodes,
      edges: definition.edges,
    };
  }

  private title(context: NcContext, value: unknown) {
    const title = String(value || '').trim();
    if (!title) NcError.get(context).badRequest('Workflow title is required');
    if (title.length > 100) {
      NcError.get(context).badRequest(
        'Workflow title cannot exceed 100 characters',
      );
    }
    return title;
  }

  private description(context: NcContext, value: unknown) {
    const description = String(value || '').trim();
    if (description.length > 2_000) {
      NcError.get(context).badRequest(
        'Workflow description cannot exceed 2000 characters',
      );
    }
    return description || null;
  }

  private idempotencyKey(context: NcContext, value: unknown) {
    if (value === undefined || value === null || value === '') return undefined;
    const key = String(value).trim();
    if (!key || key.length > 128) {
      NcError.get(context).badRequest(
        'Workflow idempotency key must contain 1 to 128 characters',
      );
    }
    return key;
  }

  private paginated(list: any[], count: number, limit: number, offset: number) {
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
}
