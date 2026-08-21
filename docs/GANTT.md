# Gantt View Design

This document records the independently authored Community Gantt view. Its
design uses the frozen AGPL source tree, this fork's own Timeline primitives,
general scheduling concepts, and public web/API standards only. No later
NocoDB or Enterprise implementation is a design input.

## First vertical slice

Gantt is a first-class view type (`ViewTypes.GANTT`, numeric value `9`). The
first slice provides:

- append-only Gantt and Gantt-column metadata tables;
- create, read, update, list, duplicate, and delete lifecycle integration;
- required start/end mappings, plus optional title, progress, and milestone
  mappings;
- day, week, month, and quarter zoom settings;
- a server-bounded overlapping-task query;
- a fixed task table and a horizontally scrollable time axis;
- vertically virtualized task rows and horizontally virtualized day headers;
- normalized progress overlays and explicit Checkbox milestones;
- permission-aware whole-day move and start/end resize operations, with
  rollback and view-scoped undo/redo;
- an independently authored directed dependency graph with finish-to-start,
  start-to-start, finish-to-finish, and start-to-finish edges;
- whole-day lead/lag values, acyclic graph enforcement, and serialized edge
  create/update/delete operations; and
- bounded dependency queries, virtualized SVG link rendering, and an
  accessible dependency editor;
- read-only, component-local critical-path analysis with total float; and
- permission-aware critical task/link highlighting and an accessible analysis
  summary; and
- an optional project working calendar with ISO weekdays, holidays, and an
  IANA timezone.

Schedule propagation is explicit and preview-first. Dependency edges and
critical-path analysis never silently mutate task dates.

## Dependency graph contract

Dependencies live in `nc_gantt_dependencies_v2`, not in user records or the
Gantt view's opaque `meta` value. Each edge stores its Gantt view, predecessor
and successor record identities, dependency kind, and an integer `lag_days`
between -3,650 and 3,650. SHA-256 identity digests support bounded indexes;
the API never exposes those internal digests.

Both endpoints must exist in the Gantt view's table when an edge is created.
Self edges, duplicate ordered pairs, and any edge that closes a directed cycle
are rejected. A view supports at most 10,000 edges. PostgreSQL and MySQL writes
serialize on the Gantt metadata row before reading and changing the graph;
SQLite relies on its single-writer transaction semantics. This prevents two
concurrent graph writers from validating against different committed graph
states.

The record database and metadata database may be separate, so endpoint
existence and edge insertion cannot share one physical transaction. A later
record deletion can therefore leave an edge whose endpoint no longer exists.
Dependency queries are scoped to supplied current task identities and omit
such edges from rendering. Trash/restore work will define record-lifecycle
cleanup and restoration rules rather than making a read operation destructive.

Dependency endpoints are immutable. Changing endpoints is an explicit delete
and create operation, so the cycle and existence invariants always run. Kind
and lag can be updated in place. Gantt view duplication copies its graph; view
deletion removes its graph before removing the view metadata.

## Metadata contract

The companion record in `nc_gantt_view_v2` stores:

- `fk_view_id`;
- optional `fk_title_column_id`;
- `fk_start_column_id` and `fk_end_column_id`;
- optional `fk_progress_column_id`;
- optional `fk_milestone_column_id`;
- `zoom` (`day`, `week`, `month`, or `quarter`);
- reserved JSON `meta`, which stores the typed `working_calendar` value without
  requiring a metadata-table migration.

`working_calendar` contains `enabled`, unique ISO weekdays (`1` is Monday and
`7` is Sunday), up to 366 unique `YYYY-MM-DD` holidays, and an IANA timezone.
Its default is disabled, Monday through Friday, no holidays, and `UTC`.
Disabled calendars preserve the original seven-calendar-day behavior. Invalid
dates, duplicate weekdays, empty working weeks, unknown timezones, and unknown
properties are rejected. The API returns a normalized value even for Gantt
views created before this setting existed.

Start and end accept Date or DateTime fields. Progress accepts Number, Decimal,
or Percent and is clamped to the visual range 0–100. Milestone accepts only a
Checkbox. A milestone is an explicit record value, not an inference from a
zero-length interval. Every configured field must belong to the view's table.

Creation may briefly produce an unconfigured companion record so the common
view lifecycle remains atomic. Task loading is rejected until both start and
end mappings are configured.

`nc_gantt_view_columns_v2` follows the common per-view field visibility/order
contract. Mapping fields are projected even when hidden, because rendering a
task must never depend on a presentation-only visibility choice.

## API

Metadata endpoints:

- `POST /api/v1/db/meta/tables/{tableId}/gantts`
- `GET /api/v1/db/meta/gantts/{viewId}`
- `PATCH /api/v1/db/meta/gantts/{viewId}`

The same operations are available under the fork's v2 compatibility routes.
Deletion uses the common view endpoint.

Task data endpoints:

- `GET /api/v1/db/gantt-data/{viewId}`
- `GET /api/v2/gantts/{viewId}/records`

Dependency endpoints are available under both v1 and v2 metadata prefixes:

- `POST /api/v1/db/meta/gantts/{viewId}/dependencies/query`
- `POST /api/v1/db/meta/gantts/{viewId}/dependencies`
- `PATCH /api/v1/db/meta/gantts/{viewId}/dependencies/{dependencyId}`
- `DELETE /api/v1/db/meta/gantts/{viewId}/dependencies/{dependencyId}`

Schedule endpoints are also available under both prefixes:

- `GET /api/v1/db/meta/gantts/{viewId}/schedule/critical-path`
- `POST /api/v1/db/meta/gantts/{viewId}/schedule/preview`
- `POST /api/v1/db/meta/gantts/{viewId}/schedule/apply`

The dependency query accepts at most 1,000 current record identities and
returns only edges whose two endpoints are in that set. This matches the
bounded task API and avoids an unbounded graph response for large tables.

Both require `from` and `to` calendar dates and treat the requested interval as
half-open: `[from, to)`. The range must be positive and no longer than 366 days.
The default page size is 500 and the maximum is 1,000. `offset`, `fields`,
`sort`, and `where` retain the shared data API semantics. A task overlaps the
window when it starts before `to` and its end is on/after `from`; a blank end is
treated as a point at its start for compatibility with existing Timeline data.

The controller delegates to `GanttDatasService`, which adds only validated
range conditions before calling `DatasService`. Gantt does not introduce a
second record CRUD engine. Record edits use the existing view-scoped row PATCH.

## Schedule propagation contract

A schedule request names one to 100 anchor records. Anchors are fixed; only
their reachable successors are considered. The scheduler walks the acyclic
graph in deterministic topological order, preserves each successor's duration,
and moves it only later by whole days. It never pulls a task earlier. Multiple
incoming constraints use the greatest required delay. The four edge kinds use
their standard start/finish anchors, and positive or negative `lag_days` is
added to the predecessor anchor. A blank end is a point at start and remains
blank. A Date end is inclusive for finish constraints; a DateTime end is its
exact instant.

When the working calendar is enabled, the same integer values represent
working-day shifts. Shifted starts land on configured working dates, weekends
and holidays are skipped, and DateTime shifts preserve the local wall-clock
time in the configured timezone across daylight-saving changes. Date values
remain calendar dates. The preview response reports `day_mode` as `working` or
`calendar`, and the normalized calendar participates in `plan_hash`, so a
calendar edit invalidates an earlier preview.

`preview` is read-only and returns current/next dates, whole-day deltas, the
driving dependency identities, and a SHA-256 `plan_hash`. `apply` requires the
same anchors and hash. It locks the metadata graph, recomputes the complete
plan, and rejects a stale hash so the caller must preview again. Its record
changes use the shared bulk-update transaction, so either every scheduled row
is written or none is. The apply path emits the ordinary shared data hooks and
audits; it does not create a second CRUD engine.

One plan is bounded to 100 anchors, 1,000 affected/required records, and the
view's 10,000-edge graph limit. Missing endpoints, missing/invalid dates,
negative durations, cycles, and over-limit plans fail without record changes.
Graph serialization prevents an edge update from racing the recomputation.
PostgreSQL/MySQL metadata uses a row lock; SQLite uses a per-view process lock
so its single local connection is not held while user rows are read. The
metadata and user-data stores can still be physically separate, so the graph
lock and record transaction are not a distributed transaction. A concurrent
direct edit after preview invalidates the hash when it is visible to
recomputation. The hash is not a database-wide compare-and-set for the narrow
interval between recomputation and the shared bulk update, so callers should
reload after a rejected apply and integrations should avoid concurrent writes
to the same scheduled date fields.

## Critical-path contract

Critical-path analysis is a read-only projection over the saved dependency
graph. Only records that are dependency endpoints participate; unrelated table
records are not incorrectly labelled critical. One analysis is bounded to
1,000 endpoint records and the view's existing 10,000-edge limit. Missing
endpoints, missing or invalid dates, negative durations, and cycles are
rejected without changing records or graph metadata.

Each weakly connected dependency network is analyzed separately. This avoids
giving every task in a shorter, unrelated project misleading float relative to
the longest network in the view. The forward and backward passes use the four
dependency kinds as generalized start constraints:

- finish-to-start: predecessor duration plus lag;
- start-to-start: lag;
- finish-to-finish: predecessor duration minus successor duration plus lag;
- start-to-finish: negative successor duration plus lag.

Task duration follows the mapped field semantics used by scheduling: a Date
end is inclusive, a DateTime end is exact, and a blank end is a zero-duration
point. The response reports duration, earliest start, latest start, and total
float in days, plus critical record and binding dependency identities. A task
with effectively zero float is critical. With a working calendar enabled,
duration and float use working-day units and exclude configured non-working
dates; full local days remain one day across daylight-saving transitions. The
response exposes the active `day_mode`. Resources and per-task calendars are
not modeled. Actual saved task placement is not mutated or persisted as part
of the analysis.

## Frontend behavior

`components/smartsheet/Gantt.vue` owns presentation and interaction state. It
uses the fork-owned pure Timeline helpers for calendar windows, virtual ranges,
and Date/DateTime mutation patches. It does not reuse Timeline overlap-lane
layout: Gantt preserves server task order and assigns one stable row per task.

The task table remains fixed while the time axis scrolls. The renderer mounts
only visible rows plus overscan and pins the focused or actively manipulated
task. Day headers use an independent horizontal virtual range. Loading remains
bounded even when the underlying table is large.

Move and resize gestures snap to whole days. A move patches start and end in one
request; an edge resize patches only that edge. Invalid negative durations are
rejected before mutation. Write permissions, SQL/read-only/locked source state,
rollback, announcements, and undo/redo follow the existing Community mutation
contracts.

The dependency panel also provides an accessible schedule workflow. A user can
select fixed anchors and inspect every proposed date change. Applying is shown
only when record updates are allowed. The preview is cleared whenever the
loaded task window or anchor selection changes, and the server hash remains the
authoritative stale-plan guard.

The same panel exposes an explicit critical-path toggle to every user allowed
to read the loaded Gantt data. The result summarizes dependency networks and
task float, highlights critical task bars and binding links, and can be hidden
without another request. Any task reload, dependency mutation, or applied
schedule clears the result so stale analysis is never presented as current.

The settings panel exposes the project calendar, and non-working dates are
shaded in the time-axis header. Schedule changes and critical-path summaries
use `wd` when the server reports working-day units. Direct drag and keyboard
edits remain explicit calendar-day gestures; the saved graph scheduler is the
calendar-aware planning operation.

## Verification

Pure unit tests cover stable task ordering, progress/milestone normalization,
dependency anchor geometry, identity hashing, cycle detection, all four
schedule constraints, cascades, strongest-predecessor selection, negative lag,
forward-only behavior, generalized critical-path offsets, disconnected
networks, float, deterministic critical edges, and cycle rejection. Community
tests also cover normalized calendar validation, weekend/holiday skipping,
backward shifts, working duration, and timezone-stable daylight-saving
arithmetic. Playwright acceptance covers metadata
lifecycle, invalid mappings, bounded range validation, required field
projection, dependency CRUD and invalid-graph rejection, stale schedule
rejection, preview/apply persistence, critical-path API projection and empty
graphs, UI analysis and highlighting, UI creation,
progress/milestone/link rendering, navigation, keyboard rescheduling,
virtualization, restart persistence, and generic view deletion. The workflow
runs against SQLite, PostgreSQL, and MySQL.
