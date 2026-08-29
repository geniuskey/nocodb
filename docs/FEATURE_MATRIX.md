# Public Feature Matrix — 2026.08.1

## Purpose and clean-room boundary

This document turns publicly documented product behaviour into an independent
roadmap for the fork. The comparison target is NocoDB's public `2026.08.1`
release documentation, reviewed on 2026-08-25. It is not a source-code parity
claim and it does not authorize consulting newer NocoDB source.

For every item in this matrix:

- use only the frozen AGPL tree, public standards, public user documentation,
  general engineering knowledge, and independently licensed dependencies;
- do not inspect, copy, translate, port, or reconstruct post-transition or
  Enterprise source;
- do not reproduce screenshots, private APIs, internal names, or proprietary
  implementation structure;
- write a fork-owned specification, tests, data model, API, and UI before
  implementation;
- do not recreate upstream plan gates or license checks. This project decides
  its own open-source product policy.

Public documentation describes outcomes and constraints. It does not establish
code provenance.

## Status legend

| Status | Meaning |
| --- | --- |
| Accepted | Exercised successfully on the frozen Community runtime |
| Present | Retained source has a relevant model, API, or UI surface, but the capability has not passed an end-to-end acceptance test |
| Partial | Some foundation exists, but a material public behaviour is absent |
| Missing | No corresponding Community discriminator, persistence model, and runtime path were found |
| Research | Requires a fork-owned specification before scope can be estimated |

The `Present` status is deliberately conservative. A component name, schema
entry, or migration is not proof that a complete Community feature exists.

## Baseline evidence

The selected source baseline is commit
`cdcff441b275fbb672fe4bfffb2eb109d3e31497`, whose backend manifest identifies
version `0.265.1`. The fork foundation is built on that commit; it is not the
legacy `0.111.x` tree.

Important retained signals are:

- `packages/nocodb-sdk/src/lib/globals.ts` defines exactly six view
  discriminators: Form, Gallery, Grid, Kanban, Map, and Calendar.
- `packages/nocodb/src/controllers` contains Community controllers for those
  views, records, metadata, sharing, hooks, integrations, extensions, sync,
  and related core services.
- `packages/nocodb/src/models` contains `Audit`, `Dashboard`, `Permission`,
  `Script`, `MCPToken`, and integration/sync models. These are only capability
  signals until a Community API and acceptance flow proves the complete path.
- the retained baseline had no List, Timeline, or Gantt view discriminator or
  matching Community controller/model set. RowWeave now has independently
  implemented additive List and Timeline foundations. List includes linked
  Has-Many hierarchy and flat read-only sharing. Timeline includes additive
  metadata/API, all nine zoom scales, span/date navigation, clipped-bar
  navigation, and a progressively loaded read-only axis. Browser acceptance
  remains pending for both views.
- the retained metadata model contains an `is_snapshot` marker, but no
  Community snapshot controller/service acceptance path was found.
- no Community trash or workflow persistence/controller/service set was found.
- the foundation acceptance verifier proves local authentication, Base and
  table creation, List create/read/update, and record
  create/read/update/delete on SQLite.

See `ARCHITECTURE.md`, `BUILDING.md`, and `BASELINE_AUDIT.md` for reproducible
commands and the legal baseline.

## Capability matrix

### Data core and collaboration

| Capability | Baseline | Independent target | Phase | Public behaviour reference |
| --- | --- | --- | --- | --- |
| Base, table, field, and record CRUD | Accepted on SQLite | Preserve APIs and add PostgreSQL/MySQL acceptance | 1 | [Product overview](https://nocodb.com/docs/product) |
| External PostgreSQL/MySQL data sources | Present | Connection, introspection, data/schema edit controls, and compatibility matrix | 1 | [Data sources](https://nocodb.com/docs/product/data-sources) |
| Grid, Form, Gallery, Kanban, Map, Calendar | Present; Grid CRUD accepted | Add focused acceptance suites for each retained view | 1 | [Views](https://nocodb.com/docs/product/tables/views) |
| Filtering, sorting, grouping, search, field visibility, import/export | Present | Define cross-database behavioural tests and API/UI consistency | 1 | [Product overview](https://nocodb.com/docs/product) |
| Grid range selection and multi-field freeze | Partial | Shift-range selection and up to three pinned fields, including display value | 1 | [2026.08.1 changelog](https://nocodb.com/docs/changelog/2026.08.1) |
| Realtime presence | Missing | Member presence, focused-cell markers, open-record state, navigation, and non-locking semantics | 1 | [Realtime Presence](https://nocodb.com/docs/product/tables/table-operations/realtime-presence) |
| Base/sidebar and view folders | Missing | Collapsible ordering-only folders with move/reorder and no permission side effects | 1 | [Folders](https://nocodb.com/docs/product/bases/folders) |
| Comments and record revisions | Present | Test author-only mutation, deep links, permissions, and attachment security | 1/10 | [Expanded record](https://nocodb.com/docs/product/records/expand-record) |
| List view | Partial; flat, linked hierarchy, flat public sharing, lifecycle, and role APIs accepted on SQLite, PostgreSQL, and MySQL; keyboard and locked-state UI compile | Browser interaction and permission UI acceptance; public hierarchy remains fail-closed | 2 | [List](https://nocodb.com/docs/product/tables/views/view-types/list) |
| Timeline view | Partial; additive metadata/API, all nine zoom scales, span/date navigation, progressive loading, clipped-bar navigation, lifecycle and role checks, and generic record reads accepted on SQLite, PostgreSQL, and MySQL | Add record interaction, grouping, sharing, and browser acceptance | 3 | [Timeline](https://www.nocodb.com/docs/product/tables/views/view-types/timeline) |
| Gantt view | Missing | Scheduling bars, milestones, dependency links, rescheduling, and validation | 4 | [Gantt](https://nocodb.com/docs/product/tables/views/view-types/gantt) |
| Base trash and restore | Missing | Recover records first, then schema and application resources, with explicit conflict handling | 5 | [Base Trash](https://nocodb.com/docs/product/bases/base-trash) |
| Per-table trash retention | Missing | Opt-in/out policy, scheduled expiry, permanent deletion, and owner-only settings | 5 | [Trash settings](https://nocodb.com/docs/product/bases/trash-settings) |
| Base snapshots | Partial marker only | Create immutable point-in-time snapshots and restore into a new Base | 6 | [Base Snapshots](https://nocodb.com/docs/product/bases/snapshots) |

### Automation and programmable application layer

| Capability | Baseline | Independent target | Phase | Public behaviour reference |
| --- | --- | --- | --- | --- |
| Table webhooks | Present | Verify record triggers, conditions, custom HTTP request, logs, retry and secret redaction | 1/7 | [Webhook](https://nocodb.com/docs/product/automation/webhook) |
| Workflow engine | Missing | Versioned trigger/action/flow graph, deterministic execution, retries, delays, and logs | 7 | [Workflows](https://nocodb.com/docs/workflows) |
| Workflow triggers | Missing | Manual, schedule, record lifecycle, form, view-entry, condition, and comment events | 7 | [Workflows](https://nocodb.com/docs/workflows) |
| Workflow actions and flow nodes | Missing | Record CRUD, email/HTTP, if/else, iteration, delay, and wait-until | 7 | [Workflows](https://nocodb.com/docs/workflows) |
| Scripts | Present as model/schema/UI signals; no accepted Community execution path | Sandboxed JavaScript editor/runtime, explicit APIs, inputs/outputs, logs, limits, and cancellation | 8 | [Scripts](https://nocodb.com/docs/product/automation/scripts/create-script) |
| Script action from workflow/webhook/button | Partial signals | One capability-scoped execution contract shared by all callers | 8 | [Run Script action](https://nocodb.com/docs/workflows/nodes/action-nodes/run-script) |
| REST Data and Meta APIs | Accepted for the foundation CRUD flow | Preserve compatibility and add contract tests for metadata and record/link operations | 1 onward | [APIs & MCP](https://nocodb.com/docs/apis-and-mcp) |
| MCP record operations | Present | Authenticate and authorize record-only CRUD; no metadata mutation by default | 1/8 | [MCP Server](https://nocodb.com/docs/apis-and-mcp/mcp) |
| Integration connections | Present | Provider-neutral credential and connection contracts with independently licensed adapters | 7 onward | [Integrations](https://nocodb.com/docs/product/integrations) |
| Sync | Present | Verify NocoDB view sync, then independently add connector-driven app sync | Later | [Sync](https://nocodb.com/docs/product/sync) |

### Permissions, identity, and administration

| Capability | Baseline | Independent target | Phase | Public behaviour reference |
| --- | --- | --- | --- | --- |
| Workspace/Base roles | Present | Owner, Creator, Editor, Commenter, Viewer, No Access, and explicit inheritance semantics | 9 | [Roles and permissions](https://nocodb.com/docs/product/collaboration/roles-and-permissions) |
| Table visibility and record create/delete permission | Present as permission model/UI signals | Central policy evaluation enforced in UI, REST, shared forms, exports, and jobs | 9 | [Table permissions](https://nocodb.com/docs/product/collaboration/table-permissions) |
| Field edit permission | Present as permission model/UI signals | Enforce across cells, links, APIs, forms, bulk operations, scripts, and workflows | 9 | [Field permissions](https://nocodb.com/docs/product/collaboration/field-permissions) |
| Record-level security | Missing | Fail-closed filter policies for roles/users/teams plus current-user dynamic values | 9 | [Record-Level Security](https://nocodb.com/docs/product/collaboration/record-level-security) |
| Teams and nested teams | Missing or unaccepted | Workspace-scoped teams first; hierarchy and inherited subject matching second | 9/10 | [Teams](https://nocodb.com/docs/product/collaboration/teams) |
| SAML 2.0 and OpenID Connect SSO | Unaccepted shared UI signals | Standards-based providers, verified-email policy, account linking, recovery, and safe redirects | 10 | [Authentication and SSO](https://nocodb.com/docs/product/account-settings/authentication) |
| SCIM 2.0 | Missing | Standards-based user/group lifecycle with scoped tokens and idempotent provisioning | 10 | [SCIM](https://nocodb.com/docs/product/account-settings/authentication/scim) |
| Workspace audit logs | Present record-level audit foundation | Immutable structured events, filters, retention, export, and permission-safe payloads | 10 | [Workspace audit logs](https://nocodb.com/docs/product/workspaces/workspace-audit) |
| Administration console | Missing or incomplete | Deployment metrics, workspace/Base/user management, identity settings, and branding | 10 | [Admin Panel](https://nocodb.com/docs/product/cloud-enterprise-edition/admin-panel) |

### Broader application platform

These tracks are required for the longer-term public capability goal but come
after the user-prioritized phases unless a foundation dependency moves them
earlier.

| Capability | Baseline | Independent target | Proposed phase | Public behaviour reference |
| --- | --- | --- | --- | --- |
| Dashboards and widgets | Present as metadata/UI signals; unaccepted | Fork-owned dashboard API, grid layout, metrics/charts/text/embed widgets, and sharing | 11 | [Dashboards](https://nocodb.com/docs/product/dashboards) |
| Extension framework | Present | Stable capability API, isolation, permissions, lifecycle, and independently licensed extensions | 11 | [Extensions](https://nocodb.com/docs/product/extensions) |
| Rich documents | Missing | Hierarchical block documents, collaboration, comments, history, export, and sharing | 11 | [NocoDocs](https://nocodb.com/docs/product/docs) |
| Custom interfaces | Missing | Draft/publish application builder with table, review, dashboard, form, overview, and record-detail pages | 12 | [Interfaces](https://nocodb.com/docs/interfaces) |
| AI-assisted authoring | Partial integration signals | Provider-neutral, opt-in assistance with explicit data boundaries and auditable actions | 12 | [Product overview](https://nocodb.com/docs/product) |

## Phase specifications

### Phase 1 — Modernization and Community parity floor

Modernization is behavioural and architectural, not a blanket dependency
upgrade. Work in small PRs and retain lockfile discipline.

Required gates:

1. CI reproduces the documented install, type-check, SDK tests, backend tests,
   production build, Docker build, and Community smoke flow.
2. PostgreSQL and MySQL join SQLite in the core CRUD matrix.
3. Known baseline test gaps are either fixed with independent reasoning or
   quarantined with an issue and a precise expected failure.
4. Security regression tests cover filter parsing, redirect validation,
   public-share field filtering, export filtering, link mutation scope,
   session rotation, and frame policy.
5. Community parity items explicitly documented for `2026.08.1`—presence,
   folders, and multi-field freeze—receive separate design PRs.
6. Dependency upgrades are grouped by purpose and never used to import newer
   NocoDB packages or generated assets.

### Phase 2 — List

Implement in reviewable slices:

1. shared discriminator, metadata migration, API schema, model, service,
   controller, ACL, and CRUD tests;
2. flat list rendering and field configuration using existing record/query
   abstractions;
3. linked hierarchy with up to three configured Has-Many levels (implemented);
4. same-table parent/child nesting, cycle detection, and progressive loading;
   keyboard navigation is implemented, while browser acceptance remains;
5. flat share, lock, filter, sort, colour, permission, and database acceptance.
   Flat sharing and its database acceptance are implemented; public hierarchy
   stays disabled until it has a hierarchy-scoped authorization contract.

### Phase 3 — Timeline

The independent contract is recorded in `docs/specs/TIMELINE_VIEW.md` and
reuses the generic view lifecycle established by List. Slices 1 and 2 are
implemented: they add a required start date, optional end date, undated-record
accounting, deterministic date math, additive metadata/API, all nine zoom
scales, active-span navigation, direct date selection, progressive horizontal
loading, and clipped-bar navigation. The focused API suite passes on SQLite,
PostgreSQL, and MySQL, and the date-axis utility has frontend unit coverage.
Editing interactions, grouping, row colour, sharing, and browser acceptance
follow as separate reviewable slices.

### Phase 4 — Gantt

Build on the Timeline date-axis package without coupling it to NocoDB-specific
metadata. Define explicit task, dependency, and milestone contracts. Validate
cycles, missing dates, invalid ranges, permissions, concurrent edits, and
database transactions before enabling drag scheduling.

### Phase 5 — Trash and restore

Start with record deletion because it has the clearest transactional boundary.
Store immutable deletion envelopes with actor, time, resource identity, schema
version, values, and links. Restore must specify conflict outcomes for unique
values, missing fields, changed validation, and occupied relationships. Extend
the same resource protocol to views, fields, tables, dashboards, workflows,
scripts, and extensions only after each resource supplies its own serializer.

### Phase 6 — Snapshots

A snapshot is a versioned export artifact, not an in-place database rewind.
Restoring creates a new Base and must never modify the source Base. Define the
included metadata/data set, attachment handling, encryption, integrity hash,
compatibility version, workspace target checks, and cleanup policy. Audit logs,
permissions, and public-share secrets should be excluded unless a later
fork-owned specification explicitly changes that policy.

### Phase 7 — Workflow

Separate definitions from executions. Persist a versioned graph; enqueue an
execution against one immutable version; store per-node inputs, redacted
outputs, timings, attempts, and errors. Use an outbox/idempotency design for
database events and external side effects. Delays and wait-until nodes must
survive process restarts.

### Phase 8 — Script

Never execute untrusted user JavaScript in the API process. Select and document
an independently licensed isolation mechanism, resource limits, network and
filesystem policy, cancellation, dependency policy, secret injection, and
audit trail. Expose a small capability API instead of Node.js internals.

### Phase 9 — Advanced permission

Centralize authorization before expanding its UI. Every data path—REST,
shared views/forms, realtime, exports, webhooks, workflows, scripts, MCP,
sync, and caches—must use the same policy decision and query constraints.
RLS must fail closed and must have cross-role leakage tests.

### Phase 10 — SSO, audit, and administration

Use SAML 2.0, OpenID Connect, OAuth 2.0, and SCIM 2.0 specifications directly.
Keep authentication, identity lifecycle, authorization, audit storage, and the
admin UI as separate modules. Provide recovery paths before an administrator
can require SSO or disable local authentication.

## Cross-cutting acceptance contract

Every major capability PR must include:

- a dated public-behaviour specification and provenance note;
- metadata migration and downgrade/rollback policy when persistence changes;
- API schema and regenerated SDK where the public contract changes;
- backend authorization and database tests;
- frontend interaction, keyboard, loading, empty, error, and accessibility
  coverage;
- SQLite, PostgreSQL, and MySQL expectations, with documented exceptions;
- share/export/realtime/cache behaviour where applicable;
- audit events and deletion/restore semantics where applicable;
- clean install, production build, and Docker smoke verification.

No feature is marked complete because a menu item renders. Completion means
the entire independent path is documented, tested, and usable on the Community
runtime.

## Public reference register

The following public pages are the initial specification register. Record the
review date and relevant behaviour in each future design PR because these pages
can change over time.

- [2026.08.1 changelog](https://nocodb.com/docs/changelog/2026.08.1)
- [Product overview](https://nocodb.com/docs/product)
- [Views](https://nocodb.com/docs/product/tables/views)
- [Workflows](https://nocodb.com/docs/workflows)
- [APIs and MCP](https://nocodb.com/docs/apis-and-mcp)
- [Roles and permissions](https://nocodb.com/docs/product/collaboration/roles-and-permissions)
- [Interfaces](https://nocodb.com/docs/interfaces)

These links are behavioural references only. Do not follow source-code links
or use current packages, containers, source maps, or compiled assets as an
implementation reference.
