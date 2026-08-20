# List View Design

This document records the independent design of the Community List view. The
implementation uses only the frozen AGPL baseline, general software engineering
knowledge, and the repository's existing public contracts. No later NocoDB or
Enterprise source is an implementation reference.

## Scope

List is a first-class view type (`ViewTypes.LIST`, numeric value `7`). It presents
the same table records, filters, sorts, and permissions as other data views. It
does not own a separate record-query engine.

The metadata and backend slice provides:

- creation and deletion through the normal view lifecycle;
- list-specific presentation settings;
- ordered field visibility through the common view-column API;
- migration-safe metadata tables; and
- generated SDK contracts for create and update operations.

The first frontend slice provides:

- List creation from the sidebar, compact sidebar, and topbar menus;
- a dedicated responsive record-row renderer;
- server-side pagination through the shared view-data composable;
- shared field visibility, filtering, sorting, and search controls;
- expanded-form record create/read/update/delete flows; and
- production-image browser coverage on SQLite, PostgreSQL, and MySQL.

Keyboard row navigation beyond Enter-to-open, multi-row selection, bulk
operations, row coloring, image-field presentation, and large-dataset
virtualization remain follow-up slices. The UI does not advertise controls for
those capabilities yet.

## Metadata contract

`nc_list_view_v2` is keyed by `base_id` and `fk_view_id`. Its optional title,
subtitle, and image column references let the renderer choose a stable visual
hierarchy without changing table data. `density` is one of `compact`,
`comfortable`, or `spacious`; `show_field_labels` controls secondary-field
labels. `meta` is reserved for backwards-compatible presentation additions.

`nc_list_view_columns_v2` stores only ordered visibility (`order`, `show`) for
each table column. Filtering and sorting continue to use the existing shared
filter and sort metadata associated with the parent view.

## API contract

- `POST /api/v1/db/meta/tables/{tableId}/lists`
- `POST /api/v2/meta/tables/{tableId}/lists`
- `PATCH /api/v1/db/meta/lists/{viewId}`
- `PATCH /api/v2/meta/lists/{viewId}`

The OpenAPI fragment is `packages/nocodb/src/schema/list-view.json`; the SDK
generator merges it with the frozen Community schema. Column visibility and
order use the existing bulk view-column update endpoint.

## Architecture boundary

The controller delegates to `ListsService`. The service owns orchestration,
validation, events, cache-list maintenance, webhooks, and socket notification.
`ListView` and `ListViewColumn` own metadata persistence and cache entries. Data
reads and writes remain in the existing data services and database adapters.

On the frontend, `useSmartsheetStore` identifies List as a normal data view,
`Smartsheet.vue` selects the fork-owned `smartsheet/List.vue` renderer, and the
renderer consumes the existing view-column injection and `useViewData`
query/pagination path. Opening or creating a record delegates to the existing
expanded-form implementation, so List does not introduce a parallel mutation
engine.

## Verification

The Community image workflow creates and updates List metadata through the API,
confirms the general table-view listing returns the List, creates a second List
through the rendered UI, and verifies a persisted record appears in that List.
The same workflow runs against SQLite, PostgreSQL, and MySQL; each database is
also restarted before persistence is checked.
