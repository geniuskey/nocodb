import Handlebars from 'handlebars';

export const WORKFLOW_DEFINITION_VERSION = 1;
export const WORKFLOW_TRIGGER_MANUAL = 'trigger.manual';
export const WORKFLOW_ACTION_LOG = 'action.log';
export const WORKFLOW_ACTION_HTTP = 'action.http';

export const WORKFLOW_NODE_TYPES = [
  WORKFLOW_TRIGGER_MANUAL,
  WORKFLOW_ACTION_LOG,
  WORKFLOW_ACTION_HTTP,
] as const;

export interface WorkflowNode {
  id: string;
  type: (typeof WORKFLOW_NODE_TYPES)[number];
  position?: { x: number; y: number };
  data: {
    title: string;
    config?: Record<string, any>;
  };
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
}

export interface WorkflowDefinition {
  definition_version: number;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface HttpActionConfig {
  method?: string;
  url: string;
  headers?: Array<{ name: string; value: string }>;
  secret_headers?: Array<{ name: string; secret: string }>;
  body?: unknown;
  timeout_ms?: number;
  retry_attempts?: number;
}

const workflowHandlebars = Handlebars.create();
workflowHandlebars.registerHelper('json', (value: unknown) =>
  JSON.stringify(value),
);

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (!condition) throw new Error(message);
};

export const isSensitiveHeader = (name: string) =>
  /authorization|cookie|token|secret|api[-_]?key/i.test(name);

const validateHeaderList = (headers: unknown, kind: 'value' | 'secret') => {
  if (headers === undefined) return;
  assert(Array.isArray(headers), 'Workflow HTTP headers must be an array');
  assert(
    headers.length <= 20,
    'Workflow HTTP actions support at most 20 headers',
  );
  for (const header of headers) {
    assert(
      header && typeof header.name === 'string' && header.name.trim(),
      'Workflow HTTP header names are required',
    );
    assert(
      header.name.length <= 128,
      'Workflow HTTP header names are too long',
    );
    assert(
      /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(header.name),
      'Workflow HTTP header names contain invalid characters',
    );
    if (kind === 'value') {
      assert(
        !isSensitiveHeader(header.name),
        `Sensitive workflow HTTP header ${header.name} must use a secret reference`,
      );
      assert(
        typeof header.value === 'string' &&
          header.value.length <= 8_192 &&
          !/[\r\n]/.test(header.value),
        'Workflow HTTP header values must be strings up to 8192 characters',
      );
    } else {
      assert(
        typeof header.secret === 'string' &&
          /^[A-Z][A-Z0-9_]{0,63}$/.test(header.secret),
        'Workflow secret names must use uppercase letters, digits, and underscores',
      );
    }
  }
};

export function validateWorkflowDefinition(
  definition: WorkflowDefinition,
): WorkflowNode[] {
  assert(
    definition?.definition_version === WORKFLOW_DEFINITION_VERSION,
    `Unsupported workflow definition version`,
  );
  assert(Array.isArray(definition.nodes), 'Workflow nodes must be an array');
  assert(Array.isArray(definition.edges), 'Workflow edges must be an array');
  assert(
    definition.nodes.length >= 2 && definition.nodes.length <= 50,
    'A workflow must contain one trigger and between 1 and 49 actions',
  );
  assert(
    definition.edges.length === definition.nodes.length - 1,
    'Workflow foundation graphs must form one linear path',
  );

  const nodes = new Map<string, WorkflowNode>();
  for (const node of definition.nodes) {
    assert(
      typeof node?.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(node.id),
      'Workflow node IDs must contain only letters, digits, underscores, or hyphens',
    );
    assert(!nodes.has(node.id), `Duplicate workflow node ID: ${node.id}`);
    assert(
      WORKFLOW_NODE_TYPES.includes(node.type),
      `Unsupported workflow node type: ${node.type}`,
    );
    assert(
      typeof node.data?.title === 'string' &&
        node.data.title.trim().length > 0 &&
        node.data.title.length <= 120,
      `Workflow node ${node.id} requires a title up to 120 characters`,
    );

    const config = node.data.config || {};
    if (node.type === WORKFLOW_ACTION_LOG) {
      assert(
        typeof config.message === 'string' && config.message.length <= 4_000,
        'Log actions require a message up to 4000 characters',
      );
    }
    if (node.type === WORKFLOW_ACTION_HTTP) {
      const http = config as HttpActionConfig;
      assert(
        typeof http.url === 'string' &&
          http.url.trim().length > 0 &&
          http.url.length <= 2_048,
        'HTTP actions require a URL up to 2048 characters',
      );
      assert(
        !/^https?:\/\/[^/\s]*@/i.test(http.url.trim()),
        'Workflow HTTP URLs cannot contain credentials',
      );
      assert(
        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(
          String(http.method || 'POST').toUpperCase(),
        ),
        'Unsupported workflow HTTP method',
      );
      validateHeaderList(http.headers, 'value');
      validateHeaderList(http.secret_headers, 'secret');
      assert(
        JSON.stringify(http.body ?? null).length <= 32_000,
        'Workflow HTTP request bodies cannot exceed 32000 characters',
      );
      assert(
        http.timeout_ms === undefined ||
          (Number.isInteger(http.timeout_ms) &&
            http.timeout_ms >= 1_000 &&
            http.timeout_ms <= 30_000),
        'Workflow HTTP timeout must be between 1000 and 30000 milliseconds',
      );
      assert(
        http.retry_attempts === undefined ||
          (Number.isInteger(http.retry_attempts) &&
            http.retry_attempts >= 1 &&
            http.retry_attempts <= 3),
        'Workflow HTTP retry attempts must be between 1 and 3',
      );
    }
    nodes.set(node.id, node);
  }

  const triggers = definition.nodes.filter(
    (node) => node.type === WORKFLOW_TRIGGER_MANUAL,
  );
  assert(
    triggers.length === 1,
    'A workflow must contain exactly one manual trigger',
  );

  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string>();
  const edgeIds = new Set<string>();
  for (const edge of definition.edges) {
    assert(
      typeof edge?.id === 'string' &&
        edge.id.length > 0 &&
        edge.id.length <= 64,
      'Workflow edge IDs are required',
    );
    assert(!edgeIds.has(edge.id), `Duplicate workflow edge ID: ${edge.id}`);
    edgeIds.add(edge.id);
    assert(
      nodes.has(edge.source),
      `Workflow edge source is missing: ${edge.source}`,
    );
    assert(
      nodes.has(edge.target),
      `Workflow edge target is missing: ${edge.target}`,
    );
    assert(edge.source !== edge.target, 'Workflow self edges are not allowed');
    assert(
      !outgoing.has(edge.source),
      'Workflow foundation nodes support one outgoing edge',
    );
    outgoing.set(edge.source, edge.target);
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
    assert(
      incoming.get(edge.target) === 1,
      'Workflow foundation nodes support one incoming edge',
    );
  }

  const trigger = triggers[0];
  assert(
    !incoming.has(trigger.id),
    'The workflow trigger cannot have an incoming edge',
  );
  const ordered: WorkflowNode[] = [];
  const visited = new Set<string>();
  let current: WorkflowNode | undefined = trigger;
  while (current) {
    assert(!visited.has(current.id), 'Workflow cycles are not allowed');
    visited.add(current.id);
    ordered.push(current);
    const nextId = outgoing.get(current.id);
    current = nextId ? nodes.get(nextId) : undefined;
  }
  assert(
    ordered.length === definition.nodes.length,
    'Every workflow node must be reachable from the trigger',
  );
  assert(
    ordered.slice(1).every((node) => node.type !== WORKFLOW_TRIGGER_MANUAL),
    'Trigger nodes can only appear at the start of a workflow',
  );
  return ordered;
}

export function renderWorkflowValue<T>(value: T, context: unknown): T {
  if (typeof value === 'string') {
    return workflowHandlebars.compile(value, {
      noEscape: true,
      strict: true,
    })(context) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => renderWorkflowValue(item, context)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        renderWorkflowValue(item, context),
      ]),
    ) as T;
  }
  return value;
}

export function redactHeaders(headers: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(headers || {}).map(([name, value]) => [
      name,
      isSensitiveHeader(name) ? '[REDACTED]' : value,
    ]),
  );
}

export function boundedWorkflowValue(value: unknown, maxLength = 32_000) {
  const serialized = JSON.stringify(value ?? null);
  if (serialized.length <= maxLength) return value;
  return {
    truncated: true,
    preview: serialized.slice(0, maxLength),
    original_length: serialized.length,
  };
}

export const shouldRetryWorkflowHttp = (error: any) => {
  const status = Number(error?.response?.status || 0);
  return !status || status === 408 || status === 429 || status >= 500;
};
