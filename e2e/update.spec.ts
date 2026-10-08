import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// Served by its own server (see playwright.config.ts) from a copy of the build this test may change.
const RELEASE = 'http://localhost:4174';
const SW = '.e2e-release/app/sw.js';

test('a new release never reloads an open screen, and offers to update', async ({ page }) => {
  const original = readFileSync(SW, 'utf8');
  try {
    await page.goto(`${RELEASE}/settings`);
    await page.evaluate(() => navigator.serviceWorker.ready);
    const field = page.locator('.text-in').first();
    await field.fill('171');
    await page.evaluate(() => ((window as unknown as { marker: string }).marker = 'same page'));

    // Ship a new release, and let the app notice it.
    appendFileSync(SW, '\n// next release\n');
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()));

    await expect(page.getByText('A new version is ready')).toBeVisible({ timeout: 10_000 });
    expect(await page.evaluate(() => (window as unknown as { marker?: string }).marker)).toBe('same page');
    await expect(field).toHaveValue('171');

    // Tapping Update switches to the new version.
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Update' }).click()]);
    expect(await page.evaluate(() => (window as unknown as { marker?: string }).marker)).toBeUndefined();
    await expect(page.getByText('A new version is ready')).toBeHidden();
  } finally {
    writeFileSync(SW, original);
  }
});
