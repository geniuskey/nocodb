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

The blocking CI starts the production bundle against each metadata database and
runs the same acceptance flow:

1. health endpoint and dashboard load;
2. sign up and sign in;
3. create a Base and its default source;
4. create a table;
5. create, read, update, and delete a record;
6. remove the temporary Base.

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

The complete server-database suites are diagnostic rather than blocking until
the retained failures below are resolved. They must not be represented as
passing by allowing SQLite fallback.

## Windows SQLite failures

The complete suite was run on 2026-08-25 with `DB_CLIENT=sqlite3`. It completed
with 551 passing tests, 21 pending tests, and 5 failures:

1. table and Grid-view CSV export;
2. attachment upload without a token;
3. v3 attachment update from URL and from base64.

The Windows fixture reset no longer fails with `EBUSY`; the remaining failures
overlap with the server-database diagnostics below. Exact output is tracked in
[issue #67](https://github.com/geniuskey/nocodb/issues/67).

## Retained PostgreSQL failures

The complete suite was run on 2026-08-25 against the pinned PostgreSQL image.
It completed with 18 failures:

1. all 11 `Model > BaseModelSql` CRUD and relation tests;
2. `PgErrorExtractorTest > will extract pg substring negative length error`;
3. table and Grid-view CSV export;
4. attachment upload without a token;
5. v3 table-update duplicate-alias validation;
6. v3 attachment update from URL and from base64.

The exact test names and reproduction command are tracked in
[issue #65](https://github.com/geniuskey/nocodb/issues/65).

## Retained MySQL failures

The complete suite was run on 2026-08-25 against the pinned MySQL image with
the empty SQL mode used by the retained Compose configuration. It completed
with 15 failures:

1. nested rollup result type;
2. non-nullable has-many unlink behavior;
3. table and Grid-view CSV export;
4. attachment upload without a token;
5. many-to-many lookup group-by;
6. two aggregation tests;
7. two numerical CRUD tests;
8. three checkbox insert/CRUD tests;
9. v3 attachment update from URL and from base64.

The exact test names and reproduction command are tracked in
[issue #66](https://github.com/geniuskey/nocodb/issues/66).

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
