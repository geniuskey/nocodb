import { expect, test } from '@playwright/test';

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
