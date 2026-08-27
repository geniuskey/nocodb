import type { Knex } from 'knex';
import { MetaTable } from '~/utils/globals';

const up = async (knex: Knex) => {
  await knex.schema.createTable(MetaTable.LIST_VIEW_LEVELS, (table) => {
    table.string('id', 20).primary().notNullable();
    table.string('base_id', 20);
    table.string('source_id', 128);
    table.string('fk_view_id', 20).notNullable().index();
    table.string('fk_relation_column_id', 20).notNullable().index();
    table.string('fk_related_model_id', 20).notNullable().index();
    table.smallint('order').notNullable();
    table.text('fields');
    table.text('where');
    table.text('sort');
    table.boolean('show_empty').defaultTo(false);
    table.smallint('page_size').defaultTo(25);
    table.boolean('recursive').defaultTo(false);
    table.smallint('max_depth').defaultTo(1);
    table.text('meta');
    table.timestamps(true, true);
    table.unique(['fk_view_id', 'order']);
  });
};

const down = async (knex: Knex) => {
  await knex.schema.dropTableIfExists(MetaTable.LIST_VIEW_LEVELS);
};

export { up, down };
