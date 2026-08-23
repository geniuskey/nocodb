# Base Trash and Restore

Phase 5 provides recoverable record, view, and physical-table deletion.
Existing record and table deletion routes keep their original permanent-delete
behavior unless callers explicitly opt in, so this addition does not silently
change API compatibility for existing clients.

## Foundation contract

`POST /api/v2/tables/{modelId}/trash` accepts the same primary-key objects used
by the existing bulk record-delete API, wrapped in a `records` array. It records
a bounded snapshot in the metadata database and only then invokes the shared
record deletion path. Up to 100 records may be trashed in one request. Each
serialized row snapshot is limited to 1 MiB, a batch is limited to 10 MiB, and
each snapshot expires 30 days after deletion.

`GET /api/v2/tables/{modelId}/trash` lists snapshots with bounded `limit` and
`offset` pagination. `POST /api/v2/tables/{modelId}/trash/restore` restores up
to 100 snapshot IDs through the shared record insertion path. The snapshot is
removed only after the insertion succeeds. `DELETE
/api/v2/tables/{modelId}/trash` permanently removes selected snapshots.

Before restoring, `POST /api/v2/tables/{modelId}/trash/conflicts` performs the
same bounded, read-only preflight used by restore. It reports primary-key,
unique-value, and enabled Email/URL/Phone validation conflicts per record and
field. Existing restore requests remain compatible: omitting `mode` selects
`strict`.

Every new delete operation also creates one base-scoped trash entry. Its record
snapshots carry `fk_trash_entry_id`, and filtered delete-all operations reuse
that entry across their bounded 100-record batches. This preserves the existing
table API while representing one user operation as one recoverable unit.

The ACL boundary intentionally reuses existing table-data permissions:

- listing requires `dataList`;
- trash and permanent deletion require `dataDelete`;
- restore requires `dataInsert`.

## Base Trash API

The independently defined Base Trash API provides a single base-scoped index:

- `GET /api/v2/meta/bases/{baseId}/trash?limit=25&offset=0` returns record,
  view, and table deletion entries newest first. Each record entry includes its
  table ID and saved name, total record count, and at most eight previews.
- `POST /api/v2/meta/bases/{baseId}/trash/{trashEntryId}/restore` restores all
  remaining records in that operation in bounded batches, or restores the
  deleted view represented by the entry.
- `GET /api/v2/meta/bases/{baseId}/trash/{trashEntryId}/conflicts` performs a
  bounded, non-mutating preflight for a grouped record entry and returns at
  most the first 100 conflict details with complete summary counts.
- `DELETE /api/v2/meta/bases/{baseId}/trash` permanently empties the base's
  record, view, and table Trash. Physical table drops happen before the
  corresponding metadata transaction.

Editors, creators, and owners can list and restore record entries. Emptying the
whole base Trash is owner-only. A data-read-only source may be listed but not
restored. The older table-level endpoints remain available for compatible,
fine-grained record recovery.

View deletion uses the same Base Trash index. Its entry identifies the original
view and parent table; owners and creators can restore it from the API or the
topbar **Trash** dialog. A restored view keeps its original identifier, title,
order, type-specific presentation, field visibility, filters, sorts, Calendar
ranges, Gantt dependencies, and target-view link configuration. The existing
view-delete API keeps its successful boolean response while adding this
recoverability.

Restore is rejected without consuming the snapshot if the original table no
longer exists, a live view has taken the same identifier or title, the source is
schema-read-only, or a referenced field was deleted while the view was in
Trash. This avoids returning a partially configured view. Deleting the parent
table permanently also removes its orphaned view snapshots. Empty Trash and the
hourly bounded expiry job permanently remove both record and view snapshots.

## Structural table Trash

The Community table-delete dialog opts into structural Trash with `DELETE
/api/v2/meta/tables/{tableId}?trash=true`. The compatible default remains a
permanent delete. A recoverable delete renames the physical table to a reserved
`nc_trash_<model-id>` name, marks its existing model metadata inactive, and
adds a 30-day Base Trash entry. Rows, fields, views, hooks, and stable metadata
identifiers remain in place. Normal table list/get/data paths exclude inactive
models.

Owners and creators can restore a table through the Base Trash API or dialog.
Restore renames the physical table to its original name and reactivates the
same metadata. It is rejected if an active table has reused the logical title
or if another model reserves the original physical name. Physical names remain
reserved while a table is in Trash because database engines may keep
schema-wide index names when a table is renamed; callers may reuse the logical
title with a different physical name.

This first structural slice accepts ordinary physical tables with no incoming
or outgoing relation fields. It rejects database views, many-to-many junctions,
synced tables, schema-read-only sources, and tables participating in relations.
This conservative boundary avoids partial graph recovery. A source cannot be
detached while it owns trashed tables; restore or permanently delete those
entries first.

Permanent deletion drops the reserved physical table before removing the
preserved metadata. Empty Trash and automatic expiry use the same path. The
metadata and connected database cannot share a distributed transaction, so an
unexpected metadata failure after a successful physical drop can leave an
unrestorable entry that an operator must permanently remove after inspection.

Pre-existing record snapshots are migrated to one-entry groups, so an upgrade
does not discard restorable data. New multi-record requests and filtered
delete-all operations are grouped. Client-side selections larger than the
100-record request limit still form one group per request.

The behavior boundary was derived from NocoDB's public
[Base Trash documentation](https://nocodb.com/docs/product/bases/base-trash).
No post-transition or Enterprise source implementation was used.

## Table Trash UI

Editors and higher roles can open **Trash** from a table's sidebar context
menu. The dialog provides a bounded, paginated list with record previews,
deletion and expiry timestamps, multi-selection, restore, permanent deletion,
and an explicit irreversible-action confirmation. Expired snapshots remain
visible but cannot be selected for restore. Read-only sources do not expose
mutation actions.

Community single-record delete actions opt into Trash across Grid, grouped
Grid, Gallery, Kanban, expanded forms, and related-record dialogs. Grid,
Gallery, and Kanban no longer register the older insert-based transient undo
for an explicit delete because that would leave the durable snapshot behind and
create restore/redo primary-key conflicts. Restore is available from the table
Trash dialog instead. Undoing the creation of a new record remains a permanent
delete so it returns to the pre-insert state without polluting Trash.

Community bulk delete actions also opt into Trash. Selected and range deletes
send at most 100 primary-key selectors per request. Grid and List “select all
matching” deletes use the existing view, filter, and excluded-primary-key
semantics while the server snapshots and deletes matching records in bounded
100-record batches. Explicit bulk deletes no longer register the older
insert-based Undo; recovery is available from the table Trash dialog.

## Automatic expiry cleanup

The Community jobs service permanently removes snapshots after their stored
`expires_at` timestamp and removes a group after its last snapshot. A repeatable
cleanup runs at minute 15 of every hour,
using the metadata index on `expires_at`. It selects at most 500 composite
`base_id`/`id` identifiers at a time and processes at most 10,000 candidates of
each snapshot type in one run. The delete query checks the same fixed cutoff
again, so overlapping workers and concurrent manual deletion are safe and
idempotent. A backlog over either per-type limit is left for the next scheduled
run.

The primary application schedules the repeatable job. With Redis workers, Bull
deduplicates the fixed job identifier and a worker consumes it; without Redis,
the in-process fallback queue uses the same cron expression. Set
`NC_RECORD_TRASH_CLEANUP_DISABLED=true` before startup only when an operator
needs to suspend automatic permanent deletion. Expired snapshots and
structural table entries remain non-restorable while cleanup is disabled.

## Compatible delete opt-in

Existing delete APIs remain permanently deleting by default. Clients can opt a
bounded delete into the same Trash lifecycle without changing the successful
response shape:

- `DELETE /api/v2/tables/{tableId}/records?trash=true` snapshots up to 100
  primary-key selectors before deletion;
- `DELETE /api/v1/db/data/{org}/{base}/{table}/{rowId}?trash=true` does the
  same for a single row;
- the equivalent v1 view-row route also accepts `trash=true`.
- `DELETE /api/v1/db/data/bulk/{org}/{base}/{table}/all?trash=true` snapshots
  every record matching `where` and `viewId`, except `skipPks`, in bounded
  batches before deleting it.

This explicit compatibility switch lets the Community GUI use durable Trash
while existing API integrations retain their current permanent-delete
semantics.

## Snapshot contents

The snapshot retains primary keys and stored, writable table columns, including
physical foreign-key fields. Computed values, virtual links, formulas, lookups,
rollups, QR/barcode/button values, generated row order, and generated
created/modified time/user fields are not copied. Normal create/delete hooks and
audits still run because trash and restore delegate their data mutation to the
existing CRUD services.

New snapshots store a small field-ID-to-deletion-time-title map next to the row
data. Restore projects values through stable field IDs: a renamed field receives
its old value under its current title, while a field deleted after the record
entered Trash is omitted. Snapshots created before this migration keep the
legacy title-based restore behavior.

## Record restore conflicts

Restore preserves every primary-key component and supports three explicit
modes:

- `strict` is the compatible default. If any selected record has a detected
  conflict, no selected row is inserted and every snapshot remains in Trash.
- `clean` restores only records with no detected conflicts. Conflicted records
  remain in Trash.
- `force` restores clean records and clears conflicting optional unique or
  validated fields to `null`. A record with a primary-key conflict, or a
  conflict on a required/system field, remains in Trash.

The table and Base Trash dialogs always run conflict analysis before mutation.
When conflicts exist they present **Cancel**, **Restore clean ones**, and
**Restore anyway** choices, with field-level reasons and an indication of
whether a conflict can be cleared. Responses report `restored`, `skipped`, and
`conflicted` counts. Base-entry restore uses the same modes across bounded
pages; skipped snapshots keep their original grouped Trash entry.

The analysis is advisory across the metadata and user-database boundary. A
concurrent write after preflight can still cause the ordinary database insert
to fail; in that case snapshots are retained.

The first slice restores the record itself. Relationship rows represented only
by virtual link columns and attachment files already removed by an external
storage lifecycle are outside this foundation contract.

## Consistency boundary

The metadata database and a connected user database may be separate systems.
There is therefore no claimed distributed transaction:

1. Trash writes snapshots, then deletes records. A normal deletion failure
   removes the newly written snapshots. A process crash between systems can
   leave both a live row and a snapshot, which is recoverable by permanently
   deleting the snapshot.
2. A filtered bulk Trash operation commits one bounded batch at a time. If a
   later batch fails, earlier batches remain recoverable in Trash and unmatched
   live rows remain untouched.
3. Restore inserts records, then removes snapshots. A process crash between
   systems can likewise leave both copies. A retry fails safely on the existing
   primary key, after which the snapshot can be permanently removed.

This ordering favors a recoverable duplicate over irreversible data loss.
Expired snapshots are not restorable. Structural field Trash remains a
subsequent Phase 5 slice.

Permanently deleting a table also removes that table's trash snapshots. Base
deletion and export/import ordering include the trash metadata table so no
orphan snapshots survive their owning metadata lifecycle.

## API examples

```sh
curl -X POST "$NC_URL/api/v2/tables/$TABLE_ID/trash" \
  -H "xc-token: $NC_TOKEN" \
  -H "content-type: application/json" \
  --data '{"records":[{"Id":7}]}'

curl "$NC_URL/api/v2/tables/$TABLE_ID/trash?limit=25&offset=0" \
  -H "xc-token: $NC_TOKEN"

curl -X POST "$NC_URL/api/v2/tables/$TABLE_ID/trash/restore" \
  -H "xc-token: $NC_TOKEN" \
  -H "content-type: application/json" \
  --data '{"trash_ids":["TRASH_ID"]}'

curl -X POST "$NC_URL/api/v2/tables/$TABLE_ID/trash/conflicts" \
  -H "xc-token: $NC_TOKEN" \
  -H "content-type: application/json" \
  --data '{"trash_ids":["TRASH_ID"]}'

curl -X POST "$NC_URL/api/v2/tables/$TABLE_ID/trash/restore" \
  -H "xc-token: $NC_TOKEN" \
  -H "content-type: application/json" \
  --data '{"trash_ids":["TRASH_ID"],"mode":"force"}'

curl "$NC_URL/api/v2/meta/bases/$BASE_ID/trash?limit=25&offset=0" \
  -H "xc-token: $NC_TOKEN"

curl -X POST "$NC_URL/api/v2/meta/bases/$BASE_ID/trash/$TRASH_ENTRY_ID/restore" \
  -H "xc-token: $NC_TOKEN" \
  -H "content-type: application/json" \
  --data '{"mode":"clean"}'

curl -X DELETE "$NC_URL/api/v2/meta/tables/$TABLE_ID?trash=true" \
  -H "xc-token: $NC_TOKEN"
```
