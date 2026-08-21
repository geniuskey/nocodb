import type { Knex } from 'knex';
import { MetaTable } from '~/utils/globals';

const up = async (knex: Knex) => {
  await knex.schema.createTable(MetaTable.RECORD_TRASH, (table) => {
    table.string('id', 20).notNullable();
    table.string('fk_model_id', 20).notNullable();
    table.text('record_id').notNullable();
    table.string('record_hash', 64).notNullable();
    table.text('pk_data').notNullable();
    table.text('row_data').notNullable();
    table.string('deleted_by', 20);
    table.timestamp('deleted_at').notNullable();
    table.timestamp('expires_at').notNullable();
    table.string('source_id', 20);
    table.string('base_id', 20);
    table.string('fk_workspace_id', 20);
    table.timestamps(true, true);

    table.primary(['base_id', 'id']);
    table.unique(
      ['base_id', 'fk_model_id', 'record_hash'],
      'nc_record_trash_v2_record_uq',
    );
    table.index(
      ['base_id', 'fk_workspace_id'],
      'nc_record_trash_v2_base_workspace_idx',
    );
    table.index(
      ['fk_model_id', 'deleted_at'],
      'nc_record_trash_v2_model_deleted_idx',
    );
    table.index(['expires_at'], 'nc_record_trash_v2_expires_idx');
  });
};

const down = async (knex: Knex) => {
  await knex.schema.dropTableIfExists(MetaTable.RECORD_TRASH);
};

export { up, down };
