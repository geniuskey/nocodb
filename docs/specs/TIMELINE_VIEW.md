# RowWeave Timeline View specification

Status: foundation design

This specification defines an independent Timeline view for the frozen AGPL
baseline. It describes behaviour and data contracts, not another product's
implementation. The only product-specific reference is public user-facing
documentation; all source structure and algorithms are designed in this
repository.

## Goals

- Represent one table record as a horizontal bar on a time axis.
- Require one start field and allow one optional end field.
- Preserve the existing View contracts for filters, sorts, field visibility,
  sharing, locking, duplication, permissions, and record identity.
- Keep metadata portable across SQLite, PostgreSQL, and MySQL.
- Deliver the feature as small vertical slices that remain useful and
  reviewable on their own.

## Non-goals for the foundation slice

- Dependencies, successors, milestones, critical paths, or resource leveling.
  Those belong to the later Gantt capability.
- Copying the source, component structure, styling, or algorithms of a newer
  NocoDB or Enterprise release.
- Nested grouping, infinite horizontal loading, drag-to-create, resizing,
  undo/redo, row coloring, or public sharing in the first slice.

## Behaviour contract

### Date configuration

- A Timeline requires exactly one start field.
- The start field must belong to the Timeline's table and use `Date`,
  `DateTime`, `CreatedTime`, or `LastModifiedTime`.
- An end field is optional and must meet the same table and type rules.
- A record without a start value is omitted from the time axis and included in
  the undated-record count.
- With no end value, a record occupies one display unit at the active zoom.
- Read-only system date fields may be used for display but cannot be changed by
  drag or resize operations.
- Invalid metadata is rejected before a View row or Timeline metadata row is
  inserted.

### Range semantics

- Dates are stored in the underlying record fields. Timeline metadata stores
  only field references and presentation preferences.
- Date-only values are interpreted in the Base time zone. DateTime values are
  converted for display using the existing RowWeave date utilities.
- The foundation renderer treats an end earlier than the start as invalid and
  displays the record as a one-unit bar with an invalid-range indicator. A
  later editing slice will reject attempts to create such a range.
- Moving a ranged record shifts start and end by the same duration. Resizing
  changes only the selected edge. These mutation rules are reserved for a
  later interaction slice.

### Navigation and zoom

The complete Timeline will support these independent zoom identifiers:

| Identifier | Visible span |
| --- | --- |
| `day` | one day |
| `week` | one week |
| `two_weeks` | two weeks |
| `month` | one month |
| `quarter` | three months |
| `six_months` | six months |
| `year` | one year |
| `two_years` | two years |
| `five_years` | five years |

The foundation slice implements `month`. Unknown stored zoom values fall back
to `month`, allowing additive zoom support without a destructive migration.
The complete navigation contract includes previous/next by the active span,
Today, direct date selection, horizontal panning, and a sticky date header.

### Records and permissions

- Clicking a bar opens the retained expanded-record form.
- Filters, sorts, quick search, and field projection use the generic View and
  data APIs.
- Viewers may read Timeline metadata and records.
- Editors may mutate records when the selected fields are writable.
- Creators and owners may create, rename, duplicate, lock, and delete Timeline
  views.
- A locked Timeline remains readable and navigable. Configuration, add,
  drag-to-create, move, resize, and delete entry points are hidden or disabled.
- Backend ACL checks remain authoritative for direct API requests.

## Metadata schema

`nc_timeline_view_v2` has one row per Timeline view:

| Column | Meaning |
| --- | --- |
| `fk_view_id` | Primary key and parent View ID |
| `base_id` | Base tenant key |
| `source_id` | Source key |
| `fk_start_date_col_id` | Required start field reference |
| `fk_end_date_col_id` | Optional end field reference |
| `zoom` | Stable zoom identifier; defaults to `month` |
| `initial_mode` | `closest_record` or `today` |
| `meta` | Versioned JSON for additive presentation settings |
| timestamps | Creation and update timestamps |

`nc_timeline_view_columns_v2` stores independent field presentation settings:

| Column | Meaning |
| --- | --- |
| `id` | Independent Timeline field identity |
| `fk_view_id` | Parent Timeline View ID |
| `fk_column_id` | Table field ID |
| `show` | Whether the field appears on a bar |
| `order` | Display order |
| `width` | Reserved label-column width |
| `bold`, `italic`, `underline` | Text presentation flags |
| tenant/source keys and timestamps | Standard metadata isolation |

The migration is additive. Its down migration removes Timeline columns before
Timeline metadata. Existing View enum values and existing tables do not change.

## API contract

- `GET /api/v2/meta/timelines/:viewId` reads Timeline metadata.
- `POST /api/v2/meta/tables/:tableId/timelines` creates a Timeline and accepts
  `title`, `fk_start_date_col_id`, optional `fk_end_date_col_id`, optional
  `zoom`, and optional `initial_mode`.
- `PATCH /api/v2/meta/timelines/:viewId` updates date configuration and
  presentation metadata after validating the parent table.
- Existing generic View endpoints handle rename, lock, duplicate, delete,
  filters, sorts, fields, sharing, and generic record reads.
- V1 aliases are retained beside V2 endpoints for compatibility with the
  baseline's existing metadata clients.

## Delivery slices

### Slice 1: metadata and flat month renderer

- Add the enum, schemas, migration, model, service, controller, ACL entries,
  creation menus, route selection, and a flat month-scale renderer.
- Validate date fields before insertion or update.
- Read records through the generic View row endpoint.
- Render dated records, count undated records, open expanded records, and
  respect field projection and lock state.
- Test metadata CRUD, validation, duplication, generic record compatibility,
  and migration portability on SQLite, PostgreSQL, and MySQL.

### Slice 2: navigation and complete zoom scale

- Implement all nine zoom identifiers, Today, direct date selection,
  previous/next, clipped-bar navigation, and progressive horizontal loading.

### Slice 3: record interaction

- Add button creation, flat drag-to-create, move, edge resize, permission and
  writable-field checks, optimistic updates, and undo/redo.

### Slice 4: grouping and sharing

- Add collapsible nested groups, vertical virtualization, public read-only
  sharing, row colors, tooltips, export, and complete browser acceptance.

## Acceptance criteria

- Existing View enum values and API responses remain compatible.
- SQLite, PostgreSQL, and MySQL migrate both up and down.
- A Timeline can be created, read, updated, renamed, duplicated, and deleted.
- Cross-table, non-date, and cross-type configuration is rejected without
  leaving partial metadata.
- Records are read through the existing View-aware data contract.
- Backend, SDK, frontend, production, and Docker builds pass from a clean
  checkout.
- Each delivery slice has API and UI acceptance coverage before its capability
  is marked complete in `docs/FEATURE_MATRIX.md`.

## Public behaviour reference

- <https://www.nocodb.com/docs/product/tables/views/view-types/timeline>
- <https://www.nocodb.com/docs/product/tables/views/create-view>
