# Base Snapshots

Base Snapshot is an independently designed Community feature built only from
the frozen AGPL baseline, general database engineering practice, and publicly
documented user-facing behavior. No post-transition or Enterprise source was
used. The public behavior reference was NocoDB's
[Base snapshots documentation](https://nocodb.com/docs/product-docs/bases/snapshots):
a point-in-time copy that restores into a new Base without changing the
original. Commercial plan limits and cooldowns are not part of this fork's
design.

## Snapshot boundary

Creating a Snapshot acquires a time-bounded Base capture lock. While that lock
is active, authenticated HTTP write requests for the source Base are rejected
and reads continue normally. The existing Community duplicate pipeline copies
the Base schema and records into a protected storage Base, after which a
versioned manifest records the application version and each table's field and
record counts.

The lock makes application-originated writes quiescent for the capture. It is
not a database-engine backup transaction: direct changes made outside NocoDB,
or writes made independently to an externally connected database, are outside
the lock. Multi-source Bases are copied source by source and therefore do not
have a single cross-database transaction boundary. Use a database-native backup
when physical, transaction-level recovery is required.

The capture timeout is 360 minutes by default. Set
`NC_SNAPSHOT_CAPTURE_TIMEOUT_MINUTES` to an integer from 5 through 1440 to
change the stale-lock recovery window. An expired lock can be replaced by a new
operation.

## Storage and exclusions

Format version 1 stores the captured data in an ordinary Community Base marked
`is_snapshot`. This protected Base:

- is omitted from normal Base reads and lists;
- has no user membership;
- is not exposed as a user-editable Base; and
- is deleted permanently with the Snapshot or its source Base.

The `nc_snapshots` row is the catalog and compatibility record. Its JSON
manifest is validation metadata, not the data backup itself. `nc_snapshot_locks`
contains only short-lived operation locks.

The Community duplicate pipeline intentionally excludes Base users. Audit and
revision history, Base permissions, shared-Base credentials, and shared views
are not restored. Snapshot storage is distinct from Trash: deleting a Snapshot
does not create a Trash entry and cannot be undone.

## Restore and validation

Restore never overwrites the source Base. It validates the catalog row,
supported format version, protected storage identity, and current table field
and record counts before queuing a copy into a newly created Base. If validation
or copying fails, the incomplete target is removed and the protected Snapshot
remains available with an error message.

This first Community format restores only within the source workspace. The API
accepts `target_workspace_id` so the contract can evolve, but rejects another
workspace until Community workspace membership and cross-workspace duplication
have a complete authorization model.

## API

All routes require the existing owner-level `manageSnapshot` permission.

```text
GET    /api/v2/meta/bases/{baseId}/snapshots
POST   /api/v2/meta/bases/{baseId}/snapshots
POST   /api/v2/meta/bases/{baseId}/snapshots/{snapshotId}/restore
DELETE /api/v2/meta/bases/{baseId}/snapshots/{snapshotId}
```

Create accepts an optional `title` and returns the queued job ID plus
`snapshot_id`. Restore accepts an optional `title` and
`target_workspace_id`, then returns the job ID and new `base_id`. List reports
`creating`, `restoring`, `ready`, or `failed`, along with `job_id`, validation
metadata, timestamps, and any bounded error message. The Base settings Snapshot
tab uses the same API and job progress stream.

## Recovery verification

The Community browser workflow creates a Snapshot, changes the original after
capture, restarts the application, restores into a new Base, and verifies that
the post-capture record exists only in the original. It also verifies that the
protected storage Base never appears in ordinary Base lists and that permanent
Snapshot deletion empties the catalog. The backend smoke suite separately
checks manifest compatibility rejection.
