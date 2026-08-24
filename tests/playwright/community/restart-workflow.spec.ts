import { expect, test } from '@playwright/test';
import { parseProp, ViewTypes } from 'nocodb-sdk';
import { getAuthToken } from './public-api-contract';

const isDataRequest = (url: string) => url.includes('/api/v1/db/data/noco/');

test('Community image preserves login, schema, and records across restart', async ({ page }) => {
  test.setTimeout(120_000);
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
  const snapshotFixtureTableMeta = tables.list.find((table: { title?: string }) => table.title === 'Snapshot fixture');
  expect(snapshotFixtureTableMeta?.id).toEqual(expect.any(String));
  expect(tables.list.find((table: { title?: string }) => table.title === 'Structural trash fixture')).toBeUndefined();

  const snapshotsResponse = await page.request.get(`/api/v2/meta/bases/${acceptanceBaseMeta.id}/snapshots`, {
    headers: sessionHeaders,
  });
  const snapshots = await snapshotsResponse.json();
  expect(snapshotsResponse.ok(), JSON.stringify(snapshots)).toBeTruthy();
  const restartSnapshot = snapshots.list.find(
    (snapshot: { title?: string }) => snapshot.title === 'Restart snapshot fixture'
  );
  expect(restartSnapshot).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      snapshot_base_id: expect.any(String),
      status: 'ready',
      format_version: 1,
      manifest: expect.objectContaining({
        format: 'nocodb-community-base-snapshot',
        format_version: 1,
        tables: expect.arrayContaining([expect.objectContaining({ title: 'Tasks' })]),
      }),
    })
  );
  expect(bases.list.some((base: { id?: string }) => base.id === restartSnapshot.snapshot_base_id)).toBe(false);

  const restoreSnapshotResponse = await page.request.post(
    `/api/v2/meta/bases/${acceptanceBaseMeta.id}/snapshots/${restartSnapshot.id}/restore`,
    {
      headers: sessionHeaders,
      data: { title: 'Snapshot recovery fixture' },
    }
  );
  const restoreSnapshot = await restoreSnapshotResponse.json();
  expect(restoreSnapshotResponse.ok(), JSON.stringify(restoreSnapshot)).toBeTruthy();
  expect(restoreSnapshot.base_id).toEqual(expect.any(String));

  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/v2/meta/bases/${restoreSnapshot.base_id}`, {
          headers: sessionHeaders,
        });
        if (!response.ok()) return 'missing';
        return (await response.json()).status || 'ready';
      },
      { timeout: 30_000 }
    )
    .toBe('ready');

  const restoredTablesResponse = await page.request.get(`/api/v2/meta/bases/${restoreSnapshot.base_id}/tables`, {
    headers: sessionHeaders,
  });
  const restoredTables = await restoredTablesResponse.json();
  expect(restoredTablesResponse.ok(), JSON.stringify(restoredTables)).toBeTruthy();
  const restoredTasks = restoredTables.list.find((table: { title?: string }) => table.title === 'Tasks');
  expect(restoredTasks?.id).toEqual(expect.any(String));
  const restoredSnapshotFixture = restoredTables.list.find(
    (table: { title?: string }) => table.title === 'Snapshot fixture'
  );
  expect(restoredSnapshotFixture?.id).toEqual(expect.any(String));
  const [originalRecordsResponse, restoredRecordsResponse] = await Promise.all([
    page.request.get(`/api/v2/tables/${snapshotFixtureTableMeta.id}/records?limit=1000`, { headers: sessionHeaders }),
    page.request.get(`/api/v2/tables/${restoredSnapshotFixture.id}/records?limit=1000`, { headers: sessionHeaders }),
  ]);
  const originalRecords = await originalRecordsResponse.json();
  const snapshotRecords = await restoredRecordsResponse.json();
  expect(originalRecordsResponse.ok(), JSON.stringify(originalRecords)).toBeTruthy();
  expect(restoredRecordsResponse.ok(), JSON.stringify(snapshotRecords)).toBeTruthy();
  expect(
    originalRecords.list.some((record: { Title?: string }) => record.Title === 'Created after snapshot boundary')
  ).toBe(true);
  expect(
    snapshotRecords.list.some((record: { Title?: string }) => record.Title === 'Created after snapshot boundary')
  ).toBe(false);

  const deleteSnapshotResponse = await page.request.delete(
    `/api/v2/meta/bases/${acceptanceBaseMeta.id}/snapshots/${restartSnapshot.id}`,
    { headers: sessionHeaders }
  );
  expect(deleteSnapshotResponse.ok(), await deleteSnapshotResponse.text()).toBeTruthy();
  const emptySnapshotsResponse = await page.request.get(`/api/v2/meta/bases/${acceptanceBaseMeta.id}/snapshots`, {
    headers: sessionHeaders,
  });
  expect((await emptySnapshotsResponse.json()).list).toEqual([]);

  const baseTrashResponse = await page.request.get(`/api/v2/meta/bases/${acceptanceBaseMeta.id}/trash`, {
    headers: sessionHeaders,
  });
  const baseTrash = await baseTrashResponse.json();
  expect(baseTrashResponse.ok(), JSON.stringify(baseTrash)).toBeTruthy();
  const fieldTrashEntry = baseTrash.list.find(
    (entry: { resource_type?: string; resource_name?: string }) =>
      entry.resource_type === 'field' && entry.resource_name === 'Field survives restart'
  );
  expect(fieldTrashEntry).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      resource_id: expect.any(String),
      parent_id: tasksTableMeta.id,
    })
  );
  const hiddenFieldTableResponse = await page.request.get(`/api/v2/meta/tables/${tasksTableMeta.id}`, {
    headers: sessionHeaders,
  });
  const hiddenFieldTable = await hiddenFieldTableResponse.json();
  expect(hiddenFieldTableResponse.ok(), JSON.stringify(hiddenFieldTable)).toBeTruthy();
  expect(
    hiddenFieldTable.columns.find((field: { id?: string }) => field.id === fieldTrashEntry.resource_id)
  ).toBeUndefined();
  const restoreFieldResponse = await page.request.post(
    `/api/v2/meta/bases/${acceptanceBaseMeta.id}/trash/${fieldTrashEntry.id}/restore`,
    { headers: sessionHeaders }
  );
  expect(restoreFieldResponse.ok(), await restoreFieldResponse.text()).toBeTruthy();
  expect(await restoreFieldResponse.json()).toEqual({
    restored: 1,
    resource_type: 'field',
    resource_id: fieldTrashEntry.resource_id,
    parent_id: tasksTableMeta.id,
  });
  const restoredFieldRecordsResponse = await page.request.get(`/api/v2/tables/${tasksTableMeta.id}/records?limit=100`, {
    headers: sessionHeaders,
  });
  const restoredFieldRecords = await restoredFieldRecordsResponse.json();
  expect(restoredFieldRecordsResponse.ok(), JSON.stringify(restoredFieldRecords)).toBeTruthy();
  expect(
    restoredFieldRecords.list.find((record: { Title?: string }) => record.Title === 'Field restart value fixture')
  ).toEqual(expect.objectContaining({ 'Field survives restart': 'Persisted hidden value' }));
  const structuralTrashEntry = baseTrash.list.find(
    (entry: { resource_type?: string; resource_name?: string }) =>
      entry.resource_type === 'table' && entry.resource_name === 'Structural trash fixture'
  );
  expect(structuralTrashEntry).toEqual(
    expect.objectContaining({ id: expect.any(String), resource_id: expect.any(String) })
  );
  const restoreStructuralTableResponse = await page.request.post(
    `/api/v2/meta/bases/${acceptanceBaseMeta.id}/trash/${structuralTrashEntry.id}/restore`,
    { headers: sessionHeaders }
  );
  expect(restoreStructuralTableResponse.ok(), await restoreStructuralTableResponse.text()).toBeTruthy();
  expect(await restoreStructuralTableResponse.json()).toEqual({
    restored: 1,
    resource_type: 'table',
    resource_id: structuralTrashEntry.resource_id,
  });
  const restoredStructuralRecordsResponse = await page.request.get(
    `/api/v2/tables/${structuralTrashEntry.resource_id}/records?limit=10`,
    { headers: sessionHeaders }
  );
  const restoredStructuralRecords = await restoredStructuralRecordsResponse.json();
  expect(restoredStructuralRecordsResponse.ok(), JSON.stringify(restoredStructuralRecords)).toBeTruthy();
  expect(restoredStructuralRecords.list).toEqual([expect.objectContaining({ Title: 'Table data survives Trash' })]);
  const restoredStructuralViewsResponse = await page.request.get(
    `/api/v2/meta/tables/${structuralTrashEntry.resource_id}/views`,
    { headers: sessionHeaders }
  );
  const restoredStructuralViews = await restoredStructuralViewsResponse.json();
  expect(restoredStructuralViewsResponse.ok(), JSON.stringify(restoredStructuralViews)).toBeTruthy();
  expect(restoredStructuralViews.list).toEqual([
    expect.objectContaining({ id: expect.any(String), type: ViewTypes.GRID }),
  ]);
  const deleteRestoredStructuralTableResponse = await page.request.delete(
    `/api/v2/meta/tables/${structuralTrashEntry.resource_id}`,
    { headers: sessionHeaders }
  );
  expect(deleteRestoredStructuralTableResponse.ok(), await deleteRestoredStructuralTableResponse.text()).toBeTruthy();

  const persistedTrashResponse = await page.request.get(`/api/v2/tables/${tasksTableMeta.id}/trash`, {
    headers: sessionHeaders,
  });
  const persistedTrash = await persistedTrashResponse.json();
  expect(persistedTrashResponse.ok(), JSON.stringify(persistedTrash)).toBeTruthy();
  const persistedTrashRecord = persistedTrash.list.find(
    (record: { row_data?: { Title?: string } }) => record.row_data?.Title === 'Trash survives restart'
  );
  expect(persistedTrashRecord).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      pk_data: expect.objectContaining({ Id: expect.anything() }),
      row_data: expect.objectContaining({ Title: 'Trash survives restart', Status: 'Blocked' }),
    })
  );
  const restorePersistedTrashResponse = await page.request.post(`/api/v2/tables/${tasksTableMeta.id}/trash/restore`, {
    headers: sessionHeaders,
    data: { trash_ids: [persistedTrashRecord.id] },
  });
  expect(restorePersistedTrashResponse.ok(), await restorePersistedTrashResponse.text()).toBeTruthy();

  const restoredTrashRecordsResponse = await page.request.get(`/api/v2/tables/${tasksTableMeta.id}/records?limit=100`, {
    headers: sessionHeaders,
  });
  const restoredTrashRecords = await restoredTrashRecordsResponse.json();
  expect(restoredTrashRecordsResponse.ok(), JSON.stringify(restoredTrashRecords)).toBeTruthy();
  const restoredTrashRecord = restoredTrashRecords.list.find(
    (record: { Title?: string }) => record.Title === 'Trash survives restart'
  );
  expect(restoredTrashRecord).toEqual(expect.objectContaining({ Id: expect.anything(), Status: 'Blocked' }));

  const retrashResponse = await page.request.post(`/api/v2/tables/${tasksTableMeta.id}/trash`, {
    headers: sessionHeaders,
    data: { records: [{ Id: restoredTrashRecord.Id }] },
  });
  const retrash = await retrashResponse.json();
  expect(retrashResponse.ok(), JSON.stringify(retrash)).toBeTruthy();
  const permanentDeleteResponse = await page.request.delete(`/api/v2/tables/${tasksTableMeta.id}/trash`, {
    headers: sessionHeaders,
    data: { trash_ids: [retrash.list[0].id] },
  });
  const permanentDelete = await permanentDeleteResponse.json();
  expect(permanentDeleteResponse.ok(), JSON.stringify(permanentDelete)).toBeTruthy();
  expect(permanentDelete).toEqual({ deleted: 1 });

  const emptyTrashResponse = await page.request.get(`/api/v2/tables/${tasksTableMeta.id}/trash`, {
    headers: sessionHeaders,
  });
  const emptyTrash = await emptyTrashResponse.json();
  expect(emptyTrashResponse.ok(), JSON.stringify(emptyTrash)).toBeTruthy();
  expect(emptyTrash.list).toEqual([]);

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
      working_calendar: {
        enabled: true,
        weekdays: [1, 2, 3, 4, 5],
        holidays: ['2026-01-01'],
        timezone: 'Asia/Seoul',
      },
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
      working_calendar: {
        enabled: true,
        weekdays: [1, 2, 3, 4, 5],
        holidays: ['2030-01-01'],
        timezone: 'UTC',
      },
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
