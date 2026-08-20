# NocoDB AGPL Baseline Architecture

This document describes the frozen Community baseline at tag `v2025.11.0`, commit `d9d3d9d16d7358d023669942e2160aaeafaaa8cb`. It must be read together with [BASELINE_AUDIT.md](./BASELINE_AUDIT.md). Directories excluded by that audit are not extension points for this fork.

## Toolchain

- Node.js: `22.12.0`, selected by the repository-level `.npmrc`. The backend declares Node.js `>=22`; the GUI, SDK, and Playwright packages declare `>=18`.
- Package manager: pnpm `9.15.5`, pinned by the root `packageManager` field. Corepack is the supported launcher.
- Workspace: a pnpm monorepo with 9 package globs (10 projects including the root) and a small Lerna configuration for independent package versioning.
- Primary language: TypeScript. The GUI also contains Vue single-file components.

Do not use pnpm 10 for this tree. Its lockfile interpretation rejects the frozen `pnpm-lock.yaml` patched-dependency metadata.

## Workspace map

| Path                                        | Role                                                                                                          | License declared by package |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `packages/nocodb`                           | NestJS/Express API server, metadata service, database abstraction, migrations, bundled production entry point | AGPL-3.0-or-later           |
| `packages/nc-gui`                           | Nuxt 3/Vue 3 single-page web client                                                                           | AGPL-3.0-or-later           |
| `packages/nocodb-sdk`                       | Shared types, helpers, and generated API client used by the server and GUI                                    | AGPL-3.0-or-later           |
| `packages/nocodb-sdk-v2`                    | Experimental second SDK generator/build                                                                       | AGPL-3.0-or-later           |
| `packages/nc-knex-dialects/knex-snowflake`  | Knex dialect package                                                                                          | MIT                         |
| `packages/nc-knex-dialects/knex-databricks` | Knex dialect package                                                                                          | MIT                         |
| `packages/nc-sql-executor`                  | Separate SQL execution service                                                                                | ISC                         |
| `packages/nc-integration-scaffolder`        | Integration scaffolding tool                                                                                  | AGPL-3.0-or-later           |
| `tests/playwright`                          | Browser end-to-end test project                                                                               | AGPL-3.0-or-later           |

The non-AGPL package declarations are not automatically relicensed by the repository-level license. See the baseline audit before copying or redistributing those packages.

`packages/noco-integrations` is a separate, nested pnpm workspace. Its only retained project is `core`, the shared integration type/interface contract. Both manifests now explicitly declare `AGPL-3.0-or-later`. Baseline provider implementations, templates, work-in-progress packages, editor instructions, and package-generation scripts are absent; a future provider must be independently implemented and reviewed for license and provenance before being added.

## Backend

`packages/nocodb` is a NestJS application hosted on Express. The Community runtime entry is `src/run/docker`; Rspack turns it into `docker/main.js` for production. Important Community areas are:

- `src/controllers` and `src/modules`: HTTP/WebSocket boundaries and NestJS module assembly.
- `src/services`: application operations and orchestration.
- `src/models` and `src/meta`: metadata models, persistence, and migrations.
- `src/db`: database-independent query and record operations.
- `src/db/sql-data-mapper`: SQL-dialect mapping.
- `src/schema`: public OpenAPI/Swagger descriptions used to generate the SDK.
- `src/plugins`, `src/providers`, and Community integration interfaces: adapters for storage, notifications, authentication, and external services. New work here must be independently designed from public specifications and the Community baseline only.
- `src/public`: server-owned static files. Audited third-party library bundles copied outside the pnpm graph have a pinned, machine-readable provenance inventory in [VENDORED_ASSETS.json](./VENDORED_ASSETS.json); CI verifies their normalized hashes and notices. Branding and provider-logo assets remain a separate review surface.

The default local metadata/data store is SQLite. Knex-backed connections support PostgreSQL and MySQL, while separate workspace packages contain Snowflake and Databricks dialects. Metadata schema changes are performed by the migrations under `src/meta/migrations`; never edit an already-released migration for new fork work.

`docs/MIGRATION_MANIFEST.json` records the cross-platform normalized SHA-256
digest of every retained metadata migration/support file and the exact order of
the v0, v1, v2, and audit migration sources. The migration integrity check
requires the working tree to match that ledger. In pull requests it additionally
compares the ledger with the base commit, so an existing file, registration, or
ordering cannot be changed or removed; a new migration must be appended.

`docs/UPGRADE_FIXTURES.json` separately pins reproducible historical metadata
states. The first fixture represents a fresh v2025.10.0 installation: that
tag's v0 source registered only `nc_001_init`, whose normalized digest is
identical to the frozen v2025.11.0 AGPL tree. The fixture runner imports that
retained Community migration directly, rather than building or executing an
older complete application tree. It then starts the current image and verifies
the ordered v0 ledger, migrated schema, a pre-upgrade persistence marker, and a
second restart across SQLite, PostgreSQL, and MySQL.

## Frontend

`packages/nc-gui` is a client-only Nuxt 3 application (`ssr: false`) using Vue 3, Vite, Pinia, Windi CSS, and the workspace SDK. Its main Community extension surfaces are:

- `pages`: route-level screens.
- `components`: reusable and feature-level Vue components.
- `composables`: shared stateful client behavior and API orchestration.
- `stores`: Pinia state stores.
- `lib`, `utils`, and `helpers`: framework-independent client utilities.
- `plugins` and `modules`: Nuxt/Vue integration points.
- `extensions/data-exporter` and `extensions/json-exporter`: Community extensions present in the baseline.

The fork physically removes `packages/nc-gui/ee` and all baseline `extensions/*-ee` directories. The Community Nuxt, Windi, plugin-resource, and extension-component discovery configuration retains explicit negative globs as defense in depth. `pnpm run check:community-boundaries` rejects reintroduction of removed paths without reading their historical implementations.

## SDK and API generation

`packages/nocodb-sdk` merges the Community Swagger fragments and runs the pinned `swagger-typescript-api@10.0.3` templates in `scripts/sdk/templates`. It produces CommonJS output in `build/main` and ESM output in `build/module`. The GUI consumes the ESM build; the backend consumes shared types and helpers.

`src/lib/Api.ts` is generated and intentionally excluded from formatting/lint checks. Change public schemas or Community templates, then regenerate; do not hand-maintain the generated client.

The backend also generates base-specific public OpenAPI documents at runtime.
The v1 and v2 endpoints emit OpenAPI 3.0 documents; v3 emits OpenAPI 3.1.
Their table and record paths are assembled from the base metadata, including
the current base and table IDs. The fork-owned Community browser workflow
requests all three authenticated documents for a newly created table and
verifies their version, authentication schemes, CRUD operations, and request
and response schemas. This is a semantic compatibility contract rather than a
snapshot of generated descriptions or ordering. The same workflow then uses
a disposable base API token and each version's documented payload and path
conventions to create, update, read, list, and delete an isolated record before
the application restart.

## Build pipeline

1. pnpm installs the frozen workspace graph.
2. The Community SDK is generated and compiled first.
3. Nuxt statically generates the Community GUI in `.output/public`.
4. Rspack bundles the backend into `packages/nocodb/docker/main.js`.
5. The fork-owned staging command replaces `packages/nocodb/docker/nc-gui`
   with that generated tree.
6. pnpm deploys the backend's production dependency closure from the frozen
   workspace lockfile, injecting the local SDK and database dialect packages.
7. A local container image combines that portable closure, the backend bundle,
   staged Community GUI, and server-owned public assets.

The root `pnpm run build:community` command performs these steps in order. The
backend now serves the staged tree directly and no longer installs or executes
the upstream precompiled `nc-lib-gui` package. The frontend `generate` command
creates `.output/public`; the baseline also exposes this as the `dist` junction.
`scripts/stage-community-gui.mjs` validates the generated entry point, removes
only the fixed ignored staging directory, and copies the tree with Node.js APIs
so packaging behaves the same on Windows, macOS, and Linux.

The canonical `packages/nocodb/Dockerfile` uses the repository root as its context, but the root
`.dockerignore` admits only the frozen manifests, required workspace package
contents, and assembled runtime assets. The Node base image and pnpm release
are pinned; local workspace dependencies use the `workspace:` protocol so they
cannot silently become broken host-relative links in the image.
The same Dockerfile handles local and Buildx multi-architecture builds. It
bundles the independently licensed Litestream v0.3.13 release using explicit
per-architecture SHA-256 checksums; the former package-context and Timely
Dockerfiles were removed because they duplicated this path without a lockfile.
The image retains Litestream's Apache-2.0 license under
`/usr/share/licenses/litestream/LICENSE`.

The Nix flake follows the same pipeline. Its fixed-output dependency derivation
uses the frozen lockfile with an exact, wrapped pnpm `9.15.5`; the final package
contains the Rspack bundle, staged GUI, and server-owned public assets. It does
not fetch a package manager or SDK generator during the sandboxed build.

## Test pipeline

- SDK: Jest unit tests plus ESLint, Prettier, and CSpell checks.
- Backend: a Jest command that currently finds no tests, and a separate Mocha/SWC unit suite under `packages/nocodb/tests/unit`.
- Frontend: Vitest runs fork-owned Community behavior tests under
  `packages/nc-gui/test`. The first suite fixes the shared Grid/List sorting
  contract for numeric, text, date/time, linked-record, attachment, and user
  values, plus sort-metadata change detection.
- End-to-end: Community Playwright tests live under `tests/playwright`. A
  separate fork-owned configuration at `playwright.community.config.ts`
  exercises the canonical Community Docker image in Chromium through signup,
  base creation, table creation, and record create/read/update/delete. The
  cross-platform `scripts/test-community-image.mjs` orchestrator runs that same
  workflow against fresh SQLite, PostgreSQL, and MySQL metadata stores on an
  isolated Docker network. It then restarts the application container and uses
  a new browser session to sign in, reopen the previously created base and
  table, read the persisted record, and perform post-restart update/create/delete
  operations. It uses the frozen frontend's built-in Playwright mode so the
  stable DOM Grid is selected instead of the beta Canvas Grid; backend routes,
  persistence, and the assembled production frontend remain the same as the
  shipped image. The package scripts and retained CI workflows no longer set
  Enterprise flags or install Enterprise-only identity-provider fixtures.
  The fresh-instance workflow also validates the generated v1, v2, and v3
  public OpenAPI contract for the created base and table and executes a complete
  record lifecycle through each public API version before the restart.

Known baseline test failures are recorded in [BUILDING.md](./BUILDING.md). They are not hidden by dependency upgrades or product-code cleanup.

## Legal boundary for extension work

The approved starting surface is the Community set identified in [BASELINE_AUDIT.md](./BASELINE_AUDIT.md). Enterprise-labelled backend, SDK, GUI, extension, script, test, and build-config paths from the frozen tag are physically absent. Ambiguous integration providers, upstream cloud/release/Helm/runner assets and workflows, the optional secret-manager package with its generated Enterprise-mode CLI, and the legacy executable packager with precompiled native binaries are also absent. Branding paths remain excluded from approval pending replacement. Inventoried third-party library assets now have pinned source/version/hash metadata and restored component notices; the installed dependency closure still requires a release-time license report and review.

Future features should enter through Community controllers/services, public schemas, database adapters, migrations, Vue components/composables, or newly created fork-owned packages. Their design inputs must be the AGPL baseline, public behavior/specifications, and independently authored tests.

The default root bootstrap and backend build/development/test entry points are Community-only. `pnpm run check:community-boundaries` verifies that excluded implementation paths remain absent, scans Community module specifiers, restricts the integration workspace to its core contract, allowlists fork-owned workflows, and rejects excluded source selectors in every principal package script. `pnpm run check:vendored-assets` independently verifies copied runtime assets, required notices, and the absence of obsolete duplicate bundles. `pnpm run check:migration-integrity` protects already-published metadata migrations and their execution order.
