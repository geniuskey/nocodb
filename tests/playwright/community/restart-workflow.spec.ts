import { expect, test } from '@playwright/test';
import { parseProp, ViewTypes } from 'nocodb-sdk';
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
  const uiTimeline = views.list.find(
    (view: { title?: string; type?: number }) => view.title === 'Task Timeline UI' && view.type === ViewTypes.TIMELINE
  );
  expect(uiTimeline?.id).toEqual(expect.any(String));
  const gantt = views.list.find(
    (view: { title?: string; type?: number }) => view.title === 'Task Gantt' && view.type === ViewTypes.GANTT
  );
  expect(gantt?.id).toEqual(expect.any(String));
  const uiGantt = views.list.find(
    (view: { title?: string; type?: number }) => view.title === 'Task Gantt UI' && view.type === ViewTypes.GANTT
  );
  expect(uiGantt?.id).toEqual(expect.any(String));

  const uiTimelineResponse = await page.request.get(`/api/v2/meta/timelines/${uiTimeline.id}`, {
    headers: sessionHeaders,
  });
  const uiTimelineMeta = await uiTimelineResponse.json();
  expect(uiTimelineResponse.ok(), JSON.stringify(uiTimelineMeta)).toBeTruthy();
  expect(uiTimelineMeta).toEqual(
    expect.objectContaining({
      fk_title_column_id: expect.any(String),
      fk_start_column_id: expect.any(String),
      fk_end_column_id: expect.any(String),
      zoom: 'day',
    })
  );
  expect(parseProp(uiTimelineMeta.meta)).toEqual(expect.objectContaining({ group_by_column_id: expect.any(String) }));

  const ganttResponse = await page.request.get(`/api/v2/meta/gantts/${gantt.id}`, {
    headers: sessionHeaders,
  });
  const ganttMeta = await ganttResponse.json();
  expect(ganttResponse.ok(), JSON.stringify(ganttMeta)).toBeTruthy();
  expect(ganttMeta).toEqual(
    expect.objectContaining({
      fk_title_column_id: expect.any(String),
      fk_start_column_id: expect.any(String),
      fk_end_column_id: expect.any(String),
      fk_progress_column_id: expect.any(String),
      fk_milestone_column_id: expect.any(String),
      zoom: 'month',
    })
  );

  const uiGanttResponse = await page.request.get(`/api/v2/meta/gantts/${uiGantt.id}`, {
    headers: sessionHeaders,
  });
  const uiGanttMeta = await uiGanttResponse.json();
  expect(uiGanttResponse.ok(), JSON.stringify(uiGanttMeta)).toBeTruthy();
  expect(uiGanttMeta).toEqual(
    expect.objectContaining({
      fk_title_column_id: expect.any(String),
      fk_start_column_id: expect.any(String),
      fk_end_column_id: expect.any(String),
      fk_progress_column_id: expect.any(String),
      fk_milestone_column_id: expect.any(String),
      zoom: 'week',
    })
  );

  const restartToday = new Date().toISOString().slice(0, 10);
  const expectedStartDate = new Date(Date.parse(`${restartToday}T00:00:00Z`) + 4 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const expectedEndDate = new Date(Date.parse(`${restartToday}T00:00:00Z`) + 6 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const restartRangeEnd = new Date(Date.parse(`${restartToday}T00:00:00Z`) + 5 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const persistedUiRangeResponse = await page.request.get(
    `/api/v2/timelines/${uiTimeline.id}/records?from=${restartToday}&to=${restartRangeEnd}&fields=Title`,
    { headers: sessionHeaders }
  );
  const persistedUiRange = await persistedUiRangeResponse.json();
  expect(persistedUiRangeResponse.ok(), JSON.stringify(persistedUiRange)).toBeTruthy();
  expect(persistedUiRange.list).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        Title: 'Current Timeline item',
        Status: 'Ready',
        'Timeline start': expectedStartDate,
        'Timeline end': expect.stringContaining(expectedEndDate),
      }),
      expect.objectContaining({
        Title: 'Ungrouped Timeline item',
        Status: null,
      }),
    ])
  );

  const expectedGanttStartDate = new Date(Date.parse(`${restartToday}T00:00:00Z`) + 4 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const expectedGanttEndDate = new Date(Date.parse(`${restartToday}T00:00:00Z`) + 6 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const persistedGanttRangeResponse = await page.request.get(
    `/api/v2/gantts/${uiGantt.id}/records?from=${restartToday}&to=${restartRangeEnd}&fields=Title`,
    { headers: sessionHeaders }
  );
  const persistedGanttRange = await persistedGanttRangeResponse.json();
  expect(persistedGanttRangeResponse.ok(), JSON.stringify(persistedGanttRange)).toBeTruthy();
  expect(persistedGanttRange.list).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        Title: 'Current Timeline item',
        'Timeline start': expectedGanttStartDate,
        'Timeline end': expect.stringContaining(expectedGanttEndDate),
        Progress: 40,
      }),
      expect.objectContaining({
        Title: 'Ungrouped Timeline item',
        Progress: 100,
      }),
    ])
  );
  const currentGanttRecord = persistedGanttRange.list.find(
    (record: { Title?: string }) => record.Title === 'Current Timeline item'
  );
  const milestoneGanttRecord = persistedGanttRange.list.find(
    (record: { Title?: string }) => record.Title === 'Ungrouped Timeline item'
  );
  expect([false, 0]).toContain(currentGanttRecord?.Milestone);
  expect([true, 1]).toContain(milestoneGanttRecord?.Milestone);
  const taskRecordsResponse = await page.request.get(`/api/v2/tables/${tasksTableMeta.id}/records?limit=100`, {
    headers: sessionHeaders,
  });
  const taskRecords = await taskRecordsResponse.json();
  expect(taskRecordsResponse.ok(), JSON.stringify(taskRecords)).toBeTruthy();
  const currentTaskRecord = taskRecords.list.find(
    (record: { Title?: string }) => record.Title === 'Current Timeline item'
  );
  const milestoneTaskRecord = taskRecords.list.find(
    (record: { Title?: string }) => record.Title === 'Ungrouped Timeline item'
  );
  const currentGanttRecordId = String(currentTaskRecord?.Id ?? currentTaskRecord?.id);
  const milestoneGanttRecordId = String(milestoneTaskRecord?.Id ?? milestoneTaskRecord?.id);
  expect(currentGanttRecordId).not.toBe('undefined');
  expect(milestoneGanttRecordId).not.toBe('undefined');
  const persistedDependencyResponse = await page.request.post(`/api/v2/meta/gantts/${uiGantt.id}/dependencies/query`, {
    headers: sessionHeaders,
    data: { record_ids: [currentGanttRecordId, milestoneGanttRecordId] },
  });
  const persistedDependencies = await persistedDependencyResponse.json();
  expect(persistedDependencyResponse.ok(), JSON.stringify(persistedDependencies)).toBeTruthy();
  expect(persistedDependencies.list).toEqual([
    expect.objectContaining({
      source_record_id: currentGanttRecordId,
      target_record_id: milestoneGanttRecordId,
      dependency_type: 'finish_start',
      lag_days: 2,
    }),
  ]);

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
  expect(parseProp(timelineMeta.meta)).toEqual(expect.objectContaining({ group_by_column_id: expect.any(String) }));

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
    expect.objectContaining({ Title: 'Persists across restart', Status: 'Ready', 'Timeline start': '2025-01-12' }),
  ]);

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

  await page.getByTestId('view-sidebar-view-Task Timeline UI').click();
  const timelineView = page.getByTestId('nc-timeline-wrapper');
  await expect(timelineView).toBeVisible({ timeout: 30_000 });
  await expect(timelineView.getByText('day', { exact: true })).toBeVisible();
  await expect(timelineView.getByTestId('nc-timeline-grouping-label')).toHaveText('Grouped by Status');
  const timelineCanvas = timelineView.getByTestId('nc-timeline-canvas');
  await expect(timelineCanvas).toHaveAttribute('data-total-items', '38');
  await expect(timelineCanvas).toHaveAttribute('data-total-groups', '2');
  expect(Number(await timelineCanvas.getAttribute('data-rendered-items'))).toBeLessThan(38);

  await timelineView.getByTestId('nc-timeline-scroll-region').evaluate(element => {
    element.scrollTop = element.scrollHeight;
    element.scrollLeft = element.scrollWidth;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(async () => Number(await timelineCanvas.getAttribute('data-rendered-items'))).toBeGreaterThan(0);
  await expect(
    timelineView.getByTestId('nc-timeline-item').filter({ hasText: 'Virtualized Timeline item' }).first()
  ).toBeVisible();

  await page.getByTestId('view-sidebar-view-Task Gantt UI').click();
  const ganttView = page.getByTestId('nc-gantt-wrapper');
  await expect(ganttView).toBeVisible({ timeout: 30_000 });
  const ganttCanvas = ganttView.getByTestId('nc-gantt-canvas');
  await expect(ganttCanvas).toHaveAttribute('data-total-tasks', '38');
  expect(Number(await ganttCanvas.getAttribute('data-rendered-tasks'))).toBeLessThan(38);
  await expect(ganttView.getByTestId('nc-gantt-task').filter({ hasText: 'Current Timeline item' })).toHaveAttribute(
    'data-progress',
    '40'
  );
  await expect(ganttView.locator('[data-testid="nc-gantt-task"][data-milestone="true"]')).toHaveCount(1);
  await expect(ganttView.getByTestId('nc-gantt-dependency-link')).toHaveCount(1);
  await expect(ganttView.getByTestId('nc-gantt-dependency-link')).toHaveAttribute('data-lag-days', '2');
  await page.getByTestId('nc-gantt-dependencies-toggle').click();
  await expect(page.getByTestId('nc-gantt-dependency-item')).toHaveCount(1);

  await ganttView.getByTestId('nc-gantt-scroll-region').evaluate(element => {
    element.scrollTop = element.scrollHeight;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(async () => Number(await ganttCanvas.getAttribute('data-rendered-tasks'))).toBeGreaterThan(0);
  await expect(
    ganttView.getByTestId('nc-gantt-row').filter({ hasText: 'Virtualized Timeline item' }).first()
  ).toBeVisible();

  const timelineDeleteResponse = await page.request.delete(`/api/v2/meta/views/${timeline.id}`, {
    headers: sessionHeaders,
  });
  expect(timelineDeleteResponse.ok()).toBeTruthy();
  const ganttDeleteResponse = await page.request.delete(`/api/v2/meta/views/${gantt.id}`, {
    headers: sessionHeaders,
  });
  expect(ganttDeleteResponse.ok()).toBeTruthy();

  await tasksTable.click();
  await expect(grid).toBeVisible({ timeout: 30_000 });

  await persistenceCell.dblclick();
  await persistenceCell.locator('input').fill('Persisted after restart');
  const updateResponse = page.waitForResponse(
    response => isDataRequest(response.url()) && response.request().method() === 'PATCH'
  );
  await grid.locator('[data-title="Title"] span[data-test-id="Title"]').click();
  expect((await updateResponse).ok()).toBeTruthy();
  await expect(persistenceCell).toContainText('Persisted after restart');

  await grid.locator('.nc-grid-add-new-cell').click();
  const newCell = grid.locator('[data-testid^="cell-Title-"]').last();
  await expect(newCell).toBeVisible();
  await newCell.dblclick();
  await newCell.locator('input').fill('Created after restart');
  const createResponse = page.waitForResponse(
    response => isDataRequest(response.url()) && ['POST', 'PATCH'].includes(response.request().method())
  );
  await grid.locator('[data-title="Title"] span[data-test-id="Title"]').click();
  expect((await createResponse).ok()).toBeTruthy();
  await expect(newCell).toContainText('Created after restart');

  await grid.locator('.nc-grid-wrapper').evaluateAll(elements => {
    for (const element of elements) {
      element.scrollTop = 0;
      element.dispatchEvent(new Event('scroll'));
    }
  });
  await expect(persistenceCell).toBeVisible();
  await persistenceCell.click({ button: 'right' });
  const deleteResponse = page.waitForResponse(
    response => isDataRequest(response.url()) && response.request().method() === 'DELETE'
  );
  await page.locator('.ant-dropdown-menu-item').filter({ hasText: 'Delete record' }).click();
  expect((await deleteResponse).ok()).toBeTruthy();
  await expect(grid.getByText('Persisted after restart', { exact: true })).toHaveCount(0);
  await expect(grid.getByText('Created after restart', { exact: true })).toBeVisible();
});
