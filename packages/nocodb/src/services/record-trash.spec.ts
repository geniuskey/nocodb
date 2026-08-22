import knex, { type Knex } from 'knex';
import { UITypes } from 'nocodb-sdk';
import type { MetaService } from '~/meta/meta.service';
import type { Column } from '~/models';
import { BaseTrashEntry, RecordTrash } from '~/models';
import {
  hashTrashRecordId,
  isRecordTrashCleanupEnabled,
  isRestorableTrashColumn,
  serializedByteLength,
  snapshotTrashRow,
  trashExpiryFrom,
} from '~/helpers/recordTrash';
import { MetaTable } from '~/utils/globals';
import { cleanExpiredRecordTrash } from '~/modules/jobs/jobs/record-trash-clean-up/record-trash-clean-up.processor';
import { up as addBaseTrashEntries } from '~/meta/migrations/v0/nc_011_base_trash_entries';

describe('Record trash snapshots', () => {
  const column = (title: string, uidt: UITypes) => ({ title, uidt } as Column);

  it('keeps stored fields and excludes computed, relation, and audit fields', () => {
    const columns = [
      column('Id', UITypes.ID),
      column('Title', UITypes.SingleLineText),
      column('ForeignKey', UITypes.ForeignKey),
      column('Formula', UITypes.Formula),
      column('Relation', UITypes.LinkToAnotherRecord),
      column('CreatedAt', UITypes.CreatedTime),
      column('CreatedBy', UITypes.CreatedBy),
      column('Order', UITypes.Order),
    ];

    expect(isRestorableTrashColumn(columns[2])).toBe(true);
    expect(
      snapshotTrashRow(columns, {
        Id: 7,
        Title: 'Recover me',
        ForeignKey: 11,
        Formula: 'computed',
        Relation: [{ Id: 11 }],
        CreatedAt: '2026-08-22T00:00:00.000Z',
        CreatedBy: { id: 'user' },
        Order: 42,
      }),
    ).toEqual({ Id: 7, Title: 'Recover me', ForeignKey: 11 });
  });

  it('hashes canonical record IDs deterministically without exposing them', () => {
    expect(hashTrashRecordId('7')).toBe(hashTrashRecordId('7'));
    expect(hashTrashRecordId('7')).not.toBe(hashTrashRecordId('8'));
    expect(hashTrashRecordId('7')).toHaveLength(64);
  });

  it('uses UTF-8 byte limits and deterministic retention timestamps', () => {
    expect(serializedByteLength({ value: '한' })).toBe(
      Buffer.byteLength(JSON.stringify({ value: '한' }), 'utf8'),
    );
    expect(
      trashExpiryFrom(new Date('2026-08-22T00:00:00.000Z')).toISOString(),
    ).toBe('2026-09-21T00:00:00.000Z');
  });

  it('allows expiry cleanup to be disabled explicitly', () => {
    expect(isRecordTrashCleanupEnabled(undefined)).toBe(true);
    expect(isRecordTrashCleanupEnabled('false')).toBe(true);
    expect(isRecordTrashCleanupEnabled('true')).toBe(false);
  });
});

describe('Record trash expiry cleanup', () => {
  let db: Knex;
  let ncMeta: MetaService;

  beforeEach(async () => {
    db = knex({
      client: 'sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await db.schema.createTable(MetaTable.RECORD_TRASH, (table) => {
      table.string('base_id');
      table.string('fk_workspace_id');
      table.string('id');
      table.string('fk_trash_entry_id');
      table.timestamp('expires_at').notNullable();
      table.primary(['base_id', 'id']);
    });
    await db.schema.createTable(MetaTable.BASE_TRASH, (table) => {
      table.string('base_id');
      table.string('fk_workspace_id');
      table.string('id');
      table.string('resource_type').notNullable();
      table.primary(['base_id', 'id']);
    });
    ncMeta = {
      knex: db,
      formatDateTime: (value: string) => value,
      contextCondition: (query, workspaceId, baseId) =>
        query.where('fk_workspace_id', workspaceId).where('base_id', baseId),
    } as unknown as MetaService;
  });

  afterEach(async () => {
    await db.destroy();
  });

  it('deletes only expired composite identifiers in bounded batches', async () => {
    await db(MetaTable.RECORD_TRASH).insert([
      {
        base_id: 'base-a',
        id: 'shared-id',
        fk_trash_entry_id: 'entry-a',
        expires_at: '2026-01-01T00:00:00.000Z',
      },
      {
        base_id: 'base-b',
        id: 'shared-id',
        expires_at: '2026-03-01T00:00:00.000Z',
      },
      {
        base_id: 'base-c',
        id: 'second-expired',
        expires_at: '2026-01-02T00:00:00.000Z',
      },
    ]);
    await db(MetaTable.BASE_TRASH).insert({
      base_id: 'base-a',
      id: 'entry-a',
      resource_type: 'records',
    });

    await expect(
      RecordTrash.deleteExpiredBatch(
        new Date('2026-02-01T00:00:00.000Z'),
        1,
        ncMeta,
      ),
    ).resolves.toEqual({ selected: 1, deleted: 1 });
    await expect(
      db(MetaTable.RECORD_TRASH).select('base_id', 'id').orderBy('base_id'),
    ).resolves.toEqual([
      { base_id: 'base-b', id: 'shared-id' },
      { base_id: 'base-c', id: 'second-expired' },
    ]);
    await expect(db(MetaTable.BASE_TRASH).select('id')).resolves.toEqual([]);

    await expect(
      RecordTrash.deleteExpiredBatch(
        new Date('2026-02-01T00:00:00.000Z'),
        10,
        ncMeta,
      ),
    ).resolves.toEqual({ selected: 1, deleted: 1 });
    await expect(
      db(MetaTable.RECORD_TRASH).select('base_id', 'id'),
    ).resolves.toEqual([{ base_id: 'base-b', id: 'shared-id' }]);
  });

  it('uses one cutoff and stops at the per-run processing limit', async () => {
    const cutoff = new Date('2026-02-01T00:00:00.000Z');
    const results = [
      { selected: 2, deleted: 2 },
      { selected: 2, deleted: 1 },
      { selected: 1, deleted: 1 },
    ];
    const deleteBatch = jest.fn(async () => results.shift()!);

    await expect(
      cleanExpiredRecordTrash(deleteBatch, {
        cutoff,
        batchSize: 2,
        maxRecords: 5,
      }),
    ).resolves.toEqual({ deleted: 4, processed: 5, limitReached: true });
    expect(deleteBatch.mock.calls).toEqual([
      [cutoff, 2],
      [cutoff, 2],
      [cutoff, 1],
    ]);
  });

  it('removes only empty entries inside the requested base scope', async () => {
    await db(MetaTable.BASE_TRASH).insert([
      {
        base_id: 'base-a',
        fk_workspace_id: 'workspace-a',
        id: 'empty-entry',
        resource_type: 'records',
      },
      {
        base_id: 'base-a',
        fk_workspace_id: 'workspace-a',
        id: 'live-entry',
        resource_type: 'records',
      },
      {
        base_id: 'base-b',
        fk_workspace_id: 'workspace-a',
        id: 'empty-entry',
        resource_type: 'records',
      },
    ]);
    await db(MetaTable.RECORD_TRASH).insert({
      base_id: 'base-a',
      fk_workspace_id: 'workspace-a',
      id: 'live-record',
      fk_trash_entry_id: 'live-entry',
      expires_at: '2027-01-01T00:00:00.000Z',
    });

    await BaseTrashEntry.deleteIfEmpty(
      { workspace_id: 'workspace-a', base_id: 'base-a' },
      'empty-entry',
      ncMeta,
    );
    await BaseTrashEntry.deleteIfEmpty(
      { workspace_id: 'workspace-a', base_id: 'base-a' },
      'live-entry',
      ncMeta,
    );

    await expect(
      db(MetaTable.BASE_TRASH).select('base_id', 'id').orderBy('base_id'),
    ).resolves.toEqual([
      { base_id: 'base-a', id: 'live-entry' },
      { base_id: 'base-b', id: 'empty-entry' },
    ]);
  });
});

describe('Base trash entry migration', () => {
  it('backfills existing record snapshots without changing their IDs', async () => {
    const db = knex({
      client: 'sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    try {
      await db.schema.createTable(MetaTable.MODELS, (table) => {
        table.string('base_id');
        table.string('id');
        table.string('title');
      });
      await db.schema.createTable(MetaTable.RECORD_TRASH, (table) => {
        table.string('base_id');
        table.string('fk_workspace_id');
        table.string('id');
        table.string('fk_model_id');
        table.string('deleted_by');
        table.timestamp('deleted_at');
        table.timestamp('expires_at');
        table.string('source_id');
        table.timestamps(true, true);
      });
      await db(MetaTable.MODELS).insert({
        base_id: 'base-a',
        id: 'model-a',
        title: 'Tasks',
      });
      await db(MetaTable.RECORD_TRASH).insert({
        base_id: 'base-a',
        fk_workspace_id: 'workspace-a',
        id: 'snapshot-a',
        fk_model_id: 'model-a',
        deleted_by: 'user-a',
        deleted_at: '2026-08-01T00:00:00.000Z',
        expires_at: '2026-08-31T00:00:00.000Z',
        source_id: 'source-a',
      });

      await addBaseTrashEntries(db);

      await expect(
        db(MetaTable.BASE_TRASH).select(
          'base_id',
          'id',
          'resource_type',
          'resource_id',
          'resource_name',
        ),
      ).resolves.toEqual([
        {
          base_id: 'base-a',
          id: 'snapshot-a',
          resource_type: 'records',
          resource_id: 'model-a',
          resource_name: 'Tasks',
        },
      ]);
      await expect(
        db(MetaTable.RECORD_TRASH)
          .where('id', 'snapshot-a')
          .first('fk_trash_entry_id'),
      ).resolves.toEqual({ fk_trash_entry_id: 'snapshot-a' });
    } finally {
      await db.destroy();
    }
  });
});
