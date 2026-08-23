import type { Knex } from 'knex';
import { MetaTable } from '~/utils/globals';

const up = async (knex: Knex) => {
  await knex.schema.createTable(MetaTable.VIEW_TRASH, (table) => {
    table.string('id', 20).notNullable();
    table.string('fk_trash_entry_id', 20).notNullable();
    table.string('fk_model_id', 20).notNullable();
    table.integer('view_type').notNullable();
    table.text('snapshot', 'longtext').notNullable();
    table.string('base_id', 20);
    table.string('fk_workspace_id', 20);
    table.timestamps(true, true);

    table.primary(['base_id', 'id']);
    table.unique(
      ['base_id', 'fk_trash_entry_id'],
      'nc_view_trash_v2_entry_unique',
    );
    table.index(['base_id', 'fk_model_id'], 'nc_view_trash_v2_model_idx');
  });
};

const down = async (knex: Knex) => {
  await knex.schema.dropTableIfExists(MetaTable.VIEW_TRASH);
};

export { up, down };
