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
SQLite, PostgreSQL 16.6, and MySQL 8.3.0 metadata stores. The database matrix is
an acceptance foundation for the remaining service-boundary and compatibility
work; it does not by itself complete Phase 1.

## Phase 2 — List View

Create an independently designed record List view with shared view contracts,
server-side pagination/filtering/sorting, field projection, keyboard
navigation, virtualization, saved view configuration, API definitions, and
browser coverage. This phase should extract reusable row-selection and bulk
operation primitives for later views.

## Phase 3 — Timeline

Add a date-range Timeline view using the shared view/query contracts. Define
start/end field mapping, grouping, zoom levels, range loading, overlap layout,
and drag-to-reschedule behavior. Timeline data loading must remain bounded for
large tables.

## Phase 4 — Gantt

Build Gantt independently on the Timeline primitives. Planned concepts include
tasks, start/end dates, milestones, dependencies, progress, critical-path
calculation, calendar-aware duration, and transactional drag/resize updates.
No proprietary implementation is an allowed design input.

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
