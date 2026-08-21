import type { Knex } from 'knex';
import { MetaTable } from '~/utils/globals';

const up = async (knex: Knex) => {
  await knex.schema.createTable(MetaTable.GANTT_DEPENDENCIES, (table) => {
    table.string('id', 20).notNullable();
    table.string('fk_view_id', 20).notNullable();
    table.text('source_record_id').notNullable();
    table.text('target_record_id').notNullable();
    table.string('source_record_hash', 64).notNullable();
    table.string('target_record_hash', 64).notNullable();
    table.string('dependency_type', 20).notNullable().defaultTo('finish_start');
    table.integer('lag_days').notNullable().defaultTo(0);
    table.string('source_id', 20);
    table.string('base_id', 20);
    table.string('fk_workspace_id', 20);
    table.timestamps(true, true);

    table.primary(['base_id', 'id']);
    table.unique(
      ['base_id', 'fk_view_id', 'source_record_hash', 'target_record_hash'],
      'nc_gantt_dependencies_v2_edge_uq',
    );
    table.index(
      ['base_id', 'fk_workspace_id'],
      'nc_gantt_dependencies_v2_base_workspace_idx',
    );
    table.index(['fk_view_id'], 'nc_gantt_dependencies_v2_view_idx');
    table.index(
      ['fk_view_id', 'source_record_hash'],
      'nc_gantt_dependencies_v2_source_idx',
    );
    table.index(
      ['fk_view_id', 'target_record_hash'],
      'nc_gantt_dependencies_v2_target_idx',
    );
  });
};

const down = async (knex: Knex) => {
  await knex.schema.dropTableIfExists(MetaTable.GANTT_DEPENDENCIES);
};

export { up, down };
