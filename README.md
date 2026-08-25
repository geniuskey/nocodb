<p align="center">
  <img src="packages/nc-gui/assets/img/brand/rowweave-wordmark.svg" alt="RowWeave" width="320">
</p>

<p align="center"><strong>Weave data into work.</strong></p>

RowWeave is an independent, community-led AGPL no-code base platform. It turns
relational databases into collaborative spreadsheet-style applications with
forms, multiple views, APIs, sharing, and automation foundations.

The project continues from the final source commit on NocoDB's modern AGPL
lineage. It is not affiliated with, sponsored by, or endorsed by NocoDB Inc.

## Project status

RowWeave is establishing a clean, reproducible foundation before adding major
new capabilities. The current foundation provides:

- SQLite, PostgreSQL, and MySQL data paths;
- Base, table, field, and record CRUD;
- Grid, Form, Gallery, Kanban, Map, and Calendar view foundations;
- REST APIs and the retained compatibility SDK;
- sharing, collaboration, webhooks, integrations, and extension foundations;
- reproducible Community builds and cross-database backend tests.

List, Timeline, Gantt, Trash/Restore, Snapshots, Workflow, Script, advanced
permissions, and administration are tracked as independent RowWeave work. A
menu item or retained model is not treated as a completed feature; see the
[feature matrix](docs/FEATURE_MATRIX.md) for evidence and acceptance criteria.

## Compatibility

The compatibility target is the final AGPL baseline, not current proprietary
NocoDB releases:

- frozen source baseline: `cdcff441b275fbb672fe4bfffb2eb109d3e31497`;
- baseline package version: `0.265.1`;
- preserved interfaces: existing `nc_*` metadata tables, REST routes,
  `NC_*` environment variables, and legacy workspace package names where
  changing them would break installations or integrations.

New RowWeave capabilities use fork-owned specifications and migrations. Read
[the compatibility contract](docs/COMPATIBILITY.md) before changing a stored
identifier or public API.

## Quick start

Requirements: Node.js `22.12.0`, pnpm `10.27.0`, and Git.

```sh
npm install --global pnpm@10.27.0
CI=true pnpm install --frozen-lockfile
pnpm run build:sdk
pnpm run integrations:build
```

Start the backend:

```sh
NC_TOOL_DIR="$PWD/.data" NC_DISABLE_TELE=true pnpm start:backend
```

In another terminal, start the frontend:

```sh
NUXT_PUBLIC_NC_BACKEND_URL=http://127.0.0.1:8080 pnpm --filter nc-gui run dev -- --host 127.0.0.1 --port 3000
```

PowerShell equivalents, production builds, tests, and Docker commands are in
[BUILDING.md](docs/BUILDING.md).

## Development rules

RowWeave is a clean-room continuation:

- do not inspect or use post-transition NocoDB source, packages, containers,
  generated assets, source maps, or Enterprise implementations;
- public user documentation may describe desired behaviour, but implementation
  design and code must be independently written in this repository;
- preserve AGPL notices and compatibility unless a reviewed migration says
  otherwise;
- major features require backend, frontend, persistence/API work, tests, and
  documentation.

See [AGENTS.md](AGENTS.md), the [baseline audit](docs/BASELINE_AUDIT.md), and
the [architecture guide](docs/ARCHITECTURE.md) before contributing.

## License and attribution

RowWeave is licensed under the [GNU Affero General Public License v3 or
later](LICENSE). When you modify and operate it over a network, the AGPL source
offer requirements apply.

This source tree includes AGPL-licensed work originally published by NocoDB and
its contributors. Their copyright and license notices remain in the history
and source tree. `NocoDB` is used only where needed for historical attribution
or compatibility identification; it is not the RowWeave product name. See
[NOTICE](NOTICE) for details.
