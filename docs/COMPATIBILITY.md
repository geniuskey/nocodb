# RowWeave compatibility contract

## Scope

RowWeave preserves practical compatibility with the frozen NocoDB AGPL
baseline while developing as an independent product. Compatibility means a
reviewed, tested interface contract; it does not mean source parity with later
NocoDB releases.

The reference point is:

- final modern AGPL commit: `cdcff441b275fbb672fe4bfffb2eb109d3e31497`;
- baseline package version: `0.265.1`;
- nearest modern AGPL release tag: `0.265.1`, at an earlier commit;
- transition boundary: no implementation commit after the baseline is an
  allowed input.

The exact source-history evidence is in `BASELINE_AUDIT.md`.

## Compatibility levels

| Level | Contract | Policy |
| --- | --- | --- |
| Stored data | Existing metadata and user data remain readable and writable | Highest priority; changes require migrations and rollback notes |
| REST APIs | Retained v1/v2/v3 routes, request shapes, and response shapes continue to work | Add contract tests before intentional changes |
| Configuration | Existing `NC_*` environment variables and deployment defaults continue to work | Add `ROWWEAVE_*` aliases only when precedence and diagnostics are defined |
| SDK | The `nocodb-sdk` workspace identity and generated baseline client remain usable | A future RowWeave SDK may wrap it; do not silently republish under an upstream-owned identity |
| Import/export | Baseline exports and documented interchange formats remain supported | Forward imports from later products are accepted only after fixture-based tests |
| UI/bookmarks | Existing application and shared-view routes remain valid | New routes should redirect or coexist instead of breaking saved links |
| Extensions/integrations | Retained public Community contracts remain available | New provider contracts use RowWeave-owned identifiers |

## Identifiers intentionally retained

The following names are technical compatibility identifiers, not RowWeave
branding, and must not be mechanically renamed:

- `nc_*` metadata tables and established columns;
- `/api/v1`, `/api/v2`, `/api/v3`, `/dashboard`, `/nc/view`, and `/nc/form`
  routes;
- `NC_*` environment variables and persisted configuration keys;
- workspace package names such as `nocodb`, `nocodb-sdk`, and `nc-gui` where
  build filters, imports, or consumers depend on them;
- historical migration names, source types, telemetry field names, and import
  discriminators needed to identify NocoDB-format data;
- database version markers already written by the baseline.

Retaining one of these identifiers does not authorize using post-transition
source and does not imply affiliation with NocoDB Inc.

## RowWeave extension rules

New persisted or public interfaces should use RowWeave-owned names unless they
are a backwards-compatible extension of an existing contract.

1. Specify behaviour and provenance before implementation.
2. Prefer additive schemas, optional response fields, and new capability
   endpoints over changing baseline meanings.
3. Add migrations for SQLite, PostgreSQL, and MySQL with explicit downgrade or
   rollback policy.
4. Keep authorization consistent across REST, UI, shares, exports, realtime,
   jobs, scripts, and workflows.
5. Version any new export artifact or asynchronous execution payload.
6. Test upgrades from a real frozen-baseline fixture and a fresh RowWeave
   database.
7. Document intentional incompatibilities in release notes before shipping.

## What is not promised

RowWeave does not currently claim:

- drop-in compatibility with NocoDB `0.300.0` or later;
- support for proprietary or Enterprise metadata, APIs, extensions, packages,
  containers, or exports;
- identical UI, plan gates, cloud services, undocumented endpoints, or internal
  implementation;
- automatic downgrade from a database after a RowWeave-only migration.

Current NocoDB user documentation may be used only as a dated behavioural
reference for independently designed RowWeave features. Later source code,
compiled assets, packages, source maps, and Enterprise implementations remain
outside the development boundary.

## Required verification

Any change touching a retained contract should include the relevant subset of:

```sh
pnpm --filter nocodb-sdk exec jest --runInBand
DB_CLIENT=sqlite3 pnpm --filter nocodb run test:unit
pnpm run build:community
NC_VERIFY_URL=http://127.0.0.1:8080 pnpm run verify:community
```

Database-affecting changes must also run the PostgreSQL and MySQL suites
documented in `BUILDING.md`. API changes must regenerate the SDK from this
repository's API schema and review the generated diff; generated clients from
later NocoDB releases are not valid inputs.
