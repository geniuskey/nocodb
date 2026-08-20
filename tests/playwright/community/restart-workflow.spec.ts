import { expect, test } from '@playwright/test';
import { ViewTypes } from 'nocodb-sdk';
import { getAuthToken } from './public-api-contract';

const isDataRequest = (url: string) => url.includes('/api/v1/db/data/noco/');

test('Community image preserves login, schema, and records across restart', async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & { isPlaywright?: boolean }).isPlaywright = true;
  });
  await page.goto('/dashboard/');

  await expect(page).toHaveURL(/#\/signin\/?$/);
  await page.getByPlaceholder('Enter your work email').fill('community@example.test');
  await page.getByPlaceholder('Enter your password').fill('Password123.');

  const signinResponse = page.waitForResponse(
    response => response.url().includes('/api/v1/auth/user/signin') && response.request().method() === 'POST'
  );
  await page.locator('button:has-text("SIGN IN")').click();
  expect((await signinResponse).ok()).toBeTruthy();
  await expect(page).toHaveURL(/#\/nc\//, { timeout: 30_000 });

  const sessionHeaders = { 'xc-auth': await getAuthToken(page) };
  const basesResponse = await page.request.get('/api/v2/meta/bases/', { headers: sessionHeaders });
  const bases = await basesResponse.json();
  expect(basesResponse.ok(), JSON.stringify(bases)).toBeTruthy();
  const acceptanceBaseMeta = bases.list.find((base: { title?: string }) => base.title === 'Community Acceptance');
  expect(acceptanceBaseMeta?.id).toEqual(expect.any(String));

  const tablesResponse = await page.request.get(`/api/v2/meta/bases/${acceptanceBaseMeta.id}/tables`, {
    headers: sessionHeaders,
  });
  const tables = await tablesResponse.json();
  expect(tablesResponse.ok(), JSON.stringify(tables)).toBeTruthy();
  const tasksTableMeta = tables.list.find((table: { title?: string }) => table.title === 'Tasks');
  expect(tasksTableMeta?.id).toEqual(expect.any(String));

  const viewsResponse = await page.request.get(`/api/v2/meta/tables/${tasksTableMeta.id}/views`, {
    headers: sessionHeaders,
  });
  const views = await viewsResponse.json();
  expect(viewsResponse.ok(), JSON.stringify(views)).toBeTruthy();
  const timeline = views.list.find(
    (view: { title?: string; type?: number }) => view.title === 'Task Timeline' && view.type === ViewTypes.TIMELINE
  );
  expect(timeline?.id).toEqual(expect.any(String));

  const timelineResponse = await page.request.get(`/api/v2/meta/timelines/${timeline.id}`, {
    headers: sessionHeaders,
  });
  const timelineMeta = await timelineResponse.json();
  expect(timelineResponse.ok(), JSON.stringify(timelineMeta)).toBeTruthy();
  expect(timelineMeta).toEqual(
    expect.objectContaining({
      fk_start_column_id: expect.any(String),
      fk_end_column_id: null,
      zoom: 'month',
    })
  );

  const timelineColumnsResponse = await page.request.get(`/api/v2/meta/views/${timeline.id}/columns/`, {
    headers: sessionHeaders,
  });
  const timelineColumns = await timelineColumnsResponse.json();
  expect(timelineColumnsResponse.ok(), JSON.stringify(timelineColumns)).toBeTruthy();
  const persistedStartViewColumn = timelineColumns.list.find(
    (column: { fk_column_id?: string }) => column.fk_column_id === timelineMeta.fk_start_column_id
  );
  expect(persistedStartViewColumn?.id).toEqual(expect.any(String));
  expect(Boolean(persistedStartViewColumn.show)).toBe(false);

  const persistedTimelineRangeResponse = await page.request.get(
    `/api/v2/timelines/${timeline.id}/records?from=2025-01-10&to=2025-01-15&fields=Title`,
    { headers: sessionHeaders }
  );
  const persistedTimelineRange = await persistedTimelineRangeResponse.json();
  expect(persistedTimelineRangeResponse.ok(), JSON.stringify(persistedTimelineRange)).toBeTruthy();
  expect(persistedTimelineRange.list).toEqual([
    expect.objectContaining({ Title: 'Persists across restart', 'Timeline start': '2025-01-12' }),
  ]);

  const timelineDeleteResponse = await page.request.delete(`/api/v2/meta/views/${timeline.id}`, {
    headers: sessionHeaders,
  });
  expect(timelineDeleteResponse.ok()).toBeTruthy();

  const baseList = page.locator('.nc-treeview-container-base-list');
  for (let attempt = 0; attempt < 3 && !(await baseList.isVisible()); attempt += 1) {
    await page.getByTestId('nc-sidebar-project-btn').click();
    await page.waitForTimeout(1_000);
  }
  await expect(baseList).toBeVisible();

  const acceptanceBase = page.getByTestId('nc-sidebar-base-title-Community Acceptance');
  await expect(acceptanceBase).toBeVisible();
  await acceptanceBase.click();

  const tasksTable = page.getByTestId('nc-tbl-title-Tasks');
  await expect(tasksTable).toBeVisible();
  await tasksTable.click();

  const grid = page.getByTestId('nc-grid-wrapper');
  await expect(grid).toBeVisible({ timeout: 30_000 });
  const persistenceCell = grid.getByTestId('cell-Title-0');
  await expect(persistenceCell).toContainText('Persists across restart');

  await persistenceCell.dblclick();
  await persistenceCell.locator('input').fill('Persisted after restart');
  const updateResponse = page.waitForResponse(
    response => isDataRequest(response.url()) && response.request().method() === 'PATCH'
  );
  await grid.locator('[data-title="Title"] span[data-test-id="Title"]').click();
  expect((await updateResponse).ok()).toBeTruthy();
  await expect(persistenceCell).toContainText('Persisted after restart');

  await grid.locator('.nc-grid-add-new-cell').click();
  const newCell = grid.getByTestId('cell-Title-1');
  await expect(newCell).toBeVisible();
  await newCell.dblclick();
  await newCell.locator('input').fill('Created after restart');
  const createResponse = page.waitForResponse(
    response => isDataRequest(response.url()) && ['POST', 'PATCH'].includes(response.request().method())
  );
  await grid.locator('[data-title="Title"] span[data-test-id="Title"]').click();
  expect((await createResponse).ok()).toBeTruthy();
  await expect(newCell).toContainText('Created after restart');

  await persistenceCell.click({ button: 'right' });
  const deleteResponse = page.waitForResponse(
    response => isDataRequest(response.url()) && response.request().method() === 'DELETE'
  );
  await page.locator('.ant-dropdown-menu-item').filter({ hasText: 'Delete record' }).click();
  expect((await deleteResponse).ok()).toBeTruthy();
  await expect(grid.getByText('Persisted after restart', { exact: true })).toHaveCount(0);
  await expect(grid.getByTestId('cell-Title-0')).toContainText('Created after restart');
});
