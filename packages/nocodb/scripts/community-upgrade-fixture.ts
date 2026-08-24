import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import knex, { type Knex } from 'knex';
import * as nc_001_init from '../src/meta/migrations/v0/nc_001_init';
import { MetaTable } from '../src/utils/globals';

type Database = 'sqlite' | 'postgres' | 'mysql';
type Mode = 'seed' | 'verify';

interface FixtureManifest {
  fixtures: Array<{
    id: string;
    sourceTag: string;
    sourceCommit: string;
    migrationTrack: string;
    migrations: string[];
    sourceFiles: Array<{ path: string; sha256: string }>;
  }>;
}

const fixtureId = 'v2025.10.0-fresh-metadata';
const markerKey = 'fork_upgrade_fixture';
const expectedMigrations = [
  'nc_001_init',
  'nc_002_teams',
  'nc_003_alter_row_color_condition_nc_order_col',
  'nc_004_workflows',
  'nc_005_add_user_specific_and_meta_column_in_sync_configs',
  'nc_006_list_view',
  'nc_007_timeline_view',
  'nc_008_gantt_view',
  'nc_009_gantt_dependencies',
  'nc_010_record_trash',
  'nc_011_base_trash_entries',
  'nc_012_view_trash',
  'nc_013_record_trash_field_map',
  'nc_014_table_trash',
  'nc_015_field_trash',
  'nc_016_base_snapshots',
];

class HistoricalV0MigrationSource {
  public getMigrations(): Promise<string[]> {
    return Promise.resolve(['nc_001_init']);
  }

  public getMigrationName(migration: string): string {
    return migration;
  }

  public getMigration(migration: string): typeof nc_001_init | undefined {
    if (migration === 'nc_001_init') return nc_001_init;
    return undefined;
  }
}

function fail(message: string): never {
  throw new Error(`Upgrade fixture: ${message}`);
}

function loadFixture() {
  const manifestPath = resolve(
    __dirname,
    '../../../docs/UPGRADE_FIXTURES.json',
  );
  const manifest = JSON.parse(
    readFileSync(manifestPath, 'utf8'),
  ) as FixtureManifest;
  const fixture = manifest.fixtures.find(({ id }) => id === fixtureId);
  if (!fixture) fail(`${fixtureId} is absent from ${manifestPath}.`);
  if (
    fixture.sourceTag !== 'v2025.10.0' ||
    fixture.sourceCommit !== 'aeb48f480ffb51f306216096f0b65c49bd22a48c' ||
    fixture.migrationTrack !== 'v0' ||
    fixture.migrations.join('\0') !== 'nc_001_init'
  ) {
    fail(`${fixtureId} provenance or migration sequence changed.`);
  }

  const source = fixture.sourceFiles.find(
    ({ path }) =>
      path === 'packages/nocodb/src/meta/migrations/v0/nc_001_init.ts',
  );
  if (!source) fail(`${fixtureId} does not pin nc_001_init.ts.`);
  const migrationPath = resolve(
    __dirname,
    '../src/meta/migrations/v0/nc_001_init.ts',
  );
  const normalizedSource = readFileSync(migrationPath, 'utf8').replace(
    /\r\n/g,
    '\n',
  );
  const digest = createHash('sha256').update(normalizedSource).digest('hex');
  if (digest !== source.sha256) {
    fail(
      `nc_001_init.ts digest ${digest} does not match the fixture digest ${source.sha256}.`,
    );
  }

  return fixture;
}

function createConnection(database: Database, endpoint: string): Knex {
  switch (database) {
    case 'sqlite':
      return knex({
        client: 'sqlite3',
        connection: { filename: resolve(endpoint) },
        useNullAsDefault: true,
      });
    case 'postgres':
      return knex({
        client: 'pg',
        connection: {
          host: '127.0.0.1',
          port: Number(endpoint),
          user: 'postgres',
          password: 'password',
          database: 'nocodb',
        },
      });
    case 'mysql':
      return knex({
        client: 'mysql2',
        connection: {
          host: '127.0.0.1',
          port: Number(endpoint),
          user: 'root',
          password: 'password',
          database: 'nocodb',
        },
      });
  }
}

async function seed(connection: Knex, sourceTag: string) {
  if (await connection.schema.hasTable('xc_knex_migrationsv0')) {
    fail('refusing to seed a database that already has v0 migration state.');
  }

  await connection.migrate.latest({
    migrationSource: new HistoricalV0MigrationSource(),
    tableName: 'xc_knex_migrationsv0',
  });
  await connection(MetaTable.STORE).insert({
    key: markerKey,
    value: JSON.stringify({ fixtureId, sourceTag }),
    type: 'upgrade-fixture',
  });

  const migrations = await connection('xc_knex_migrationsv0')
    .select('name')
    .orderBy('id');
  if (migrations.map(({ name }) => name).join('\0') !== 'nc_001_init') {
    fail('historical migration bookkeeping was not created exactly.');
  }
}

async function verify(connection: Knex, sourceTag: string) {
  const migrations = await connection('xc_knex_migrationsv0')
    .select('name')
    .orderBy('id');
  const migrationNames = migrations.map(({ name }) => name);
  if (migrationNames.join('\0') !== expectedMigrations.join('\0')) {
    fail(
      `expected ${expectedMigrations.join(
        ', ',
      )}, received ${migrationNames.join(', ')}.`,
    );
  }

  const marker = await connection(MetaTable.STORE)
    .where({ key: markerKey })
    .first('value');
  const expectedMarker = JSON.stringify({ fixtureId, sourceTag });
  if (!marker || marker.value !== expectedMarker) {
    fail('the pre-upgrade persistence marker was not preserved.');
  }

  for (const table of [
    MetaTable.TEAMS,
    MetaTable.PRINCIPAL_ASSIGNMENTS,
    MetaTable.WORKFLOWS,
    MetaTable.WORKFLOW_EXECUTIONS,
    MetaTable.DEPENDENCY_TRACKER,
    MetaTable.LIST_VIEW,
    MetaTable.LIST_VIEW_COLUMNS,
    MetaTable.TIMELINE_VIEW,
    MetaTable.TIMELINE_VIEW_COLUMNS,
    MetaTable.GANTT_VIEW,
    MetaTable.GANTT_VIEW_COLUMNS,
    MetaTable.GANTT_DEPENDENCIES,
    MetaTable.BASE_TRASH,
    MetaTable.RECORD_TRASH,
    MetaTable.VIEW_TRASH,
    MetaTable.SNAPSHOT,
    MetaTable.SNAPSHOT_LOCK,
  ]) {
    if (!(await connection.schema.hasTable(table))) {
      fail(`expected migrated table ${table} is absent.`);
    }
  }

  if (
    !(await connection.schema.hasColumn(MetaTable.RECORD_TRASH, 'field_map'))
  ) {
    fail('expected record Trash field identity map is absent.');
  }

  const syncColumns = await connection(MetaTable.SYNC_CONFIGS).columnInfo();
  for (const column of ['created_by', 'updated_by', 'meta']) {
    if (!syncColumns[column]) {
      fail(
        `expected migrated column ${MetaTable.SYNC_CONFIGS}.${column} is absent.`,
      );
    }
  }

  const recordTrashColumns = await connection(
    MetaTable.RECORD_TRASH,
  ).columnInfo();
  if (!recordTrashColumns.fk_trash_entry_id) {
    fail(
      `expected migrated column ${MetaTable.RECORD_TRASH}.fk_trash_entry_id is absent.`,
    );
  }

  const baseTrashColumns = await connection(MetaTable.BASE_TRASH).columnInfo();
  for (const column of ['storage_name', 'original_type', 'parent_id']) {
    if (!baseTrashColumns[column]) {
      fail(
        `expected migrated column ${MetaTable.BASE_TRASH}.${column} is absent.`,
      );
    }
  }

  const snapshotColumns = await connection(MetaTable.SNAPSHOT).columnInfo();
  for (const column of [
    'format_version',
    'source_version',
    'manifest',
    'job_id',
    'error',
    'completed_at',
  ]) {
    if (!snapshotColumns[column]) {
      fail(
        `expected migrated column ${MetaTable.SNAPSHOT}.${column} is absent.`,
      );
    }
  }

  if (!(await connection.schema.hasColumn(MetaTable.PROJECT, 'is_snapshot'))) {
    fail('expected protected Base marker is absent.');
  }

  const orderColumn = await connection(
    MetaTable.ROW_COLOR_CONDITIONS,
  ).columnInfo('nc_order');
  if (!orderColumn || /int/i.test(orderColumn.type)) {
    fail(
      `${MetaTable.ROW_COLOR_CONDITIONS}.nc_order was not migrated from an integer type.`,
    );
  }
}

async function main() {
  const [mode, database, endpoint] = process.argv.slice(2) as [
    Mode,
    Database,
    string,
  ];
  if (
    !['seed', 'verify'].includes(mode) ||
    !['sqlite', 'postgres', 'mysql'].includes(database) ||
    !endpoint
  ) {
    fail(
      'usage: community-upgrade-fixture.ts seed|verify sqlite|postgres|mysql <path-or-port>',
    );
  }
  if (database !== 'sqlite' && !/^\d+$/.test(endpoint)) {
    fail('PostgreSQL/MySQL endpoint must be a published TCP port.');
  }

  const fixture = loadFixture();
  const connection = createConnection(database, endpoint);
  try {
    if (mode === 'seed') await seed(connection, fixture.sourceTag);
    else await verify(connection, fixture.sourceTag);
  } finally {
    await connection.destroy();
  }

  console.log(`${fixtureId} ${mode} passed for ${database}.`);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
