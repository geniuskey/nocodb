import { expect, test } from '@playwright/test';
import { ViewTypes } from 'nocodb-sdk';
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
  expect((await statusColumnResponse).ok()).toBeTruthy();
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

  await grid.locator('.nc-grid-add-new-cell').click();
  const persistenceCell = grid.getByTestId('cell-Title-0');
  await expect(persistenceCell).toBeVisible();
  await persistenceCell.dblclick();
  await persistenceCell.locator('input').fill('Persists across restart');

  const persistenceResponse = page.waitForResponse(
    response => isDataRequest(response.url()) && ['POST', 'PATCH'].includes(response.request().method())
  );
  await grid.locator('[data-title="Title"] span[data-test-id="Title"]').click();
  expect((await persistenceResponse).ok()).toBeTruthy();
  await expect(persistenceCell).toContainText('Persists across restart');

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

  await page.keyboard.press('Escape');

  await expect(listView.getByTestId('nc-list-row-0')).toHaveCSS('height', '86px');
  const coloredListRow = listView.locator('[role="option"]').filter({ hasText: 'Virtualized task' }).first();
  await expect(coloredListRow).toBeVisible();
  await expect
    .poll(() => coloredListRow.evaluate(element => getComputedStyle(element).backgroundColor))
    .not.toBe('rgb(255, 255, 255)');

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
  await page.getByTestId('nc-list-bulk-update-apply').click();
  expect((await updateAllMatchingResponse).ok()).toBeTruthy();

  const updatedListResponse = await page.request.get(`/api/v2/tables/${createdTableBody.id}/records?limit=100`, {
    headers: sessionHeaders,
  });
  expect(updatedListResponse.ok()).toBeTruthy();
  const updatedListRecords = (await updatedListResponse.json()) as {
    list: Array<{ Title?: string; Status?: string }>;
  };
  expect(updatedListRecords.list.filter(record => record.Title?.startsWith('Virtualized task '))).toHaveLength(28);
  expect(
    updatedListRecords.list
      .filter(record => record.Title?.startsWith('Virtualized task '))
      .every(record => record.Status === 'Blocked')
  ).toBe(true);
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
});
