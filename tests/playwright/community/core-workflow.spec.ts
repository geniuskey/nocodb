import { expect, type Request, test } from '@playwright/test';
import { UITypes, ViewTypes } from 'nocodb-sdk';
import { expectPublicApiContract, expectPublicApiRuntimeCrud, getAuthToken } from './public-api-contract';

const isDataRequest = (url: string) => url.includes('/api/v1/db/data/noco/');

test('Community image supports signup, base, table, and record CRUD', async ({ page }) => {
  test.setTimeout(180_000);
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
  const titleColumn = statusColumnModel.columns.find((column: { title?: string }) => column.title === 'Title');
  expect(titleColumn?.id).toEqual(expect.any(String));
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

  const listFilterResponse = await page.request.post(`/api/v2/meta/views/${createdList.id}/filters`, {
    headers: sessionHeaders,
    data: {
      fk_column_id: createdStatusColumn.id,
      comparison_op: 'eq',
      value: 'Ready',
    },
  });
  const createdListFilter = await listFilterResponse.json();
  expect(listFilterResponse.ok(), JSON.stringify(createdListFilter)).toBeTruthy();
  const listSortResponse = await page.request.post(`/api/v2/meta/views/${createdList.id}/sorts/`, {
    headers: sessionHeaders,
    data: { fk_column_id: titleColumn.id, direction: 'asc' },
  });
  const createdListSort = await listSortResponse.json();
  expect(listSortResponse.ok(), JSON.stringify(createdListSort)).toBeTruthy();

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
  const ganttProgressColumn = await createTimelineColumn('Progress', UITypes.Number);
  const ganttMilestoneColumn = await createTimelineColumn('Milestone', UITypes.Checkbox);

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

  const invalidTimelineGroupUpdate = await page.request.patch(`/api/v2/meta/timelines/${createdTimeline.id}`, {
    headers: sessionHeaders,
    data: { meta: { group_by_column_id: 42 } },
  });
  expect(invalidTimelineGroupUpdate.status()).toBe(400);

  const timelineUpdateResponse = await page.request.patch(`/api/v2/meta/timelines/${createdTimeline.id}`, {
    headers: sessionHeaders,
    data: {
      fk_start_column_id: timelineStartColumn.id,
      fk_end_column_id: timelineEndColumn.id,
      zoom: 'month',
      meta: { group_by_column_id: createdStatusColumn.id },
    },
  });
  const updatedTimeline = await timelineUpdateResponse.json();
  expect(timelineUpdateResponse.ok(), JSON.stringify(updatedTimeline)).toBeTruthy();
  expect(updatedTimeline.view).toEqual(
    expect.objectContaining({
      fk_start_column_id: timelineStartColumn.id,
      fk_end_column_id: timelineEndColumn.id,
      zoom: 'month',
      meta: expect.objectContaining({ group_by_column_id: createdStatusColumn.id }),
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
      meta: expect.objectContaining({ group_by_column_id: createdStatusColumn.id }),
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
        Status: 'Ready',
        'Timeline start': '2025-01-05',
        'Timeline end': '2025-01-20T12:00:00Z',
        Progress: 65,
        Milestone: false,
      },
      {
        Title: 'Timeline point in range',
        Status: 'Blocked',
        'Timeline start': '2025-01-12',
        'Timeline end': null,
        Progress: 100,
        Milestone: true,
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

  const ganttCreateResponse = await page.request.post(`/api/v2/meta/tables/${createdTableBody.id}/gantts`, {
    headers: sessionHeaders,
    data: { title: 'Task Gantt', type: ViewTypes.GANTT },
  });
  const createdGantt = await ganttCreateResponse.json();
  expect(ganttCreateResponse.ok(), JSON.stringify(createdGantt)).toBeTruthy();
  expect(createdGantt).toEqual(
    expect.objectContaining({
      title: 'Task Gantt',
      type: ViewTypes.GANTT,
      view: expect.objectContaining({ zoom: 'week' }),
    })
  );
  expect(createdGantt.view.working_calendar).toEqual({
    enabled: false,
    weekdays: [1, 2, 3, 4, 5],
    holidays: [],
    timezone: 'UTC',
  });

  const unconfiguredGanttRange = await page.request.get(
    `/api/v2/gantts/${createdGantt.id}/records?from=2025-01-01&to=2025-02-01`,
    { headers: sessionHeaders }
  );
  expect(unconfiguredGanttRange.status()).toBe(400);

  const invalidGanttUpdate = await page.request.patch(`/api/v2/meta/gantts/${createdGantt.id}`, {
    headers: sessionHeaders,
    data: { fk_progress_column_id: createdStatusColumn.id },
  });
  expect(invalidGanttUpdate.status()).toBe(400);

  const ganttUpdateResponse = await page.request.patch(`/api/v2/meta/gantts/${createdGantt.id}`, {
    headers: sessionHeaders,
    data: {
      fk_title_column_id: titleColumn.id,
      fk_start_column_id: timelineStartColumn.id,
      fk_end_column_id: timelineEndColumn.id,
      fk_progress_column_id: ganttProgressColumn.id,
      fk_milestone_column_id: ganttMilestoneColumn.id,
      zoom: 'month',
    },
  });
  const updatedGantt = await ganttUpdateResponse.json();
  expect(ganttUpdateResponse.ok(), JSON.stringify(updatedGantt)).toBeTruthy();
  expect(updatedGantt.view).toEqual(
    expect.objectContaining({
      fk_title_column_id: titleColumn.id,
      fk_start_column_id: timelineStartColumn.id,
      fk_end_column_id: timelineEndColumn.id,
      fk_progress_column_id: ganttProgressColumn.id,
      fk_milestone_column_id: ganttMilestoneColumn.id,
      zoom: 'month',
    })
  );

  const ganttReadResponse = await page.request.get(`/api/v2/meta/gantts/${createdGantt.id}`, {
    headers: sessionHeaders,
  });
  const readGantt = await ganttReadResponse.json();
  expect(ganttReadResponse.ok(), JSON.stringify(readGantt)).toBeTruthy();
  expect(readGantt).toEqual(
    expect.objectContaining({
      fk_title_column_id: titleColumn.id,
      fk_start_column_id: timelineStartColumn.id,
      fk_end_column_id: timelineEndColumn.id,
      fk_progress_column_id: ganttProgressColumn.id,
      fk_milestone_column_id: ganttMilestoneColumn.id,
      zoom: 'month',
    })
  );

  const invalidWorkingCalendarResponse = await page.request.patch(`/api/v2/meta/gantts/${createdGantt.id}`, {
    headers: sessionHeaders,
    data: {
      working_calendar: {
        enabled: true,
        weekdays: [1, 2, 3, 4, 5],
        holidays: [],
        timezone: 'Not/A_Zone',
      },
    },
  });
  expect(invalidWorkingCalendarResponse.status()).toBe(400);

  const invalidGanttRanges = await Promise.all([
    page.request.get(`/api/v2/gantts/${createdGantt.id}/records?to=2025-01-15`, { headers: sessionHeaders }),
    page.request.get(`/api/v2/gantts/${createdGantt.id}/records?from=2025-02-01&to=2025-01-01`, {
      headers: sessionHeaders,
    }),
    page.request.get(`/api/v2/gantts/${createdGantt.id}/records?from=2025-01-01&to=2026-01-03`, {
      headers: sessionHeaders,
    }),
    page.request.get(`/api/v2/gantts/${createdGantt.id}/records?from=2025-01-01&to=2025-02-01&limit=1001`, {
      headers: sessionHeaders,
    }),
    page.request.get(`/api/v2/gantts/${createdList.id}/records?from=2025-01-01&to=2025-02-01`, {
      headers: sessionHeaders,
    }),
  ]);
  expect(invalidGanttRanges.map(response => response.status())).toEqual([400, 400, 400, 400, 400]);

  const ganttRangeResponse = await page.request.get(
    `/api/v1/db/gantt-data/${createdGantt.id}?from=2025-01-10&to=2025-01-15&fields=Title&limit=1`,
    { headers: sessionHeaders }
  );
  const ganttRange = await ganttRangeResponse.json();
  expect(ganttRangeResponse.ok(), JSON.stringify(ganttRange)).toBeTruthy();
  expect(ganttRange.pageInfo).toEqual(
    expect.objectContaining({ totalRows: 2, pageSize: 1, isFirstPage: true, isLastPage: false })
  );
  expect(ganttRange.list).toEqual([
    expect.objectContaining({
      Title: 'Timeline spanning range',
      'Timeline start': '2025-01-05',
      'Timeline end': expect.stringContaining('2025-01-20'),
      Progress: 65,
    }),
  ]);
  expect([false, 0]).toContain(ganttRange.list[0]?.Milestone);

  const insertedTimelineRecordsResponse = await page.request.get(
    `/api/v2/tables/${createdTableBody.id}/records?limit=100`,
    { headers: sessionHeaders }
  );
  const insertedTimelineRecordsBody = await insertedTimelineRecordsResponse.json();
  expect(insertedTimelineRecordsResponse.ok(), JSON.stringify(insertedTimelineRecordsBody)).toBeTruthy();
  const insertedTimelineRecords = insertedTimelineRecordsBody.list;
  const dependencySourceRecord = insertedTimelineRecords.find(
    (record: { Title?: string }) => record.Title === 'Timeline spanning range'
  );
  const dependencyTargetRecord = insertedTimelineRecords.find(
    (record: { Title?: string }) => record.Title === 'Timeline point in range'
  );
  const dependencyAfterRecord = insertedTimelineRecords.find(
    (record: { Title?: string }) => record.Title === 'Timeline after range'
  );
  const dependencySourceId = String(dependencySourceRecord?.Id ?? dependencySourceRecord?.id);
  const dependencyTargetId = String(dependencyTargetRecord?.Id ?? dependencyTargetRecord?.id);
  const dependencyAfterId = String(dependencyAfterRecord?.Id ?? dependencyAfterRecord?.id);
  expect(dependencySourceId).not.toBe('undefined');
  expect(dependencyTargetId).not.toBe('undefined');
  expect(dependencyAfterId).not.toBe('undefined');

  const emptyDependencyQueryResponse = await page.request.post(
    `/api/v2/meta/gantts/${createdGantt.id}/dependencies/query`,
    {
      headers: sessionHeaders,
      data: { record_ids: [dependencySourceId, dependencyTargetId] },
    }
  );
  expect(emptyDependencyQueryResponse.ok(), await emptyDependencyQueryResponse.text()).toBeTruthy();
  expect(await emptyDependencyQueryResponse.json()).toEqual({ list: [] });

  const dependencyCreateResponse = await page.request.post(`/api/v2/meta/gantts/${createdGantt.id}/dependencies`, {
    headers: sessionHeaders,
    data: {
      source_record_id: dependencySourceId,
      target_record_id: dependencyTargetId,
      dependency_type: 'finish_start',
      lag_days: 2,
    },
  });
  const createdDependency = await dependencyCreateResponse.json();
  expect(dependencyCreateResponse.ok(), JSON.stringify(createdDependency)).toBeTruthy();
  expect(createdDependency).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      fk_view_id: createdGantt.id,
      source_record_id: dependencySourceId,
      target_record_id: dependencyTargetId,
      dependency_type: 'finish_start',
      lag_days: 2,
    })
  );
  expect(createdDependency).not.toHaveProperty('source_record_hash');
  expect(createdDependency).not.toHaveProperty('target_record_hash');

  const branchingDependencyResponse = await page.request.post(`/api/v2/meta/gantts/${createdGantt.id}/dependencies`, {
    headers: sessionHeaders,
    data: {
      source_record_id: dependencySourceId,
      target_record_id: dependencyAfterId,
      dependency_type: 'finish_start',
      lag_days: 0,
    },
  });
  const branchingDependency = await branchingDependencyResponse.json();
  expect(branchingDependencyResponse.ok(), JSON.stringify(branchingDependency)).toBeTruthy();

  const criticalPathResponse = await page.request.get(`/api/v2/meta/gantts/${createdGantt.id}/schedule/critical-path`, {
    headers: sessionHeaders,
  });
  const criticalPath = await criticalPathResponse.json();
  expect(criticalPathResponse.ok(), JSON.stringify(criticalPath)).toBeTruthy();
  expect(criticalPath).toEqual(
    expect.objectContaining({
      analyzed_record_count: 3,
      component_count: 1,
      day_mode: 'calendar',
      critical_record_ids: expect.arrayContaining([dependencySourceId, dependencyTargetId]),
      critical_dependency_ids: [createdDependency.id],
    })
  );
  expect(criticalPath.critical_record_ids).not.toContain(dependencyAfterId);
  expect(criticalPath.tasks).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ record_id: dependencySourceId, title: 'Timeline spanning range', critical: true }),
      expect.objectContaining({ record_id: dependencyAfterId, title: 'Timeline after range', critical: false }),
      expect.objectContaining({ record_id: dependencyTargetId, critical: true }),
    ])
  );
  const nonCriticalTask = criticalPath.tasks.find(
    (task: { record_id: string }) => task.record_id === dependencyAfterId
  );
  const criticalBranchTask = criticalPath.tasks.find(
    (task: { record_id: string }) => task.record_id === dependencyTargetId
  );
  expect(nonCriticalTask.total_float_days).toBeGreaterThan(0);
  expect(criticalBranchTask.total_float_days).toBe(0);

  const branchingDependencyDeleteResponse = await page.request.delete(
    `/api/v2/meta/gantts/${createdGantt.id}/dependencies/${branchingDependency.id}`,
    { headers: sessionHeaders }
  );
  expect(branchingDependencyDeleteResponse.ok(), await branchingDependencyDeleteResponse.text()).toBeTruthy();

  const initialSchedulePreviewResponse = await page.request.post(
    `/api/v2/meta/gantts/${createdGantt.id}/schedule/preview`,
    {
      headers: sessionHeaders,
      data: { anchor_record_ids: [dependencySourceId] },
    }
  );
  const initialSchedulePreview = await initialSchedulePreviewResponse.json();
  expect(initialSchedulePreviewResponse.ok(), JSON.stringify(initialSchedulePreview)).toBeTruthy();
  expect(initialSchedulePreview).toEqual(
    expect.objectContaining({
      plan_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      anchor_record_ids: [dependencySourceId],
      applied: false,
      changes: [
        expect.objectContaining({
          record_id: dependencyTargetId,
          title: 'Timeline point in range',
          previous_start: '2025-01-12',
          next_start: '2025-01-23',
          delta_days: 11,
          driving_dependency_ids: [createdDependency.id],
        }),
      ],
    })
  );

  const changedDependencyResponse = await page.request.patch(
    `/api/v2/meta/gantts/${createdGantt.id}/dependencies/${createdDependency.id}`,
    {
      headers: sessionHeaders,
      data: { lag_days: 3 },
    }
  );
  expect(changedDependencyResponse.ok(), await changedDependencyResponse.text()).toBeTruthy();
  const staleScheduleApplyResponse = await page.request.post(`/api/v2/meta/gantts/${createdGantt.id}/schedule/apply`, {
    headers: sessionHeaders,
    data: {
      anchor_record_ids: [dependencySourceId],
      plan_hash: initialSchedulePreview.plan_hash,
    },
  });
  expect(staleScheduleApplyResponse.status()).toBe(400);

  const currentSchedulePreviewResponse = await page.request.post(
    `/api/v1/db/meta/gantts/${createdGantt.id}/schedule/preview`,
    {
      headers: sessionHeaders,
      data: { anchor_record_ids: [dependencySourceId] },
    }
  );
  const currentSchedulePreview = await currentSchedulePreviewResponse.json();
  expect(currentSchedulePreviewResponse.ok(), JSON.stringify(currentSchedulePreview)).toBeTruthy();
  expect(currentSchedulePreview.changes).toEqual([
    expect.objectContaining({
      record_id: dependencyTargetId,
      previous_start: '2025-01-12',
      next_start: '2025-01-24',
      delta_days: 12,
    }),
  ]);
  const scheduleApplyResponse = await page.request.post(`/api/v2/meta/gantts/${createdGantt.id}/schedule/apply`, {
    headers: sessionHeaders,
    data: {
      anchor_record_ids: [dependencySourceId],
      plan_hash: currentSchedulePreview.plan_hash,
    },
  });
  const appliedSchedule = await scheduleApplyResponse.json();
  expect(scheduleApplyResponse.ok(), JSON.stringify(appliedSchedule)).toBeTruthy();
  expect(appliedSchedule).toEqual(
    expect.objectContaining({ applied: true, plan_hash: currentSchedulePreview.plan_hash })
  );

  const scheduledRecordsResponse = await page.request.get(`/api/v2/tables/${createdTableBody.id}/records?limit=100`, {
    headers: sessionHeaders,
  });
  const scheduledRecords = (await scheduledRecordsResponse.json()).list;
  expect(scheduledRecordsResponse.ok()).toBeTruthy();
  expect(scheduledRecords.find((record: { Title?: string }) => record.Title === 'Timeline point in range')).toEqual(
    expect.objectContaining({ 'Timeline start': '2025-01-24' })
  );

  const invalidDependencyResponses = await Promise.all([
    page.request.post(`/api/v2/meta/gantts/${createdGantt.id}/dependencies`, {
      headers: sessionHeaders,
      data: {
        source_record_id: dependencySourceId,
        target_record_id: dependencyTargetId,
      },
    }),
    page.request.post(`/api/v2/meta/gantts/${createdGantt.id}/dependencies`, {
      headers: sessionHeaders,
      data: {
        source_record_id: dependencySourceId,
        target_record_id: dependencySourceId,
      },
    }),
    page.request.post(`/api/v2/meta/gantts/${createdGantt.id}/dependencies`, {
      headers: sessionHeaders,
      data: {
        source_record_id: dependencySourceId,
        target_record_id: `0${dependencySourceId}`,
      },
    }),
    page.request.post(`/api/v2/meta/gantts/${createdGantt.id}/dependencies`, {
      headers: sessionHeaders,
      data: {
        source_record_id: dependencyTargetId,
        target_record_id: dependencySourceId,
      },
    }),
    page.request.post(`/api/v2/meta/gantts/${createdGantt.id}/dependencies`, {
      headers: sessionHeaders,
      data: {
        source_record_id: dependencySourceId,
        target_record_id: 'missing-record',
      },
    }),
  ]);
  expect(invalidDependencyResponses.map(response => response.status())).toEqual([400, 400, 400, 400, 422]);

  const dependencyUpdateResponse = await page.request.patch(
    `/api/v2/meta/gantts/${createdGantt.id}/dependencies/${createdDependency.id}`,
    {
      headers: sessionHeaders,
      data: { dependency_type: 'start_start', lag_days: -1 },
    }
  );
  expect(dependencyUpdateResponse.ok(), await dependencyUpdateResponse.text()).toBeTruthy();
  expect(await dependencyUpdateResponse.json()).toEqual(
    expect.objectContaining({ dependency_type: 'start_start', lag_days: -1 })
  );

  const dependencyQueryResponse = await page.request.post(
    `/api/v1/db/meta/gantts/${createdGantt.id}/dependencies/query`,
    {
      headers: sessionHeaders,
      data: { record_ids: [dependencySourceId, dependencyTargetId] },
    }
  );
  expect(dependencyQueryResponse.ok(), await dependencyQueryResponse.text()).toBeTruthy();
  expect((await dependencyQueryResponse.json()).list).toEqual([
    expect.objectContaining({ id: createdDependency.id, dependency_type: 'start_start', lag_days: -1 }),
  ]);

  const dependencyDeleteResponse = await page.request.delete(
    `/api/v2/meta/gantts/${createdGantt.id}/dependencies/${createdDependency.id}`,
    { headers: sessionHeaders }
  );
  expect(dependencyDeleteResponse.ok(), await dependencyDeleteResponse.text()).toBeTruthy();
  expect(await dependencyDeleteResponse.json()).toEqual({ id: createdDependency.id });

  const emptyCriticalPathResponse = await page.request.get(
    `/api/v1/db/meta/gantts/${createdGantt.id}/schedule/critical-path`,
    { headers: sessionHeaders }
  );
  expect(emptyCriticalPathResponse.ok(), await emptyCriticalPathResponse.text()).toBeTruthy();
  expect(await emptyCriticalPathResponse.json()).toEqual({
    analyzed_record_count: 0,
    component_count: 0,
    day_mode: 'calendar',
    critical_record_ids: [],
    critical_dependency_ids: [],
    tasks: [],
    components: [],
  });

  const workingCalendarResponse = await page.request.patch(`/api/v2/meta/gantts/${createdGantt.id}`, {
    headers: sessionHeaders,
    data: {
      working_calendar: {
        enabled: true,
        weekdays: [1, 2, 3, 4, 5],
        holidays: ['2026-01-01'],
        timezone: 'Asia/Seoul',
      },
    },
  });
  expect(workingCalendarResponse.ok(), await workingCalendarResponse.text()).toBeTruthy();
  expect((await workingCalendarResponse.json()).view.working_calendar).toEqual({
    enabled: true,
    weekdays: [1, 2, 3, 4, 5],
    holidays: ['2026-01-01'],
    timezone: 'Asia/Seoul',
  });

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
      expect.objectContaining({
        id: createdGantt.id,
        title: 'Task Gantt',
        type: ViewTypes.GANTT,
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
  const deletedRecordResponse = await deleteRecordResponse;
  expect(deletedRecordResponse.ok()).toBeTruthy();
  expect(new URL(deletedRecordResponse.url()).searchParams.get('trash')).toBe('true');
  await expect(titleCell).toHaveCount(0);

  const deletedRecordTrashResponse = await page.request.get(`/api/v2/tables/${createdTableBody.id}/trash`, {
    headers: sessionHeaders,
  });
  const deletedRecordTrash = await deletedRecordTrashResponse.json();
  expect(deletedRecordTrashResponse.ok(), JSON.stringify(deletedRecordTrash)).toBeTruthy();
  const deletedRecordSnapshot = deletedRecordTrash.list.find(
    (record: { row_data?: { Title?: string } }) => record.row_data?.Title === 'Updated task'
  );
  expect(deletedRecordSnapshot?.id).toEqual(expect.any(String));
  const deletedRecordTrashCleanupResponse = await page.request.delete(`/api/v2/tables/${createdTableBody.id}/trash`, {
    headers: sessionHeaders,
    data: { trash_ids: [deletedRecordSnapshot.id] },
  });
  expect(deletedRecordTrashCleanupResponse.ok(), await deletedRecordTrashCleanupResponse.text()).toBeTruthy();

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

  const trashCandidatesResponse = await page.request.post(`/api/v2/tables/${createdTableBody.id}/records`, {
    headers: sessionHeaders,
    data: [{ Title: 'Trash restore round trip', Status: 'Ready' }],
  });
  const trashCandidates = await trashCandidatesResponse.json();
  expect(trashCandidatesResponse.ok(), JSON.stringify(trashCandidates)).toBeTruthy();
  const trashOptInDeleteResponse = await page.request.delete(
    `/api/v2/tables/${createdTableBody.id}/records?trash=true`,
    {
      headers: sessionHeaders,
      data: trashCandidates.map((record: { Id: number }) => ({ Id: record.Id })),
    }
  );
  const trashDeleteResult = await trashOptInDeleteResponse.json();
  expect(trashOptInDeleteResponse.ok(), JSON.stringify(trashDeleteResult)).toBeTruthy();
  expect(trashDeleteResult).toEqual([{ Id: trashCandidates[0].Id }]);
  const createdTrashResponse = await page.request.get(`/api/v2/tables/${createdTableBody.id}/trash`, {
    headers: sessionHeaders,
  });
  const createdTrash = await createdTrashResponse.json();
  expect(createdTrashResponse.ok(), JSON.stringify(createdTrash)).toBeTruthy();
  expect(createdTrash.list).toEqual([
    expect.objectContaining({
      record_id: String(trashCandidates[0].Id),
      row_data: expect.objectContaining({ Title: 'Trash restore round trip', Status: 'Ready' }),
    }),
  ]);

  const collisionResponse = await page.request.post(`/api/v2/tables/${createdTableBody.id}/records?undo=true`, {
    headers: sessionHeaders,
    data: { Id: trashCandidates[0].Id, Title: 'Trash PK collision', Status: 'Blocked' },
  });
  expect(collisionResponse.ok(), await collisionResponse.text()).toBeTruthy();
  const rejectedRestoreResponse = await page.request.post(`/api/v2/tables/${createdTableBody.id}/trash/restore`, {
    headers: sessionHeaders,
    data: { trash_ids: [createdTrash.list[0].id] },
  });
  expect(rejectedRestoreResponse.status()).toBe(422);
  const primaryConflictResponse = await page.request.post(`/api/v2/tables/${createdTableBody.id}/trash/conflicts`, {
    headers: sessionHeaders,
    data: { trash_ids: [createdTrash.list[0].id] },
  });
  const primaryConflict = await primaryConflictResponse.json();
  expect(primaryConflictResponse.ok(), JSON.stringify(primaryConflict)).toBeTruthy();
  expect(primaryConflict).toEqual(
    expect.objectContaining({
      total: 1,
      clean: 0,
      conflicted: 1,
      conflicts: [
        expect.objectContaining({
          record_id: String(trashCandidates[0].Id),
          issues: [expect.objectContaining({ type: 'primary_key', clearable: false })],
        }),
      ],
    })
  );
  const skippedPrimaryRestoreResponse = await page.request.post(`/api/v2/tables/${createdTableBody.id}/trash/restore`, {
    headers: sessionHeaders,
    data: { trash_ids: [createdTrash.list[0].id], mode: 'force' },
  });
  expect(skippedPrimaryRestoreResponse.ok(), await skippedPrimaryRestoreResponse.text()).toBeTruthy();
  expect(await skippedPrimaryRestoreResponse.json()).toEqual({ restored: 0, skipped: 1, conflicted: 1 });
  const collisionCleanupResponse = await page.request.delete(`/api/v2/tables/${createdTableBody.id}/records`, {
    headers: sessionHeaders,
    data: [{ Id: trashCandidates[0].Id }],
  });
  expect(collisionCleanupResponse.ok(), await collisionCleanupResponse.text()).toBeTruthy();

  const restoreTrashResponse = await page.request.post(`/api/v2/tables/${createdTableBody.id}/trash/restore`, {
    headers: sessionHeaders,
    data: { trash_ids: [createdTrash.list[0].id] },
  });
  const restoreTrash = await restoreTrashResponse.json();
  expect(restoreTrashResponse.ok(), JSON.stringify(restoreTrash)).toBeTruthy();
  expect(restoreTrash).toEqual({ restored: 1, skipped: 0, conflicted: 0 });

  const trashListResponse = await page.request.get(`/api/v2/tables/${createdTableBody.id}/trash`, {
    headers: sessionHeaders,
  });
  const trashList = await trashListResponse.json();
  expect(trashListResponse.ok(), JSON.stringify(trashList)).toBeTruthy();
  expect(trashList.list).toEqual([]);

  const restoredRecordsResponse = await page.request.get(`/api/v2/tables/${createdTableBody.id}/records?limit=100`, {
    headers: sessionHeaders,
  });
  const restoredRecords = await restoredRecordsResponse.json();
  expect(restoredRecordsResponse.ok(), JSON.stringify(restoredRecords)).toBeTruthy();
  expect(restoredRecords.list).toEqual(
    expect.arrayContaining([expect.objectContaining({ Title: 'Trash restore round trip', Status: 'Ready' })])
  );
  const roundTripCleanupResponse = await page.request.delete(`/api/v2/tables/${createdTableBody.id}/records`, {
    headers: sessionHeaders,
    data: [{ Id: trashCandidates[0].Id }],
  });
  expect(roundTripCleanupResponse.ok(), await roundTripCleanupResponse.text()).toBeTruthy();

  const restoreKeyColumnResponse = await page.request.post(`/api/v2/meta/tables/${createdTableBody.id}/columns`, {
    headers: sessionHeaders,
    data: {
      title: 'Restore key',
      column_name: 'Restore key',
      uidt: UITypes.Number,
      unique: true,
    },
  });
  const restoreKeyColumnModel = await restoreKeyColumnResponse.json();
  expect(restoreKeyColumnResponse.ok(), JSON.stringify(restoreKeyColumnModel)).toBeTruthy();
  const restoreKeyColumn = restoreKeyColumnModel.columns.find(
    (candidate: { title?: string }) => candidate.title === 'Restore key'
  );
  expect(restoreKeyColumn?.id).toEqual(expect.any(String));

  const clearableTrashCandidateResponse = await page.request.post(`/api/v2/tables/${createdTableBody.id}/records`, {
    headers: sessionHeaders,
    data: { Title: 'Clearable restore conflict', 'Restore key': 424242 },
  });
  const clearableTrashCandidate = await clearableTrashCandidateResponse.json();
  expect(clearableTrashCandidateResponse.ok(), JSON.stringify(clearableTrashCandidate)).toBeTruthy();
  const clearableTrashResponse = await page.request.post(`/api/v2/tables/${createdTableBody.id}/trash`, {
    headers: sessionHeaders,
    data: { records: [{ Id: clearableTrashCandidate.Id }] },
  });
  const clearableTrash = await clearableTrashResponse.json();
  expect(clearableTrashResponse.ok(), JSON.stringify(clearableTrash)).toBeTruthy();

  const renameRestoreKeyResponse = await page.request.patch(`/api/v2/meta/columns/${restoreKeyColumn.id}`, {
    headers: sessionHeaders,
    data: {
      title: 'Renamed restore key',
      column_name: restoreKeyColumn.column_name,
      uidt: UITypes.Number,
      unique: true,
    },
  });
  expect(renameRestoreKeyResponse.ok(), await renameRestoreKeyResponse.text()).toBeTruthy();
  const activeUniqueCollisionResponse = await page.request.post(
    `/api/v2/tables/${createdTableBody.id}/records?undo=true`,
    {
      headers: sessionHeaders,
      data: {
        Id: clearableTrashCandidate.Id + 1000,
        Title: 'Active unique collision',
        'Renamed restore key': 424242,
      },
    }
  );
  const activeUniqueCollision = await activeUniqueCollisionResponse.json();
  expect(activeUniqueCollisionResponse.ok(), JSON.stringify(activeUniqueCollision)).toBeTruthy();

  const clearableConflictResponse = await page.request.post(`/api/v2/tables/${createdTableBody.id}/trash/conflicts`, {
    headers: sessionHeaders,
    data: { trash_ids: [clearableTrash.list[0].id] },
  });
  const clearableConflict = await clearableConflictResponse.json();
  expect(clearableConflictResponse.ok(), JSON.stringify(clearableConflict)).toBeTruthy();
  expect(clearableConflict).toEqual(
    expect.objectContaining({
      total: 1,
      clean: 0,
      conflicted: 1,
      conflicts: [
        expect.objectContaining({
          issues: [
            expect.objectContaining({
              type: 'unique',
              field: 'Renamed restore key',
              clearable: true,
            }),
          ],
        }),
      ],
    })
  );
  const cleanConflictRestoreResponse = await page.request.post(`/api/v2/tables/${createdTableBody.id}/trash/restore`, {
    headers: sessionHeaders,
    data: { trash_ids: [clearableTrash.list[0].id], mode: 'clean' },
  });
  expect(cleanConflictRestoreResponse.ok(), await cleanConflictRestoreResponse.text()).toBeTruthy();
  expect(await cleanConflictRestoreResponse.json()).toEqual({ restored: 0, skipped: 1, conflicted: 1 });
  const forceConflictRestoreResponse = await page.request.post(`/api/v2/tables/${createdTableBody.id}/trash/restore`, {
    headers: sessionHeaders,
    data: { trash_ids: [clearableTrash.list[0].id], mode: 'force' },
  });
  expect(forceConflictRestoreResponse.ok(), await forceConflictRestoreResponse.text()).toBeTruthy();
  expect(await forceConflictRestoreResponse.json()).toEqual({ restored: 1, skipped: 0, conflicted: 1 });
  const forceRestoredRecordsResponse = await page.request.get(
    `/api/v2/tables/${createdTableBody.id}/records?limit=100`,
    { headers: sessionHeaders }
  );
  const forceRestoredRecords = await forceRestoredRecordsResponse.json();
  expect(forceRestoredRecordsResponse.ok(), JSON.stringify(forceRestoredRecords)).toBeTruthy();
  expect(forceRestoredRecords.list.find((record: { Id: number }) => record.Id === clearableTrashCandidate.Id)).toEqual(
    expect.objectContaining({ Title: 'Clearable restore conflict', 'Renamed restore key': null })
  );
  const clearableConflictCleanupResponse = await page.request.delete(`/api/v2/tables/${createdTableBody.id}/records`, {
    headers: sessionHeaders,
    data: [{ Id: clearableTrashCandidate.Id }, { Id: activeUniqueCollision.Id }],
  });
  expect(clearableConflictCleanupResponse.ok(), await clearableConflictCleanupResponse.text()).toBeTruthy();
  const legacyTrashCandidateResponse = await page.request.post(`/api/v2/tables/${createdTableBody.id}/records`, {
    headers: sessionHeaders,
    data: { Title: 'Legacy route trash opt-in', Status: 'Blocked' },
  });
  const legacyTrashCandidate = await legacyTrashCandidateResponse.json();
  expect(legacyTrashCandidateResponse.ok(), JSON.stringify(legacyTrashCandidate)).toBeTruthy();
  const legacyTrashDeleteResponse = await page.request.delete(
    `/api/v1/db/data/noco/${createdBaseBody.id}/${createdTableBody.id}/views/${createdList.id}/${legacyTrashCandidate.Id}?trash=true`,
    { headers: sessionHeaders }
  );
  expect(legacyTrashDeleteResponse.ok(), await legacyTrashDeleteResponse.text()).toBeTruthy();
  expect(await legacyTrashDeleteResponse.json()).toBe(1);
  const legacyTrashListResponse = await page.request.get(`/api/v2/tables/${createdTableBody.id}/trash`, {
    headers: sessionHeaders,
  });
  const legacyTrashList = await legacyTrashListResponse.json();
  expect(legacyTrashListResponse.ok(), JSON.stringify(legacyTrashList)).toBeTruthy();
  const legacyTrashSnapshot = legacyTrashList.list.find(
    (record: { row_data?: { Title?: string } }) => record.row_data?.Title === 'Legacy route trash opt-in'
  );
  expect(legacyTrashSnapshot?.id).toEqual(expect.any(String));
  const legacyTrashRestoreResponse = await page.request.post(`/api/v2/tables/${createdTableBody.id}/trash/restore`, {
    headers: sessionHeaders,
    data: { trash_ids: [legacyTrashSnapshot.id] },
  });
  expect(legacyTrashRestoreResponse.ok(), await legacyTrashRestoreResponse.text()).toBeTruthy();
  const legacyTrashCleanupResponse = await page.request.delete(`/api/v2/tables/${createdTableBody.id}/records`, {
    headers: sessionHeaders,
    data: { Id: legacyTrashCandidate.Id },
  });
  expect(legacyTrashCleanupResponse.ok(), await legacyTrashCleanupResponse.text()).toBeTruthy();

  const bulkTrashCandidatesResponse = await page.request.post(`/api/v2/tables/${createdTableBody.id}/records`, {
    headers: sessionHeaders,
    data: [
      ...Array.from({ length: 101 }, (_, index) => ({
        Title: `Bulk trash matching ${index + 1}`,
        Status: 'Ready',
      })),
      { Title: 'Bulk trash excluded', Status: 'Ready' },
    ],
  });
  const bulkTrashCandidates = await bulkTrashCandidatesResponse.json();
  expect(bulkTrashCandidatesResponse.ok(), JSON.stringify(bulkTrashCandidates)).toBeTruthy();
  const bulkTrashQuery = new URLSearchParams({
    where: '(Title,like,Bulk trash)',
    viewId: createdList.id,
    skipPks: String(bulkTrashCandidates[101].Id),
    trash: 'true',
  });
  const bulkTrashDeleteResponse = await page.request.delete(
    `/api/v1/db/data/bulk/noco/${createdBaseBody.id}/${createdTableBody.id}/all?${bulkTrashQuery}`,
    { headers: sessionHeaders }
  );
  const bulkTrashDeleted = await bulkTrashDeleteResponse.json();
  expect(bulkTrashDeleteResponse.ok(), JSON.stringify(bulkTrashDeleted)).toBeTruthy();
  expect(bulkTrashDeleted).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ Title: 'Bulk trash matching 1' }),
      expect.objectContaining({ Title: 'Bulk trash matching 101' }),
    ])
  );
  expect(bulkTrashDeleted).toHaveLength(101);

  const bulkTrashLiveQuery = new URLSearchParams({ where: '(Title,like,Bulk trash)', limit: '100' });
  const bulkTrashLiveResponse = await page.request.get(
    `/api/v2/tables/${createdTableBody.id}/records?${bulkTrashLiveQuery}`,
    { headers: sessionHeaders }
  );
  const bulkTrashLive = await bulkTrashLiveResponse.json();
  expect(bulkTrashLiveResponse.ok(), JSON.stringify(bulkTrashLive)).toBeTruthy();
  expect(bulkTrashLive.list).toEqual([expect.objectContaining({ Title: 'Bulk trash excluded' })]);

  const bulkTrashSnapshots: Array<{
    id: string;
    fk_trash_entry_id?: string;
    row_data?: { Title?: string };
  }> = [];
  for (const offset of [0, 100]) {
    const bulkTrashListResponse = await page.request.get(
      `/api/v2/tables/${createdTableBody.id}/trash?limit=100&offset=${offset}`,
      { headers: sessionHeaders }
    );
    const bulkTrashList = await bulkTrashListResponse.json();
    expect(bulkTrashListResponse.ok(), JSON.stringify(bulkTrashList)).toBeTruthy();
    bulkTrashSnapshots.push(...bulkTrashList.list);
  }
  expect(bulkTrashSnapshots).toHaveLength(101);
  expect(
    bulkTrashSnapshots.every((record: { row_data?: { Title?: string } }) =>
      record.row_data?.Title?.startsWith('Bulk trash matching')
    )
  ).toBe(true);
  expect(new Set(bulkTrashSnapshots.map(record => record.fk_trash_entry_id)).size).toBe(1);
  const baseTrashResponse = await page.request.get(`/api/v2/meta/bases/${createdBaseBody.id}/trash`, {
    headers: sessionHeaders,
  });
  const baseTrash = await baseTrashResponse.json();
  expect(baseTrashResponse.ok(), JSON.stringify(baseTrash)).toBeTruthy();
  expect(baseTrash.list).toEqual([
    expect.objectContaining({
      resource_type: 'records',
      resource_id: createdTableBody.id,
      resource_name: createdTableBody.title,
      record_count: 101,
    }),
  ]);
  expect(baseTrash.list[0].records).toHaveLength(8);
  for (const record of baseTrash.list[0].records) {
    expect(record.row_data.Title).toMatch(/^Bulk trash matching \d+$/);
  }
  const bulkTrashConflictResponse = await page.request.get(
    `/api/v2/meta/bases/${createdBaseBody.id}/trash/${baseTrash.list[0].id}/conflicts`,
    { headers: sessionHeaders }
  );
  const bulkTrashConflict = await bulkTrashConflictResponse.json();
  expect(bulkTrashConflictResponse.ok(), JSON.stringify(bulkTrashConflict)).toBeTruthy();
  expect(bulkTrashConflict).toEqual({
    total: 101,
    clean: 101,
    conflicted: 0,
    truncated: false,
    conflicts: [],
  });
  const bulkTrashRestoreResponse = await page.request.post(
    `/api/v2/meta/bases/${createdBaseBody.id}/trash/${baseTrash.list[0].id}/restore`,
    { headers: sessionHeaders }
  );
  expect(bulkTrashRestoreResponse.ok(), await bulkTrashRestoreResponse.text()).toBeTruthy();
  expect(await bulkTrashRestoreResponse.json()).toEqual({ restored: 101, skipped: 0, conflicted: 0 });
  for (let index = 0; index < bulkTrashCandidates.length; index += 100) {
    const bulkTrashCleanupResponse = await page.request.delete(`/api/v2/tables/${createdTableBody.id}/records`, {
      headers: sessionHeaders,
      data: bulkTrashCandidates.slice(index, index + 100).map((record: { Id: number }) => ({ Id: record.Id })),
    });
    expect(bulkTrashCleanupResponse.ok(), await bulkTrashCleanupResponse.text()).toBeTruthy();
  }

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
  const bulkDelete = await bulkDeleteResponse;
  expect(bulkDelete.ok()).toBeTruthy();
  expect(new URL(bulkDelete.url()).searchParams.get('trash')).toBe('true');
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
  const deleteAllMatching = await deleteAllMatchingResponse;
  expect(deleteAllMatching.ok()).toBeTruthy();
  expect(new URL(deleteAllMatching.url()).searchParams.get('trash')).toBe('true');

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

  const listBulkTrashResponse = await page.request.get(`/api/v2/tables/${createdTableBody.id}/trash?limit=100`, {
    headers: sessionHeaders,
  });
  const listBulkTrash = await listBulkTrashResponse.json();
  expect(listBulkTrashResponse.ok(), JSON.stringify(listBulkTrash)).toBeTruthy();
  expect(listBulkTrash.list).toHaveLength(30);
  expect(
    listBulkTrash.list.filter(
      (record: { row_data?: { Title?: string } }) => record.row_data?.Title === 'Bulk updated task'
    )
  ).toHaveLength(28);
  const listBulkTrashCleanupResponse = await page.request.delete(`/api/v2/meta/bases/${createdBaseBody.id}/trash`, {
    headers: sessionHeaders,
  });
  expect(listBulkTrashCleanupResponse.ok(), await listBulkTrashCleanupResponse.text()).toBeTruthy();
  expect(await listBulkTrashCleanupResponse.json()).toEqual({ deleted: 30 });

  const listViewTrashResponse = await page.request.delete(`/api/v2/meta/views/${createdList.id}`, {
    headers: sessionHeaders,
  });
  expect(listViewTrashResponse.ok(), await listViewTrashResponse.text()).toBeTruthy();
  const viewTrashListResponse = await page.request.get(`/api/v2/meta/bases/${createdBaseBody.id}/trash`, {
    headers: sessionHeaders,
  });
  const viewTrashList = await viewTrashListResponse.json();
  expect(viewTrashListResponse.ok(), JSON.stringify(viewTrashList)).toBeTruthy();
  expect(viewTrashList.list).toEqual([
    expect.objectContaining({
      resource_type: 'view',
      resource_id: createdList.id,
      resource_name: 'Task List',
      parent_id: createdTableBody.id,
      view_type: ViewTypes.LIST,
      record_count: 0,
      records: [],
    }),
  ]);
  const viewTrashEntryId = viewTrashList.list[0].id as string;
  const viewRestoreResponse = await page.request.post(
    `/api/v2/meta/bases/${createdBaseBody.id}/trash/${viewTrashEntryId}/restore`,
    { headers: sessionHeaders }
  );
  const restoredViewResult = await viewRestoreResponse.json();
  expect(viewRestoreResponse.ok(), JSON.stringify(restoredViewResult)).toBeTruthy();
  expect(restoredViewResult).toEqual({
    restored: 1,
    resource_type: 'view',
    resource_id: createdList.id,
    parent_id: createdTableBody.id,
  });
  const restoredListResponse = await page.request.get(`/api/v2/meta/tables/${createdTableBody.id}/views`, {
    headers: sessionHeaders,
  });
  const restoredViews = await restoredListResponse.json();
  expect(restoredListResponse.ok(), JSON.stringify(restoredViews)).toBeTruthy();
  const restoredList = restoredViews.list.find((view: { id?: string }) => view.id === createdList.id);
  expect(restoredList).toBeTruthy();
  expect(restoredList.view).toEqual(expect.objectContaining({ density: 'compact' }));
  expect(Boolean(restoredList.view.show_field_labels)).toBe(false);
  const restoredFiltersResponse = await page.request.get(`/api/v2/meta/views/${createdList.id}/filters`, {
    headers: sessionHeaders,
  });
  expect(restoredFiltersResponse.ok(), await restoredFiltersResponse.text()).toBeTruthy();
  expect((await restoredFiltersResponse.json()).list).toEqual([
    expect.objectContaining({ id: createdListFilter.id, fk_column_id: createdStatusColumn.id, value: 'Ready' }),
  ]);
  const restoredSortsResponse = await page.request.get(`/api/v2/meta/views/${createdList.id}/sorts/`, {
    headers: sessionHeaders,
  });
  expect(restoredSortsResponse.ok(), await restoredSortsResponse.text()).toBeTruthy();
  expect((await restoredSortsResponse.json()).list).toEqual([
    expect.objectContaining({ id: createdListSort.id, fk_column_id: titleColumn.id, direction: 'asc' }),
  ]);

  const secondViewTrashResponse = await page.request.delete(`/api/v2/meta/views/${createdList.id}`, {
    headers: sessionHeaders,
  });
  expect(secondViewTrashResponse.ok(), await secondViewTrashResponse.text()).toBeTruthy();
  const secondViewTrashListResponse = await page.request.get(`/api/v2/meta/bases/${createdBaseBody.id}/trash`, {
    headers: sessionHeaders,
  });
  const secondViewTrashList = await secondViewTrashListResponse.json();
  expect(secondViewTrashListResponse.ok(), JSON.stringify(secondViewTrashList)).toBeTruthy();
  const secondViewTrashEntryId = secondViewTrashList.list[0].id as string;

  await page.getByTestId('nc-topbar-base-trash').click();
  const baseTrashDialog = page.getByTestId('nc-base-trash-dialog');
  await expect(baseTrashDialog).toBeVisible();
  await expect(page.getByTestId(`nc-base-trash-entry-${secondViewTrashEntryId}`)).toContainText('Task List');
  const uiViewRestoreResponsePromise = page.waitForResponse(
    response =>
      response.url().includes(`/trash/${secondViewTrashEntryId}/restore`) && response.request().method() === 'POST'
  );
  await page.getByTestId(`nc-base-trash-restore-${secondViewTrashEntryId}`).click();
  const uiViewRestoreResponse = await uiViewRestoreResponsePromise;
  expect(uiViewRestoreResponse.ok(), await uiViewRestoreResponse.text()).toBeTruthy();
  await expect(page.getByTestId('nc-base-trash-empty-state')).toBeVisible();
  await page.getByTestId('nc-base-trash-close').click();
  await expect(baseTrashDialog).toBeHidden();
  const restoredViewListResponse = await page.request.get(`/api/v2/meta/tables/${createdTableBody.id}/views`, {
    headers: sessionHeaders,
  });
  expect(restoredViewListResponse.ok(), await restoredViewListResponse.text()).toBeTruthy();
  expect((await restoredViewListResponse.json()).list).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: createdList.id, title: 'Task List' })])
  );

  const currentTimelineDate = new Date().toISOString().slice(0, 10);
  const currentTimelineEnd = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
  const uiTimelineRecordResponse = await page.request.post(`/api/v2/tables/${createdTableBody.id}/records`, {
    headers: sessionHeaders,
    data: [
      {
        Title: 'Current Timeline item',
        Status: 'Ready',
        'Timeline start': currentTimelineDate,
        'Timeline end': currentTimelineEnd,
        Progress: 40,
        Milestone: false,
      },
      {
        Title: 'Ungrouped Timeline item',
        Status: null,
        'Timeline start': currentTimelineDate,
        'Timeline end': currentTimelineEnd,
        Progress: 100,
        Milestone: true,
      },
    ],
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
  await page.getByTestId('nc-timeline-settings-group').click();
  await page.locator('.ant-select-dropdown:visible').last().getByText('Status', { exact: true }).click();
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
  expect((await timelineZoomUpdate.json()).view).toEqual(
    expect.objectContaining({
      zoom: 'day',
      meta: expect.objectContaining({ group_by_column_id: createdStatusColumn.id }),
    })
  );
  await expect(timelineView.getByText('day', { exact: true })).toBeVisible();
  await expect(timelineView.getByTestId('nc-timeline-grouping-label')).toHaveText('Grouped by Status');
  await expect(timelineView.getByTestId('nc-timeline-group')).toHaveCount(2);
  await expect(timelineView.locator('[data-group-label="Ready"]')).toBeVisible();
  await expect(timelineView.locator('[data-group-label="Uncategorized"]')).toBeVisible();
  const rescheduledTimelineItem = timelineView
    .getByTestId('nc-timeline-item')
    .filter({ hasText: 'Current Timeline item' });
  await expect(rescheduledTimelineItem).toBeVisible();

  const readyGroupToggle = timelineView.locator('[data-group-label="Ready"]').getByTestId('nc-timeline-group-toggle');
  await expect(readyGroupToggle).toHaveAttribute('aria-expanded', 'true');
  await readyGroupToggle.click();
  await expect(readyGroupToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(rescheduledTimelineItem).toHaveCount(0);
  await readyGroupToggle.focus();
  await readyGroupToggle.press('Enter');
  await expect(readyGroupToggle).toHaveAttribute('aria-expanded', 'true');
  await expect(rescheduledTimelineItem).toBeVisible();

  const timelineItemBox = await rescheduledTimelineItem.boundingBox();
  expect(timelineItemBox).not.toBeNull();
  const rescheduleResponsePromise = page.waitForResponse(
    response => isDataRequest(response.url()) && response.request().method() === 'PATCH'
  );
  await page.mouse.move(timelineItemBox!.x + 16, timelineItemBox!.y + timelineItemBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(timelineItemBox!.x + 136, timelineItemBox!.y + timelineItemBox!.height / 2, { steps: 5 });
  await page.mouse.up();

  const rescheduleResponse = await rescheduleResponsePromise;
  expect(rescheduleResponse.ok(), await rescheduleResponse.text()).toBeTruthy();
  expect(rescheduleResponse.request().postDataJSON()).toEqual({
    'Timeline start': new Date(Date.parse(`${currentTimelineDate}T00:00:00Z`) + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10),
    'Timeline end': new Date(
      Math.floor(Date.parse(currentTimelineEnd) / 1000) * 1000 + 24 * 60 * 60 * 1000
    ).toISOString(),
  });
  await expect(page.getByTestId('nc-timeline-announcement')).toContainText('moved 1 day later');
  await expect(rescheduledTimelineItem).toBeVisible();

  await rescheduledTimelineItem.hover();
  const timelineEndResizeHandle = rescheduledTimelineItem.getByTestId('nc-timeline-resize-end');
  await expect(timelineEndResizeHandle).toBeVisible();
  const timelineEndResizeBox = await timelineEndResizeHandle.boundingBox();
  expect(timelineEndResizeBox).not.toBeNull();
  const resizeResponsePromise = page.waitForResponse(
    response => isDataRequest(response.url()) && response.request().method() === 'PATCH'
  );
  await page.mouse.move(
    timelineEndResizeBox!.x + timelineEndResizeBox!.width / 2,
    timelineEndResizeBox!.y + timelineEndResizeBox!.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    timelineEndResizeBox!.x + timelineEndResizeBox!.width / 2 + 120,
    timelineEndResizeBox!.y + timelineEndResizeBox!.height / 2,
    { steps: 5 }
  );
  await page.mouse.up();

  const resizeResponse = await resizeResponsePromise;
  expect(resizeResponse.ok(), await resizeResponse.text()).toBeTruthy();
  expect(resizeResponse.request().postDataJSON()).toEqual({
    'Timeline end': new Date(
      Math.floor(Date.parse(currentTimelineEnd) / 1000) * 1000 + 2 * 24 * 60 * 60 * 1000
    ).toISOString(),
  });
  await expect(page.getByTestId('nc-timeline-announcement')).toContainText('duration increased by 1 day');
  await expect(rescheduledTimelineItem).toBeVisible();

  const keyboardResizeResponsePromise = page.waitForResponse(
    response => isDataRequest(response.url()) && response.request().method() === 'PATCH'
  );
  await timelineEndResizeHandle.focus();
  await timelineEndResizeHandle.press('ArrowRight');
  const keyboardResizeResponse = await keyboardResizeResponsePromise;
  expect(keyboardResizeResponse.ok(), await keyboardResizeResponse.text()).toBeTruthy();
  expect(keyboardResizeResponse.request().postDataJSON()).toEqual({
    'Timeline end': new Date(
      Math.floor(Date.parse(currentTimelineEnd) / 1000) * 1000 + 3 * 24 * 60 * 60 * 1000
    ).toISOString(),
  });
  await expect(page.getByTestId('nc-timeline-announcement')).toContainText('duration increased by 1 day');

  await rescheduledTimelineItem.hover();
  const timelineStartResizeHandle = rescheduledTimelineItem.getByTestId('nc-timeline-resize-start');
  await expect(timelineStartResizeHandle).toBeVisible();
  const timelineStartResizeBox = await timelineStartResizeHandle.boundingBox();
  expect(timelineStartResizeBox).not.toBeNull();
  const startResizeResponsePromise = page.waitForResponse(
    response => isDataRequest(response.url()) && response.request().method() === 'PATCH'
  );
  await page.mouse.move(
    timelineStartResizeBox!.x + timelineStartResizeBox!.width / 2,
    timelineStartResizeBox!.y + timelineStartResizeBox!.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    timelineStartResizeBox!.x + timelineStartResizeBox!.width / 2 + 120,
    timelineStartResizeBox!.y + timelineStartResizeBox!.height / 2,
    { steps: 5 }
  );
  await page.mouse.up();

  const startResizeResponse = await startResizeResponsePromise;
  expect(startResizeResponse.ok(), await startResizeResponse.text()).toBeTruthy();
  expect(startResizeResponse.request().postDataJSON()).toEqual({
    'Timeline start': new Date(Date.parse(`${currentTimelineDate}T00:00:00Z`) + 2 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10),
  });
  await expect(page.getByTestId('nc-timeline-announcement')).toContainText('start moved 1 day later');

  const keyboardStartResizeResponsePromise = page.waitForResponse(
    response => isDataRequest(response.url()) && response.request().method() === 'PATCH'
  );
  await timelineStartResizeHandle.focus();
  await timelineStartResizeHandle.press('ArrowRight');
  const keyboardStartResizeResponse = await keyboardStartResizeResponsePromise;
  expect(keyboardStartResizeResponse.ok(), await keyboardStartResizeResponse.text()).toBeTruthy();
  expect(keyboardStartResizeResponse.request().postDataJSON()).toEqual({
    'Timeline start': new Date(Date.parse(`${currentTimelineDate}T00:00:00Z`) + 3 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10),
  });
  await expect(page.getByTestId('nc-timeline-announcement')).toContainText('start moved 1 day later');

  const virtualTimelineStart = new Date(Date.parse(`${currentTimelineDate}T00:00:00Z`) + 5 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  const virtualTimelineEnd = new Date(
    Date.parse(`${currentTimelineDate}T00:00:00Z`) + 6 * 24 * 60 * 60 * 1000
  ).toISOString();
  const virtualTimelineRecordsResponse = await page.request.post(`/api/v2/tables/${createdTableBody.id}/records`, {
    headers: sessionHeaders,
    data: Array.from({ length: 36 }, (_, index) => ({
      Title: `Virtualized Timeline item ${String(index + 1).padStart(2, '0')}`,
      Status: 'Ready',
      'Timeline start': virtualTimelineStart,
      'Timeline end': virtualTimelineEnd,
    })),
  });
  expect(virtualTimelineRecordsResponse.ok(), await virtualTimelineRecordsResponse.text()).toBeTruthy();

  const virtualTimelineNextResponse = page.waitForResponse(
    response => response.url().includes('/api/v1/db/timeline-data/') && response.request().method() === 'GET'
  );
  await page.getByTestId('nc-timeline-next').click();
  expect((await virtualTimelineNextResponse).ok()).toBeTruthy();
  const virtualTimelineTodayResponse = page.waitForResponse(
    response => response.url().includes('/api/v1/db/timeline-data/') && response.request().method() === 'GET'
  );
  await page.getByTestId('nc-timeline-today').click();
  expect((await virtualTimelineTodayResponse).ok()).toBeTruthy();

  const timelineCanvas = timelineView.getByTestId('nc-timeline-canvas');
  const timelineHeader = timelineView.getByTestId('nc-timeline-header');
  await expect(timelineCanvas).toHaveAttribute('data-total-items', '38');
  await expect(timelineCanvas).toHaveAttribute('data-total-groups', '2');

  const initiallyRenderedItems = Number(await timelineCanvas.getAttribute('data-rendered-items'));
  const initiallyRenderedDays = Number(await timelineHeader.getAttribute('data-rendered-days'));
  expect(initiallyRenderedItems).toBeGreaterThan(0);
  expect(initiallyRenderedItems).toBeLessThan(38);
  expect(initiallyRenderedDays).toBeGreaterThan(0);
  expect(initiallyRenderedDays).toBeLessThan(14);

  const pinnedTimelineItem = timelineView.getByTestId('nc-timeline-item').filter({ hasText: 'Current Timeline item' });
  await pinnedTimelineItem.focus();
  await timelineView.getByTestId('nc-timeline-scroll-region').evaluate(element => {
    element.scrollTop = element.scrollHeight;
    element.scrollLeft = element.scrollWidth;
    element.dispatchEvent(new Event('scroll'));
  });

  await expect(pinnedTimelineItem).toHaveCount(1);
  await expect(timelineView.locator('[data-day-index="13"]')).toBeVisible();
  await expect(timelineView.locator('[data-group-label="Uncategorized"]')).toBeVisible();
  await expect(
    timelineView.getByTestId('nc-timeline-item').filter({ hasText: 'Virtualized Timeline item' }).first()
  ).toBeVisible();

  await page.locator('.nc-create-view-btn').click();
  await page.getByTestId('sidebar-view-create-gantt').click();

  const ganttName = page.locator('.nc-view-create-modal .nc-view-input');
  await expect(ganttName).toBeVisible();
  await ganttName.fill('Task Gantt UI');

  await page.getByTestId('nc-gantt-start-field-select').click();
  await page.locator('.ant-select-dropdown:visible').getByText('Timeline start', { exact: true }).click();
  await page.getByTestId('nc-gantt-end-field-select').click();
  await page.locator('.ant-select-dropdown:visible').last().getByText('Timeline end', { exact: true }).click();
  await page.getByTestId('nc-gantt-progress-field-select').click();
  await page.locator('.ant-select-dropdown:visible').last().getByText('Progress', { exact: true }).click();
  await page.getByTestId('nc-gantt-milestone-field-select').click();
  await page.locator('.ant-select-dropdown:visible').last().getByText('Milestone', { exact: true }).click();

  const uiGanttCreateResponse = page.waitForResponse(
    response =>
      response.url().includes(`/meta/tables/${createdTableBody.id}/gantts`) && response.request().method() === 'POST'
  );
  const uiGanttUpdateResponse = page.waitForResponse(
    response => response.url().includes('/meta/gantts/') && response.request().method() === 'PATCH'
  );
  const firstGanttRangeResponse = page.waitForResponse(
    response => response.url().includes('/api/v1/db/gantt-data/') && response.request().method() === 'GET'
  );
  await page.getByTestId('nc-view-create-submit').click();

  const createdUiGantt = await (await uiGanttCreateResponse).json();
  expect(createdUiGantt).toEqual(expect.objectContaining({ title: 'Task Gantt UI', type: ViewTypes.GANTT }));
  const configuredUiGanttResponse = await uiGanttUpdateResponse;
  expect(configuredUiGanttResponse.ok()).toBeTruthy();
  expect((await configuredUiGanttResponse.json()).view).toEqual(
    expect.objectContaining({
      fk_title_column_id: titleColumn.id,
      fk_start_column_id: timelineStartColumn.id,
      fk_end_column_id: timelineEndColumn.id,
      fk_progress_column_id: ganttProgressColumn.id,
      fk_milestone_column_id: ganttMilestoneColumn.id,
      zoom: 'week',
    })
  );

  const initialGanttRange = await firstGanttRangeResponse;
  expect(initialGanttRange.ok(), await initialGanttRange.text()).toBeTruthy();
  const initialGanttRangeUrl = new URL(initialGanttRange.url());
  expect(initialGanttRangeUrl.searchParams.get('from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(initialGanttRangeUrl.searchParams.get('to')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(initialGanttRangeUrl.searchParams.get('limit')).toBe('1000');

  const ganttView = page.getByTestId('nc-gantt-wrapper');
  await expect(ganttView).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('nc-gantt-settings-toggle').click();
  await page.getByTestId('nc-gantt-working-calendar-enabled').check();
  await page.getByTestId('nc-gantt-working-calendar-holidays').fill('2030-01-01');
  const workingCalendarUiResponse = page.waitForResponse(
    response => response.url().includes(`/meta/gantts/${createdUiGantt.id}`) && response.request().method() === 'PATCH'
  );
  await page.getByTestId('nc-gantt-settings-save').click();
  expect((await workingCalendarUiResponse).ok()).toBeTruthy();
  await expect(ganttView.locator('[data-testid="nc-gantt-day"][data-working-day="false"]').first()).toBeVisible();
  const currentGanttTask = ganttView.getByTestId('nc-gantt-task').filter({ hasText: 'Current Timeline item' });
  await expect(currentGanttTask).toBeVisible();
  await expect(currentGanttTask).toHaveAttribute('data-progress', '40');
  await expect(currentGanttTask.getByTestId('nc-gantt-progress')).toBeVisible();
  await expect(ganttView.locator('[data-testid="nc-gantt-task"][data-milestone="true"]')).toHaveCount(1);
  await expect(ganttView.getByTestId('nc-gantt-row').filter({ hasText: 'Ungrouped Timeline item' })).toContainText(
    '100%'
  );

  await page.getByTestId('nc-gantt-dependencies-toggle').click();
  await expect(page.getByTestId('nc-gantt-dependencies-panel')).toBeVisible();
  await page.getByTestId('nc-gantt-dependency-source').click();
  await page.locator('.ant-select-dropdown:visible').last().getByText('Current Timeline item', { exact: true }).click();
  await page.getByTestId('nc-gantt-dependency-target').click();
  await page
    .locator('.ant-select-dropdown:visible')
    .last()
    .getByText('Ungrouped Timeline item', { exact: true })
    .click();
  await page.getByTestId('nc-gantt-dependency-lag').fill('2');
  const uiDependencyCreateResponse = page.waitForResponse(
    response =>
      response.url().includes(`/meta/gantts/${createdUiGantt.id}/dependencies`) &&
      !response.url().endsWith('/query') &&
      response.request().method() === 'POST'
  );
  await page.getByTestId('nc-gantt-dependency-add').click();
  const createdUiDependencyResponse = await uiDependencyCreateResponse;
  expect(createdUiDependencyResponse.ok(), await createdUiDependencyResponse.text()).toBeTruthy();
  const createdUiDependency = await createdUiDependencyResponse.json();
  expect(createdUiDependency).toEqual(expect.objectContaining({ dependency_type: 'finish_start', lag_days: 2 }));
  await expect(page.getByTestId('nc-gantt-dependency-item')).toHaveCount(1);
  await expect(page.getByTestId('nc-gantt-dependency-link')).toHaveCount(1);
  await expect(page.getByTestId('nc-gantt-dependency-link')).toHaveAttribute('data-dependency-type', 'finish_start');
  await expect(page.getByTestId('nc-gantt-dependency-link')).toHaveAttribute('data-lag-days', '2');

  const uiCriticalPathResponsePromise = page.waitForResponse(
    response =>
      response.url().includes(`/meta/gantts/${createdUiGantt.id}/schedule/critical-path`) &&
      response.request().method() === 'GET'
  );
  await page.getByTestId('nc-gantt-critical-path-toggle').click();
  const uiCriticalPathResponse = await uiCriticalPathResponsePromise;
  expect(uiCriticalPathResponse.ok(), await uiCriticalPathResponse.text()).toBeTruthy();
  await expect(page.getByTestId('nc-gantt-critical-path-summary')).toContainText('2 critical tasks');
  await expect(currentGanttTask).toHaveAttribute('data-critical', 'true');
  await expect(page.getByTestId('nc-gantt-dependency-link')).toHaveAttribute('data-critical', 'true');
  await page.getByTestId('nc-gantt-critical-path-toggle').click();
  await expect(page.getByTestId('nc-gantt-critical-path-summary')).toHaveCount(0);

  await page.getByTestId('nc-gantt-schedule-anchors').click();
  await page.locator('.ant-select-dropdown:visible').last().getByText('Current Timeline item', { exact: true }).click();
  await page.keyboard.press('Escape');
  const uiSchedulePreviewResponsePromise = page.waitForResponse(
    response =>
      response.url().includes(`/meta/gantts/${createdUiGantt.id}/schedule/preview`) &&
      response.request().method() === 'POST'
  );
  await page.getByTestId('nc-gantt-schedule-preview').click();
  const uiSchedulePreviewResponse = await uiSchedulePreviewResponsePromise;
  expect(uiSchedulePreviewResponse.ok(), await uiSchedulePreviewResponse.text()).toBeTruthy();
  await expect(page.getByTestId('nc-gantt-schedule-plan')).toBeVisible();
  await expect(page.getByTestId('nc-gantt-schedule-change')).toHaveCount(1);

  const uiScheduleApplyResponsePromise = page.waitForResponse(
    response =>
      response.url().includes(`/meta/gantts/${createdUiGantt.id}/schedule/apply`) &&
      response.request().method() === 'POST'
  );
  await page.getByTestId('nc-gantt-schedule-apply').click();
  const uiScheduleApplyResponse = await uiScheduleApplyResponsePromise;
  expect(uiScheduleApplyResponse.ok(), await uiScheduleApplyResponse.text()).toBeTruthy();
  await expect(page.getByTestId('nc-gantt-announcement')).toContainText('Applied 1 scheduled task change');

  // Keep the long-lived restart fixture inside its original bounded window.
  // The API contract above already verifies schedule persistence; this UI
  // assertion verifies the preview/confirm interaction and then restores the
  // shared fixture through the ordinary bulk row update.
  const uiTaskRowsResponse = await page.request.get(`/api/v2/tables/${createdTableBody.id}/records?limit=100`, {
    headers: sessionHeaders,
  });
  const uiTaskRows = (await uiTaskRowsResponse.json()).list;
  const ungroupedTask = uiTaskRows.find((record: { Title?: string }) => record.Title === 'Ungrouped Timeline item');
  const restoreScheduledTaskResponse = await page.request.patch(`/api/v2/tables/${createdTableBody.id}/records`, {
    headers: sessionHeaders,
    data: [
      {
        Id: ungroupedTask.Id,
        'Timeline start': currentTimelineDate,
        'Timeline end': currentTimelineEnd,
      },
    ],
  });
  expect(restoreScheduledTaskResponse.ok(), await restoreScheduledTaskResponse.text()).toBeTruthy();

  await page.getByTestId('nc-gantt-next').click();
  await expect(currentGanttTask).toHaveCount(0);
  await page.getByTestId('nc-gantt-today').click();
  await expect(currentGanttTask).toBeVisible();

  const ganttKeyboardMoveResponsePromise = page.waitForResponse(
    response => isDataRequest(response.url()) && response.request().method() === 'PATCH'
  );
  await currentGanttTask.focus();
  await currentGanttTask.press('ArrowRight');
  const ganttKeyboardMoveResponse = await ganttKeyboardMoveResponsePromise;
  expect(ganttKeyboardMoveResponse.ok(), await ganttKeyboardMoveResponse.text()).toBeTruthy();
  expect(ganttKeyboardMoveResponse.request().postDataJSON()).toEqual({
    'Timeline start': new Date(Date.parse(`${currentTimelineDate}T00:00:00Z`) + 4 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10),
    'Timeline end': new Date(
      Math.floor(Date.parse(currentTimelineEnd) / 1000) * 1000 + 4 * 24 * 60 * 60 * 1000
    ).toISOString(),
  });
  await expect(page.getByTestId('nc-gantt-announcement')).toContainText('moved 1 day');

  const trashUiRecordsResponse = await page.request.post(`/api/v2/tables/${createdTableBody.id}/records`, {
    headers: sessionHeaders,
    data: [
      { Title: 'Restore from trash UI', Status: 'Ready' },
      { Title: 'Permanently delete from trash UI', Status: 'Blocked' },
    ],
  });
  const trashUiRecords = await trashUiRecordsResponse.json();
  expect(trashUiRecordsResponse.ok(), JSON.stringify(trashUiRecords)).toBeTruthy();
  const trashUiCreateResponse = await page.request.post(`/api/v2/tables/${createdTableBody.id}/trash`, {
    headers: sessionHeaders,
    data: { records: trashUiRecords.map((record: { Id: number }) => ({ Id: record.Id })) },
  });
  const trashUiSnapshots = await trashUiCreateResponse.json();
  expect(trashUiCreateResponse.ok(), JSON.stringify(trashUiSnapshots)).toBeTruthy();
  expect(trashUiSnapshots.list).toHaveLength(2);
  const trashUiCollisionResponse = await page.request.post(`/api/v2/tables/${createdTableBody.id}/records?undo=true`, {
    headers: sessionHeaders,
    data: {
      Id: trashUiRecords[0].Id,
      Title: 'Active collision for trash UI',
      Status: 'Blocked',
    },
  });
  expect(trashUiCollisionResponse.ok(), await trashUiCollisionResponse.text()).toBeTruthy();

  const tableContextMenu = page.getByTestId('nc-sidebar-table-context-menu').first();
  await tableContextMenu.locator('xpath=ancestor::*[contains(@class,"nc-sidebar-node")][1]').hover();
  await tableContextMenu.click();
  await page.getByTestId('nc-sidebar-table-trash').click();
  const trashDialog = page.getByTestId('nc-record-trash-dialog');
  await expect(trashDialog).toBeVisible();
  await expect(trashDialog).toContainText('Restore from trash UI');
  await expect(trashDialog).toContainText('Permanently delete from trash UI');

  const uiConflictResponsePromise = page.waitForResponse(
    response =>
      response.url().endsWith(`/tables/${createdTableBody.id}/trash/conflicts`) &&
      response.request().method() === 'POST'
  );
  await page.getByTestId(`nc-record-trash-restore-${trashUiSnapshots.list[0].id}`).click();
  const uiConflictResponse = await uiConflictResponsePromise;
  expect(uiConflictResponse.ok(), await uiConflictResponse.text()).toBeTruthy();
  await expect(page.getByTestId('nc-record-trash-conflicts')).toContainText('primary key is already used');
  await expect(page.getByTestId('nc-record-trash-conflicts')).toContainText('Cannot force');

  const uiForceRestoreResponsePromise = page.waitForResponse(
    response =>
      response.url().endsWith(`/tables/${createdTableBody.id}/trash/restore`) && response.request().method() === 'POST'
  );
  await page.getByTestId('nc-record-trash-restore-force').click();
  const uiForceRestoreResponse = await uiForceRestoreResponsePromise;
  expect(uiForceRestoreResponse.ok(), await uiForceRestoreResponse.text()).toBeTruthy();
  expect(await uiForceRestoreResponse.json()).toEqual({ restored: 0, skipped: 1, conflicted: 1 });
  await expect(page.getByTestId('nc-record-trash-conflicts')).toHaveCount(0);
  await expect(page.getByTestId(`nc-record-trash-row-${trashUiSnapshots.list[0].id}`)).toBeVisible();

  const trashUiCollisionCleanupResponse = await page.request.delete(`/api/v2/tables/${createdTableBody.id}/records`, {
    headers: sessionHeaders,
    data: [{ Id: trashUiRecords[0].Id }],
  });
  expect(trashUiCollisionCleanupResponse.ok(), await trashUiCollisionCleanupResponse.text()).toBeTruthy();

  const uiRestoreResponsePromise = page.waitForResponse(
    response =>
      response.url().endsWith(`/tables/${createdTableBody.id}/trash/restore`) && response.request().method() === 'POST'
  );
  await page.getByTestId(`nc-record-trash-restore-${trashUiSnapshots.list[0].id}`).click();
  const uiRestoreResponse = await uiRestoreResponsePromise;
  expect(uiRestoreResponse.ok(), await uiRestoreResponse.text()).toBeTruthy();
  await expect(page.getByTestId(`nc-record-trash-row-${trashUiSnapshots.list[0].id}`)).toHaveCount(0);

  await page.getByTestId(`nc-record-trash-delete-${trashUiSnapshots.list[1].id}`).click();
  await expect(page.locator('.ant-modal-confirm')).toContainText('This cannot be undone.');
  const uiPermanentDeleteResponsePromise = page.waitForResponse(
    response =>
      response.url().endsWith(`/tables/${createdTableBody.id}/trash`) && response.request().method() === 'DELETE'
  );
  await page.locator('.ant-modal-confirm').getByRole('button', { name: 'Delete permanently' }).click();
  const uiPermanentDeleteResponse = await uiPermanentDeleteResponsePromise;
  expect(uiPermanentDeleteResponse.ok(), await uiPermanentDeleteResponse.text()).toBeTruthy();
  await expect(page.getByTestId('nc-record-trash-empty')).toBeVisible();
  await page.getByTestId('nc-record-trash-close').click();

  const trashUiLiveRecordsResponse = await page.request.get(`/api/v2/tables/${createdTableBody.id}/records?limit=100`, {
    headers: sessionHeaders,
  });
  const trashUiLiveRecords = await trashUiLiveRecordsResponse.json();
  expect(trashUiLiveRecordsResponse.ok(), JSON.stringify(trashUiLiveRecords)).toBeTruthy();
  expect(trashUiLiveRecords.list).toEqual(
    expect.arrayContaining([expect.objectContaining({ Title: 'Restore from trash UI', Status: 'Ready' })])
  );
  const restoredTrashUiRecord = trashUiLiveRecords.list.find(
    (record: { Id: number; Title?: string }) => record.Title === 'Restore from trash UI'
  );
  const trashUiCleanupResponse = await page.request.delete(`/api/v2/tables/${createdTableBody.id}/records`, {
    headers: sessionHeaders,
    data: [{ Id: restoredTrashUiRecord.Id }],
  });
  expect(trashUiCleanupResponse.ok(), await trashUiCleanupResponse.text()).toBeTruthy();

  const dependentFieldTrashResponse = await page.request.delete(
    `/api/v2/meta/columns/${timelineStartColumn.id}?trash=true`,
    { headers: sessionHeaders }
  );
  expect(dependentFieldTrashResponse.status()).toBe(400);
  const dependentFieldResponse = await page.request.get(`/api/v2/meta/columns/${timelineStartColumn.id}`, {
    headers: sessionHeaders,
  });
  expect(dependentFieldResponse.ok(), await dependentFieldResponse.text()).toBeTruthy();

  const createTrashField = async (title: string, columnName = title) => {
    const response = await page.request.post(`/api/v2/meta/tables/${createdTableBody.id}/columns`, {
      headers: sessionHeaders,
      data: { title, column_name: columnName, uidt: UITypes.SingleLineText },
    });
    const model = await response.json();
    expect(response.ok(), JSON.stringify(model)).toBeTruthy();
    const field = model.columns.find((candidate: { title?: string }) => candidate.title === title);
    expect(field?.id).toEqual(expect.any(String));
    return field;
  };

  const recoverableField = await createTrashField('Recoverable field');
  const recoverableFieldRecordResponse = await page.request.post(`/api/v2/tables/${createdTableBody.id}/records`, {
    headers: sessionHeaders,
    data: { Title: 'Field Trash value fixture', 'Recoverable field': 'Value survives field Trash' },
  });
  const recoverableFieldRecord = await recoverableFieldRecordResponse.json();
  expect(recoverableFieldRecordResponse.ok(), JSON.stringify(recoverableFieldRecord)).toBeTruthy();

  const fieldTrashResponse = await page.request.delete(`/api/v2/meta/columns/${recoverableField.id}?trash=true`, {
    headers: sessionHeaders,
  });
  expect(fieldTrashResponse.ok(), await fieldTrashResponse.text()).toBeTruthy();
  const hiddenFieldTableResponse = await page.request.get(`/api/v2/meta/tables/${createdTableBody.id}`, {
    headers: sessionHeaders,
  });
  const hiddenFieldTable = await hiddenFieldTableResponse.json();
  expect(hiddenFieldTableResponse.ok(), JSON.stringify(hiddenFieldTable)).toBeTruthy();
  expect(hiddenFieldTable.columns.find((field: { id?: string }) => field.id === recoverableField.id)).toBeUndefined();
  const hiddenFieldRecordsResponse = await page.request.get(`/api/v2/tables/${createdTableBody.id}/records?limit=100`, {
    headers: sessionHeaders,
  });
  const hiddenFieldRecords = await hiddenFieldRecordsResponse.json();
  expect(hiddenFieldRecordsResponse.ok(), JSON.stringify(hiddenFieldRecords)).toBeTruthy();
  const hiddenFieldRecord = hiddenFieldRecords.list.find(
    (record: { Title?: string }) => record.Title === 'Field Trash value fixture'
  );
  expect(hiddenFieldRecord).not.toHaveProperty('Recoverable field');

  const fieldBaseTrashResponse = await page.request.get(`/api/v2/meta/bases/${createdBaseBody.id}/trash`, {
    headers: sessionHeaders,
  });
  const fieldBaseTrash = await fieldBaseTrashResponse.json();
  expect(fieldBaseTrashResponse.ok(), JSON.stringify(fieldBaseTrash)).toBeTruthy();
  const fieldTrashEntry = fieldBaseTrash.list.find(
    (entry: { resource_type?: string; resource_id?: string }) =>
      entry.resource_type === 'field' && entry.resource_id === recoverableField.id
  );
  expect(fieldTrashEntry).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      parent_id: createdTableBody.id,
      resource_name: 'Recoverable field',
      record_count: 0,
      records: [],
    })
  );

  const replacementFieldResponse = await page.request.post(`/api/v2/meta/tables/${createdTableBody.id}/columns`, {
    headers: sessionHeaders,
    data: {
      title: 'Recoverable field',
      column_name: 'recoverable_field_replacement',
      uidt: UITypes.SingleLineText,
    },
  });
  expect(replacementFieldResponse.status()).toBe(422);
  const fieldRestoreResponse = await page.request.post(
    `/api/v2/meta/bases/${createdBaseBody.id}/trash/${fieldTrashEntry.id}/restore`,
    { headers: sessionHeaders }
  );
  expect(fieldRestoreResponse.ok(), await fieldRestoreResponse.text()).toBeTruthy();
  expect(await fieldRestoreResponse.json()).toEqual({
    restored: 1,
    resource_type: 'field',
    resource_id: recoverableField.id,
    parent_id: createdTableBody.id,
  });
  const restoredFieldRecordsResponse = await page.request.get(
    `/api/v2/tables/${createdTableBody.id}/records?limit=100`,
    { headers: sessionHeaders }
  );
  const restoredFieldRecords = await restoredFieldRecordsResponse.json();
  expect(restoredFieldRecordsResponse.ok(), JSON.stringify(restoredFieldRecords)).toBeTruthy();
  expect(
    restoredFieldRecords.list.find((record: { Title?: string }) => record.Title === 'Field Trash value fixture')
  ).toEqual(expect.objectContaining({ 'Recoverable field': 'Value survives field Trash' }));

  const purgeField = await createTrashField('Field purge fixture');
  const purgeFieldTrashResponse = await page.request.delete(`/api/v2/meta/columns/${purgeField.id}?trash=true`, {
    headers: sessionHeaders,
  });
  expect(purgeFieldTrashResponse.ok(), await purgeFieldTrashResponse.text()).toBeTruthy();
  const emptyFieldTrashResponse = await page.request.delete(`/api/v2/meta/bases/${createdBaseBody.id}/trash`, {
    headers: sessionHeaders,
  });
  const emptyFieldTrash = await emptyFieldTrashResponse.json();
  expect(emptyFieldTrashResponse.ok(), JSON.stringify(emptyFieldTrash)).toBeTruthy();
  expect(emptyFieldTrash.deleted).toBeGreaterThanOrEqual(1);
  const recreatedPurgeField = await createTrashField('Field purge fixture');
  const recreatedPurgeFieldDeleteResponse = await page.request.delete(
    `/api/v2/meta/columns/${recreatedPurgeField.id}`,
    { headers: sessionHeaders }
  );
  expect(recreatedPurgeFieldDeleteResponse.ok(), await recreatedPurgeFieldDeleteResponse.text()).toBeTruthy();

  const createStructuralTrashTable = (title = 'Structural trash fixture', tableName = title) =>
    page.request.post(`/api/v2/meta/bases/${createdBaseBody.id}/${createdTableBody.source_id}/tables`, {
      headers: sessionHeaders,
      data: {
        title,
        table_name: tableName,
        columns: [
          { title: 'Id', column_name: 'Id', uidt: UITypes.ID, pk: true, ai: true },
          { title: 'Title', column_name: 'Title', uidt: UITypes.SingleLineText, pv: true },
        ],
      },
    });
  const structuralTableResponse = await createStructuralTrashTable();
  const structuralTable = await structuralTableResponse.json();
  expect(structuralTableResponse.ok(), JSON.stringify(structuralTable)).toBeTruthy();
  expect(structuralTable).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      source_id: createdTableBody.source_id,
      title: 'Structural trash fixture',
    })
  );
  const structuralViewResponse = await page.request.get(`/api/v2/meta/tables/${structuralTable.id}/views`, {
    headers: sessionHeaders,
  });
  const structuralViews = await structuralViewResponse.json();
  expect(structuralViewResponse.ok(), JSON.stringify(structuralViews)).toBeTruthy();
  expect(structuralViews.list).toEqual([expect.objectContaining({ id: expect.any(String), type: ViewTypes.GRID })]);
  const structuralRecordResponse = await page.request.post(`/api/v2/tables/${structuralTable.id}/records`, {
    headers: sessionHeaders,
    data: { Title: 'Table data survives Trash' },
  });
  const structuralRecord = await structuralRecordResponse.json();
  expect(structuralRecordResponse.ok(), JSON.stringify(structuralRecord)).toBeTruthy();

  const structuralTrashResponse = await page.request.delete(`/api/v2/meta/tables/${structuralTable.id}?trash=true`, {
    headers: sessionHeaders,
  });
  expect(structuralTrashResponse.ok(), await structuralTrashResponse.text()).toBeTruthy();
  const hiddenStructuralTableResponse = await page.request.get(`/api/v2/meta/tables/${structuralTable.id}`, {
    headers: sessionHeaders,
  });
  expect(hiddenStructuralTableResponse.status()).toBe(404);
  const structuralBaseTrashResponse = await page.request.get(`/api/v2/meta/bases/${createdBaseBody.id}/trash`, {
    headers: sessionHeaders,
  });
  const structuralBaseTrash = await structuralBaseTrashResponse.json();
  expect(structuralBaseTrashResponse.ok(), JSON.stringify(structuralBaseTrash)).toBeTruthy();
  const structuralTrashEntry = structuralBaseTrash.list.find(
    (entry: { resource_type?: string; resource_id?: string }) =>
      entry.resource_type === 'table' && entry.resource_id === structuralTable.id
  );
  expect(structuralTrashEntry).toEqual(
    expect.objectContaining({
      id: expect.any(String),
      resource_name: 'Structural trash fixture',
      record_count: 0,
      records: [],
    })
  );

  const replacementStructuralTableResponse = await createStructuralTrashTable(
    'Structural trash fixture',
    'Structural trash replacement'
  );
  const replacementStructuralTable = await replacementStructuralTableResponse.json();
  expect(replacementStructuralTableResponse.ok(), JSON.stringify(replacementStructuralTable)).toBeTruthy();
  const conflictedStructuralRestoreResponse = await page.request.post(
    `/api/v2/meta/bases/${createdBaseBody.id}/trash/${structuralTrashEntry.id}/restore`,
    { headers: sessionHeaders }
  );
  expect(conflictedStructuralRestoreResponse.status()).toBe(400);
  const replacementDeleteResponse = await page.request.delete(`/api/v2/meta/tables/${replacementStructuralTable.id}`, {
    headers: sessionHeaders,
  });
  expect(replacementDeleteResponse.ok(), await replacementDeleteResponse.text()).toBeTruthy();
  const structuralRestoreResponse = await page.request.post(
    `/api/v2/meta/bases/${createdBaseBody.id}/trash/${structuralTrashEntry.id}/restore`,
    { headers: sessionHeaders }
  );
  expect(structuralRestoreResponse.ok(), await structuralRestoreResponse.text()).toBeTruthy();
  expect(await structuralRestoreResponse.json()).toEqual({
    restored: 1,
    resource_type: 'table',
    resource_id: structuralTable.id,
  });
  const structuralRestoredRecordsResponse = await page.request.get(
    `/api/v2/tables/${structuralTable.id}/records?limit=10`,
    { headers: sessionHeaders }
  );
  const structuralRestoredRecords = await structuralRestoredRecordsResponse.json();
  expect(structuralRestoredRecordsResponse.ok(), JSON.stringify(structuralRestoredRecords)).toBeTruthy();
  expect(structuralRestoredRecords.list).toEqual([
    expect.objectContaining({ Id: structuralRecord.Id, Title: 'Table data survives Trash' }),
  ]);

  const purgeTableResponse = await createStructuralTrashTable('Structural purge fixture');
  const purgeTable = await purgeTableResponse.json();
  expect(purgeTableResponse.ok(), JSON.stringify(purgeTable)).toBeTruthy();
  const trashPurgeTableResponse = await page.request.delete(`/api/v2/meta/tables/${purgeTable.id}?trash=true`, {
    headers: sessionHeaders,
  });
  expect(trashPurgeTableResponse.ok(), await trashPurgeTableResponse.text()).toBeTruthy();
  const emptyStructuralTrashResponse = await page.request.delete(`/api/v2/meta/bases/${createdBaseBody.id}/trash`, {
    headers: sessionHeaders,
  });
  const emptyStructuralTrash = await emptyStructuralTrashResponse.json();
  expect(emptyStructuralTrashResponse.ok(), JSON.stringify(emptyStructuralTrash)).toBeTruthy();
  expect(emptyStructuralTrash.deleted).toBeGreaterThanOrEqual(1);
  const purgedTableResponse = await page.request.get(`/api/v2/meta/tables/${purgeTable.id}`, {
    headers: sessionHeaders,
  });
  expect(purgedTableResponse.status()).toBe(404);
  const recreatePurgedTableResponse = await createStructuralTrashTable('Structural purge fixture');
  const recreatedPurgeTable = await recreatePurgedTableResponse.json();
  expect(recreatePurgedTableResponse.ok(), JSON.stringify(recreatedPurgeTable)).toBeTruthy();
  const recreatedPurgeTableDeleteResponse = await page.request.delete(`/api/v2/meta/tables/${recreatedPurgeTable.id}`, {
    headers: sessionHeaders,
  });
  expect(recreatedPurgeTableDeleteResponse.ok(), await recreatedPurgeTableDeleteResponse.text()).toBeTruthy();

  const retrashStructuralTableResponse = await page.request.delete(
    `/api/v2/meta/tables/${structuralTable.id}?trash=true`,
    { headers: sessionHeaders }
  );
  expect(retrashStructuralTableResponse.ok(), await retrashStructuralTableResponse.text()).toBeTruthy();

  const restartField = await createTrashField('Field survives restart');
  const restartFieldRecordResponse = await page.request.post(`/api/v2/tables/${createdTableBody.id}/records`, {
    headers: sessionHeaders,
    data: { Title: 'Field restart value fixture', 'Field survives restart': 'Persisted hidden value' },
  });
  const restartFieldRecord = await restartFieldRecordResponse.json();
  expect(restartFieldRecordResponse.ok(), JSON.stringify(restartFieldRecord)).toBeTruthy();
  const restartFieldTrashResponse = await page.request.delete(`/api/v2/meta/columns/${restartField.id}?trash=true`, {
    headers: sessionHeaders,
  });
  expect(restartFieldTrashResponse.ok(), await restartFieldTrashResponse.text()).toBeTruthy();

  const restartTrashRecordResponse = await page.request.post(`/api/v2/tables/${createdTableBody.id}/records`, {
    headers: sessionHeaders,
    data: { Title: 'Trash survives restart', Status: 'Blocked' },
  });
  const restartTrashRecord = await restartTrashRecordResponse.json();
  expect(restartTrashRecordResponse.ok(), JSON.stringify(restartTrashRecord)).toBeTruthy();
  const restartTrashResponse = await page.request.post(`/api/v2/tables/${createdTableBody.id}/trash`, {
    headers: sessionHeaders,
    data: { records: [{ Id: restartTrashRecord.Id }] },
  });
  const restartTrash = await restartTrashResponse.json();
  expect(restartTrashResponse.ok(), JSON.stringify(restartTrash)).toBeTruthy();
  expect(restartTrash.list).toEqual([
    expect.objectContaining({
      record_id: String(restartTrashRecord.Id),
      pk_data: { Id: restartTrashRecord.Id },
      row_data: expect.objectContaining({
        Id: restartTrashRecord.Id,
        Title: 'Trash survives restart',
        Status: 'Blocked',
      }),
    }),
  ]);

  const snapshotFixtureTableResponse = await page.request.post(
    `/api/v2/meta/bases/${createdBaseBody.id}/${createdTableBody.source_id}/tables`,
    {
      headers: sessionHeaders,
      data: {
        title: 'Snapshot fixture',
        table_name: 'Snapshot fixture',
        columns: [{ title: 'Title', column_name: 'Title', uidt: UITypes.SingleLineText, pv: true }],
      },
    }
  );
  const snapshotFixtureTable = await snapshotFixtureTableResponse.json();
  expect(snapshotFixtureTableResponse.ok(), JSON.stringify(snapshotFixtureTable)).toBeTruthy();
  const preSnapshotRecordResponse = await page.request.post(`/api/v2/tables/${snapshotFixtureTable.id}/records`, {
    headers: sessionHeaders,
    data: { Title: 'Created before snapshot boundary' },
  });
  expect(preSnapshotRecordResponse.ok(), await preSnapshotRecordResponse.text()).toBeTruthy();

  const snapshotBaseList = page.locator('.nc-treeview-container-base-list');
  for (let attempt = 0; attempt < 3 && !(await snapshotBaseList.isVisible()); attempt += 1) {
    await page.getByTestId('nc-sidebar-project-btn').click();
    await page.waitForTimeout(1_000);
  }
  await expect(snapshotBaseList).toBeVisible();
  const baseNode = snapshotBaseList.getByTestId('nc-sidebar-base-title-Community Acceptance');
  await baseNode.hover();
  await baseNode.getByTestId('nc-sidebar-context-menu').click();
  await page.locator('.nc-sidebar-base-base-settings').click();
  await expect(page.locator('.nc-base-settings')).toBeVisible();
  await page.getByTestId('snapshots-tab').click();
  await expect(page.getByTestId('nc-settings-subtab-snapshots')).toBeVisible();
  await page.getByTestId('nc-snapshot-title').fill('Restart snapshot fixture');
  await page.getByTestId('nc-snapshot-create').click();

  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/v2/meta/bases/${createdBaseBody.id}/snapshots`, {
          headers: sessionHeaders,
        });
        const body = await response.json();
        return body.list?.find((snapshot: { title?: string }) => snapshot.title === 'Restart snapshot fixture')?.status;
      },
      { timeout: 30_000 }
    )
    .toBe('ready');
  await expect(page.getByText('Restart snapshot fixture', { exact: true })).toBeVisible();

  const postSnapshotRecordResponse = await page.request.post(`/api/v2/tables/${snapshotFixtureTable.id}/records`, {
    headers: sessionHeaders,
    data: { Title: 'Created after snapshot boundary' },
  });
  expect(postSnapshotRecordResponse.ok(), await postSnapshotRecordResponse.text()).toBeTruthy();
});
