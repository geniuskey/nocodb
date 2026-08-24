import type { Knex } from 'knex';
import { MetaTable } from '~/utils/globals';

export async function up(knex: Knex): Promise<void> {
  const workflowColumns: Array<{
    name: string;
    add: (table: Knex.CreateTableBuilder) => void;
  }> = [
    {
      name: 'definition_version',
      add: (table) =>
        table.integer('definition_version').notNullable().defaultTo(1),
    },
    {
      name: 'concurrency_limit',
      add: (table) =>
        table.integer('concurrency_limit').notNullable().defaultTo(1),
    },
  ];
  for (const column of workflowColumns) {
    if (!(await knex.schema.hasColumn(MetaTable.WORKFLOWS, column.name))) {
      await knex.schema.alterTable(MetaTable.WORKFLOWS, (table) => {
        column.add(table);
      });
    }
  }

  const executionColumns: Array<{
    name: string;
    add: (table: Knex.CreateTableBuilder) => void;
  }> = [
    {
      name: 'idempotency_key',
      add: (table) => table.string('idempotency_key', 128),
    },
    {
      name: 'trigger_type',
      add: (table) => table.string('trigger_type', 50),
    },
    { name: 'trigger_data', add: (table) => table.text('trigger_data') },
    { name: 'result', add: (table) => table.text('result') },
    { name: 'error', add: (table) => table.text('error') },
    { name: 'job_id', add: (table) => table.string('job_id', 20) },
    { name: 'created_by', add: (table) => table.string('created_by', 20) },
  ];
  for (const column of executionColumns) {
    if (
      !(await knex.schema.hasColumn(MetaTable.WORKFLOW_EXECUTIONS, column.name))
    ) {
      await knex.schema.alterTable(MetaTable.WORKFLOW_EXECUTIONS, (table) => {
        column.add(table);
      });
    }
  }

  await knex.schema.alterTable(MetaTable.WORKFLOW_EXECUTIONS, (table) => {
    table.unique(
      ['fk_workflow_id', 'idempotency_key'],
      'nc_wf_exec_idempotency_uidx',
    );
    table.index(['fk_workflow_id', 'created_at'], 'nc_wf_exec_created_idx');
  });

  if (!(await knex.schema.hasTable(MetaTable.WORKFLOW_EXECUTION_NODES))) {
    await knex.schema.createTable(
      MetaTable.WORKFLOW_EXECUTION_NODES,
      (table) => {
        table.string('id', 20).primary().notNullable();
        table.string('fk_workspace_id', 20);
        table.string('base_id', 20);
        table.string('fk_execution_id', 20).notNullable();
        table.string('node_id', 64).notNullable();
        table.string('node_type', 50).notNullable();
        table.string('status', 30).notNullable();
        table.integer('attempt').notNullable().defaultTo(0);
        table.text('input');
        table.text('output');
        table.text('error');
        table.timestamp('started_at');
        table.timestamp('finished_at');
        table.timestamps(true, true);
        table.unique(['fk_execution_id', 'node_id'], 'nc_wf_exec_node_uidx');
        table.index(['fk_execution_id'], 'nc_wf_exec_node_execution_idx');
      },
    );
  }

  if (!(await knex.schema.hasTable(MetaTable.WORKFLOW_LOCKS))) {
    await knex.schema.createTable(MetaTable.WORKFLOW_LOCKS, (table) => {
      table.string('workflow_id', 20).primary().notNullable();
      table.string('execution_id', 20).notNullable().unique();
      table.string('fk_workspace_id', 20);
      table.string('base_id', 20);
      table.timestamp('expires_at').notNullable();
      table.timestamps(true, true);
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists(MetaTable.WORKFLOW_LOCKS);
  await knex.schema.dropTableIfExists(MetaTable.WORKFLOW_EXECUTION_NODES);
  await knex.schema.alterTable(MetaTable.WORKFLOW_EXECUTIONS, (table) => {
    table.dropUnique(
      ['fk_workflow_id', 'idempotency_key'],
      'nc_wf_exec_idempotency_uidx',
    );
    table.dropIndex(['fk_workflow_id', 'created_at'], 'nc_wf_exec_created_idx');
    for (const column of [
      'idempotency_key',
      'trigger_type',
      'trigger_data',
      'result',
      'error',
      'job_id',
      'created_by',
    ]) {
      table.dropColumn(column);
    }
  });
  await knex.schema.alterTable(MetaTable.WORKFLOWS, (table) => {
    table.dropColumn('definition_version');
    table.dropColumn('concurrency_limit');
  });
}
