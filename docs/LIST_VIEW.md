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

The frontend provides:

- List creation from the sidebar, compact sidebar, and topbar menus;
- a dedicated responsive record-row renderer;
- server-side pagination through the shared view-data composable;
- shared field visibility, filtering, sorting, and search controls;
- expanded-form record create/read/update/delete flows; and
- saved title, subtitle, image, density, and field-label presentation settings;
- attachment thumbnails with a stable empty-image fallback;
- optional row accents derived from visible Single Select option colors;
- ordered, condition-based row color rules stored in List metadata;
- variable-height, overscanned row virtualization;
- bounded adjacent-range prefetch over the existing server pagination API;
- cross-page explicit selection and all-matching, permission-aware bulk deletion;
- cross-page explicit and all-matching, permission-aware multi-field bulk update;
- keyboard navigation and range selection; and
- production-image browser coverage on SQLite, PostgreSQL, and MySQL.

List keeps the existing explicit page contract while prefetching the immediately
adjacent server ranges. Page navigation applies a ready range without issuing the
same request again. The cache retains at most three ranges and uses least-recently-used
eviction, so browsing a large table does not retain an unbounded record set.

## Interaction contract

List rows form an accessible multi-select listbox. One row participates in the
tab order at a time. The keyboard contract is:

- `ArrowUp` and `ArrowDown` move focus by one row;
- `Home` and `End` move to the first and last row on the loaded page;
- holding `Shift` while moving focus selects the contiguous range;
- `Space` toggles the focused row;
- `Enter` opens the focused row in the expanded form;
- `Ctrl+A` or `Cmd+A` selects every row on the loaded page; and
- `Escape` clears the selection.

Explicit selections are keyed by the table primary key and survive pagination.
After selecting a complete loaded page, a separate action promotes the state to
all records matching the current view and search filters. Unchecking records in
that mode records primary-key exclusions, including on later pages. A view or
data reload clears the selection so a changed query cannot silently inherit a
bulk-operation target.

The bulk-delete action is displayed only when the current user has record-delete
permission. Explicit selections use the existing Community bulk-record delete
endpoint. All-matching selection uses the existing server-side bulk-delete-all
endpoint with the active view, search expression, and excluded primary keys; it
does not load every matching row into the browser. Both paths require the shared
destructive-action confirmation dialog.

The bulk-update action is displayed only when the current user has data-edit
permission and at least one field grants `RECORD_FIELD_EDIT`. The editor applies
one value per selected field and prevents duplicate field entries. Primary keys, unique, auto-increment,
read-only, system, virtual, attachment, foreign-key, and database-specific
fields are intentionally excluded, and the allowed field set is checked again
when Apply is pressed. Explicit selection sends every selected value through the
Community transaction-backed bulk record update endpoint. All-matching selection
sends the same object through one Community conditional SQL update with the
active view, search expression, and excluded primary keys. The backend applies
those exclusions to the same query used for counting, audit, and mutation, and
hooks receive the resulting count. Selection clears only after the complete
multi-field operation succeeds.

The renderer virtualizes the loaded page with a fixed height calculated for the
current viewport, density, and number of visible detail rows. A small overscan
keeps keyboard navigation smooth while limiting the number of record elements
mounted in the DOM. Data retrieval remains server-paginated. The current page
prefetches only its valid previous and next offset/limit ranges; filter, sort,
search, page-size, view, reload, and mutation changes invalidate the cache and
also invalidate in-flight results from the prior generation.

## Metadata contract

`nc_list_view_v2` is keyed by `base_id` and `fk_view_id`. Its optional title,
subtitle, and image column references let the renderer choose a stable visual
hierarchy without changing table data. `density` is one of `compact`,
`comfortable`, or `spacious`; `show_field_labels` controls secondary-field
labels. `meta` is reserved for backwards-compatible presentation additions.

`nc_list_view_columns_v2` stores only ordered visibility (`order`, `show`) for
each table column. Filtering and sorting continue to use the existing shared
filter and sort metadata associated with the parent view.

The Appearance toolbar saves the title, optional subtitle, optional attachment
image, density, and detail-label settings through the List update endpoint. Its
field selectors intentionally contain only fields currently projected by the
view. This prevents a saved presentation field from silently requesting or
displaying data that the view has hidden. Missing or stale configuration falls
back to the primary visible field and then the next suitable visible field.

When an attachment image field is configured, the renderer uses the first valid
attachment value and removes that field from the detail list. Records without a
valid attachment retain the same layout with a neutral image placeholder. Image
height participates in the virtual-row height calculation.

The optional `meta.color_by_field_id` setting references a currently visible
Single Select field. A row whose cell value matches an existing select option
receives a subtle background and left accent using that option's stored color.
Missing fields, stale option values, and empty cells render without an accent.
The renderer evaluates only data already projected into the List response.

`meta.list_color_rules` stores at most 20 ordered rules. Each rule contains a
stable local identifier, a hexadecimal color, an `and`/`or` logical operator,
and between one and ten conditions. Each condition stores its own identifier,
visible field identifier, Community filter comparison, optional comparison
sub-operation, and value. The renderer evaluates rules from top to bottom
against the already projected row; the first matching all/any group wins. If no
rule matches, the Single Select color setting above is used as a fallback. Flat
single-condition metadata written by earlier fork releases is read as a
one-condition `and` group and is migrated when the Appearance editor next saves
it.

The Appearance editor supports ordinary text, number, select, checkbox,
date/time, and other scalar fields using the retained Community filter
vocabulary and cell editors. Attachment, relation, lookup, rollup,
database-specific, and action fields are excluded. Missing fields, malformed
colors, incompatible values, stale rules, and groups containing a stale
condition are ignored so saved metadata cannot stop a List from rendering or
accidentally broaden a match.

This List-only presentation path is intentionally independent of the existing
shared row-color subsystem: it does not read or write `row_coloring_mode`, call
row-color endpoints, alter `useEeConfig`, or change any licensing check. More
complex nested groups remain outside this List-only design.

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
query/pagination path. `useViewData` exposes non-mutating range fetch and explicit
range apply boundaries; `useListRangeCache` owns the List-only bounded LRU and
does not introduce another query or mutation engine. Opening or creating a record delegates to the existing
expanded-form implementation, so List does not introduce a parallel mutation
engine. `useViewRowSelection` contains presentation-independent persistent
selection, all-matching exclusions, and keyboard behavior, while the List
renderer owns virtualization, focus, accessibility markup, and the confirmed
mutation flow.

## Verification

The Community image workflow creates and updates List metadata through the API,
confirms the general table-view listing returns the List, creates a second List
through the rendered UI, and verifies a persisted record appears in that List.
It also saves Appearance settings, applies ordered conditional colors with a
Single Select fallback, verifies the resulting layout, creates enough records
to prove the DOM window is bounded, exercises keyboard range selection, explicit deletion, all-matching
selection, cross-page exclusions, permission-aware multi-field bulk update,
virtual focus movement, and server-side bulk deletion. The same workflow runs
against SQLite, PostgreSQL, and MySQL; each database is also restarted before
persistence is checked. It observes the adjacent offset request, verifies that
page navigation consumes the prefetched response without repeating that range,
and waits for the opposite adjacent range to become ready. Unit tests cover presentation-field resolution,
attachment parsing, conditional and select-color resolution, page transitions,
bounded LRU eviction and stale in-flight range invalidation, bulk-update field eligibility, all-matching exclusions, and keyboard boundary
behavior independently of the renderer.
