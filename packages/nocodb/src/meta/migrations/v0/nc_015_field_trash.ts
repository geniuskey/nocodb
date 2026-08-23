import type { Knex } from 'knex';
import { MetaTable } from '~/utils/globals';

const up = async (knex: Knex) => {
  await knex.schema.alterTable(MetaTable.BASE_TRASH, (table) => {
    table.string('parent_id', 20);
    table.index(
      ['base_id', 'parent_id', 'resource_type'],
      'nc_base_trash_v2_parent_resource_idx',
    );
  });
};

const down = async (knex: Knex) => {
  await knex.schema.alterTable(MetaTable.BASE_TRASH, (table) => {
    table.dropIndex(
      ['base_id', 'parent_id', 'resource_type'],
      'nc_base_trash_v2_parent_resource_idx',
    );
    table.dropColumn('parent_id');
  });
};

export { up, down };
