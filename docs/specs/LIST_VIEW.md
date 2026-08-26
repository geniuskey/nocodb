# RowWeave List View specification

Status: flat foundation implemented; hierarchy and sharing pending, 2026-08-26.

## Provenance and clean-room boundary

This specification is an independent RowWeave design for the frozen AGPL
baseline. It was derived from the baseline's existing public abstractions,
general database and UI engineering practice, and publicly documented
user-facing behaviour. No post-transition NocoDB source or Enterprise source
is an implementation input.

Behavioural references reviewed on 2026-08-25:

- <https://nocodb.com/docs/product/tables/views/view-types/list>
- <https://nocodb.com/docs/changelog/2026.08.1>

The public documentation describes a flat list, an optional hierarchy of at
most three linked-record levels, per-level fields/filters/sorts, empty-section
suppression, self-referential nesting, keyboard navigation, and persisted
column widths. RowWeave implements those capabilities from this specification,
not from another product's source or visual implementation.

## Compatibility contract

- Existing `ViewTypes` numeric values 1 through 6 remain unchanged.
- RowWeave adds `ViewTypes.LIST = 7` and the alias `list`.
- Existing Grid, Form, Gallery, Kanban, Map, and Calendar metadata remains
  byte-for-byte valid.
- The v1 and v2 metadata API conventions remain available. List endpoints are
  additive and use the same authentication and base isolation rules.
- Unknown view types must continue to fail explicitly in older clients. A List
  view is never silently represented as a Grid view.
- General record, filter, sort, export, and shared-view APIs are reused where
  their contracts are view-independent.

## Delivery slices

### Slice 1: flat list foundation

- Add the List discriminator, metadata tables, models, API, authorization, and
  application events.
- Store per-view metadata and per-column visibility, order, and width.
- Render records as a distinct, accessible list using the existing record data
  service. Filtering, sorting, paging, editing, and CRUD retain their existing
  API semantics.
- Provide loading, empty, error, locked, and read-only states.

### Slice 2: linked hierarchy

- Add a versioned level model separate from the flat-list metadata.
- Configure at most three levels, with each model appearing at most once.
- Non-root levels accept Has-Many links only. A self-referential Has-Many link
  may recursively expand records while detecting cycles by record identity.
- Store fields, filters, sorts, expansion state, and empty-section policy per
  level. Expansion is paged and lazy so a hierarchy cannot trigger unbounded
  queries.

### Slice 3: interaction and sharing

- Add keyboard navigation that keeps the active record visible.
- Add creation, rename, duplicate, delete, share, and lock acceptance coverage.
- Support portable export/import metadata with an explicit schema version.

## Slice 1 storage design

`nc_list_view_v2` has one row per List view:

- `base_id`, `source_id`, `fk_view_id`
- `row_height`
- `meta`
- timestamps

`nc_list_view_columns_v2` has one row per List field:

- `base_id`, `source_id`, `id`, `fk_view_id`, `fk_column_id`
- `show`, `order`, `width`
- timestamps

Both tables are additive. Their rollback removes the column table first and
then the view table. The migration does not rewrite existing metadata.

## Slice 1 API

- `POST /api/v1/db/meta/tables/{tableId}/lists`
- `POST /api/v2/meta/tables/{tableId}/lists`
- `GET /api/v1/db/meta/lists/{viewId}`
- `GET /api/v2/meta/lists/{viewId}`
- `PATCH /api/v1/db/meta/lists/{viewId}`
- `PATCH /api/v2/meta/lists/{viewId}`

Creation uses the existing `ViewCreateReq` contract. Update accepts only
`row_height` and `meta`. Field visibility/order/width use the generic view
column API so filters, sorts, permissions, and client caching remain aligned
with other view types.

## Authorization and isolation

- Read follows the existing view-read permission.
- Create and update follow existing creator/editor view permissions.
- All metadata queries include workspace/base context and obtain `source_id`
  from the parent view when omitted.
- A List view cannot reference a field outside its parent model/source.
- Public sharing is enabled only after the generic public-data path has explicit
  List acceptance tests.

## Acceptance criteria

- Existing view enum values and existing API responses do not change.
- SQLite, PostgreSQL, and MySQL migrate both up and down.
- A List view can be created, read, updated, filtered, sorted, and deleted.
- Field visibility, order, and width persist.
- Record create/read/update/delete works through the List UI.
- Backend, SDK, frontend, production, and Docker builds pass from a clean
  checkout.
- Flat and hierarchical behaviour each have API and UI tests before being
  marked complete in `docs/FEATURE_MATRIX.md`.

## Current verification status

The flat slice is accepted on SQLite, PostgreSQL 14.7, and MySQL 8.3.0. Its
integration test covers List metadata create/read/update/delete, per-field
visibility and width, record create/read/update/delete through the compatible
data API, filtering, sorting, and hidden-field projection. The full SQLite
backend suite passes with 558 tests and 21 intentional pending tests; the
focused List suite passes with two tests on each supported metadata database.

The SDK, backend type check, Nuxt production build, complete Community build,
and source-built Community Docker image pass. The Docker acceptance flow covers
sign-up/sign-in, Base and table creation, List create/read/update, and record
create/read/update/delete. Browser-level UI acceptance could not run because no
browser runtime was connected in the verification environment. Hierarchy,
sharing, and browser-level UI automation remain gates before the overall List
capability can be marked complete.
