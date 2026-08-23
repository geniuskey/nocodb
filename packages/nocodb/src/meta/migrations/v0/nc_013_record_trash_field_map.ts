import type { Knex } from 'knex';
import { MetaTable } from '~/utils/globals';

const up = async (knex: Knex) => {
  await knex.schema.alterTable(MetaTable.RECORD_TRASH, (table) => {
    table.text('field_map', 'longtext');
  });
};

const down = async (knex: Knex) => {
  await knex.schema.alterTable(MetaTable.RECORD_TRASH, (table) => {
    table.dropColumn('field_map');
  });
};

export { up, down };
