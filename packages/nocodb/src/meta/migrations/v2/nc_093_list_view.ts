import type { Knex } from 'knex';
import { MetaTable } from '~/utils/globals';

const up = async (knex: Knex) => {
  await knex.schema.createTable(MetaTable.LIST_VIEW, (table) => {
    table.string('fk_view_id', 20).primary();
    table.string('base_id', 20);
    table.string('source_id', 128);
    table.smallint('row_height');
    table.text('meta');
    table.dateTime('created_at');
    table.dateTime('updated_at');
  });

  await knex.schema.createTable(MetaTable.LIST_VIEW_COLUMNS, (table) => {
    table.string('id', 20).primary().notNullable();
    table.string('base_id', 20);
    table.string('source_id', 128);
    table.string('fk_view_id', 20).notNullable().index();
    table.string('fk_column_id', 20).notNullable().index();
    table.boolean('show');
    table.float('order');
    table.string('width').defaultTo('200px');
    table.timestamps(true, true);
  });
};

const down = async (knex: Knex) => {
  await knex.schema.dropTableIfExists(MetaTable.LIST_VIEW_COLUMNS);
  await knex.schema.dropTableIfExists(MetaTable.LIST_VIEW);
};

export { up, down };
