import knex, { type Knex } from 'knex';
import { ViewTypes } from 'nocodb-sdk';
import type { NcContext } from '~/interface/config';
import type { MetaService } from '~/meta/meta.service';
import NocoCache from '~/cache/NocoCache';
import { View, ViewTrash } from '~/models';
import { up as addViewTrash } from '~/meta/migrations/v0/nc_012_view_trash';
import { MetaTable } from '~/utils/globals';

jest.mock('~/helpers/commandPaletteHelpers', () => ({
  cleanCommandPaletteCache: jest.fn(() => Promise.resolve()),
}));
jest.mock('~/helpers/scriptHelper', () => ({
  cleanBaseSchemaCacheForBase: jest.fn(() => Promise.resolve()),
}));
jest.mock('~/socket/NocoSocket', () => ({
  __esModule: true,
  default: { broadcastEvent: jest.fn() },
}));

describe('View trash snapshots', () => {
  const context: NcContext = {
    workspace_id: 'workspace-a',
    base_id: 'base-a',
  };
  let db: Knex;
  let ncMeta: MetaService;
  let generatedId = 0;

  const addScope = (table: Knex.CreateTableBuilder) => {
    table.string('base_id');
    table.string('fk_workspace_id');
  };

  beforeEach(async () => {
    db = knex({
      client: 'sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    await db.schema.createTable(MetaTable.BASE_TRASH, (table) => {
      table.string('id');
      table.string('resource_type');
      table.string('resource_id');
      table.string('resource_name');
      table.string('deleted_by');
      table.timestamp('deleted_at');
      table.timestamp('expires_at');
      table.string('source_id');
      addScope(table);
      table.timestamps(true, true);
      table.primary(['base_id', 'id']);
    });
    await addViewTrash(db);
    await db.schema.createTable(MetaTable.VIEWS, (table) => {
      table.string('id');
      table.string('fk_model_id');
      table.string('source_id');
      table.string('title');
      table.integer('type');
      table.integer('order');
      table.text('meta');
      addScope(table);
      table.timestamps(true, true);
      table.primary(['base_id', 'id']);
    });
    await db.schema.createTable(MetaTable.GRID_VIEW, (table) => {
      table.string('id');
      table.string('fk_view_id');
      table.string('row_height');
      addScope(table);
      table.timestamps(true, true);
    });
    await db.schema.createTable(MetaTable.GRID_VIEW_COLUMNS, (table) => {
      table.string('id');
      table.string('fk_view_id');
      table.string('fk_column_id');
      table.boolean('show');
      table.integer('order');
      addScope(table);
      table.timestamps(true, true);
    });
    await db.schema.createTable(MetaTable.FILTER_EXP, (table) => {
      table.string('id');
      table.string('fk_view_id');
      table.string('fk_column_id');
      table.string('comparison_op');
      table.string('value');
      addScope(table);
      table.timestamps(true, true);
    });
    await db.schema.createTable(MetaTable.SORT, (table) => {
      table.string('id');
      table.string('fk_view_id');
      table.string('fk_column_id');
      table.string('direction');
      addScope(table);
      table.timestamps(true, true);
    });
    await db.schema.createTable(MetaTable.COL_RELATIONS, (table) => {
      table.string('id');
      table.string('fk_column_id');
      table.string('fk_target_view_id');
      addScope(table);
      table.timestamps(true, true);
    });
    await db.schema.createTable(MetaTable.MODELS, (table) => {
      table.string('id');
      table.string('title');
      addScope(table);
    });
    await db.schema.createTable(MetaTable.COLUMNS, (table) => {
      table.string('id');
      table.string('fk_model_id');
      addScope(table);
    });

    ncMeta = {
      knex: db,
      formatDateTime: (value: string) => value,
      contextCondition: (query, workspaceId, baseId) =>
        query.where('fk_workspace_id', workspaceId).where('base_id', baseId),
      metaInsert2: async (workspaceId, baseId, table, data) => {
        const now = '2026-08-23T00:00:00.000Z';
        const row = {
          ...data,
          id: data.id ?? `generated-${++generatedId}`,
          fk_workspace_id: workspaceId,
          base_id: baseId,
          created_at: now,
          updated_at: now,
        };
        await db(table).insert(row);
        return row;
      },
      metaDelete: async (workspaceId, baseId, table, idOrCondition) => {
        const query = db(table).where(
          typeof idOrCondition === 'string'
            ? { id: idOrCondition }
            : idOrCondition,
        );
        query.where('fk_workspace_id', workspaceId).where('base_id', baseId);
        return query.delete();
      },
      metaGet2: async (workspaceId, baseId, table, idOrCondition) => {
        const query = db(table).where(
          typeof idOrCondition === 'string'
            ? { id: idOrCondition }
            : idOrCondition,
        );
        query.where('fk_workspace_id', workspaceId).where('base_id', baseId);
        return query.first();
      },
    } as unknown as MetaService;

    jest.spyOn(NocoCache, 'get').mockResolvedValue(null);
    jest.spyOn(NocoCache, 'set').mockResolvedValue(true);
    jest.spyOn(NocoCache, 'del').mockResolvedValue(true);
    jest.spyOn(NocoCache, 'deepDel').mockResolvedValue(true);

    const scoped = { base_id: 'base-a', fk_workspace_id: 'workspace-a' };
    await db(MetaTable.MODELS).insert({
      ...scoped,
      id: 'model-a',
      title: 'Tasks',
    });
    await db(MetaTable.COLUMNS).insert({
      ...scoped,
      id: 'column-a',
      fk_model_id: 'model-a',
    });
    await db(MetaTable.VIEWS).insert({
      ...scoped,
      id: 'view-a',
      fk_model_id: 'model-a',
      source_id: 'source-a',
      title: 'Recoverable grid',
      type: ViewTypes.GRID,
      order: 2,
      meta: JSON.stringify({ density: 'compact' }),
    });
    await db(MetaTable.GRID_VIEW).insert({
      ...scoped,
      id: 'grid-a',
      fk_view_id: 'view-a',
      row_height: 'short',
    });
    await db(MetaTable.GRID_VIEW_COLUMNS).insert({
      ...scoped,
      id: 'grid-column-a',
      fk_view_id: 'view-a',
      fk_column_id: 'column-a',
      show: true,
      order: 1,
    });
    await db(MetaTable.FILTER_EXP).insert({
      ...scoped,
      id: 'filter-a',
      fk_view_id: 'view-a',
      fk_column_id: 'column-a',
      comparison_op: 'eq',
      value: 'Open',
    });
    await db(MetaTable.SORT).insert({
      ...scoped,
      id: 'sort-a',
      fk_view_id: 'view-a',
      fk_column_id: 'column-a',
      direction: 'asc',
    });
    await db(MetaTable.COL_RELATIONS).insert({
      ...scoped,
      id: 'relation-a',
      fk_column_id: 'column-a',
      fk_target_view_id: 'view-a',
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await db.destroy();
  });

  const deleteLiveViewRows = async () => {
    await db(MetaTable.FILTER_EXP).where({ fk_view_id: 'view-a' }).delete();
    await db(MetaTable.SORT).where({ fk_view_id: 'view-a' }).delete();
    await db(MetaTable.GRID_VIEW_COLUMNS)
      .where({ fk_view_id: 'view-a' })
      .delete();
    await db(MetaTable.GRID_VIEW).where({ fk_view_id: 'view-a' }).delete();
    await db(MetaTable.VIEWS).where({ id: 'view-a' }).delete();
    await db(MetaTable.COL_RELATIONS)
      .where({ id: 'relation-a' })
      .update({ fk_target_view_id: null });
  };

  it('round-trips view configuration, filters, sorts, visibility, and target links', async () => {
    const view = await View.get(context, 'view-a', ncMeta);
    const entry = await ViewTrash.create(
      context,
      { view, deletedBy: 'user-a' },
      ncMeta,
    );
    await deleteLiveViewRows();

    const restored = await ViewTrash.restore(context, entry.id, ncMeta);

    expect(restored).toEqual(
      expect.objectContaining({
        id: 'view-a',
        fk_model_id: 'model-a',
        title: 'Recoverable grid',
        type: ViewTypes.GRID,
      }),
    );
    await expect(
      db(MetaTable.GRID_VIEW).where({ fk_view_id: 'view-a' }).first(),
    ).resolves.toEqual(expect.objectContaining({ row_height: 'short' }));
    await expect(
      db(MetaTable.GRID_VIEW_COLUMNS).where({ fk_view_id: 'view-a' }).first(),
    ).resolves.toEqual(
      expect.objectContaining({ fk_column_id: 'column-a', show: 1, order: 1 }),
    );
    await expect(
      db(MetaTable.FILTER_EXP).where({ fk_view_id: 'view-a' }).first(),
    ).resolves.toEqual(
      expect.objectContaining({ comparison_op: 'eq', value: 'Open' }),
    );
    await expect(
      db(MetaTable.SORT).where({ fk_view_id: 'view-a' }).first(),
    ).resolves.toEqual(expect.objectContaining({ direction: 'asc' }));
    await expect(
      db(MetaTable.COL_RELATIONS).where({ id: 'relation-a' }).first(),
    ).resolves.toEqual(
      expect.objectContaining({ fk_target_view_id: 'view-a' }),
    );
    await expect(db(MetaTable.VIEW_TRASH).select('id')).resolves.toEqual([]);
    await expect(db(MetaTable.BASE_TRASH).select('id')).resolves.toEqual([]);
  });

  it('keeps the snapshot when a live view has taken the original title', async () => {
    const view = await View.get(context, 'view-a', ncMeta);
    const entry = await ViewTrash.create(context, { view }, ncMeta);
    await deleteLiveViewRows();
    await db(MetaTable.VIEWS).insert({
      base_id: 'base-a',
      fk_workspace_id: 'workspace-a',
      id: 'view-b',
      fk_model_id: 'model-a',
      source_id: 'source-a',
      title: 'Recoverable grid',
      type: ViewTypes.GRID,
    });

    await expect(ViewTrash.restore(context, entry.id, ncMeta)).rejects.toThrow(
      'A view named "Recoverable grid" already exists',
    );
    await expect(db(MetaTable.VIEW_TRASH).select('id')).resolves.toHaveLength(
      1,
    );
    await expect(db(MetaTable.BASE_TRASH).select('id')).resolves.toHaveLength(
      1,
    );
  });

  it('removes expired view snapshots in bounded batches', async () => {
    const view = await View.get(context, 'view-a', ncMeta);
    const entry = await ViewTrash.create(context, { view }, ncMeta);
    await db(MetaTable.BASE_TRASH)
      .where({ id: entry.id })
      .update({ expires_at: '2026-08-01T00:00:00.000Z' });

    await expect(
      ViewTrash.deleteExpiredBatch(
        new Date('2026-08-23T00:00:00.000Z'),
        10,
        ncMeta,
      ),
    ).resolves.toEqual({ selected: 1, deleted: 1 });
    await expect(db(MetaTable.VIEW_TRASH).select('id')).resolves.toEqual([]);
    await expect(db(MetaTable.BASE_TRASH).select('id')).resolves.toEqual([]);
  });
});
