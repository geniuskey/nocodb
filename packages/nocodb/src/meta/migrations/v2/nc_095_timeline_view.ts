import type { Knex } from 'knex';
import { MetaTable } from '~/utils/globals';

const up = async (knex: Knex) => {
  await knex.schema.createTable(MetaTable.TIMELINE_VIEW, (table) => {
    table.string('fk_view_id', 20).primary();
    table.string('base_id', 20);
    table.string('source_id', 128);
    table.string('fk_start_date_col_id', 20).notNullable().index();
    table.string('fk_end_date_col_id', 20).index();
    table.string('zoom', 20).notNullable().defaultTo('month');
    table.string('initial_mode', 20).notNullable().defaultTo('today');
    table.text('meta');
    table.dateTime('created_at');
    table.dateTime('updated_at');
  });

  await knex.schema.createTable(MetaTable.TIMELINE_VIEW_COLUMNS, (table) => {
    table.string('id', 20).primary().notNullable();
    table.string('base_id', 20);
    table.string('source_id', 128);
    table.string('fk_view_id', 20).notNullable().index();
    table.string('fk_column_id', 20).notNullable().index();
    table.boolean('show');
    table.float('order');
    table.string('width').defaultTo('200px');
    table.boolean('bold');
    table.boolean('italic');
    table.boolean('underline');
    table.timestamps(true, true);
  });
};

const down = async (knex: Knex) => {
  await knex.schema.dropTableIfExists(MetaTable.TIMELINE_VIEW_COLUMNS);
  await knex.schema.dropTableIfExists(MetaTable.TIMELINE_VIEW);
};

export { up, down };
