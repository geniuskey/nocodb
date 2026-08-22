import type { Knex } from 'knex';
import { MetaTable } from '~/utils/globals';

const up = async (knex: Knex) => {
  await knex.schema.createTable(MetaTable.BASE_TRASH, (table) => {
    table.string('id', 20).notNullable();
    table.string('resource_type', 32).notNullable();
    table.string('resource_id', 20).notNullable();
    table.string('resource_name', 255);
    table.string('deleted_by', 20);
    table.timestamp('deleted_at').notNullable();
    table.timestamp('expires_at').notNullable();
    table.string('source_id', 20);
    table.string('base_id', 20);
    table.string('fk_workspace_id', 20);
    table.timestamps(true, true);

    table.primary(['base_id', 'id']);
    table.index(
      ['base_id', 'fk_workspace_id'],
      'nc_base_trash_v2_base_workspace_idx',
    );
    table.index(['base_id', 'deleted_at'], 'nc_base_trash_v2_deleted_idx');
    table.index(['expires_at'], 'nc_base_trash_v2_expires_idx');
  });

  await knex.schema.alterTable(MetaTable.RECORD_TRASH, (table) => {
    table.string('fk_trash_entry_id', 20);
    table.index(
      ['base_id', 'fk_trash_entry_id'],
      'nc_record_trash_v2_entry_idx',
    );
  });

  const modelRows: Array<{ base_id?: string; id: string; title?: string }> =
    await knex(MetaTable.MODELS).select('base_id', 'id', 'title');
  const modelTitles = new Map(
    modelRows.map((model) => [
      `${model.base_id ?? ''}:${model.id}`,
      model.title,
    ]),
  );
  const batchSize = 500;
  let offset = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snapshots: Array<{
      id: string;
      fk_model_id: string;
      deleted_by?: string;
      deleted_at: string | Date;
      expires_at: string | Date;
      source_id?: string;
      base_id?: string;
      fk_workspace_id?: string;
      created_at?: string | Date;
      updated_at?: string | Date;
    }> = await knex(MetaTable.RECORD_TRASH)
      .select(
        'id',
        'fk_model_id',
        'deleted_by',
        'deleted_at',
        'expires_at',
        'source_id',
        'base_id',
        'fk_workspace_id',
        'created_at',
        'updated_at',
      )
      .orderBy('base_id', 'asc')
      .orderBy('id', 'asc')
      .limit(batchSize)
      .offset(offset);

    if (!snapshots.length) break;

    await knex.batchInsert(
      MetaTable.BASE_TRASH,
      snapshots.map((snapshot) => ({
        id: snapshot.id,
        resource_type: 'records',
        resource_id: snapshot.fk_model_id,
        resource_name:
          modelTitles.get(
            `${snapshot.base_id ?? ''}:${snapshot.fk_model_id}`,
          ) ?? null,
        deleted_by: snapshot.deleted_by ?? null,
        deleted_at: snapshot.deleted_at,
        expires_at: snapshot.expires_at,
        source_id: snapshot.source_id ?? null,
        base_id: snapshot.base_id ?? null,
        fk_workspace_id: snapshot.fk_workspace_id ?? null,
        created_at: snapshot.created_at ?? null,
        updated_at: snapshot.updated_at ?? null,
      })),
      batchSize,
    );

    offset += snapshots.length;
  }

  await knex(MetaTable.RECORD_TRASH).update({
    fk_trash_entry_id: knex.ref('id'),
  });
};

const down = async (knex: Knex) => {
  await knex.schema.alterTable(MetaTable.RECORD_TRASH, (table) => {
    table.dropIndex(
      ['base_id', 'fk_trash_entry_id'],
      'nc_record_trash_v2_entry_idx',
    );
    table.dropColumn('fk_trash_entry_id');
  });
  await knex.schema.dropTableIfExists(MetaTable.BASE_TRASH);
};

export { up, down };
