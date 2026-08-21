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
  rollback and view-scoped undo/redo.

Dependencies, critical-path analysis, working calendars, and calendar-aware
duration are deliberately outside this slice. Dependencies require their own
append-only graph schema and transaction rules; they will not be represented
as opaque Gantt metadata.

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

Pure unit tests cover stable task ordering, progress normalization, and
milestone normalization. Community Playwright acceptance covers metadata
lifecycle, invalid mappings, bounded range validation, required field
projection, UI creation, progress and milestone rendering, navigation,
keyboard rescheduling, virtualization, restart persistence, and generic view
deletion. The workflow runs against SQLite, PostgreSQL, and MySQL.
