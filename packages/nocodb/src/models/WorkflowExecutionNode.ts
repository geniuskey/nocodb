import type { NcContext } from '~/interface/config';
import type { MetaService } from '~/meta/meta.service';
import { extractProps } from '~/helpers/extractProps';
import Noco from '~/Noco';
import { MetaTable } from '~/utils/globals';

export default class WorkflowExecutionNode {
  static async create(
    context: NcContext,
    data: Record<string, any>,
    ncMeta: MetaService = Noco.ncMeta,
  ) {
    const insert = extractProps(data, [
      'id',
      'fk_execution_id',
      'node_id',
      'node_type',
      'status',
      'attempt',
      'input',
      'output',
      'error',
      'started_at',
      'finished_at',
    ]);
    for (const field of ['input', 'output']) {
      if (field in insert) insert[field] = JSON.stringify(insert[field]);
    }
    return ncMeta.metaInsert2(
      context.workspace_id,
      context.base_id,
      MetaTable.WORKFLOW_EXECUTION_NODES,
      insert,
    );
  }

  static async update(
    context: NcContext,
    id: string,
    data: Record<string, any>,
    ncMeta: MetaService = Noco.ncMeta,
  ) {
    const update = extractProps(data, [
      'status',
      'attempt',
      'input',
      'output',
      'error',
      'started_at',
      'finished_at',
    ]);
    for (const field of ['input', 'output']) {
      if (field in update) update[field] = JSON.stringify(update[field]);
    }
    return ncMeta.metaUpdate(
      context.workspace_id,
      context.base_id,
      MetaTable.WORKFLOW_EXECUTION_NODES,
      update,
      id,
    );
  }

  static async list(
    context: NcContext,
    executionId: string,
    ncMeta: MetaService = Noco.ncMeta,
  ) {
    const rows = await ncMeta.metaList2(
      context.workspace_id,
      context.base_id,
      MetaTable.WORKFLOW_EXECUTION_NODES,
      {
        condition: { fk_execution_id: executionId },
        orderBy: { created_at: 'asc' },
      },
    );
    return rows.map((row) => {
      for (const field of ['input', 'output']) {
        if (typeof row[field] === 'string') {
          try {
            row[field] = JSON.parse(row[field]);
          } catch {
            row[field] = undefined;
          }
        }
      }
      return row;
    });
  }
}
