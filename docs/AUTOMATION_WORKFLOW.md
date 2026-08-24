# Automation Workflow Foundation

This Community workflow engine is independently designed from the frozen AGPL
baseline, general queue/database engineering practice, and public user-facing
behavior. No post-transition or Enterprise source code was inspected or used.
The behavior references are the public NocoDB documentation for
[workflow building](https://nocodb.com/docs/product-docs/automation/workflow/create-workflow),
[workflow operations and execution logs](https://nocodb.com/docs/product-docs/automation/workflow/actions-on-workflow),
and [HTTP webhook actions](https://nocodb.com/docs/product-docs/automation/webhook/create-webhook).
Commercial implementation details, plan enforcement, and source structure are
not implementation references.

## Foundation scope

Definition format version 1 deliberately implements a bounded foundation:

- exactly one manual or record-created trigger;
- one linear, acyclic path of up to 49 actions;
- durable log-message and HTTP-request actions;
- versioned workflow definition snapshots for every execution;
- persistent execution and per-node status, input, output, attempt, and error;
- API-level idempotency keys;
- one active execution per workflow with stale-lock recovery;
- bounded HTTP retry, timeout, response capture, and error reporting; and
- a Base Overview GUI for create, edit, enable, run, inspect, and delete.

Record-updated/deleted and form-specific triggers, schedules, conditions,
branching, iteration, record actions, cancellation, and higher concurrency are
not silently simulated. They are future format extensions and will require
their own migrations, validation, tests, and documentation.

## Definition contract

The graph is stored in the existing AGPL-baseline `nc_workflows` table. A
definition has `definition_version: 1`, a `nodes` array, and an `edges` array.
Allowed node types are:

```text
trigger.manual
trigger.record.created
action.log
action.http
```

The validator requires one trigger, unique bounded identifiers, supported node
configuration, a single incoming/outgoing edge per node, no cycles, and full
reachability from the trigger. Unsupported graphs fail closed instead of being
partially executed.

Templates use Handlebars syntax. Manual input is available through
`{{ trigger.field }}`. A record-created trigger exposes `event`, `table_id`,
`view_id`, `record`, `records`, and `count`; for example,
`{{ trigger.record.Title }}`. A completed action is available to later nodes
through `{{ nodes.node_id.output.field }}`. The `json` helper serializes
structured values.

The record-created trigger subscribes to the retained Community data hook after
the insert transaction commits. It is scoped to one table selected in the
workflow definition. A single insert produces one execution, while one bulk
insert produces one execution whose `records` array contains the committed
records and whose `record` value is the first record. The event listener is
isolated from the CRUD response path: dispatch failures are logged and do not
roll back an already committed insert.

Definition updates verify that the selected table belongs to the current base.
The manual trigger endpoint rejects record-triggered workflows. If an automated
event arrives while that workflow's single execution lock is held, a finished
error execution is persisted instead of silently dropping the event.

## Durable execution and recovery

Triggering creates an `nc_workflow_executions` row before queue submission and
stores an immutable snapshot of the selected definition. Each node writes an
`nc_workflow_execution_nodes` row before executing. Application restart does
not erase completed execution history.

The caller may send `Idempotency-Key` or `idempotency_key`. Repeating the same
key for the same workflow returns the existing execution and does not enqueue a
second run. A database unique constraint is the final race boundary.

`nc_workflow_locks` enforces one active run per workflow in format version 1.
The worker renews its lock before every node and HTTP attempt. Locks expire 15
minutes after the last renewal so an unclean process exit cannot block the
workflow indefinitely; a worker that loses its lock fails closed. The execution
row remains the durable diagnostic record if a process dies; automatic
queued/running reconciliation is planned with cancellation and scheduler work.

## HTTP and secrets boundary

HTTP actions support GET, POST, PUT, PATCH, DELETE, and HEAD. Timeout is bounded
to 1–30 seconds. An action can make at most three attempts; only network errors,
HTTP 408/429, and 5xx responses are retried with a short exponential backoff.
Application queues remain the execution transport, while execution rows are the
source of user-visible status.

Private-network requests are blocked through the retained Community
request-filtering agent unless the operator explicitly sets
`NC_ALLOW_LOCAL_HOOKS=true`. Redirect scanning remains enabled. Response bodies
are bounded before persistence, and credential/cookie/token-like response and
request headers are redacted from node logs.

Secret values are never accepted in `secret_headers`. A workflow stores only an
uppercase secret reference such as `API_TOKEN`; the worker resolves its value
from `NC_WORKFLOW_SECRET_API_TOKEN` at execution time. Missing secrets fail the
node without echoing a value. Plain custom headers remain available for
non-sensitive metadata. Credential-like plain headers such as `Authorization`,
cookies, tokens, secrets, and API keys are rejected and must use secret
references.

## API

All endpoints require the existing Creator/Owner-level `manageWorkflow`
permission.

```text
GET    /api/v2/meta/bases/{baseId}/workflows
POST   /api/v2/meta/bases/{baseId}/workflows
GET    /api/v2/meta/bases/{baseId}/workflows/{workflowId}
PATCH  /api/v2/meta/bases/{baseId}/workflows/{workflowId}
DELETE /api/v2/meta/bases/{baseId}/workflows/{workflowId}
POST   /api/v2/meta/bases/{baseId}/workflows/{workflowId}/trigger
GET    /api/v2/meta/bases/{baseId}/workflows/{workflowId}/executions
GET    /api/v2/meta/bases/{baseId}/workflows/{workflowId}/executions/{executionId}
```

Deleting a workflow permanently deletes its execution history and is rejected
while an execution lock is active.

## Next independent slices

1. Record-updated/deleted triggers using Community application events.
2. Condition evaluation and explicit if/else graph ports.
3. Scheduled triggers and startup reconciliation for interrupted executions.
4. Community record create/update/find/list actions.
5. Iterate, bounded fan-out, cancellation, and configurable concurrency.

Phase 8 scripts remain out of scope until a separate sandbox and authorization
boundary is designed and verified.
