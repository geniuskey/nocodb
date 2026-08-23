# Base Trash and Restore

Phase 5 begins with recoverable record and view deletion. Existing record
deletion routes keep their original permanent-delete behavior unless callers
explicitly opt in, so this addition does not silently change API compatibility
for existing clients.

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

- `GET /api/v2/meta/bases/{baseId}/trash?limit=25&offset=0` returns deletion
  entries newest first. Each record entry includes its table ID and saved name,
  total record count, and at most eight record previews.
- `POST /api/v2/meta/bases/{baseId}/trash/{trashEntryId}/restore` restores all
  remaining records in that operation in bounded batches, or restores the
  deleted view represented by the entry.
- `DELETE /api/v2/meta/bases/{baseId}/trash` permanently empties the base's
  record and view Trash in one metadata transaction.

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
needs to suspend automatic permanent deletion. Expired snapshots remain
non-restorable while cleanup is disabled.

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

Restore preserves every primary-key component. If a live row already uses any
snapshot's primary key, the whole restore request fails with no inserted rows
and leaves all snapshots available for manual conflict resolution.

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
Expired snapshots are not restorable. Structural table/field trash and richer
record conflict resolution are subsequent Phase 5 slices.

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

curl "$NC_URL/api/v2/meta/bases/$BASE_ID/trash?limit=25&offset=0" \
  -H "xc-token: $NC_TOKEN"

curl -X POST "$NC_URL/api/v2/meta/bases/$BASE_ID/trash/$TRASH_ENTRY_ID/restore" \
  -H "xc-token: $NC_TOKEN"
```
