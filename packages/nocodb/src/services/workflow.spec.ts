import {
  boundedWorkflowValue,
  redactHeaders,
  renderWorkflowValue,
  shouldRetryWorkflowHttp,
  validateWorkflowDefinition,
  WORKFLOW_ACTION_HTTP,
  WORKFLOW_ACTION_LOG,
  WORKFLOW_DEFINITION_VERSION,
  WORKFLOW_TRIGGER_MANUAL,
  type WorkflowDefinition,
} from '~/helpers/workflowEngine';

const definition = (
  action: Record<string, any> = {
    id: 'log',
    type: WORKFLOW_ACTION_LOG,
    data: { title: 'Log', config: { message: 'Hello {{ trigger.name }}' } },
  },
): WorkflowDefinition => ({
  definition_version: WORKFLOW_DEFINITION_VERSION,
  nodes: [
    {
      id: 'trigger',
      type: WORKFLOW_TRIGGER_MANUAL,
      data: { title: 'Manual trigger', config: {} },
    },
    action as any,
  ],
  edges: [{ id: 'edge', source: 'trigger', target: action.id }],
});

describe('Community workflow definition', () => {
  it('orders a valid manual trigger and action path', () => {
    expect(
      validateWorkflowDefinition(definition()).map((node) => node.id),
    ).toEqual(['trigger', 'log']);
  });

  it.each([
    [
      'multiple triggers',
      {
        ...definition(),
        nodes: [
          ...definition().nodes,
          {
            id: 'trigger2',
            type: WORKFLOW_TRIGGER_MANUAL,
            data: { title: 'Other trigger' },
          },
        ],
        edges: [
          ...definition().edges,
          { id: 'edge2', source: 'log', target: 'trigger2' },
        ],
      },
    ],
    [
      'a cycle',
      {
        ...definition(),
        edges: [
          { id: 'edge', source: 'trigger', target: 'log' },
          { id: 'back', source: 'log', target: 'trigger' },
        ],
      },
    ],
    [
      'an unsupported node',
      definition({
        id: 'unknown',
        type: 'action.script',
        data: { title: 'Script', config: {} },
      }),
    ],
  ])('rejects %s', (_label, candidate) => {
    expect(() =>
      validateWorkflowDefinition(candidate as WorkflowDefinition),
    ).toThrow();
  });

  it('validates HTTP retry and environment-secret references without storing values', () => {
    const candidate = definition({
      id: 'http',
      type: WORKFLOW_ACTION_HTTP,
      data: {
        title: 'HTTP',
        config: {
          method: 'POST',
          url: 'https://example.com/{{ trigger.path }}',
          retry_attempts: 3,
          secret_headers: [{ name: 'Authorization', secret: 'API_TOKEN' }],
        },
      },
    });
    expect(validateWorkflowDefinition(candidate)).toHaveLength(2);
    expect(JSON.stringify(candidate)).not.toContain('Bearer');
  });

  it('rejects invalid secret identifiers', () => {
    expect(() =>
      validateWorkflowDefinition(
        definition({
          id: 'http',
          type: WORKFLOW_ACTION_HTTP,
          data: {
            title: 'HTTP',
            config: {
              url: 'https://example.com',
              secret_headers: [
                { name: 'Authorization', secret: '../../PRIVATE_KEY' },
              ],
            },
          },
        }),
      ),
    ).toThrow(/secret names/i);
  });

  it('requires sensitive HTTP headers to use environment-secret references', () => {
    expect(() =>
      validateWorkflowDefinition(
        definition({
          id: 'http',
          type: WORKFLOW_ACTION_HTTP,
          data: {
            title: 'HTTP',
            config: {
              url: 'https://example.com',
              headers: [{ name: 'Authorization', value: 'Bearer plaintext' }],
            },
          },
        }),
      ),
    ).toThrow(/secret reference/i);
  });

  it.each([
    [{ name: 'X-Header\r\nInjected', value: 'value' }, /header names/i],
    [{ name: 'X-Header', value: 'value\r\nInjected: true' }, /header values/i],
  ])('rejects unsafe HTTP header input', (header, message) => {
    expect(() =>
      validateWorkflowDefinition(
        definition({
          id: 'http',
          type: WORKFLOW_ACTION_HTTP,
          data: {
            title: 'HTTP',
            config: { url: 'https://example.com', headers: [header] },
          },
        }),
      ),
    ).toThrow(message);
  });

  it('rejects credentials embedded in HTTP URLs', () => {
    expect(() =>
      validateWorkflowDefinition(
        definition({
          id: 'http',
          type: WORKFLOW_ACTION_HTTP,
          data: {
            title: 'HTTP',
            config: { url: 'https://user:password@example.com/hook' },
          },
        }),
      ),
    ).toThrow(/cannot contain credentials/i);
  });
});

describe('Community workflow runtime boundaries', () => {
  it('renders trigger and previous node output variables', () => {
    expect(
      renderWorkflowValue(
        {
          greeting: 'Hello {{ trigger.name }}',
          id: '{{ nodes.first.output.id }}',
        },
        {
          trigger: { name: 'Ada' },
          nodes: { first: { output: { id: 42 } } },
        },
      ),
    ).toEqual({ greeting: 'Hello Ada', id: '42' });
  });

  it('redacts credentials and response cookies by header name', () => {
    expect(
      redactHeaders({
        Authorization: 'Bearer secret',
        'Set-Cookie': 'session=secret',
        'Content-Type': 'application/json',
      }),
    ).toEqual({
      Authorization: '[REDACTED]',
      'Set-Cookie': '[REDACTED]',
      'Content-Type': 'application/json',
    });
  });

  it('bounds persisted action output', () => {
    expect(boundedWorkflowValue({ payload: 'x'.repeat(100) }, 20)).toEqual(
      expect.objectContaining({ truncated: true, original_length: 114 }),
    );
  });

  it('retries network, throttling, and server errors only', () => {
    expect(shouldRetryWorkflowHttp(new Error('network'))).toBe(true);
    expect(shouldRetryWorkflowHttp({ response: { status: 429 } })).toBe(true);
    expect(shouldRetryWorkflowHttp({ response: { status: 503 } })).toBe(true);
    expect(shouldRetryWorkflowHttp({ response: { status: 400 } })).toBe(false);
  });
});
