import type { Knex } from 'knex';
import { MetaTable } from '~/utils/globals';

const TOKEN_INDEXES = [
  {
    column: 'access_token',
    name: 'nc_oauth_tokens_access_token_index',
  },
  {
    column: 'refresh_token',
    name: 'nc_oauth_tokens_refresh_token_index',
  },
] as const;

export async function createOAuthTokenValueIndexes(knex: Knex) {
  if (knex.client.config.client.includes('mysql')) {
    // MySQL cannot index TEXT without a prefix. Equality lookups still compare
    // the complete token after using this bounded prefix to find candidates.
    await knex.raw(
      'ALTER TABLE ?? ADD INDEX ?? (??(512)), ADD INDEX ?? (??(512))',
      [
        MetaTable.OAUTH_TOKENS,
        TOKEN_INDEXES[0].name,
        TOKEN_INDEXES[0].column,
        TOKEN_INDEXES[1].name,
        TOKEN_INDEXES[1].column,
      ],
    );
    return;
  }

  await knex.schema.alterTable(MetaTable.OAUTH_TOKENS, (table) => {
    for (const index of TOKEN_INDEXES) {
      table.index(index.column, index.name);
    }
  });
}
