# Architecture

This document describes the frozen Community foundation derived from commit
`cdcff441b275fbb672fe4bfffb2eb109d3e31497`. It describes only source retained
in the AGPL repository. See `BASELINE_AUDIT.md` for the legal boundary and
excluded paths.

## Runtime and toolchain

- Node.js: `22.12.0`, pinned by the root `.npmrc`. The backend manifest requires
  Node 22 or newer; the GUI and SDK require Node 18 or newer.
- Package manager: pnpm `10.27.0`, pinned by the root `packageManager` field.
- Backend: NestJS 10 hosted by Express, compiled with Rspack and SWC.
- Frontend: Nuxt 3.17.4, Vue 3, Pinia, Ant Design Vue, and Windi CSS.
- Metadata and query layer: Knex with SQLite, PostgreSQL, and MySQL paths in the
  Community runtime. Retained adapter code also contains Oracle, Snowflake, and
  Databricks-oriented abstractions; those are not part of the foundation
  acceptance matrix yet.
- Default local metadata database: SQLite at `$NC_TOOL_DIR/noco.db`.

## Workspace layout

The root pnpm workspace contains seven projects:

| Path | Role |
| --- | --- |
| `packages/nocodb` | NestJS backend, metadata store, database abstraction, APIs, jobs, and production bundle |
| `packages/nc-gui` | Nuxt/Vue web application |
| `packages/nc-lib-gui` | Small Express static-file adapter populated from the local GUI source build |
| `packages/nocodb-sdk` | Shared types, formula/filter helpers, API client, and OpenAPI-generated client |
| `packages/nocodb-sdk-v2` | Experimental/newer SDK package retained from the AGPL tree; not used by the primary runtime |
| `packages/nc-mail-templates` | Mail template workspace package |
| `tests/playwright` | Browser end-to-end suite |

`packages/noco-integrations` is a separate nested pnpm workspace with its own
lockfile. Its retained Community content consists of
`@noco-integrations/core`; it is installed and built explicitly before the
backend. `packages/nc-secret-mgr` is deliberately not a workspace project and
is removed by the foundation cleanup.

Other retained source directories such as `packages/nc-knex-dialects`,
`packages/nc-sql-executor`, and `packages/nc-integration-scaffolder` are not
independent root workspace packages in this revision. They must be reviewed
before being promoted into supported extension surfaces.

## Backend architecture

The local development entry is `packages/nocodb/src/run/docker.ts`. It creates
an Express server and initializes `Noco`, which mounts the Nest application.
`AppModule` composes four major modules:

- `AuthModule`: local, token, basic, shared-view, and retained Google auth
  strategies.
- `NocoModule`: metadata, data, view, user, attachment, webhook, integration,
  notification, MCP, and v1/v2/v3 API controllers and services.
- `EventEmitterModule`: application-domain event publication and listeners.
- `JobsModule`: asynchronous and migration jobs.

The typical request path is:

```text
HTTP request
  -> Express/Nest middleware and authentication/ACL guards
  -> controller (API transport and validation)
  -> service (domain operation)
  -> metadata models or BaseModelSqlv2
  -> Knex/database driver
```

Important backend areas are:

- `src/controllers` and `src/services`: REST boundaries and domain services.
- `src/modules`: Nest module composition, authentication, events, and jobs.
- `src/models`: metadata model classes. Most are files directly under the
  directory rather than one subdirectory per model.
- `src/meta`: metadata database initialization, caching, and schema migrations.
- `src/meta/migrations/v2`: ordered metadata migrations. New persistent
  metadata must be introduced here and registered in
  `XcMigrationSourcev2.ts`.
- `src/db/BaseModelSqlv2`: record CRUD, relations, filtering, sorting,
  aggregation, and grouping.
- `src/db/field-handler`: UI-field-type behavior by database client.
- `src/db/sql-client`, `src/db/sql-mgr`, and `src/db/sql-migrator`: database
  dialect operations, schema changes, and source-database migrations.
- `src/schema/swagger.json` and `swagger-v3.json`: authoritative Community API
  descriptions used to generate the SDK.
- `src/middlewares/gui`: mounts the locally built static GUI at `/dashboard` by
  default.

Community development and production use the separate
`rspack.community.dev.config.js`, `rspack.community.config.js`, and
`docker/rspack.community.config.js` entry points. Historical edition-selected
build configurations are not executed or modified to unlock another edition.

## Frontend architecture

`packages/nc-gui` is a client-side Nuxt application (`ssr: false` for the
static production output). Its main organization is:

- `pages`: route entry points for signup, account, project/base, shared view,
  and error flows.
- `layouts`: top-level page shells.
- `components`: feature and UI components. `components/smartsheet` contains
  record views, toolbars, grids, forms, gallery, kanban, map, and calendar.
- `composables`: reusable application behavior and stores for APIs, views,
  filters, grouping, records, permissions, dialogs, and global state.
- `store`: Pinia state.
- `plugins` and `middleware`: Nuxt lifecycle integration and route policy.
- `utils` and `helpers`: field parsing, import/export, rendering, and UI
  utilities.
- `lang`: localization resources.

Development runs the Nuxt server separately and points it at the backend with
`NUXT_PUBLIC_NC_BACKEND_URL`. Production uses `nuxt generate`; the foundation
stages `.output/public` into `packages/nc-lib-gui/lib/dist`. The backend then
serves that local source-built output. The committed or npm-published GUI
artifact is not a build input.

The AGPL baseline defines these view types in the shared SDK: Grid, Form,
Gallery, Kanban, Map, and Calendar. List, Timeline, and Gantt must be added as
new independent designs across the shared type, metadata, API, service, and UI
layers rather than as isolated frontend modes.

## SDK and API generation

`packages/nocodb-sdk` is both a shared library and the generated API client.
The build performs these steps:

1. Merge the retained Community `swagger.json` and v3 schema.
2. Run the pinned `swagger-typescript-api` 10.0.3 generator with the retained
   AGPL templates in `scripts/sdk/templates`.
3. Compile CommonJS and ES-module outputs.

Changes to public API payloads must update the backend schema first, regenerate
`src/lib/Api.ts`, and include backend and SDK tests. Do not hand-edit generated
API methods as a substitute for schema changes.

## Database architecture

The retained baseline stores two different classes of data:

- Metadata: users, bases, sources, tables, columns, views, filters, hooks,
  permissions, jobs, and other application state in the metadata database.
- User records: rows in the connected source database, accessed through
  `BaseModelSqlv2` and the active driver.

The supported foundation path is SQLite for the metadata database and for an
internal source. PostgreSQL and MySQL are represented by production drivers and
existing test configurations, but their complete acceptance runs require local
database services. Database-specific behavior belongs in field handlers,
condition/formula mappings, or SQL client/manager abstractions—not in view
components or controllers.

## Major extension points

### Add a field type

1. Add the shared type and serialization behavior in `nocodb-sdk`.
2. Add metadata/API schema fields if persistence changes.
3. Implement database-specific field handlers and SQL mappings.
4. Add backend column validation and migration behavior.
5. Add GUI edit/display/configuration components.
6. Add SDK, backend, and GUI/end-to-end tests.

### Add a view type

1. Define the shared view discriminator and API types.
2. Add metadata tables/columns with a registered migration.
3. Add model, controller, service, ACL, and API schema support.
4. Add frontend routing, toolbar configuration, rendering, and state.
5. Cover create/read/update/delete, sharing, permissions, and source-database
   compatibility in tests.

### Add an integration or automation provider

Implement against the independently licensed interface in
`packages/noco-integrations/core`, keep provider-specific credentials outside
metadata logs, register the package through the existing integration registry,
and add backend/API/UI tests. The excluded secret-manager or Enterprise build
artifacts are not reference implementations.

### Add a database dialect

Extend the driver/SQL client and manager abstractions, field handlers,
condition and formula mappings, schema introspection, migrations, and the
database test matrix. Avoid database-name conditionals in controllers and GUI
code.

## Test architecture

- SDK: Jest unit tests colocated as `*.spec.ts`.
- Backend: Jest is present for Nest-generated specs, while the substantive
  integration-style unit suite uses Mocha under `packages/nocodb/tests/unit`.
- Frontend: Vitest is configured, but the frozen revision contains no frontend
  unit test files under `packages/nc-gui/test`.
- End-to-end: Playwright under `tests/playwright`, with SQLite, PostgreSQL, and
  MySQL launch modes.
- Foundation smoke acceptance: `scripts/verify-community.mjs` verifies signup,
  signin, Base creation, table creation, and record CRUD against a running
  server, then removes its temporary Base.

New product work must add focused tests at the layer where behavior is owned;
the smoke verifier is not a substitute for feature tests.
