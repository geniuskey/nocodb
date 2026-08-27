# Database Compatibility Baseline

This document records database behavior observed from the retained AGPL source.
No post-license-transition NocoDB source or Enterprise implementation was used.

## Pinned test databases

| Database   | Image           | Manifest digest                                                           |
| ---------- | --------------- | ------------------------------------------------------------------------- |
| PostgreSQL | `postgres:14.7` | `sha256:5ac16ee311340b09e3670d660c76f77a611202fd07b05d486e934eece99bea7c` |
| MySQL      | `mysql:8.3.0`   | `sha256:9de9d54fecee6253130e65154b930978b1fcc336bcc86dfd06e89b72a2588ebe` |

The Community CI pins both tag and digest. These versions match the retained
AGPL test fixtures. Version upgrades should be separate compatibility changes.

## Required Community acceptance

The blocking CI runs the complete backend suite against SQLite, PostgreSQL,
and MySQL. It also starts the production bundle against each metadata database
and runs the same acceptance flow:

1. health endpoint and dashboard load;
2. sign up and sign in;
3. create a Base and its default source;
4. create a table;
5. create, read, and update a List view;
6. create, read, update, and delete a record;
7. remove the temporary Base.

SQLite, PostgreSQL, and MySQL must all pass this flow. The source-built
Community container is additionally checked with SQLite.

The PostgreSQL and MySQL production-bundle paths were also run locally on
Windows on 2026-08-25 with the pinned images; both completed the full flow.

## Backend unit suite

Run SQLite without first probing for a MySQL server:

```sh
DB_CLIENT=sqlite3 pnpm --filter nocodb run test:unit
```

For a server database, set `DB_REQUIRE_CONNECTION=true`. This makes an
unavailable or incorrectly configured database fail immediately instead of
silently running the suite on SQLite.

PostgreSQL:

```sh
pnpm start:pg
DB_USER=postgres DB_PASSWORD=password DB_HOST=127.0.0.1 DB_PORT=5432 \
  DB_CLIENT=pg DB_REQUIRE_CONNECTION=true \
  pnpm --filter nocodb run test:unit
pnpm stop:pg
```

MySQL:

```sh
pnpm start:mysql
DB_USER=root DB_PASSWORD=password DB_HOST=127.0.0.1 DB_PORT=3306 \
  DB_CLIENT=mysql2 DB_REQUIRE_CONNECTION=true \
  pnpm --filter nocodb run test:unit
pnpm stop:mysql
```

The suite must use `DB_REQUIRE_CONNECTION=true` for a server database. This
prevents a connection problem from being misreported as a passing SQLite run.

## Verified complete-suite results

All three complete backend suites were run locally on Windows on 2026-08-25
from the same checkout and completed without failures:

| Database        | Passing | Pending | Failing |
| --------------- | ------: | ------: | ------: |
| SQLite          |     556 |      21 |       0 |
| PostgreSQL 14.7 |     556 |      21 |       0 |
| MySQL 8.3.0     |     556 |      21 |       0 |

The pending tests are tests intentionally skipped by the retained suite, not
runtime failures. The PostgreSQL and MySQL versions above are the pinned images
listed at the top of this document. MySQL uses the empty SQL mode declared by
the retained test Compose configuration.

## List view slice verification

The independent flat List slice was verified on Windows on 2026-08-26. Its
linked hierarchy extension was verified on 2026-08-27:

| Database/runtime | Scope | Result |
| --- | --- | --- |
| SQLite | Complete backend suite | 558 passing, 21 pending, 0 failing |
| SQLite | Focused `List view foundation` suite with hierarchy, sharing, lifecycle, and roles | 7 passing, 0 failing |
| PostgreSQL 14.7 | Focused `List view foundation` suite with hierarchy, sharing, lifecycle, and roles | 7 passing, 0 failing |
| MySQL 8.3.0 | Focused `List view foundation` suite with hierarchy, sharing, lifecycle, and roles | 7 passing, 0 failing |
| Community Docker image with SQLite | Production HTTP acceptance | Login, Base, table, List metadata, and record CRUD passed |

The hierarchy cases cover Has-Many validation and persistence, field-table
isolation, rejection of non-Has-Many and non-self recursive configuration,
the v2 lazy linked-record endpoint, level cleanup, and bounded self-reference.
The sharing case covers UUID access, password enforcement, hidden-field
projection, sorting, paging, and count. A configured hierarchy is removed from
public List metadata, and generic public linked-record access remains denied.
The lifecycle cases cover rename, lock persistence, deletion, same-table and
same-type duplication of metadata, fields, filters, sorts, and hierarchy with
new identities. Role checks confirm viewer read access and creator lifecycle
management while rejecting viewer metadata mutations.

Run the focused suite against any configured metadata database with:

```sh
DB_CLIENT=<sqlite3|pg|mysql2> DB_REQUIRE_CONNECTION=true \
  pnpm --filter nocodb exec mocha --require @swc-node/register \
  tests/unit/index.test.ts --recursive --timeout 300000 --exit --delay \
  --grep "List view foundation"
```

Omit `DB_REQUIRE_CONNECTION` for SQLite. PostgreSQL and MySQL were tested
against clean containers because the retained PostgreSQL Sakila init directory
contains two schema/data pairs that collide on a fresh Docker volume. That
pre-existing fixture defect does not affect application migrations or the
focused List suite, which creates isolated test databases itself.

## Test-harness portability

The retained fixture loader derived the `tests` directory by replacing the
literal string `tests/unit` in `__dirname`. That works with POSIX separators but
looked for fixtures inside `tests/unit` on Windows. The harness now resolves the
parent directory with the platform path API.

SQLite fixture replacement also requires closing both the harness Knex client
and the cached application source connection. The cleanup path now closes those
exact connections before reseeding, which avoids Windows `EBUSY` failures.

`DB_CLIENT=sqlite3` is also handled as an explicit request. When a server client
is selected, `DB_REQUIRE_CONNECTION=true` prevents a failed database probe from
falling back to SQLite.

Local PostgreSQL metadata sources retain their configured schema/search path
and use a schema-aware connection rather than the global metadata connection.
MySQL metadata and source connections share the same retained value conversion
for buffers, bits, decimals, and one-bit booleans. MySQL percent-unique and
median aggregation queries now use valid MySQL scalar-subquery and window-query
syntax.

Attachment path validation uses platform path semantics, so local-storage
attachments remain within the configured storage root on both Windows and
POSIX systems. Assertions whose ordering or exact database error wording is not
part of the API contract are database-independent while preserving the same
behavioral checks.
