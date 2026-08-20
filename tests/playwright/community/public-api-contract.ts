import { type APIResponse, expect, type Page } from '@playwright/test';

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

interface FlatRecord {
  Id: number | string;
  Title: string;
}

interface FlatRecordList {
  list: FlatRecord[];
}

interface V3Record {
  fields: { Title: string };
  id: number | string;
}

interface V3RecordList {
  records: V3Record[];
}

interface ApiToken {
  id: number | string;
  token: string;
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

export const getAuthToken = async (page: Page) => {
  const token = await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('nocodb-gui-v2') ?? '{}') as { token?: unknown };
    return typeof state.token === 'string' ? state.token : '';
  });

  expect(token).toEqual(expect.any(String));
  expect(token.length).toBeGreaterThan(0);
  return token;
};

const expectJsonResponse = async <T>(response: APIResponse, operation: string): Promise<T> => {
  expect(response.ok(), `${operation} failed with HTTP ${response.status()}`).toBeTruthy();
  return (await response.json()) as T;
};

const expectFlatApiCrud = async (
  page: Page,
  token: string,
  collectionPath: string,
  itemPath: (recordId: number | string) => string,
  updatePath: (recordId: number | string) => string,
  deletePath: (recordId: number | string) => string,
  updateBody: (recordId: number | string, title: string) => JsonObject,
  deleteBody: (recordId: number | string) => JsonObject | undefined,
  version: string
) => {
  const headers = { 'xc-token': token };
  const created = await expectJsonResponse<FlatRecord>(
    await page.request.post(collectionPath, {
      headers,
      data: { Title: `Public API ${version}` },
    }),
    `public API ${version} create`
  );
  expect(created.Id).toEqual(expect.anything());

  const updatedTitle = `Public API ${version} updated`;
  await expectJsonResponse<JsonObject>(
    await page.request.patch(updatePath(created.Id), {
      headers,
      data: updateBody(created.Id, updatedTitle),
    }),
    `public API ${version} update`
  );

  const read = await expectJsonResponse<FlatRecord>(
    await page.request.get(itemPath(created.Id), { headers }),
    `public API ${version} read`
  );
  expect(read.Id).toBe(created.Id);
  expect(read.Title).toBe(updatedTitle);

  const list = await expectJsonResponse<FlatRecordList>(
    await page.request.get(collectionPath, { headers }),
    `public API ${version} list`
  );
  expect(list.list).toEqual(expect.arrayContaining([expect.objectContaining({ Id: created.Id, Title: updatedTitle })]));

  await expectJsonResponse<JsonObject>(
    await page.request.delete(deletePath(created.Id), {
      headers,
      data: deleteBody(created.Id),
    }),
    `public API ${version} delete`
  );

  const afterDelete = await expectJsonResponse<FlatRecordList>(
    await page.request.get(collectionPath, { headers }),
    `public API ${version} list after delete`
  );
  expect(afterDelete.list).not.toEqual(expect.arrayContaining([expect.objectContaining({ Id: created.Id })]));
};

export async function expectPublicApiContract(page: Page, baseId: string, tableId: string) {
  const token = await getAuthToken(page);

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

export async function expectPublicApiRuntimeCrud(page: Page, baseId: string, tableId: string) {
  const sessionToken = await getAuthToken(page);
  const apiToken = await expectJsonResponse<ApiToken>(
    await page.request.post(`/api/v1/db/meta/projects/${baseId}/api-tokens`, {
      headers: { 'xc-auth': sessionToken },
      data: { description: 'Community public API acceptance' },
    }),
    'public API token create'
  );
  expect(apiToken.id).toEqual(expect.anything());
  expect(apiToken.token).toEqual(expect.any(String));
  expect(apiToken.token.length).toBeGreaterThan(0);

  const v1Collection = `/api/v1/db/data/v1/${baseId}/${tableId}`;
  const v2Collection = `/api/v2/tables/${tableId}/records`;
  const v3Collection = `/api/v3/data/${baseId}/${tableId}/records`;

  await expectFlatApiCrud(
    page,
    apiToken.token,
    v1Collection,
    recordId => `${v1Collection}/${encodeURIComponent(recordId)}`,
    recordId => `${v1Collection}/${encodeURIComponent(recordId)}`,
    recordId => `${v1Collection}/${encodeURIComponent(recordId)}`,
    (_recordId, title) => ({ Title: title }),
    () => undefined,
    'v1'
  );

  await expectFlatApiCrud(
    page,
    apiToken.token,
    v2Collection,
    recordId => `${v2Collection}/${encodeURIComponent(recordId)}`,
    () => v2Collection,
    () => v2Collection,
    (recordId, title) => ({ Id: recordId, Title: title }),
    recordId => ({ Id: recordId }),
    'v2'
  );

  const headers = { 'xc-token': apiToken.token };
  const created = await expectJsonResponse<V3RecordList>(
    await page.request.post(v3Collection, {
      headers,
      data: { fields: { Title: 'Public API v3' } },
    }),
    'public API v3 create'
  );
  expect(created.records).toHaveLength(1);
  const recordId = created.records[0].id;

  await expectJsonResponse<V3RecordList>(
    await page.request.patch(v3Collection, {
      headers,
      data: { id: recordId, fields: { Title: 'Public API v3 updated' } },
    }),
    'public API v3 update'
  );

  const read = await expectJsonResponse<V3Record>(
    await page.request.get(`${v3Collection}/${encodeURIComponent(recordId)}`, { headers }),
    'public API v3 read'
  );
  expect(read.id).toBe(recordId);
  expect(read.fields.Title).toBe('Public API v3 updated');

  const list = await expectJsonResponse<V3RecordList>(
    await page.request.get(v3Collection, { headers }),
    'public API v3 list'
  );
  expect(list.records).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: recordId, fields: expect.objectContaining({ Title: 'Public API v3 updated' }) }),
    ])
  );

  await expectJsonResponse<V3RecordList>(
    await page.request.delete(v3Collection, {
      headers,
      data: { id: recordId },
    }),
    'public API v3 delete'
  );

  const afterDelete = await expectJsonResponse<V3RecordList>(
    await page.request.get(v3Collection, { headers }),
    'public API v3 list after delete'
  );
  expect(afterDelete.records).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: recordId })]));

  const deletedToken = await page.request.delete(
    `/api/v1/db/meta/projects/${baseId}/api-tokens/${encodeURIComponent(apiToken.id)}`,
    { headers: { 'xc-auth': sessionToken } }
  );
  expect(deletedToken.ok(), `public API token delete failed with HTTP ${deletedToken.status()}`).toBeTruthy();
}
