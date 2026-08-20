import { expect, type Request, test } from '@playwright/test';
import { UITypes, ViewTypes } from 'nocodb-sdk';
import { expectPublicApiContract, expectPublicApiRuntimeCrud, getAuthToken } from './public-api-contract';

const isDataRequest = (url: string) => url.includes('/api/v1/db/data/noco/');

test('Community image supports signup, base, table, and record CRUD', async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & { isPlaywright?: boolean }).isPlaywright = true;
  });
  await page.goto('/dashboard/');

  await expect(page).toHaveURL(/#\/signup$/);
  await page.getByPlaceholder('Enter your work email').fill('community@example.test');
  await page.getByPlaceholder('Enter your password').fill('Password123.');

  const signupResponse = page.waitForResponse(
    response => response.url().includes('/api/v1/auth/user/signup') && response.request().method() === 'POST'
  );
  await page.getByRole('button', { name: 'SIGN UP', exact: true }).click();
  expect((await signupResponse).ok()).toBeTruthy();

  const onboarding = page.getByTestId('nc-onboarding-flow-container');
  const createBaseButton = page.getByTestId('nc-sidebar-create-base-btn');
  const initialGrid = page.getByTestId('nc-grid-wrapper');
  await expect(onboarding.or(initialGrid)).toBeVisible({ timeout: 30_000 });
  if (await onboarding.isVisible()) {
    await page.getByTestId('nc-onboarding-flow-skip-button').click();
  }

  await expect(onboarding).toBeHidden();
  await expect(page).toHaveURL(/#\/nc\//);
  await expect(initialGrid).toBeVisible({ timeout: 30_000 });
  const baseList = page.locator('.nc-treeview-container-base-list');
  for (let attempt = 0; attempt < 3 && !(await baseList.isVisible()); attempt += 1) {
    await page.getByTestId('nc-sidebar-project-btn').click();
    await page.waitForTimeout(1_000);
  }
  await expect(baseList).toBeVisible();
  await expect(createBaseButton).toBeVisible();
  await createBaseButton.click();

  const baseName = page.locator('.nc-metadb-base-name');
  await expect(baseName).toBeVisible();
  await baseName.fill('Community Acceptance');

  const baseResponse = page.waitForResponse(
    response => response.url().includes('/api/v1/db/meta/projects') && response.request().method() === 'POST'
  );
  await page.getByTestId('docs-create-proj-dlg-create-btn').click();
  const createdBase = await baseResponse;
  expect(createdBase.ok()).toBeTruthy();
  const createdBaseBody = await createdBase.json();
  expect(createdBaseBody.title).toBe('Community Acceptance');
  expect(createdBaseBody.id).toEqual(expect.any(String));

  await expect(page.getByTestId('proj-view-btn__add-new-table')).toBeVisible();
  await page.getByTestId('proj-view-btn__add-new-table').click();

  const tableName = page.getByTestId('create-table-title-input');
  await expect(tableName).toBeVisible();
  await tableName.fill('Tasks');

  const tableResponse = page.waitForResponse(
    response =>
      /\/api\/v1\/db\/meta\/projects\/[^/]+\/[^/]+\/tables/.test(response.url()) &&
      response.request().method() === 'POST'
  );
  await page.getByRole('dialog').getByRole('button', { name: 'Create Table', exact: true }).click();
  const createdTable = await tableResponse;
  expect(createdTable.ok()).toBeTruthy();
  const createdTableBody = await createdTable.json();
  expect(createdTableBody.title).toBe('Tasks');
  expect(createdTableBody.id).toEqual(expect.any(String));

  const grid = page.getByTestId('nc-grid-wrapper');
  await expect(grid).toBeVisible();

  const sessionHeaders = { 'xc-auth': await getAuthToken(page) };

  await grid.locator('.nc-column-add').click();
  const columnForm = page.locator('form[data-testid="add-or-edit-column"]');
  await expect(columnForm).toBeVisible();
  await columnForm.locator('.nc-column-name-input').fill('Status');
  const columnTypeSearch = columnForm.locator('.nc-column-type-search-input input');
  await columnTypeSearch.fill('SingleSelect');
  await columnForm.locator('.nc-column-list-wrapper').getByTestId('SingleSelect').click();
  await columnForm.getByTestId('nc-add-select-option-btn').click();
  await columnForm.getByTestId('select-column-option-input-0').fill('Ready');
  await columnForm.getByTestId('nc-add-select-option-btn').click();
  await columnForm.getByTestId('select-column-option-input-1').fill('Blocked');

  const statusColumnResponse = page.waitForResponse(
    response =>
      response.url().includes(`/meta/tables/${createdTableBody.id}/columns`) && response.request().method() === 'POST'
  );
  await columnForm.getByRole('button', { name: 'Save Field', exact: true }).click();
  const createdStatusColumnResponse = await statusColumnResponse;
  expect(createdStatusColumnResponse.ok()).toBeTruthy();
  const statusColumnModel = await createdStatusColumnResponse.json();
  const createdStatusColumn = statusColumnModel.columns.find((column: { title?: string }) => column.title === 'Status');
  expect(createdStatusColumn?.id).toEqual(expect.any(String));
  await expect(columnForm).toBeHidden();
  await expect(grid.locator('[data-title="Status"]')).toBeVisible();

  const listCreateResponse = await page.request.post(`/api/v2/meta/tables/${createdTableBody.id}/lists`, {
    headers: sessionHeaders,
    data: { title: 'Task List', type: ViewTypes.LIST },
  });
  const createdList = await listCreateResponse.json();
  expect(listCreateResponse.ok(), JSON.stringify(createdList)).toBeTruthy();
  expect(createdList).toEqual(
    expect.objectContaining({
      title: 'Task List',
      type: ViewTypes.LIST,
      view: expect.objectContaining({
        density: 'comfortable',
      }),
    })
  );
  expect(Boolean(createdList.view.show_field_labels)).toBe(true);
  const listUpdateResponse = await page.request.patch(`/api/v2/meta/lists/${createdList.id}`, {
    headers: sessionHeaders,
    data: { density: 'compact', show_field_labels: false },
  });
  expect(listUpdateResponse.ok()).toBeTruthy();
  const updatedList = await listUpdateResponse.json();
  expect(updatedList).toEqual(
    expect.objectContaining({
      view: expect.objectContaining({ density: 'compact' }),
    })
  );
  expect(Boolean(updatedList.view.show_field_labels)).toBe(false);

  const createTimelineColumn = async (title: string, uidt: UITypes) => {
    const response = await page.request.post(`/api/v2/meta/tables/${createdTableBody.id}/columns`, {
      headers: sessionHeaders,
      data: { title, column_name: title, uidt },
    });
    const model = await response.json();
    expect(response.ok(), JSON.stringify(model)).toBeTruthy();
    const column = model.columns.find((candidate: { title?: string }) => candidate.title === title);
    expect(column.id).toEqual(expect.any(String));
    return column;
  };
  const timelineStartColumn = await createTimelineColumn('Timeline start', UITypes.Date);
  const timelineEndColumn = await createTimelineColumn('Timeline end', UITypes.DateTime);

  const timelineCreateResponse = await page.request.post(`/api/v2/meta/tables/${createdTableBody.id}/timelines`, {
    headers: sessionHeaders,
    data: { title: 'Task Timeline', type: ViewTypes.TIMELINE },
  });
  const createdTimeline = await timelineCreateResponse.json();
  expect(timelineCreateResponse.ok(), JSON.stringify(createdTimeline)).toBeTruthy();
  expect(createdTimeline).toEqual(
    expect.objectContaining({
      title: 'Task Timeline',
      type: ViewTypes.TIMELINE,
      view: expect.objectContaining({ zoom: 'week' }),
    })
  );

  const unconfiguredTimelineRange = await page.request.get(
    `/api/v2/timelines/${createdTimeline.id}/records?from=2025-01-01&to=2025-02-01`,
    { headers: sessionHeaders }
  );
  expect(unconfiguredTimelineRange.status()).toBe(400);

  const invalidTimelineUpdate = await page.request.patch(`/api/v2/meta/timelines/${createdTimeline.id}`, {
    headers: sessionHeaders,
    data: { fk_start_column_id: createdStatusColumn.id },
  });
  expect(invalidTimelineUpdate.status()).toBe(400);

  const timelineUpdateResponse = await page.request.patch(`/api/v2/meta/timelines/${createdTimeline.id}`, {
    headers: sessionHeaders,
    data: {
      fk_start_column_id: timelineStartColumn.id,
      fk_end_column_id: timelineEndColumn.id,
      zoom: 'month',
    },
  });
  const updatedTimeline = await timelineUpdateResponse.json();
  expect(timelineUpdateResponse.ok(), JSON.stringify(updatedTimeline)).toBeTruthy();
  expect(updatedTimeline.view).toEqual(
    expect.objectContaining({
      fk_start_column_id: timelineStartColumn.id,
      fk_end_column_id: timelineEndColumn.id,
      zoom: 'month',
    })
  );

  const timelineReadResponse = await page.request.get(`/api/v2/meta/timelines/${createdTimeline.id}`, {
    headers: sessionHeaders,
  });
  const readTimeline = await timelineReadResponse.json();
  expect(timelineReadResponse.ok(), JSON.stringify(readTimeline)).toBeTruthy();
  expect(readTimeline).toEqual(
    expect.objectContaining({
      fk_start_column_id: timelineStartColumn.id,
      fk_end_column_id: timelineEndColumn.id,
      zoom: 'month',
    })
  );

  const timelineRecordsResponse = await page.request.post(`/api/v2/tables/${createdTableBody.id}/records`, {
    headers: sessionHeaders,
    data: [
      {
        Title: 'Timeline before range',
        'Timeline start': '2025-01-01',
        'Timeline end': '2025-01-02T12:00:00Z',
      },
      {
        Title: 'Timeline spanning range',
        'Timeline start': '2025-01-05',
        'Timeline end': '2025-01-20T12:00:00Z',
      },
      {
        Title: 'Timeline point in range',
        'Timeline start': '2025-01-12',
        'Timeline end': null,
      },
      {
        Title: 'Timeline after range',
        'Timeline start': '2025-02-01',
        'Timeline end': '2025-02-02T12:00:00Z',
      },
    ],
  });
  const timelineRecords = await timelineRecordsResponse.json();
  expect(timelineRecordsResponse.ok(), JSON.stringify(timelineRecords)).toBeTruthy();

  const invalidTimelineRanges = await Promise.all([
    page.request.get(`/api/v2/timelines/${createdTimeline.id}/records?to=2025-01-15`, {
      headers: sessionHeaders,
    }),
    page.request.get(`/api/v2/timelines/${createdTimeline.id}/records?from=2025-02-01&to=2025-01-01`, {
      headers: sessionHeaders,
    }),
    page.request.get(`/api/v2/timelines/${createdTimeline.id}/records?from=2025-01-01&to=2026-01-03`, {
      headers: sessionHeaders,
    }),
    page.request.get(`/api/v2/timelines/${createdTimeline.id}/records?from=2025-01-01&to=2025-02-01&limit=1001`, {
      headers: sessionHeaders,
    }),
    page.request.get(`/api/v2/timelines/${createdList.id}/records?from=2025-01-01&to=2025-02-01`, {
      headers: sessionHeaders,
    }),
  ]);
  expect(invalidTimelineRanges.map(response => response.status())).toEqual([400, 400, 400, 400, 400]);

  const timelineRangeResponse = await page.request.get(
    `/api/v1/db/timeline-data/${createdTimeline.id}?from=2025-01-10&to=2025-01-15&limit=1`,
    { headers: sessionHeaders }
  );
  const timelineRange = await timelineRangeResponse.json();
  expect(timelineRangeResponse.ok(), JSON.stringify(timelineRange)).toBeTruthy();
  expect(timelineRange.pageInfo).toEqual(
    expect.objectContaining({ totalRows: 2, pageSize: 1, isFirstPage: true, isLastPage: false })
  );
  expect(timelineRange.list).toHaveLength(1);

  const filteredTimelineRangeResponse = await page.request.get(
    `/api/v2/timelines/${createdTimeline.id}/records?from=2025-01-10&to=2025-01-15&where=${encodeURIComponent(
      '(Title,eq,Timeline point in range)'
    )}`,
    { headers: sessionHeaders }
  );
  const filteredTimelineRange = await filteredTimelineRangeResponse.json();
  expect(filteredTimelineRangeResponse.ok(), JSON.stringify(filteredTimelineRange)).toBeTruthy();
  expect(filteredTimelineRange.list).toEqual([
    expect.objectContaining({ Title: 'Timeline point in range', 'Timeline start': '2025-01-12' }),
  ]);

  const timelineColumnsResponse = await page.request.get(`/api/v2/meta/views/${createdTimeline.id}/columns/`, {
    headers: sessionHeaders,
  });
  const timelineColumns = await timelineColumnsResponse.json();
  expect(timelineColumnsResponse.ok(), JSON.stringify(timelineColumns)).toBeTruthy();
  const timelineStartViewColumn = timelineColumns.list.find(
    (column: { fk_column_id?: string }) => column.fk_column_id === timelineStartColumn.id
  );
  expect(timelineStartViewColumn?.id).toEqual(expect.any(String));
  const timelineColumnUpdateResponse = await page.request.patch(
    `/api/v2/meta/views/${createdTimeline.id}/columns/${timelineStartViewColumn.id}`,
    {
      headers: sessionHeaders,
      data: { show: false },
    }
  );
  expect(timelineColumnUpdateResponse.ok()).toBeTruthy();

  const projectedTimelineRangeResponse = await page.request.get(
    `/api/v2/timelines/${createdTimeline.id}/records?from=2025-01-10&to=2025-01-15&fields=Title`,
    { headers: sessionHeaders }
  );
  const projectedTimelineRange = await projectedTimelineRangeResponse.json();
  expect(projectedTimelineRangeResponse.ok(), JSON.stringify(projectedTimelineRange)).toBeTruthy();
  expect(projectedTimelineRange.list).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ Title: 'Timeline spanning range', 'Timeline start': '2025-01-05' }),
      expect.objectContaining({ Title: 'Timeline point in range', 'Timeline start': '2025-01-12' }),
    ])
  );

  const clearTimelineEndResponse = await page.request.patch(`/api/v2/meta/timelines/${createdTimeline.id}`, {
    headers: sessionHeaders,
    data: { fk_end_column_id: null },
  });
  const timelineWithPointEvents = await clearTimelineEndResponse.json();
  expect(clearTimelineEndResponse.ok(), JSON.stringify(timelineWithPointEvents)).toBeTruthy();
  expect(timelineWithPointEvents.view.fk_end_column_id).toBeNull();

  const pointTimelineRangeResponse = await page.request.get(
    `/api/v2/timelines/${createdTimeline.id}/records?from=2025-01-10&to=2025-01-15`,
    { headers: sessionHeaders }
  );
  const pointTimelineRange = await pointTimelineRangeResponse.json();
  expect(pointTimelineRangeResponse.ok(), JSON.stringify(pointTimelineRange)).toBeTruthy();
  expect(pointTimelineRange.list).toEqual([
    expect.objectContaining({ Title: 'Timeline point in range', 'Timeline start': '2025-01-12' }),
  ]);

  const timelineRecordsDeleteResponse = await page.request.delete(`/api/v2/tables/${createdTableBody.id}/records`, {
    headers: sessionHeaders,
    data: timelineRecords,
  });
  expect(timelineRecordsDeleteResponse.ok(), await timelineRecordsDeleteResponse.text()).toBeTruthy();

  const viewsResponse = await page.request.get(`/api/v2/meta/tables/${createdTableBody.id}/views`, {
    headers: sessionHeaders,
  });
  expect(viewsResponse.ok()).toBeTruthy();
  const tableViews = await viewsResponse.json();
  expect(tableViews.list).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: createdList.id,
        title: 'Task List',
        type: ViewTypes.LIST,
      }),
      expect.objectContaining({
        id: createdTimeline.id,
        title: 'Task Timeline',
        type: ViewTypes.TIMELINE,
      }),
    ])
  );

  await expectPublicApiContract(page, createdBaseBody.id, createdTableBody.id);

  await expect(grid).toBeVisible();
  await expect(page.getByTestId('nc-pagination-add-record')).toBeVisible();

  await grid.locator('.nc-grid-add-new-cell').click();
  const titleCell = grid.getByTestId('cell-Title-0');
  await expect(titleCell).toBeVisible();
  await titleCell.dblclick();
  await titleCell.locator('input').fill('First task');

  const createRecordResponse = page.waitForResponse(
    response => isDataRequest(response.url()) && ['POST', 'PATCH'].includes(response.request().method())
  );
  await grid.locator('[data-title="Title"] span[data-test-id="Title"]').click();
  const createdRecord = await createRecordResponse;
  expect(createdRecord.ok()).toBeTruthy();
  await expect(titleCell).toContainText('First task');

  await titleCell.dblclick();
  await titleCell.locator('input').fill('Updated task');
  const updateRecordResponse = page.waitForResponse(
    response => isDataRequest(response.url()) && response.request().method() === 'PATCH'
  );
  await grid.locator('[data-title="Title"] span[data-test-id="Title"]').click();
  expect((await updateRecordResponse).ok()).toBeTruthy();
  await expect(titleCell).toContainText('Updated task');

  await titleCell.click({ button: 'right' });
  const deleteRecordResponse = page.waitForResponse(
    response => isDataRequest(response.url()) && response.request().method() === 'DELETE'
  );
  await page.locator('.ant-dropdown-menu-item').filter({ hasText: 'Delete record' }).click();
  expect((await deleteRecordResponse).ok()).toBeTruthy();
  await expect(titleCell).toHaveCount(0);

  const persistenceResponse = await page.request.post(`/api/v2/tables/${createdTableBody.id}/records`, {
    headers: sessionHeaders,
    data: { Title: 'Persists across restart', Status: 'Ready', 'Timeline start': '2025-01-12' },
  });
  expect(persistenceResponse.ok(), await persistenceResponse.text()).toBeTruthy();
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/v2/tables/${createdTableBody.id}/records?limit=10`, {
          headers: sessionHeaders,
        });
        if (!response.ok()) return false;

        const body = (await response.json()) as { list?: Array<{ Title?: string }> };
        return body.list?.some(record => record.Title === 'Persists across restart') ?? false;
      },
      { timeout: 15_000 }
    )
    .toBe(true);

  await expectPublicApiRuntimeCrud(page, createdBaseBody.id, createdTableBody.id);

  const bulkListRecordsResponse = await page.request.post(`/api/v2/tables/${createdTableBody.id}/records`, {
    headers: sessionHeaders,
    data: Array.from({ length: 30 }, (_, index) => ({
      Title: `Virtualized task ${index + 1}`,
      Status: 'Ready',
    })),
  });
  expect(bulkListRecordsResponse.ok(), await bulkListRecordsResponse.text()).toBeTruthy();

  const listRowsResponse = await page.request.get(
    `/api/v1/db/data/noco/${createdBaseBody.id}/${createdTableBody.id}/views/${createdList.id}`,
    { headers: sessionHeaders }
  );
  expect(listRowsResponse.ok()).toBeTruthy();
  const listRows = await listRowsResponse.json();
  expect(listRows.list).toEqual(
    expect.arrayContaining([expect.objectContaining({ Title: 'Persists across restart' })])
  );

  const listRangeRequestUrls: string[] = [];
  const trackListRangeRequest = (request: Request) => {
    if (request.method() !== 'GET') return;
    const requestUrl = new URL(request.url());
    if (requestUrl.searchParams.get('offset') === '25') listRangeRequestUrls.push(request.url());
  };
  page.on('request', trackListRangeRequest);

  await page.locator('.nc-create-view-btn').click();
  await page.getByTestId('sidebar-view-create-list').click();

  const listName = page.locator('.nc-view-create-modal .nc-view-input');
  await expect(listName).toBeVisible();
  await listName.fill('Task List UI');

  const uiListCreateResponse = page.waitForResponse(
    response =>
      response.url().includes(`/meta/tables/${createdTableBody.id}/lists`) && response.request().method() === 'POST'
  );
  await page.getByTestId('nc-view-create-submit').click();
  const createdUiListResponse = await uiListCreateResponse;
  expect(createdUiListResponse.ok()).toBeTruthy();
  const createdUiList = await createdUiListResponse.json();
  expect(createdUiList).toEqual(
    expect.objectContaining({
      title: 'Task List UI',
      type: ViewTypes.LIST,
    })
  );

  const listView = page.getByTestId('nc-list-wrapper');
  await expect(listView).toBeVisible({ timeout: 30_000 });
  await expect(listView.getByTestId('nc-list-row-0')).toContainText('Persists across restart');
  await expect(page.getByTestId('nc-list-add-record')).toBeVisible();
  await expect(listView).toHaveAttribute('data-prefetched-range-pages', '2');
  const pageTwoRangePath = `/views/${createdUiList.id}`;
  const pageTwoRangeRequestCount = () => listRangeRequestUrls.filter(url => url.includes(pageTwoRangePath)).length;
  expect(pageTwoRangeRequestCount()).toBeGreaterThan(0);

  await page.getByTestId('nc-list-settings-button').click();
  const listSettings = page.getByTestId('nc-list-settings');
  await expect(listSettings).toBeVisible();

  const densityUpdateResponse = page.waitForResponse(
    response => response.url().includes(`/meta/lists/${createdUiList.id}`) && response.request().method() === 'PATCH'
  );
  await listSettings.getByTestId('nc-list-density-spacious').click();
  const densityUpdate = await densityUpdateResponse;
  expect(densityUpdate.ok()).toBeTruthy();
  expect((await densityUpdate.json()).view).toEqual(expect.objectContaining({ density: 'spacious' }));

  const labelsUpdateResponse = page.waitForResponse(
    response => response.url().includes(`/meta/lists/${createdUiList.id}`) && response.request().method() === 'PATCH'
  );
  await listSettings.getByTestId('nc-list-show-field-labels').click();
  const labelsUpdate = await labelsUpdateResponse;
  expect(labelsUpdate.ok()).toBeTruthy();
  expect(Boolean((await labelsUpdate.json()).view.show_field_labels)).toBe(false);

  await expect(listSettings.getByTestId('nc-list-title-field')).toContainText('Title');
  await expect(listSettings.getByTestId('nc-list-subtitle-field')).toContainText('Status');
  await expect(listSettings.getByTestId('nc-list-image-field')).toContainText('None');

  const colorUpdateResponse = page.waitForResponse(
    response => response.url().includes(`/meta/lists/${createdUiList.id}`) && response.request().method() === 'PATCH'
  );
  await listSettings.getByTestId('nc-list-color-field').click();
  await page.locator('.ant-select-dropdown:visible').getByText('Status', { exact: true }).click();
  const colorUpdate = await colorUpdateResponse;
  expect(colorUpdate.ok()).toBeTruthy();
  const colorUpdateBody = await colorUpdate.json();
  const savedColorMeta =
    typeof colorUpdateBody.view.meta === 'string' ? JSON.parse(colorUpdateBody.view.meta) : colorUpdateBody.view.meta;
  expect(savedColorMeta).toEqual(expect.objectContaining({ color_by_field_id: expect.any(String) }));

  const addColorRuleResponse = page.waitForResponse(
    response => response.url().includes(`/meta/lists/${createdUiList.id}`) && response.request().method() === 'PATCH'
  );
  await listSettings.getByTestId('nc-list-add-color-rule').click();
  expect((await addColorRuleResponse).ok()).toBeTruthy();

  const colorRule = listSettings.getByTestId('nc-list-color-rule-0');
  const colorRuleFieldResponse = page.waitForResponse(
    response => response.url().includes(`/meta/lists/${createdUiList.id}`) && response.request().method() === 'PATCH'
  );
  await colorRule.getByTestId('nc-list-color-rule-field-0').click();
  await page.locator('.ant-select-dropdown:visible').getByText('Status', { exact: true }).click();
  expect((await colorRuleFieldResponse).ok()).toBeTruthy();

  const colorRuleValueResponse = page.waitForResponse(
    response => response.url().includes(`/meta/lists/${createdUiList.id}`) && response.request().method() === 'PATCH'
  );
  await colorRule.getByTestId('nc-list-color-rule-value-0').click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option-content')
    .getByText('Ready', { exact: true })
    .click();
  expect((await colorRuleValueResponse).ok()).toBeTruthy();

  const addColorConditionResponse = page.waitForResponse(
    response => response.url().includes(`/meta/lists/${createdUiList.id}`) && response.request().method() === 'PATCH'
  );
  await colorRule.getByTestId('nc-list-color-rule-add-condition-0').click();
  expect((await addColorConditionResponse).ok()).toBeTruthy();

  const colorConditionOperatorResponse = page.waitForResponse(
    response => response.url().includes(`/meta/lists/${createdUiList.id}`) && response.request().method() === 'PATCH'
  );
  await colorRule.getByTestId('nc-list-color-rule-operator-0-1').click();
  await page.locator('.ant-select-dropdown:visible').getByText('is like', { exact: true }).click();
  expect((await colorConditionOperatorResponse).ok()).toBeTruthy();

  const colorConditionValueResponse = page.waitForResponse(
    response => response.url().includes(`/meta/lists/${createdUiList.id}`) && response.request().method() === 'PATCH'
  );
  await colorRule.getByTestId('nc-list-color-rule-value-0-1').locator('input').fill('Virtualized task');
  expect((await colorConditionValueResponse).ok()).toBeTruthy();

  const colorLogicalOperatorResponse = page.waitForResponse(
    response => response.url().includes(`/meta/lists/${createdUiList.id}`) && response.request().method() === 'PATCH'
  );
  await colorRule.getByTestId('nc-list-color-rule-logical-0').click();
  await page.locator('.ant-select-dropdown:visible').getByText('Match any', { exact: true }).click();
  const colorLogicalOperatorUpdate = await colorLogicalOperatorResponse;
  expect(colorLogicalOperatorUpdate.ok()).toBeTruthy();
  const colorRuleUpdateBody = await colorLogicalOperatorUpdate.json();
  const savedConditionalColorMeta =
    typeof colorRuleUpdateBody.view.meta === 'string'
      ? JSON.parse(colorRuleUpdateBody.view.meta)
      : colorRuleUpdateBody.view.meta;
  expect(savedConditionalColorMeta.list_color_rules).toEqual([
    expect.objectContaining({
      color: '#4F46E5',
      logical_op: 'or',
      conditions: [
        expect.objectContaining({
          fk_column_id: expect.any(String),
          comparison_op: 'eq',
          value: 'Ready',
        }),
        expect.objectContaining({
          fk_column_id: expect.any(String),
          comparison_op: 'like',
          value: 'Virtualized task',
        }),
      ],
    }),
  ]);

  await page.keyboard.press('Escape');

  await expect(listView.getByTestId('nc-list-row-0')).toHaveCSS('height', '86px');
  const coloredListRow = listView.locator('[role="option"]').filter({ hasText: 'Virtualized task' }).first();
  await expect(coloredListRow).toBeVisible();
  await expect
    .poll(() => coloredListRow.evaluate(element => getComputedStyle(element).backgroundColor))
    .not.toBe('rgb(255, 255, 255)');
  await expect(coloredListRow).toHaveCSS('border-left-color', 'rgb(79, 70, 229)');

  const renderedListRows = listView.locator('[role="option"]');
  await expect.poll(() => renderedListRows.count()).toBeGreaterThan(1);
  await expect.poll(() => renderedListRows.count()).toBeLessThan(25);

  const secondListRow = listView.getByTestId('nc-list-row-1');
  await secondListRow.focus();
  await secondListRow.press(' ');
  await expect(secondListRow).toHaveAttribute('aria-selected', 'true');

  await secondListRow.press('Shift+ArrowDown');
  const thirdListRow = listView.getByTestId('nc-list-row-2');
  await expect(thirdListRow).toBeFocused();
  await expect(thirdListRow).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('nc-list-selection-toolbar')).toContainText('2 selected');

  const bulkDeleteResponse = page.waitForResponse(
    response =>
      response.url().includes(`/api/v2/tables/${createdTableBody.id}/records`) &&
      response.request().method() === 'DELETE'
  );
  await page.getByTestId('nc-list-delete-selected').click();
  await page.getByTestId('nc-record-delete-all').click();
  expect((await bulkDeleteResponse).ok()).toBeTruthy();
  await expect(listView.getByTestId('nc-list-row-0')).toContainText('Persists across restart');

  const firstListRow = listView.getByTestId('nc-list-row-0');
  await firstListRow.focus();
  await firstListRow.press('End');
  const lastPageListRow = listView.getByTestId('nc-list-row-24');
  await expect(lastPageListRow).toBeFocused();
  await expect(listView.getByTestId('nc-list-row-0')).toHaveCount(0);

  await lastPageListRow.press('Control+a');
  await expect(page.getByTestId('nc-list-selection-toolbar')).toContainText('25 selected');
  await page.getByTestId('nc-list-select-all-matching').click();
  await expect(page.getByTestId('nc-list-selection-toolbar')).toContainText('All 29 matching records selected');

  await lastPageListRow.press('Home');
  const persistentListRow = listView.getByTestId('nc-list-row-0');
  await expect(persistentListRow).toContainText('Persists across restart');
  await persistentListRow.getByRole('checkbox').click();
  await expect(page.getByTestId('nc-list-selection-toolbar')).toContainText('All 28 matching records selected');

  await page.locator('.nc-grid-pagination-wrapper .next-page').click();
  const secondPageFirstRow = listView.getByTestId('nc-list-row-0');
  await expect(secondPageFirstRow).toBeVisible();
  await expect(secondPageFirstRow).toHaveAttribute('aria-selected', 'true');
  const prefetchedPageTwoRequestCount = pageTwoRangeRequestCount();
  await expect(listView).toHaveAttribute('data-prefetched-range-pages', '1,2');
  expect(pageTwoRangeRequestCount()).toBe(prefetchedPageTwoRequestCount);
  await secondPageFirstRow.getByRole('checkbox').click();
  await expect(page.getByTestId('nc-list-selection-toolbar')).toContainText('All 27 matching records selected');
  await secondPageFirstRow.getByRole('checkbox').click();
  await expect(page.getByTestId('nc-list-selection-toolbar')).toContainText('All 28 matching records selected');

  const updateAllMatchingResponse = page.waitForResponse(
    response => response.url().includes('/api/v1/db/data/bulk/noco/') && response.request().method() === 'PATCH'
  );
  await page.getByTestId('nc-list-update-selected').click();
  await page.getByTestId('nc-list-bulk-update-field').click();
  await page.locator('.ant-select-dropdown:visible').getByText('Status', { exact: true }).click();
  await page.getByTestId('nc-list-bulk-update-value').click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option-content')
    .getByText('Blocked', { exact: true })
    .click();
  await page.getByTestId('nc-list-bulk-update-add-field').click();
  await page.getByTestId('nc-list-bulk-update-field-1').click();
  await page.locator('.ant-select-dropdown:visible').getByText('Title', { exact: true }).click();
  await page.getByTestId('nc-list-bulk-update-value-1').locator('input').fill('Bulk updated task');
  await page.getByTestId('nc-list-bulk-update-apply').click();
  const updateAllMatching = await updateAllMatchingResponse;
  expect(updateAllMatching.ok()).toBeTruthy();
  expect(updateAllMatching.request().postDataJSON()).toEqual(
    expect.objectContaining({ Status: 'Blocked', Title: 'Bulk updated task' })
  );

  const updatedListResponse = await page.request.get(`/api/v2/tables/${createdTableBody.id}/records?limit=100`, {
    headers: sessionHeaders,
  });
  expect(updatedListResponse.ok()).toBeTruthy();
  const updatedListRecords = (await updatedListResponse.json()) as {
    list: Array<{ Title?: string; Status?: string }>;
  };
  expect(
    updatedListRecords.list.filter(record => record.Title === 'Bulk updated task' && record.Status === 'Blocked')
  ).toHaveLength(28);
  expect(updatedListRecords.list.find(record => record.Title === 'Persists across restart')?.Status).not.toBe(
    'Blocked'
  );

  await page.getByTestId('nc-list-select-all').click();
  await page.getByTestId('nc-list-select-all-matching').click();
  await page.locator('.nc-grid-pagination-wrapper .prev-page').click();
  const persistentRowAfterUpdate = listView.getByTestId('nc-list-row-0');
  await expect(persistentRowAfterUpdate).toContainText('Persists across restart');
  await persistentRowAfterUpdate.getByRole('checkbox').click();
  await expect(page.getByTestId('nc-list-selection-toolbar')).toContainText('All 28 matching records selected');

  const deleteAllMatchingResponse = page.waitForResponse(
    response => response.url().includes('/api/v1/db/data/bulk/noco/') && response.request().method() === 'DELETE'
  );
  await page.getByTestId('nc-list-delete-selected').click();
  await page.getByTestId('nc-record-delete-all').click();
  expect((await deleteAllMatchingResponse).ok()).toBeTruthy();

  await expect(listView.getByTestId('nc-list-row-0')).toContainText('Persists across restart');
  await expect(page.getByTestId('nc-list-delete-selected')).toHaveCount(0);
  page.off('request', trackListRangeRequest);

  const cleanupListResponse = await page.request.get(`/api/v2/tables/${createdTableBody.id}/records?limit=100`, {
    headers: sessionHeaders,
  });
  expect(cleanupListResponse.ok()).toBeTruthy();
  const cleanupList = (await cleanupListResponse.json()) as {
    list: Array<{ Id: number; Title?: string }>;
  };
  const temporaryRecords = cleanupList.list
    .filter(record => record.Title?.startsWith('Virtualized task '))
    .map(record => ({ Id: record.Id }));
  expect(temporaryRecords).toEqual([]);

  const currentTimelineDate = new Date().toISOString().slice(0, 10);
  const currentTimelineEnd = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  const uiTimelineRecordResponse = await page.request.post(`/api/v2/tables/${createdTableBody.id}/records`, {
    headers: sessionHeaders,
    data: {
      Title: 'Current Timeline item',
      Status: 'Ready',
      'Timeline start': currentTimelineDate,
      'Timeline end': currentTimelineEnd,
    },
  });
  expect(uiTimelineRecordResponse.ok(), await uiTimelineRecordResponse.text()).toBeTruthy();

  await page.locator('.nc-create-view-btn').click();
  await page.getByTestId('sidebar-view-create-timeline').click();

  const timelineName = page.locator('.nc-view-create-modal .nc-view-input');
  await expect(timelineName).toBeVisible();
  await timelineName.fill('Task Timeline UI');

  await page.getByTestId('nc-timeline-start-field-select').click();
  await page.locator('.ant-select-dropdown:visible').getByText('Timeline start', { exact: true }).click();
  await page.getByTestId('nc-timeline-end-field-select').click();
  await page.locator('.ant-select-dropdown:visible').last().getByText('Timeline end', { exact: true }).click();

  const uiTimelineCreateResponse = page.waitForResponse(
    response =>
      response.url().includes(`/meta/tables/${createdTableBody.id}/timelines`) && response.request().method() === 'POST'
  );
  const uiTimelineUpdateResponse = page.waitForResponse(
    response => response.url().includes('/meta/timelines/') && response.request().method() === 'PATCH'
  );
  const firstTimelineRangeResponse = page.waitForResponse(
    response => response.url().includes('/api/v1/db/timeline-data/') && response.request().method() === 'GET'
  );
  await page.getByTestId('nc-view-create-submit').click();

  const createdUiTimeline = await (await uiTimelineCreateResponse).json();
  expect(createdUiTimeline).toEqual(expect.objectContaining({ title: 'Task Timeline UI', type: ViewTypes.TIMELINE }));
  const configuredUiTimelineResponse = await uiTimelineUpdateResponse;
  expect(configuredUiTimelineResponse.ok()).toBeTruthy();
  expect((await configuredUiTimelineResponse.json()).view).toEqual(
    expect.objectContaining({
      fk_start_column_id: timelineStartColumn.id,
      fk_end_column_id: timelineEndColumn.id,
      zoom: 'week',
    })
  );

  const initialRange = await firstTimelineRangeResponse;
  expect(initialRange.ok(), await initialRange.text()).toBeTruthy();
  const initialRangeUrl = new URL(initialRange.url());
  expect(initialRangeUrl.searchParams.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(initialRangeUrl.searchParams.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(initialRangeUrl.searchParams.get('limit')).toBe('1000');

  const timelineView = page.getByTestId('nc-timeline-wrapper');
  await expect(timelineView).toBeVisible({ timeout: 30_000 });
  await expect(timelineView.getByTestId('nc-timeline-item').filter({ hasText: 'Current Timeline item' })).toBeVisible();

  await page.getByTestId('nc-timeline-next').click();
  await expect(timelineView.getByTestId('nc-timeline-item').filter({ hasText: 'Current Timeline item' })).toHaveCount(
    0
  );
  await page.getByTestId('nc-timeline-today').click();
  await expect(timelineView.getByTestId('nc-timeline-item').filter({ hasText: 'Current Timeline item' })).toBeVisible();

  await page.getByTestId('nc-timeline-settings-toggle').click();
  await page.getByTestId('nc-timeline-settings-zoom').click();
  await page
    .locator('.ant-select-dropdown:visible')
    .last()
    .locator('span.capitalize')
    .filter({ hasText: /^day$/ })
    .click();
  const timelineZoomUpdateResponse = page.waitForResponse(
    response =>
      response.url().includes(`/meta/timelines/${createdUiTimeline.id}`) && response.request().method() === 'PATCH'
  );
  await page.getByTestId('nc-timeline-settings-save').click();
  const timelineZoomUpdate = await timelineZoomUpdateResponse;
  expect(timelineZoomUpdate.ok()).toBeTruthy();
  expect((await timelineZoomUpdate.json()).view).toEqual(expect.objectContaining({ zoom: 'day' }));
  await expect(timelineView.getByText('day', { exact: true })).toBeVisible();
  await expect(timelineView.getByTestId('nc-timeline-item').filter({ hasText: 'Current Timeline item' })).toBeVisible();
});
