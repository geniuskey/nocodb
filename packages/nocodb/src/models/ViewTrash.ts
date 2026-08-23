import { EventType, ViewTypes } from 'nocodb-sdk';
import BaseTrashEntry from './BaseTrashEntry';
import View from './View';
import type { NcContext } from '~/interface/config';
import type { MetaService } from '~/meta/meta.service';
import Noco from '~/Noco';
import NocoCache from '~/cache/NocoCache';
import { NcError } from '~/helpers/catchError';
import { trashExpiryFrom } from '~/helpers/recordTrash';
import { cleanCommandPaletteCache } from '~/helpers/commandPaletteHelpers';
import { cleanBaseSchemaCacheForBase } from '~/helpers/scriptHelper';
import NocoSocket from '~/socket/NocoSocket';
import { CacheDelDirection, CacheScope, MetaTable } from '~/utils/globals';

type SnapshotRow = Record<string, any>;

export type ViewTrashSnapshot = {
  version: 1;
  view: SnapshotRow;
  configuration: SnapshotRow[];
  columns: SnapshotRow[];
  filters: SnapshotRow[];
  sorts: SnapshotRow[];
  ganttDependencies: SnapshotRow[];
  calendarRanges: SnapshotRow[];
  targetRelations: Array<{ id: string; fk_column_id: string }>;
};

type ViewStorage = {
  configurationTable: MetaTable;
  configurationScope: CacheScope;
  columnsTable: MetaTable;
  columnsScope: CacheScope;
};

export default class ViewTrash {
  id: string;
  fk_trash_entry_id: string;
  fk_model_id: string;
  view_type: ViewTypes;
  snapshot: ViewTrashSnapshot;
  base_id?: string;
  fk_workspace_id?: string;
  created_at?: string;
  updated_at?: string;

  constructor(data: Partial<ViewTrash>) {
    Object.assign(this, data);
  }

  private static fromDb(data: any): ViewTrash | null {
    if (!data) return null;
    return new ViewTrash({
      ...data,
      snapshot:
        typeof data.snapshot === 'string'
          ? JSON.parse(data.snapshot)
          : data.snapshot,
    });
  }

  private static storage(viewType: ViewTypes): ViewStorage {
    switch (viewType) {
      case ViewTypes.GRID:
        return {
          configurationTable: MetaTable.GRID_VIEW,
          configurationScope: CacheScope.GRID_VIEW,
          columnsTable: MetaTable.GRID_VIEW_COLUMNS,
          columnsScope: CacheScope.GRID_VIEW_COLUMN,
        };
      case ViewTypes.LIST:
        return {
          configurationTable: MetaTable.LIST_VIEW,
          configurationScope: CacheScope.LIST_VIEW,
          columnsTable: MetaTable.LIST_VIEW_COLUMNS,
          columnsScope: CacheScope.LIST_VIEW_COLUMN,
        };
      case ViewTypes.TIMELINE:
        return {
          configurationTable: MetaTable.TIMELINE_VIEW,
          configurationScope: CacheScope.TIMELINE_VIEW,
          columnsTable: MetaTable.TIMELINE_VIEW_COLUMNS,
          columnsScope: CacheScope.TIMELINE_VIEW_COLUMN,
        };
      case ViewTypes.GANTT:
        return {
          configurationTable: MetaTable.GANTT_VIEW,
          configurationScope: CacheScope.GANTT_VIEW,
          columnsTable: MetaTable.GANTT_VIEW_COLUMNS,
          columnsScope: CacheScope.GANTT_VIEW_COLUMN,
        };
      case ViewTypes.GALLERY:
        return {
          configurationTable: MetaTable.GALLERY_VIEW,
          configurationScope: CacheScope.GALLERY_VIEW,
          columnsTable: MetaTable.GALLERY_VIEW_COLUMNS,
          columnsScope: CacheScope.GALLERY_VIEW_COLUMN,
        };
      case ViewTypes.KANBAN:
        return {
          configurationTable: MetaTable.KANBAN_VIEW,
          configurationScope: CacheScope.KANBAN_VIEW,
          columnsTable: MetaTable.KANBAN_VIEW_COLUMNS,
          columnsScope: CacheScope.KANBAN_VIEW_COLUMN,
        };
      case ViewTypes.FORM:
        return {
          configurationTable: MetaTable.FORM_VIEW,
          configurationScope: CacheScope.FORM_VIEW,
          columnsTable: MetaTable.FORM_VIEW_COLUMNS,
          columnsScope: CacheScope.FORM_VIEW_COLUMN,
        };
      case ViewTypes.MAP:
        return {
          configurationTable: MetaTable.MAP_VIEW,
          configurationScope: CacheScope.MAP_VIEW,
          columnsTable: MetaTable.MAP_VIEW_COLUMNS,
          columnsScope: CacheScope.MAP_VIEW_COLUMN,
        };
      case ViewTypes.CALENDAR:
        return {
          configurationTable: MetaTable.CALENDAR_VIEW,
          configurationScope: CacheScope.CALENDAR_VIEW,
          columnsTable: MetaTable.CALENDAR_VIEW_COLUMNS,
          columnsScope: CacheScope.CALENDAR_VIEW_COLUMN,
        };
      default:
        throw new Error(`Unsupported view type: ${viewType}`);
    }
  }

  private static async scopedRows(
    context: NcContext,
    table: MetaTable,
    condition: Record<string, unknown>,
    ncMeta: MetaService,
  ): Promise<SnapshotRow[]> {
    const query = ncMeta.knex(table).select('*').where(condition);
    ncMeta.contextCondition(
      query,
      context.workspace_id,
      context.base_id,
      table,
    );
    return query;
  }

  private static async captureSnapshot(
    context: NcContext,
    view: View,
    ncMeta: MetaService,
  ): Promise<ViewTrashSnapshot> {
    const storage = this.storage(view.type);
    const [
      viewRows,
      configuration,
      columns,
      filters,
      sorts,
      ganttDependencies,
      calendarRanges,
      targetRelations,
    ] = await Promise.all([
      this.scopedRows(context, MetaTable.VIEWS, { id: view.id }, ncMeta),
      this.scopedRows(
        context,
        storage.configurationTable,
        { fk_view_id: view.id },
        ncMeta,
      ),
      this.scopedRows(
        context,
        storage.columnsTable,
        { fk_view_id: view.id },
        ncMeta,
      ),
      this.scopedRows(
        context,
        MetaTable.FILTER_EXP,
        { fk_view_id: view.id },
        ncMeta,
      ),
      this.scopedRows(context, MetaTable.SORT, { fk_view_id: view.id }, ncMeta),
      view.type === ViewTypes.GANTT
        ? this.scopedRows(
            context,
            MetaTable.GANTT_DEPENDENCIES,
            { fk_view_id: view.id },
            ncMeta,
          )
        : [],
      view.type === ViewTypes.CALENDAR
        ? this.scopedRows(
            context,
            MetaTable.CALENDAR_VIEW_RANGE,
            { fk_view_id: view.id },
            ncMeta,
          )
        : [],
      this.scopedRows(
        context,
        MetaTable.COL_RELATIONS,
        { fk_target_view_id: view.id },
        ncMeta,
      ),
    ]);

    if (viewRows.length !== 1) {
      NcError.get(context).viewNotFound(view.id);
    }

    return {
      version: 1,
      view: viewRows[0],
      configuration,
      columns,
      filters,
      sorts,
      ganttDependencies,
      calendarRanges,
      targetRelations: targetRelations.map((relation) => ({
        id: relation.id,
        fk_column_id: relation.fk_column_id,
      })),
    };
  }

  static async create(
    context: NcContext,
    param: { view: View; deletedBy?: string },
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<BaseTrashEntry> {
    const snapshot = await this.captureSnapshot(context, param.view, ncMeta);
    const deletedAt = new Date();
    const entry = await BaseTrashEntry.create(
      context,
      {
        resource_type: 'view',
        resource_id: param.view.id,
        resource_name: param.view.title,
        deleted_by: param.deletedBy,
        deleted_at: deletedAt.toISOString(),
        expires_at: trashExpiryFrom(deletedAt).toISOString(),
        source_id: param.view.source_id,
      },
      ncMeta,
    );

    try {
      await ncMeta.metaInsert2(
        context.workspace_id,
        context.base_id,
        MetaTable.VIEW_TRASH,
        {
          fk_trash_entry_id: entry.id,
          fk_model_id: param.view.fk_model_id,
          view_type: param.view.type,
          snapshot: JSON.stringify(snapshot),
        },
      );
    } catch (error) {
      await ncMeta.metaDelete(
        context.workspace_id,
        context.base_id,
        MetaTable.BASE_TRASH,
        entry.id,
      );
      throw error;
    }

    return entry;
  }

  static async getByEntryId(
    context: NcContext,
    entryId: string,
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<ViewTrash | null> {
    return this.fromDb(
      await ncMeta.metaGet2(
        context.workspace_id,
        context.base_id,
        MetaTable.VIEW_TRASH,
        { fk_trash_entry_id: entryId },
      ),
    );
  }

  private static assertReferencesExist(
    context: NcContext,
    snapshot: ViewTrashSnapshot,
    existingColumnIds: Set<string>,
  ) {
    const referencedColumnIds = new Set<string>();
    for (const row of [
      ...snapshot.configuration,
      ...snapshot.columns,
      ...snapshot.filters,
      ...snapshot.sorts,
      ...snapshot.calendarRanges,
    ]) {
      for (const [key, value] of Object.entries(row)) {
        if (
          typeof value === 'string' &&
          key !== 'fk_view_id' &&
          (key === 'fk_column_id' || /fk_.*(?:col|column).*_id$/.test(key))
        ) {
          referencedColumnIds.add(value);
        }
      }
    }
    const missing = [...referencedColumnIds].filter(
      (id) => !existingColumnIds.has(id),
    );
    if (missing.length) {
      NcError.get(context).badRequest(
        `View cannot be restored because ${missing.length} referenced field${
          missing.length === 1 ? '' : 's'
        } no longer exist`,
      );
    }
  }

  static async restore(
    context: NcContext,
    entryId: string,
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<View> {
    const trashed = await this.getByEntryId(context, entryId, ncMeta);
    if (!trashed)
      NcError.get(context).notFound('View trash snapshot not found');
    const snapshot = trashed.snapshot;
    if (!snapshot || snapshot.version !== 1 || !snapshot.view?.id) {
      NcError.get(context).badRequest('Unsupported view trash snapshot');
    }

    const liveView = await this.scopedRows(
      context,
      MetaTable.VIEWS,
      { id: snapshot.view.id },
      ncMeta,
    );
    if (liveView.length) {
      NcError.get(context).badRequest(
        'A live view already uses this trash snapshot identifier',
      );
    }
    const matchingTitle = await this.scopedRows(
      context,
      MetaTable.VIEWS,
      {
        fk_model_id: trashed.fk_model_id,
        title: snapshot.view.title,
      },
      ncMeta,
    );
    if (matchingTitle.length) {
      NcError.get(context).badRequest(
        `A view named "${snapshot.view.title}" already exists`,
      );
    }
    const models = await this.scopedRows(
      context,
      MetaTable.MODELS,
      { id: trashed.fk_model_id },
      ncMeta,
    );
    if (!models.length) {
      NcError.get(context).badRequest(
        'The table that contained this view no longer exists',
      );
    }
    const columnRows = await this.scopedRows(
      context,
      MetaTable.COLUMNS,
      { fk_model_id: trashed.fk_model_id },
      ncMeta,
    );
    this.assertReferencesExist(
      context,
      snapshot,
      new Set(columnRows.map((column) => column.id)),
    );

    const storage = this.storage(trashed.view_type);
    await ncMeta.knex.transaction(async (trx) => {
      const insert = async (table: MetaTable, rows: SnapshotRow[]) => {
        if (rows.length) await trx(table).insert(rows);
      };

      await insert(MetaTable.VIEWS, [snapshot.view]);
      await insert(storage.configurationTable, snapshot.configuration);
      await insert(storage.columnsTable, snapshot.columns);
      await insert(MetaTable.FILTER_EXP, snapshot.filters);
      await insert(MetaTable.SORT, snapshot.sorts);
      await insert(MetaTable.GANTT_DEPENDENCIES, snapshot.ganttDependencies);
      await insert(MetaTable.CALENDAR_VIEW_RANGE, snapshot.calendarRanges);

      if (snapshot.targetRelations.length) {
        const relationQuery = trx(MetaTable.COL_RELATIONS)
          .whereIn(
            'id',
            snapshot.targetRelations.map((relation) => relation.id),
          )
          .whereNull('fk_target_view_id')
          .update({ fk_target_view_id: snapshot.view.id });
        ncMeta.contextCondition(
          relationQuery,
          context.workspace_id,
          context.base_id,
          MetaTable.COL_RELATIONS,
        );
        await relationQuery;
      }

      const snapshotDelete = trx(MetaTable.VIEW_TRASH).where({
        id: trashed.id,
      });
      ncMeta.contextCondition(
        snapshotDelete,
        context.workspace_id,
        context.base_id,
        MetaTable.VIEW_TRASH,
      );
      await snapshotDelete.delete();

      const entryDelete = trx(MetaTable.BASE_TRASH).where({ id: entryId });
      ncMeta.contextCondition(
        entryDelete,
        context.workspace_id,
        context.base_id,
        MetaTable.BASE_TRASH,
      );
      await entryDelete.delete();
    });

    await Promise.all([
      NocoCache.deepDel(
        context,
        `${CacheScope.VIEW}:${trashed.fk_model_id}:list`,
        CacheDelDirection.PARENT_TO_CHILD,
      ),
      NocoCache.deepDel(
        context,
        `${storage.configurationScope}:${snapshot.view.id}`,
        CacheDelDirection.PARENT_TO_CHILD,
      ),
      NocoCache.deepDel(
        context,
        `${storage.columnsScope}:${snapshot.view.id}:list`,
        CacheDelDirection.PARENT_TO_CHILD,
      ),
      NocoCache.deepDel(
        context,
        `${CacheScope.FILTER_EXP}:${snapshot.view.id}:list`,
        CacheDelDirection.PARENT_TO_CHILD,
      ),
      NocoCache.deepDel(
        context,
        `${CacheScope.SORT}:${snapshot.view.id}:list`,
        CacheDelDirection.PARENT_TO_CHILD,
      ),
      NocoCache.del(context, [
        `${CacheScope.VIEW_ALIAS}:${trashed.fk_model_id}:${snapshot.view.title}`,
        `${CacheScope.VIEW_ALIAS}:${trashed.fk_model_id}:${snapshot.view.id}`,
      ]),
      ...snapshot.targetRelations.map((relation) =>
        NocoCache.deepDel(
          context,
          `${CacheScope.COL_RELATION}:${relation.fk_column_id}`,
          CacheDelDirection.CHILD_TO_PARENT,
        ),
      ),
    ]);
    cleanCommandPaletteCache(context.workspace_id).catch(() => undefined);
    cleanBaseSchemaCacheForBase(context.base_id).catch(() => undefined);

    const restored = await View.get(context, snapshot.view.id, ncMeta);
    NocoSocket.broadcastEvent(context, {
      event: EventType.META_EVENT,
      payload: { action: 'view_create', payload: restored },
    });
    return restored;
  }

  static async deleteForModel(
    context: NcContext,
    modelId: string,
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<void> {
    const snapshots = await this.scopedRows(
      context,
      MetaTable.VIEW_TRASH,
      { fk_model_id: modelId },
      ncMeta,
    );
    if (!snapshots.length) return;
    const entryIds = snapshots.map((snapshot) => snapshot.fk_trash_entry_id);
    await ncMeta.knex.transaction(async (trx) => {
      const snapshotQuery = trx(MetaTable.VIEW_TRASH).whereIn(
        'id',
        snapshots.map((snapshot) => snapshot.id),
      );
      ncMeta.contextCondition(
        snapshotQuery,
        context.workspace_id,
        context.base_id,
        MetaTable.VIEW_TRASH,
      );
      await snapshotQuery.delete();

      const entryQuery = trx(MetaTable.BASE_TRASH).whereIn('id', entryIds);
      ncMeta.contextCondition(
        entryQuery,
        context.workspace_id,
        context.base_id,
        MetaTable.BASE_TRASH,
      );
      await entryQuery.delete();
    });
  }

  static async deleteExpiredBatch(
    cutoff: Date,
    limit: number,
    ncMeta: MetaService = Noco.ncMeta,
  ): Promise<{ selected: number; deleted: number }> {
    const formattedCutoff = ncMeta.formatDateTime(cutoff.toISOString());
    const candidates: Array<{
      base_id: string;
      id: string;
      fk_trash_entry_id: string;
    }> = await ncMeta
      .knex(`${MetaTable.VIEW_TRASH} as view_trash`)
      .join(`${MetaTable.BASE_TRASH} as base_trash`, function () {
        this.on('view_trash.base_id', '=', 'base_trash.base_id').andOn(
          'view_trash.fk_trash_entry_id',
          '=',
          'base_trash.id',
        );
      })
      .select(
        'view_trash.base_id',
        'view_trash.id',
        'view_trash.fk_trash_entry_id',
      )
      .where('base_trash.expires_at', '<=', formattedCutoff)
      .orderBy('base_trash.expires_at', 'asc')
      .orderBy('view_trash.id', 'asc')
      .limit(limit);

    if (!candidates.length) return { selected: 0, deleted: 0 };

    const byBase = candidates.reduce<Map<string, typeof candidates>>(
      (groups, candidate) => {
        const rows = groups.get(candidate.base_id) ?? [];
        rows.push(candidate);
        groups.set(candidate.base_id, rows);
        return groups;
      },
      new Map(),
    );

    const deleted = await ncMeta.knex.transaction(async (trx) => {
      const snapshotQuery = trx(MetaTable.VIEW_TRASH).where(function () {
        for (const [baseId, rows] of byBase) {
          this.orWhere(function () {
            this.where('base_id', baseId).whereIn(
              'id',
              rows.map((row) => row.id),
            );
          });
        }
      });
      const count = Number(await snapshotQuery.delete());

      const entryQuery = trx(MetaTable.BASE_TRASH).where(function () {
        for (const [baseId, rows] of byBase) {
          this.orWhere(function () {
            this.where('base_id', baseId).whereIn(
              'id',
              rows.map((row) => row.fk_trash_entry_id),
            );
          });
        }
      });
      await entryQuery.delete();
      return count;
    });

    return { selected: candidates.length, deleted };
  }
}
