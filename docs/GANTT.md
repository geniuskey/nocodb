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
  accessible dependency editor.

Automatic successor rescheduling, critical-path analysis, working calendars,
and calendar-aware duration remain outside this slice. Dependency edges are
explicit constraints; they do not silently mutate task dates.

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
- reserved JSON `meta`.

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

## Verification

Pure unit tests cover stable task ordering, progress/milestone normalization,
dependency anchor geometry, identity hashing, cycle detection, and
missing-endpoint filtering. Community Playwright acceptance covers metadata
lifecycle, invalid mappings, bounded range validation, required field
projection, dependency CRUD and invalid-graph rejection, UI creation,
progress/milestone/link rendering, navigation, keyboard rescheduling,
virtualization, restart persistence, and generic view deletion. The workflow
runs against SQLite, PostgreSQL, and MySQL.
