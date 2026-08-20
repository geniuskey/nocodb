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

It intentionally does not expose a frontend creation menu or renderer. Later
slices will add bounded date-range loading, overlap layout and virtualization,
then editing and drag-to-reschedule behavior. A metadata-only view therefore
cannot be created accidentally by the current UI.

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

## Architecture boundary

`TimelinesController` delegates orchestration and validation to
`TimelinesService`. `TimelineView` and `TimelineViewColumn` own metadata
persistence and cache entries. General `View` lifecycle code initializes,
duplicates, lists, and removes the companion metadata.

The future renderer must use `DataTableService`/`DatasService` for record
projection, filters, sorts, permissions, and mutations. If the existing query
contract cannot express bounded temporal loading, the next backend slice may
add a date-range predicate to the shared data engine; it must not create a
Timeline-only CRUD path.

## Compatibility rules

- The migration is append-only and does not rewrite earlier metadata.
- Existing view type values `1` through `7` remain unchanged.
- A missing end field is a supported point event, not corrupt metadata.
- A missing start field is an unconfigured view, not an implicit field choice.
- Unknown future `meta` properties must remain round-trippable.
- Range responses added later must be bounded by a server-enforced interval and
  result limit.

## Verification

The metadata slice is accepted when the SDK and backend type checks pass, the
Community boundary checker reports no new exception, and the production image
workflow proves that SQLite, PostgreSQL, and MySQL can migrate, create, read,
update, list, restart, and delete Timeline metadata without affecting ordinary
record CRUD.
