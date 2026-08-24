import type { Knex } from 'knex';
import { MetaTable } from '~/utils/globals';

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn(MetaTable.PROJECT, 'is_snapshot'))) {
    await knex.schema.alterTable(MetaTable.PROJECT, (table) => {
      table.boolean('is_snapshot').notNullable().defaultTo(false);
    });
  }

  const snapshotColumns: Array<{
    name: string;
    add: (table: Knex.CreateTableBuilder) => void;
  }> = [
    {
      name: 'format_version',
      add: (table) =>
        table.integer('format_version').notNullable().defaultTo(1),
    },
    {
      name: 'source_version',
      add: (table) => table.string('source_version', 64),
    },
    { name: 'manifest', add: (table) => table.text('manifest') },
    { name: 'job_id', add: (table) => table.string('job_id', 20) },
    { name: 'error', add: (table) => table.text('error') },
    { name: 'completed_at', add: (table) => table.timestamp('completed_at') },
  ];

  for (const column of snapshotColumns) {
    if (!(await knex.schema.hasColumn(MetaTable.SNAPSHOT, column.name))) {
      await knex.schema.alterTable(MetaTable.SNAPSHOT, (table) => {
        column.add(table);
      });
    }
  }

  if (!(await knex.schema.hasTable(MetaTable.SNAPSHOT_LOCK))) {
    await knex.schema.createTable(MetaTable.SNAPSHOT_LOCK, (table) => {
      table.string('base_id', 20).primary();
      table.string('snapshot_id', 20).notNullable().unique();
      table.string('fk_workspace_id', 20);
      table.timestamp('expires_at').notNullable();
      table.timestamps(true, true);
    });
  }

  await knex.schema.alterTable(MetaTable.SNAPSHOT, (table) => {
    table.index(['base_id', 'status'], 'nc_snapshot_base_status');
    table.index(['snapshot_base_id'], 'nc_snapshot_storage_base');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists(MetaTable.SNAPSHOT_LOCK);

  await knex.schema.alterTable(MetaTable.SNAPSHOT, (table) => {
    table.dropIndex(['base_id', 'status'], 'nc_snapshot_base_status');
    table.dropIndex(['snapshot_base_id'], 'nc_snapshot_storage_base');
    table.dropColumn('format_version');
    table.dropColumn('source_version');
    table.dropColumn('manifest');
    table.dropColumn('job_id');
    table.dropColumn('error');
    table.dropColumn('completed_at');
  });
}
