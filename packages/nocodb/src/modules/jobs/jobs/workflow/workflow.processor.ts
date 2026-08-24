import { Injectable } from '@nestjs/common';
import axios from 'axios';
import type { Job } from 'bull';
import { useAgent } from 'request-filtering-agent';
import type { ExecuteWorkflowJobData } from '~/interface/Jobs';
import {
  boundedWorkflowValue,
  type HttpActionConfig,
  type WorkflowNode,
  redactHeaders,
  renderWorkflowValue,
  shouldRetryWorkflowHttp,
  validateWorkflowDefinition,
  WORKFLOW_ACTION_HTTP,
  WORKFLOW_ACTION_LOG,
  WORKFLOW_TRIGGER_MANUAL,
} from '~/helpers/workflowEngine';
import {
  WorkflowExecution,
  WorkflowExecutionNode,
  WorkflowLock,
} from '~/models';
import { WorkflowExecutionStatus } from '~/models/WorkflowExecution';
import Noco from '~/Noco';
import { MetaTable } from '~/utils/globals';

const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

@Injectable()
export class WorkflowProcessor {
  async job(job: Job<ExecuteWorkflowJobData>) {
    const { context, workflowId, executionId } = job.data;
    const execution = await WorkflowExecution.get(context, executionId);
    if (!execution || execution.fk_workflow_id !== workflowId) {
      await WorkflowLock.release(context, workflowId, executionId);
      throw new Error('Workflow execution is missing');
    }

    const definition = {
      definition_version: execution.workflow_data?.definition_version,
      nodes: execution.workflow_data?.nodes,
      edges: execution.workflow_data?.edges,
    };
    let orderedNodes: WorkflowNode[];
    try {
      orderedNodes = validateWorkflowDefinition(definition);
    } catch (error) {
      await WorkflowExecution.update(context, executionId, {
        status: WorkflowExecutionStatus.ERROR,
        error: String(error?.message || error).slice(0, 4_000),
        finished: true,
        finished_at: new Date().toISOString(),
      });
      await WorkflowLock.release(context, workflowId, executionId);
      throw error;
    }
    const runtime = {
      trigger: execution.trigger_data || {},
      nodes: {} as Record<string, { output: unknown }>,
    };
    const executionResults: Array<{
      node_id: string;
      node_type: string;
      status: string;
    }> = [];

    await WorkflowExecution.update(context, executionId, {
      status: WorkflowExecutionStatus.RUNNING,
      started_at: new Date().toISOString(),
    });

    try {
      for (const node of orderedNodes) {
        if (!(await WorkflowLock.renew(context, workflowId, executionId))) {
          throw new Error('Workflow execution lock was lost');
        }
        const nodeResultId = await Noco.ncMeta.genNanoid(
          MetaTable.WORKFLOW_EXECUTION_NODES,
        );
        const input =
          node.type === WORKFLOW_TRIGGER_MANUAL
            ? boundedWorkflowValue(runtime.trigger)
            : this.safeNodeInput(node.data.config || {});
        await WorkflowExecutionNode.create(context, {
          id: nodeResultId,
          fk_execution_id: executionId,
          node_id: node.id,
          node_type: node.type,
          status: 'running',
          attempt: 0,
          input,
          started_at: new Date().toISOString(),
        });

        try {
          let output: unknown;
          let attempt = 1;
          if (node.type === WORKFLOW_TRIGGER_MANUAL) {
            output = boundedWorkflowValue(runtime.trigger);
          } else if (node.type === WORKFLOW_ACTION_LOG) {
            output = {
              message: renderWorkflowValue(
                String(node.data.config?.message || ''),
                runtime,
              ),
            };
          } else if (node.type === WORKFLOW_ACTION_HTTP) {
            const result = await this.executeHttp(
              node.data.config as HttpActionConfig,
              runtime,
              async (currentAttempt) => {
                attempt = currentAttempt;
                if (
                  !(await WorkflowLock.renew(context, workflowId, executionId))
                ) {
                  throw new Error('Workflow execution lock was lost');
                }
                await WorkflowExecutionNode.update(context, nodeResultId, {
                  attempt: currentAttempt,
                });
              },
            );
            output = result.output;
            attempt = result.attempt;
          }

          const boundedOutput = boundedWorkflowValue(output);
          runtime.nodes[node.id] = { output: boundedOutput };
          executionResults.push({
            node_id: node.id,
            node_type: node.type,
            status: 'success',
          });
          await WorkflowExecutionNode.update(context, nodeResultId, {
            status: 'success',
            attempt,
            output: boundedOutput,
            finished_at: new Date().toISOString(),
          });
        } catch (error) {
          const message = String(error?.message || error).slice(0, 4_000);
          executionResults.push({
            node_id: node.id,
            node_type: node.type,
            status: 'error',
          });
          await WorkflowExecutionNode.update(context, nodeResultId, {
            status: 'error',
            error: message,
            finished_at: new Date().toISOString(),
          });
          throw error;
        }
      }

      const result = {
        nodes: executionResults,
        output: runtime.nodes[orderedNodes.at(-1).id]?.output,
      };
      await WorkflowExecution.update(context, executionId, {
        status: WorkflowExecutionStatus.SUCCESS,
        execution_data: { nodes: executionResults },
        result,
        error: null,
        finished: true,
        finished_at: new Date().toISOString(),
      });
      return { execution_id: executionId, status: 'success' };
    } catch (error) {
      await WorkflowExecution.update(context, executionId, {
        status: WorkflowExecutionStatus.ERROR,
        execution_data: { nodes: executionResults },
        error: String(error?.message || error).slice(0, 4_000),
        finished: true,
        finished_at: new Date().toISOString(),
      });
      throw error;
    } finally {
      await WorkflowLock.release(context, workflowId, executionId);
    }
  }

  private safeNodeInput(config: Record<string, any>) {
    const safe = { ...config };
    if (safe.headers) {
      safe.headers = safe.headers.map((header) => ({
        ...header,
        value: redactHeaders({ [header.name]: header.value })[header.name],
      }));
    }
    return boundedWorkflowValue(safe);
  }

  private async executeHttp(
    config: HttpActionConfig,
    runtime: unknown,
    onAttempt: (attempt: number) => Promise<void>,
  ) {
    const method = String(config.method || 'POST').toUpperCase();
    const url = renderWorkflowValue(config.url, runtime);
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error('Workflow HTTP action produced an invalid URL');
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Workflow HTTP actions only support HTTP and HTTPS URLs');
    }
    if (parsedUrl.username || parsedUrl.password) {
      throw new Error('Workflow HTTP URLs cannot contain credentials');
    }

    const headers: Record<string, string> = {};
    for (const header of config.headers || []) {
      headers[header.name] = renderWorkflowValue(header.value, runtime);
    }
    for (const header of config.secret_headers || []) {
      const value = process.env[`NC_WORKFLOW_SECRET_${header.secret}`];
      if (value === undefined) {
        throw new Error(`Workflow secret ${header.secret} is not configured`);
      }
      headers[header.name] = value;
    }
    if (
      config.body !== undefined &&
      !Object.keys(headers).some(
        (name) => name.toLowerCase() === 'content-type',
      )
    ) {
      headers['Content-Type'] = 'application/json';
    }

    const attempts = Math.min(Math.max(config.retry_attempts || 1, 1), 3);
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      await onAttempt(attempt);
      try {
        const response = await axios.request({
          url,
          method,
          headers,
          data: renderWorkflowValue(config.body, runtime),
          timeout: Math.min(
            Math.max(config.timeout_ms || 10_000, 1_000),
            30_000,
          ),
          maxRedirects: 5,
          ...(process.env.NC_ALLOW_LOCAL_HOOKS !== 'true'
            ? {
                httpAgent: useAgent(url, {
                  stopPortScanningByUrlRedirection: true,
                }),
                httpsAgent: useAgent(url, {
                  stopPortScanningByUrlRedirection: true,
                }),
              }
            : {}),
        });
        return {
          attempt,
          output: {
            status: response.status,
            status_text: response.statusText,
            headers: redactHeaders(response.headers as Record<string, unknown>),
            body: boundedWorkflowValue(response.data),
          },
        };
      } catch (error) {
        lastError = error;
        if (attempt >= attempts || !shouldRetryWorkflowHttp(error)) break;
        await delay(250 * 2 ** (attempt - 1));
      }
    }
    const status = (lastError as any)?.response?.status;
    throw new Error(
      status
        ? `Workflow HTTP action failed with status ${status}`
        : `Workflow HTTP action failed: ${
            (lastError as any)?.message || 'network error'
          }`,
    );
  }
}
