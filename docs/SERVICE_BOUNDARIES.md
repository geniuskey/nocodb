# Backend Service Boundaries

This document defines the fork-owned backend dependency policy used for
modernization and new feature work. It describes the retained AGPL Community
tree; it is not derived from any later NocoDB implementation.

## Dependency direction

```text
SDK / HTTP contracts
          |
          v
Transport (controllers, guards, request context)
          |
          v
Application services (authorization-aware use cases and orchestration)
       /        |          \
      v         v           v
Metadata     Data engine   Adapters / jobs
models/meta  db/query      providers/integrations
                 |
                 v
        SQL dialect implementations
```

Dependencies flow downward. Results and domain values may flow back upward,
but a lower layer must not import a controller. Cross-cutting events are
published through an application-owned interface rather than by importing an
application service from the data engine.

## Layer responsibilities

### Contracts

`packages/nocodb-sdk/src`, `packages/nocodb/src/schema`, and the request/response
types under `packages/nocodb/src/interface` define public and internal
contracts. Public API changes begin here and require compatibility tests. A
contract must not depend on a NestJS controller or a concrete database driver.

### Transport

Files ending in `.controller.ts`, plus guards, decorators, interceptors, and
request-context middleware, form the transport layer. Controllers own route
mapping, parameter extraction, guard/ACL selection, response status/headers,
and delegation to one application service. New runtime imports from `models`,
`meta`, `db`, `dbQueryClient`, `Noco`, Knex, or a concrete database driver are
forbidden. Type-only domain imports remain allowed.

### Application services

`packages/nocodb/src/services` contains use cases. Services resolve tenant and
authorization context, validate inputs, coordinate metadata and record
operations, publish application events, and select transaction boundaries.
They may call other services deliberately, but they must not depend on
controllers. A controller-specific response shape should be mapped at the
transport edge or represented by a shared contract.

### Metadata domain and persistence

`packages/nocodb/src/models` and `packages/nocodb/src/meta` own metadata
entities, caches, metadata persistence, and schema migration execution. These
directories must not import application services or controllers. New schema
changes are append-only migrations protected by `MIGRATION_MANIFEST.json` and
the upgrade matrix.

### Record data engine

`packages/nocodb/src/db` and `packages/nocodb/src/dbQueryClient` implement
record querying, relation handling, formula translation, mutation mechanics,
and dialect-neutral SQL behavior. Dialect packages/adapters provide concrete
database behavior. The engine must not know about HTTP controllers and must not
gain new imports from application services. Existing webhook and telemetry
callbacks are recorded debt and should be replaced with lower-level ports or
returned events when those paths are next changed.

### Adapters and asynchronous work

Providers, plugins, Community integration interfaces, queues, and jobs adapt
external systems. Application services invoke them through explicit
interfaces. Adapters do not become an alternate route around authorization,
metadata services, or the record data engine.

## Canonical record and view flow

The retained v2 record flow is the starting point for new open views:

1. `DataTableController` owns the `/api/v2/tables/:modelId/...` transport and
   calls `DataTableService`.
2. `DataTableService` resolves the `Model` and optional `View`, then delegates
   list behavior to `DatasService` or record operations to the data engine.
3. `DatasService` applies the shared query/filter/sort/pagination semantics.
4. `Model.getBaseModelSQL` and `BaseModelSqlv2` execute dialect-neutral record
   operations using the selected connection adapter.
5. API v3 uses `DataV3Service` for v3 identifiers and response mapping while
   reusing the same model/view resolution and data engine.

`ViewsService` owns general view lifecycle metadata. Grid, Form, Gallery,
Kanban, Calendar, and future view-specific services own only their companion
configuration. A view type must not create a parallel CRUD/query engine.

## Placement rules for List, Timeline, and Gantt

- Add public enums/types and API schemas to the SDK/contracts first.
- Put create/update/read semantics for view metadata in a view-specific
  application service and retained metadata models.
- Reuse `DataTableService`/`DatasService` for filtering, sorting, field
  projection, pagination, and record mutation.
- Add a focused data-engine primitive only when the shared engine cannot
  express a bounded range/group query. Keep it view-agnostic where practical.
- Keep date-range layout, virtualization, drag previews, and interaction state
  in the frontend. The backend owns validated persisted changes, permissions,
  concurrency behavior, and bounded queries.
- Gantt dependency and scheduling concepts must use independently authored
  contracts and migrations; they do not justify reading excluded source.

## Enforced legacy debt

`SERVICE_BOUNDARY_EXCEPTIONS.json` records the exact runtime edges that violate
the desired direction at establishment commit
`d344a5d15236568d5fbec0b7caa060fca8b1b8f4`:

- 18 transport-to-persistence edges.
- 3 data-engine-to-application edges.
- 0 domain-to-application edges.
- 0 lower-layer-to-transport edges.

`pnpm run check:service-boundaries` requires the source tree to match that
inventory, including the exact runtime bindings imported on each edge. In CI,
`--against <base-revision>` makes the exception lists removal-only. Paying down
an edge requires moving the behavior behind the appropriate service/port and
deleting its exception in the same change. New exceptions are not an extension
mechanism.

## Review checklist

- Does each controller delegate persistence and record work to a service?
- Is tenant/ACL context preserved at the application boundary?
- Does a new view reuse shared record query and mutation semantics?
- Is database-specific behavior isolated below the data engine contract?
- Are public contract changes versioned and characterized by tests?
- Are migrations append-only and covered by an upgrade fixture?
- Does the boundary checker pass without adding an exception?
