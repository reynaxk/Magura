import { expect, test } from '@playwright/test';

/** Runs against a local stack (API with DEV_AUTH=1, web without Privy). */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('magura:devUser', 'e2e'));
});

for (const path of ['/', '/trenches', '/copy', '/groups', '/messages', '/live', '/portfolio', '/settings', '/onboarding']) {
  test(`loads ${path} without errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(path);
    await expect(page.locator('body')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('world chat round-trip', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('tab', { name: 'World' }).click();
  const text = `hello ${Date.now()}`;
  await page.getByPlaceholder('Say hi to the world').fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(text)).toBeVisible();
});

test('trenches shows the three stages', async ({ page }) => {
  await page.goto('/trenches');
  for (const name of ['New Pairs', 'Almost Survived', 'Survived']) await expect(page.getByRole('heading', { name })).toBeVisible();
});
