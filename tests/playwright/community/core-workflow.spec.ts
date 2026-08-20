import { expect, test } from '@playwright/test';
import { expectPublicApiContract, expectPublicApiRuntimeCrud } from './public-api-contract';

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

  await expectPublicApiContract(page, createdBaseBody.id, createdTableBody.id);

  const grid = page.getByTestId('nc-grid-wrapper');
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
});
