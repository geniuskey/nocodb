import type { WorkflowType } from 'nocodb-sdk';
import type { NcContext } from '~/interface/config';
import type { MetaService } from '~/meta/meta.service';
import type { WorkflowEdge, WorkflowNode } from '~/helpers/workflowEngine';
import { extractProps } from '~/helpers/extractProps';
import Noco from '~/Noco';
import { MetaTable } from '~/utils/globals';

const parseJson = <T>(value: T | string | null | undefined, fallback: T): T => {
  if (typeof value !== 'string') return (value as T) ?? fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

export default class Workflow implements WorkflowType {
  id?: string;
  title?: string;
  description?: string;
  base_id?: string;
  fk_workspace_id?: string;
  enabled?: boolean;
  nodes?: WorkflowNode[];
  edges?: WorkflowEdge[];
  meta?: Record<string, any>;
  definition_version?: number;
  concurrency_limit?: number;
  trigger_count?: number;
  order?: number;
  created_by?: string;
  updated_by?: string;
  created_at?: string;
  updated_at?: string;

  constructor(data: Partial<Workflow>) {
    Object.assign(this, data);
  }

  static fromDb(data: any): Workflow | null {
    if (!data) return null;
    return new Workflow({
      ...data,
      enabled:
        data.enabled === true || data.enabled === 1 || data.enabled === '1',
      nodes: parseJson(data.nodes, []),
      edges: parseJson(data.edges, []),
      meta: parseJson(data.meta, {}),
    });
  }

  static async create(
    context: NcContext,
    data: Partial<Workflow>,
    ncMeta: MetaService = Noco.ncMeta,
  ) {
    const insert = extractProps(data, [
      'id',
      'title',
      'description',
      'enabled',
      'nodes',
      'edges',
      'meta',
      'definition_version',
      'concurrency_limit',
      'trigger_count',
      'order',
      'created_by',
      'updated_by',
    ]);
    for (const field of ['nodes', 'edges', 'meta']) {
      if (field in insert) insert[field] = JSON.stringify(insert[field]);
    }
    return this.fromDb(
      await ncMeta.metaInsert2(
        context.workspace_id,
        context.base_id,
        MetaTable.WORKFLOWS,
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
        MetaTable.WORKFLOWS,
        id,
      ),
    );
  }

  static async list(
    context: NcContext,
    args: { limit: number; offset: number },
    ncMeta: MetaService = Noco.ncMeta,
  ) {
    const rows = await ncMeta.metaList2(
      context.workspace_id,
      context.base_id,
      MetaTable.WORKFLOWS,
      {
        limit: args.limit,
        offset: args.offset,
        orderBy: { order: 'asc', created_at: 'asc' },
      },
    );
    return rows.map((row) => this.fromDb(row));
  }

  static async listEnabled(
    context: NcContext,
    ncMeta: MetaService = Noco.ncMeta,
  ) {
    const rows = await ncMeta.metaList2(
      context.workspace_id,
      context.base_id,
      MetaTable.WORKFLOWS,
      {
        condition: { enabled: true },
        orderBy: { order: 'asc', created_at: 'asc' },
      },
    );
    return rows.map((row) => this.fromDb(row));
  }

  static count(
    context: NcContext,
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<number> {
    return ncMeta.metaCount(
      context.workspace_id,
      context.base_id,
      MetaTable.WORKFLOWS,
    );
  }

  static async update(
    context: NcContext,
    id: string,
    data: Partial<Workflow>,
    ncMeta: MetaService = Noco.ncMeta,
  ) {
    const update = extractProps(data, [
      'title',
      'description',
      'enabled',
      'nodes',
      'edges',
      'meta',
      'definition_version',
      'concurrency_limit',
      'trigger_count',
      'order',
      'updated_by',
    ]);
    for (const field of ['nodes', 'edges', 'meta']) {
      if (field in update) update[field] = JSON.stringify(update[field]);
    }
    await ncMeta.metaUpdate(
      context.workspace_id,
      context.base_id,
      MetaTable.WORKFLOWS,
      update,
      id,
    );
    return this.get(context, id, ncMeta);
  }

  static async incrementTriggerCount(
    context: NcContext,
    id: string,
    ncMeta: MetaService = Noco.ncMeta,
  ) {
    await ncMeta
      .knex(MetaTable.WORKFLOWS)
      .where('id', id)
      .where('base_id', context.base_id)
      .increment('trigger_count', 1);
  }

  static async delete(
    context: NcContext,
    id: string,
    ncMeta: MetaService = Noco.ncMeta,
  ) {
    await ncMeta.metaDelete(
      context.workspace_id,
      context.base_id,
      MetaTable.WORKFLOWS,
      id,
    );
  }
}
