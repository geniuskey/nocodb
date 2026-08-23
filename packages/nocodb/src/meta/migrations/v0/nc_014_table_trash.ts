import type { Knex } from 'knex';
import { MetaTable } from '~/utils/globals';

const up = async (knex: Knex) => {
  await knex.schema.alterTable(MetaTable.BASE_TRASH, (table) => {
    table.string('storage_name', 255);
    table.string('original_type', 32);
    table.index(
      ['resource_type', 'expires_at'],
      'nc_base_trash_v2_resource_expires_idx',
    );
  });
};

const down = async (knex: Knex) => {
  await knex.schema.alterTable(MetaTable.BASE_TRASH, (table) => {
    table.dropIndex(
      ['resource_type', 'expires_at'],
      'nc_base_trash_v2_resource_expires_idx',
    );
    table.dropColumn('original_type');
    table.dropColumn('storage_name');
  });
};

export { up, down };
