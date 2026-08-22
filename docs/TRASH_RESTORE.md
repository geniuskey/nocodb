# Record Trash and Restore

Phase 5 begins with an opt-in, table-record trash API. Existing record deletion
routes keep their original permanent-delete behavior, so this addition does not
silently change API compatibility for existing clients.

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

The ACL boundary intentionally reuses existing table-data permissions:

- listing requires `dataList`;
- trash and permanent deletion require `dataDelete`;
- restore requires `dataInsert`.

## Table Trash UI

Editors and higher roles can open **Trash** from a table's sidebar context
menu. The dialog provides a bounded, paginated list with record previews,
deletion and expiry timestamps, multi-selection, restore, permanent deletion,
and an explicit irreversible-action confirmation. Expired snapshots remain
visible but cannot be selected for restore. Read-only sources do not expose
mutation actions.

This UI manages records created through the opt-in trash API. Ordinary record
delete actions still use their baseline permanent-delete route until the next
Phase 5 compatibility slice deliberately changes that behavior.

## Compatible delete opt-in

Existing delete APIs remain permanently deleting by default. Clients can opt a
bounded delete into the same Trash lifecycle without changing the successful
response shape:

- `DELETE /api/v2/tables/{tableId}/records?trash=true` snapshots up to 100
  primary-key selectors before deletion;
- `DELETE /api/v1/db/data/{org}/{base}/{table}/{rowId}?trash=true` does the
  same for a single row;
- the equivalent v1 view-row route also accepts `trash=true`.

This explicit compatibility switch lets the Community GUI migrate its delete
surfaces independently while existing API integrations retain their current
permanent-delete semantics. Filtered “delete all” APIs are not yet routed
through Trash because the current snapshot contract is deliberately bounded.

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
2. Restore inserts records, then removes snapshots. A process crash between
   systems can likewise leave both copies. A retry fails safely on the existing
   primary key, after which the snapshot can be permanently removed.

This ordering favors a recoverable duplicate over irreversible data loss.
Expired snapshots are not restorable. Automated expiry cleanup, table/base
metadata trash, richer conflict resolution, and routing ordinary record delete
actions through Trash are subsequent Phase 5 slices.

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
```
