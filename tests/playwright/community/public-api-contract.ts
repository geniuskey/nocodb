import { expect, type Page } from '@playwright/test';

type JsonObject = Record<string, unknown>;

interface JsonSchema {
  properties: Record<string, JsonSchema>;
  required: string[];
  type: string;
}

interface OpenApiDocument {
  components: {
    schemas: Record<string, JsonSchema>;
    securitySchemes: Record<string, JsonObject>;
  };
  info: { version: string };
  openapi: string;
  paths: Record<string, JsonObject>;
}

interface PublicApiVersion {
  collectionOperations: string[];
  collectionPath: (baseId: string, tableId: string) => string;
  docsPath: (baseId: string) => string;
  itemPath: (baseId: string, tableId: string) => string;
  itemOperations: string[];
  openapi: string;
  version: string;
}

const publicApiVersions: PublicApiVersion[] = [
  {
    version: '1.0',
    openapi: '3.0.0',
    collectionOperations: ['get', 'post'],
    itemOperations: ['get', 'patch', 'delete'],
    docsPath: baseId => `/api/v1/db/meta/projects/${baseId}/swagger.json`,
    collectionPath: (baseId, tableId) => `/api/v1/db/data/v1/${baseId}/${tableId}`,
    itemPath: (baseId, tableId) => `/api/v1/db/data/v1/${baseId}/${tableId}/{rowId}`,
  },
  {
    version: '2.0',
    openapi: '3.0.0',
    collectionOperations: ['get', 'post', 'patch', 'delete'],
    itemOperations: ['get'],
    docsPath: baseId => `/api/v2/meta/bases/${baseId}/swagger.json`,
    collectionPath: (_baseId, tableId) => `/api/v2/tables/${tableId}/records`,
    itemPath: (_baseId, tableId) => `/api/v2/tables/${tableId}/records/{recordId}`,
  },
  {
    version: '3.0',
    openapi: '3.1.0',
    collectionOperations: ['get', 'post', 'patch', 'delete'],
    itemOperations: ['get'],
    docsPath: baseId => `/api/v3/meta/bases/${baseId}/swagger.json`,
    collectionPath: (baseId, tableId) => `/api/v3/data/${baseId}/${tableId}/records`,
    itemPath: (baseId, tableId) => `/api/v3/data/${baseId}/${tableId}/records/{recordId}`,
  },
];

const expectOperations = (path: JsonObject, operations: string[]) => {
  for (const operation of operations) {
    expect(path, `missing ${operation.toUpperCase()} operation`).toHaveProperty(operation);
  }
};

const expectSecuritySchemes = (document: OpenApiDocument) => {
  expect(document.components.securitySchemes.xcToken).toEqual(
    expect.objectContaining({
      type: 'apiKey',
      in: 'header',
      name: 'xc-token',
    })
  );
  expect(document.components.securitySchemes.bearerAuth).toEqual(
    expect.objectContaining({
      type: 'http',
      scheme: 'bearer',
    })
  );
};

const expectTaskSchemas = (document: OpenApiDocument, version: string) => {
  const request = document.components.schemas.TasksRequest;
  const response = document.components.schemas.TasksResponse;

  expect(request).toEqual(expect.objectContaining({ type: 'object' }));
  expect(response).toEqual(expect.objectContaining({ type: 'object' }));

  if (version === '3.0') {
    expect(request.required).toContain('fields');
    expect(request.properties.fields.properties).toHaveProperty('Title');
    expect(response.required).toContain('id');
    expect(response.properties.fields.properties).toHaveProperty('Title');
  } else {
    expect(request.properties).toHaveProperty('Title');
    expect(response.properties).toHaveProperty('Title');
  }
};

export async function expectPublicApiContract(page: Page, baseId: string, tableId: string) {
  const token = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('nocodb-gui-v2') ?? '{}') as { token?: unknown };
    return typeof state.token === 'string' ? state.token : '';
  });

  expect(token).toEqual(expect.any(String));
  expect(token.length).toBeGreaterThan(0);

  for (const api of publicApiVersions) {
    const response = await page.request.get(api.docsPath(baseId), {
      headers: { 'xc-auth': token },
    });
    expect(response.ok(), `OpenAPI ${api.version} document request failed`).toBeTruthy();

    const document = (await response.json()) as OpenApiDocument;
    expect(document.openapi).toBe(api.openapi);
    expect(document.info.version).toBe(api.version);
    expectSecuritySchemes(document);

    const collectionPath = document.paths[api.collectionPath(baseId, tableId)];
    const itemPath = document.paths[api.itemPath(baseId, tableId)];
    expect(collectionPath, `OpenAPI ${api.version} table path is missing`).toBeDefined();
    expect(itemPath, `OpenAPI ${api.version} record path is missing`).toBeDefined();
    expectOperations(collectionPath, api.collectionOperations);
    expectOperations(itemPath, api.itemOperations);
    expectTaskSchemas(document, api.version);
  }
}
