# Timeline View Design

This document records the independent design of the Community Timeline view.
The design uses the frozen AGPL baseline, general software engineering knowledge,
public standards, and this fork's own contracts. No later NocoDB or proprietary
source is an implementation reference.

## Scope and delivery slices

Timeline is a first-class view type (`ViewTypes.TIMELINE`, numeric value `8`). It
will present records from the existing shared view query and mutation services;
it does not own a separate record CRUD engine.

The first slice establishes only the durable contract:

- append-only Timeline and Timeline-column metadata tables;
- create, read, update, duplicate, and delete lifecycle integration;
- generated Community SDK and OpenAPI definitions;
- validated start, end, and title field mappings; and
- normal view-column visibility and ordering.

This metadata slice intentionally did not expose a frontend creation menu or
renderer. Those capabilities are added only by the later slices described
below.

The second slice adds the bounded record-loading contract. It continues to use
the shared data service rather than introducing a Timeline-specific CRUD
engine.

The third slice adds the authenticated, read-only Community renderer:

- Timeline creation is available from the ordinary view menus;
- creation requires a Date or DateTime start field and accepts optional end and
  title fields;
- day, week, month, and quarter zooms use server-bounded windows of 14, 42, 120,
  and 366 days respectively;
- previous, today, and next navigation replace the bounded window instead of
  accumulating an unbounded client data set;
- a deterministic greedy interval-partitioning algorithm assigns overlapping
  records to lanes; and
- Timeline settings persist through the existing metadata PATCH endpoint.

The renderer does not mutate records. Dragging, resizing, grouping, and
rescheduling remain later, independently reviewed slices.

The fourth slice adds whole-day rescheduling without creating a Timeline-only
mutation path:

- an editable record can be dragged horizontally and snaps to a whole-day
  delta at every zoom level;
- keyboard users can move a focused item one day with Left Arrow or Right
  Arrow;
- start and non-blank end values move by the same delta in one existing shared
  row PATCH, preserving interval duration;
- Date values remain calendar dates, while DateTime values preserve their time
  as the browser shifts the instant by calendar days;
- blank optional ends remain blank; and
- failed writes restore the original values, while successful writes enter the
  existing view-scoped undo/redo history.

Rescheduling is unavailable for locked views, SQL views, synced tables,
read-only mapped fields, and users without `dataEdit`. At that slice, resize
handles and partial-duration changes remained deferred.

The fifth slice adds right-edge duration resizing for records with a distinct,
non-blank end mapping:

- the visible end handle snaps pointer movement to whole-day deltas at every
  zoom level;
- a focused handle supports Left Arrow and Right Arrow for one-day changes;
- only the mapped end field is sent through the existing shared row PATCH;
- inclusive Date ends may equal the start calendar day, while DateTime ends
  may equal but never precede the start instant; and
- optimistic preview, permission boundaries, rollback, bounded reload, and
  view-scoped undo/redo match whole-item rescheduling.

An interval whose real end lies beyond the loaded window does not expose a
handle at the clipped viewport edge. Blank ends remain point events, and
left-edge/start resizing is intentionally outside this slice.

## Metadata contract

`nc_timeline_view_v2` is keyed by `base_id` and `fk_view_id` and stores:

- `fk_title_column_id`: optional label field;
- `fk_start_column_id`: optional Date or DateTime field;
- `fk_end_column_id`: optional Date or DateTime field; absent means a point event;
- `zoom`: `day`, `week`, `month`, or `quarter`, defaulting to `week`; and
- `meta`: reserved for backwards-compatible presentation additions.

An unconfigured Timeline is valid. This allows view creation before a user
chooses date fields and avoids guessing a table's intended schedule semantics.
On update, every non-null field reference must belong to the Timeline's table.
Start and end mappings accept only ordinary Date and DateTime fields. Computed
or read-only timestamp types are excluded from this initial writable contract
so future rescheduling cannot imply an unsupported mutation.

`nc_timeline_view_columns_v2` stores ordered visibility (`order`, `show`) for
each table column. Filters, sorts, row permissions, and record data stay in the
existing shared view and data services.

## API contract

- `POST /api/v1/db/meta/tables/{tableId}/timelines`
- `POST /api/v2/meta/tables/{tableId}/timelines`
- `GET /api/v1/db/meta/timelines/{viewId}`
- `GET /api/v2/meta/timelines/{viewId}`
- `PATCH /api/v1/db/meta/timelines/{viewId}`
- `PATCH /api/v2/meta/timelines/{viewId}`

Creation uses the common `ViewCreateReq` contract. Update accepts only Timeline
field mappings, zoom, and metadata. Supplying `null` explicitly clears a mapping.
Column visibility and order use the common bulk view-column update endpoint.

The OpenAPI fragment is
`packages/nocodb/src/schema/timeline-view.json`; the SDK generator merges it
with the Community schema.

### Bounded range loading

- `GET /api/v1/db/timeline-data/{viewId}`
- `GET /api/v2/timelines/{viewId}/records`

Both endpoints require `from` and `to` calendar dates in `YYYY-MM-DD` format.
The query window is half-open: `from` is inclusive and `to` is exclusive. A
window must be positive and no longer than 366 days. `limit` defaults to 500,
is restricted to 1–1000, and applies per page; `offset` defaults to zero.
Invalid or unbounded requests are rejected instead of silently widened.

For a Timeline without an end mapping, a record is included when its start is
inside `[from, to)`. With an end mapping, a record is included when its start is
before `to` and its end is on or after `from`. A blank end is treated as a point
at the start, so it must also start on or after `from`. End dates are inclusive,
which makes an item ending on `from` visible on that calendar day.

The range predicate is a server-owned condition combined with the existing view
and request filters using AND. Existing view sorts, field projection, row access,
and request throttling remain in force. Timeline title/start/end mapping fields
are always projected even if their ordinary view columns are hidden or a caller
requests a smaller field list; a renderer cannot position a record without
them. No public/shared Timeline endpoint is introduced in this slice.

## Architecture boundary

`TimelinesController` delegates orchestration and validation to
`TimelinesService`. `TimelineView` and `TimelineViewColumn` own metadata
persistence and cache entries. General `View` lifecycle code initializes,
duplicates, lists, and removes the companion metadata.

The range loader uses `DatasService.getDataList` for record projection, filters,
sorts, permissions, and pagination. It supplies only the server-owned temporal
conditions and hard bounds. The renderer uses this endpoint and the same shared
view settings; it does not create a Timeline-only CRUD path.

The GUI renderer is `components/smartsheet/Timeline.vue`. Its pure overlap
layout is isolated in `utils/timelineView.ts` so later virtualization and Gantt
work can reuse and test interval behavior without mounting Vue. The normal view
filter, sort, search, lock, and permission abstractions remain the source of
truth. Timeline navigation never falls back to the general unbounded row list.

Drag rescheduling deliberately calls the existing authenticated
`dbViewRow.update` contract with the Timeline view id. That shared mutation path
continues to own row authorization, field validation, hooks, webhooks, and
database writes. Sending start and end in one PATCH prevents a visible
half-moved interval. The renderer applies a local preview, restores the original
record on error, reloads the bounded window after success, and registers the
same PATCH pair with the existing view-scoped undo/redo service.

Right-edge resizing reuses that exact mutation/history path with a one-field
end patch. Its pure patch builder owns the Date-versus-DateTime boundary check,
so pointer and keyboard input cannot diverge on minimum-duration behavior.

## Compatibility rules

- The migration is append-only and does not rewrite earlier metadata.
- Existing view type values `1` through `7` remain unchanged.
- A missing end field is a supported point event, not corrupt metadata.
- A missing start field is an unconfigured view, not an implicit field choice.
- Unknown future `meta` properties must remain round-trippable.
- Range responses are bounded by a server-enforced interval and result limit.

## Verification

The metadata slice is accepted when the SDK and backend type checks pass, the
Community boundary checker reports no new exception, and the production image
workflow proves that SQLite, PostgreSQL, and MySQL can migrate, create, read,
update, list, restart, and delete Timeline metadata without affecting ordinary
record CRUD.

The range slice additionally requires fresh and post-restart browser workflows
to prove both v1 and v2 routes, interval and point-event overlap, hard request
bounds, view/request filter composition, required mapping projection, and
pagination against SQLite, PostgreSQL, and MySQL.

The read-only renderer slice additionally requires unit coverage for stable
overlap lanes, a successful Community GUI production build, and fresh/restart
browser coverage for menu creation, field mapping, bounded loading, navigation,
zoom persistence, and rendered record labels on SQLite, PostgreSQL, and MySQL.

The rescheduling slice additionally requires unit coverage for mixed Date and
DateTime shifts, blank ends, invalid values, and no-op deltas. Fresh and restart
browser workflows must prove that one drag sends one row PATCH containing both
mapped values and that the new dates persist on SQLite, PostgreSQL, and MySQL.

The end-resize slice additionally requires unit coverage for one-field patches,
inclusive same-day Date ends, reversed intervals, blank ends, and unsupported
mappings. Fresh and restart browser workflows must prove that the end handle
sends only the mapped end and that the resized duration persists on all three
metadata databases.
