import type { Knex } from 'knex';
import { MetaTable } from '~/utils/globals';

const up = async (knex: Knex) => {
  await knex.schema.createTable(MetaTable.GANTT_VIEW, (table) => {
    table.string('fk_view_id', 20).notNullable();
    table.string('source_id', 20);
    table.string('base_id', 20);
    table.string('fk_workspace_id', 20);
    table.string('fk_title_column_id', 20);
    table.string('fk_start_column_id', 20);
    table.string('fk_end_column_id', 20);
    table.string('fk_progress_column_id', 20);
    table.string('fk_milestone_column_id', 20);
    table.string('zoom', 20).notNullable().defaultTo('week');
    table.text('meta');
    table.timestamps(true, true);

    table.primary(['base_id', 'fk_view_id']);
    table.index(
      ['base_id', 'fk_workspace_id'],
      'nc_gantt_view_v2_base_workspace_idx',
    );
    table.index(['fk_view_id'], 'nc_gantt_view_v2_view_idx');
  });

  await knex.schema.createTable(MetaTable.GANTT_VIEW_COLUMNS, (table) => {
    table.string('id', 20).notNullable();
    table.string('fk_view_id', 20).notNullable();
    table.string('fk_column_id', 20).notNullable();
    table.string('source_id', 20);
    table.string('base_id', 20);
    table.string('fk_workspace_id', 20);
    table.boolean('show').notNullable().defaultTo(true);
    table.float('order');
    table.timestamps(true, true);

    table.primary(['base_id', 'id']);
    table.index(
      ['base_id', 'fk_workspace_id'],
      'nc_gantt_view_columns_v2_base_workspace_idx',
    );
    table.index(
      ['fk_view_id', 'fk_column_id'],
      'nc_gantt_view_columns_v2_view_column_idx',
    );
    table.index(['fk_view_id'], 'nc_gantt_view_columns_v2_view_idx');
  });
};

const down = async (knex: Knex) => {
  await knex.schema.dropTableIfExists(MetaTable.GANTT_VIEW_COLUMNS);
  await knex.schema.dropTableIfExists(MetaTable.GANTT_VIEW);
};

export { up, down };
