# Project Roadmap

This fork evolves from the frozen AGPL baseline identified in
[BASELINE_AUDIT.md](./BASELINE_AUDIT.md). The phases below are ordered so that
new product capabilities are built on stable Community-owned abstractions
rather than accumulating feature-specific patches.

## Non-negotiable implementation boundary

Every phase must use only:

- source already present in the approved AGPL Community baseline;
- general software engineering knowledge and public standards;
- public API specifications and publicly documented user-facing behavior; and
- independently licensed open-source dependencies.

No phase may copy, port, translate, adapt, reconstruct, or use as a reference
any post-license-transition NocoDB source or proprietary Enterprise
implementation. Similar capabilities must be independently designed and
tested.

## Phase order

```text
Phase 0   Fork / License / Build
    ↓
Phase 1   Modernization
    ↓
Phase 2   List View
    ↓
Phase 3   Timeline
    ↓
Phase 4   Gantt
    ↓
Phase 5   Trash / Restore
    ↓
Phase 6   Snapshot
    ↓
Phase 7   Automation / Workflow
    ↓
Phase 8   Script
    ↓
Phase 9   Advanced Permission
    ↓
Phase 10  SSO / Audit / Administration
```

List precedes Timeline, and Timeline precedes Gantt. This lets all three views
share independently authored query, grouping, ordering, date-range, and
virtualization foundations.

## Phase 0 — Fork / License / Build

Goals:

- freeze and document the last complete AGPL baseline;
- identify non-Community and differently licensed paths;
- pin the supported local toolchain;
- make clean installation, development, production builds, and Docker builds
  reproducible; and
- verify authentication, base/table creation, and record CRUD on SQLite.

Exit evidence is maintained in [BASELINE_AUDIT.md](./BASELINE_AUDIT.md),
[ARCHITECTURE.md](./ARCHITECTURE.md), and [BUILDING.md](./BUILDING.md).

## Phase 1 — Modernization

Modernization is structural work, not a product-feature phase. Planned work is
split into small reviewable changes:

1. Enforce Community-only source boundaries in build and CI inputs without
   modifying or bypassing license checks.
2. Separate generated artifacts from authored source and make generation
   deterministic.
3. Replace platform-specific scripts with cross-platform commands.
4. Establish reliable Community unit, integration, API-smoke, and browser-test
   lanes; record and then retire baseline failures.
5. Make Docker dependency installation use the frozen dependency graph and
   validate SQLite, PostgreSQL, and MySQL images independently.
6. Clarify backend service/module boundaries and frontend view-extension
   contracts before adding new views.
7. Add compatibility tests for existing databases and public APIs.

Phase 1 is complete only when a clean checkout can run the documented build
and Community test matrix in CI without depending on excluded directories.

Current evidence: the canonical Community image now completes the same
Chromium signup/base/table/record CRUD workflow independently against fresh
SQLite, PostgreSQL 16.6, and MySQL 8.3.0 metadata stores. It then restarts the
application and verifies new-session login, existing schema/record reads, and
post-restart CRUD against the preserved state in every database. The fresh
workflow also authenticates to the runtime-generated public API v1, v2, and v3
OpenAPI documents and verifies their security definitions, generated table
schemas, and version-specific CRUD operation layout. It then creates, updates,
reads, lists, and deletes an isolated record through each API version using a
disposable `xc-token` credential. This is an acceptance foundation for the
remaining service-boundary and existing-database compatibility work. Existing
metadata migrations and their v0/v1/v2/audit execution order are now protected
by an append-only, hash-verified ledger. A provenance-pinned v2025.10.0 fresh
metadata fixture now verifies the real `nc_001` to `nc_006` upgrade boundary,
schema changes, data preservation, and restart idempotence on SQLite,
PostgreSQL, and MySQL without running a historical full application tree.
Additional fork-release fixtures will be appended when this fork publishes new
migrations. Backend dependency direction and the canonical record/view flow are
now documented and enforced with removal-only exception inventories. Broader
compatibility and modernization work remains, so this does not by itself
complete Phase 1.

## Phase 2 — List View

Create an independently designed record List view with shared view contracts,
server-side pagination/filtering/sorting, field projection, keyboard
navigation, virtualization, saved view configuration, API definitions, and
browser coverage. This phase should extract reusable row-selection and bulk
operation primitives for later views.

Current evidence: List metadata, SDK contracts, Community service endpoints,
creation menus, responsive rendering, shared query controls, expanded-form
CRUD, server pagination, variable-height DOM virtualization, accessible
keyboard navigation, cross-page explicit selection, all-matching selection
with primary-key exclusions, and confirmed permission-aware bulk deletion are
implemented. Permission-aware multi-field bulk update uses the same cross-page
selection model, validates the field permission set again on Apply, and enforces
primary-key exclusions in the Community conditional update query. Unit tests cover the reusable selection primitive,
and the production-image browser workflow covers the rendered interactions on
SQLite, PostgreSQL, and MySQL. Saved title/subtitle/image configuration, density
and label controls, and attachment-image presentation are implemented. Ordered
conditional row colors and Single Select fallback colors are implemented as
List-only metadata without using the shared gated row-color subsystem. Color
rules support bounded AND/OR condition groups with safe legacy parsing.
Adjacent server ranges are prefetched through the existing Community offset/limit
API and retained in a three-range LRU; navigation consumes a ready range without
duplicating the request, while query and mutation changes invalidate stale and
in-flight entries. Phase 2 is complete.

## Phase 3 — Timeline

Add a date-range Timeline view using the shared view/query contracts. Define
start/end field mapping, grouping, zoom levels, range loading, overlap layout,
and drag-to-reschedule behavior. Timeline data loading must remain bounded for
large tables.

Current evidence: the independently designed metadata contract, numeric view
type, append-only Timeline and Timeline-column tables, create/read/update API,
date-field validation, SDK generation, general view lifecycle integration, and
server-bounded temporal query contract are implemented. The Community GUI can
create and configure a Timeline, load only its current bounded window, navigate
day/week/month/quarter zooms, and render intervals in deterministic overlap
lanes. Whole-day drag and keyboard rescheduling use one
permission-aware shared row PATCH for start/end, preserve duration, roll back
failed writes, and participate in view-scoped undo/redo. Resize-based duration
changes now use a permission-aware right-edge handle and keyboard controls,
with a one-field PATCH, minimum-bound validation, rollback, and undo/redo.
The symmetric left-edge handle now updates only the mapped start with the same
permission, boundary, rollback, and history guarantees. One-field visual
grouping now persists in the Timeline presentation metadata, validates and
projects the mapped field through the shared query AST, lays out overlaps per
group, and provides accessible local collapse controls. Two-axis viewport
virtualization now preserves the complete bounded layout while mounting only
overscanned day headers, group bands, and records; active keyboard and pointer
interactions remain pinned in the DOM. Phase 3 is complete.

## Phase 4 — Gantt

Build Gantt independently on the Timeline primitives. The first vertical slice
is implemented as a first-class view with append-only metadata, validated
start/end/title/progress/milestone mappings, bounded range loading, a fixed task
table and virtualized time axis, progress and milestone rendering, and
permission-aware transactional move/resize updates. SQLite, PostgreSQL, and
MySQL acceptance covers creation, rendering, persistence, and deletion.

The next Gantt slice will define an append-only dependency graph and its
transaction rules before adding dependency rendering. Critical-path analysis,
working calendars, and calendar-aware duration follow that contract. No
proprietary implementation is an allowed design input.

## Phase 5 — Trash / Restore

Introduce reversible deletion semantics for supported metadata and records,
retention policy, restore conflict handling, permanent deletion, audit events,
migrations, and backward-compatible API behavior.

## Phase 6 — Snapshot

Define consistent metadata/data snapshot boundaries, storage format,
compatibility metadata, restore validation, progress reporting, and recovery
tests. Snapshot is distinct from Trash and from external database backup.

## Phase 7 — Automation / Workflow

Create an event/action workflow core with independently defined triggers,
conditions, durable execution state, retries, idempotency, concurrency limits,
secrets boundaries, observability, and webhook actions.

## Phase 8 — Script

Add a permission-aware scripting capability on top of the workflow engine.
Execution must be isolated, resource-limited, deterministic where required,
auditable, and incapable of directly escaping data/API authorization rules.

## Phase 9 — Advanced Permission

Evolve the existing authorization model with explicit policy evaluation,
workspace/base/table/view/field scopes, inheritance rules, deny precedence,
API compatibility tests, and migration paths for existing roles.

## Phase 10 — SSO / Audit / Administration

Add standards-based identity and administration capabilities, beginning with
OIDC and SAML specifications, followed by session policy, provisioning,
structured audit events, export/retention, security administration, and
operational diagnostics.

## Target architecture

```text
Our Project
├── Data Core
│   ├── PostgreSQL
│   ├── MySQL
│   ├── SQLite
│   └── Other independently supported adapters
└── Application
    ├── Grid
    ├── Form
    ├── Gallery
    ├── Kanban
    ├── Calendar
    ├── Open Views
    │   ├── List
    │   ├── Timeline
    │   └── Gantt
    └── Automation
        ├── Workflow
        ├── Script
        └── Webhook
```

## Delivery policy

Each meaningful unit lands through a focused pull request. A major feature is
not complete without its backend and frontend work, migrations where needed,
API definitions, tests, documentation, compatibility evidence, and an explicit
licensing-boundary review.
