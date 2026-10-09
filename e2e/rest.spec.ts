import { expect, test } from '@playwright/test';

test('logging a set starts a rest timer that keeps time through a locked screen', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.getByRole('button', { name: /Start workout|Do it today/ }).first().click();
  await expect(page.getByRole('button', { name: 'Log set 1' })).toBeVisible();
  const w = page.getByLabel('Set 1 weight');
  if (await w.isVisible().catch(() => false)) await w.fill('20');
  await page.getByRole('button', { name: 'Log set 1' }).click();

  const bar = page.getByRole('timer');
  await expect(bar).toContainText(/Rest\s*\d:\d\d/);
  const secs = async () => {
    const [, m, s] = (await bar.innerText()).match(/(\d+):(\d\d)/)!;
    return Number(m) * 60 + Number(s);
  };
  const before = await secs();
  await page.getByRole('button', { name: '30 seconds more' }).click();
  expect(await secs()).toBeGreaterThanOrEqual(before + 29);

  // The phone is locked for 10 minutes (no timers run), then unlocked.
  const now = await page.evaluate(() => Date.now());
  await page.clock.setSystemTime(now + (before + 30 + 20) * 1000);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(bar).toContainText("Rest's up");
  await expect(bar).toContainText(/0:(1\d|2\d) ago/);

  // Tapping it dismisses it; logging the next set starts a new one.
  await page.getByRole('button', { name: 'Dismiss rest timer' }).click();
  await expect(bar).toBeHidden();
  await page.getByRole('button', { name: 'Log set 2' }).click();
  await expect(bar).toContainText(/Rest\s*\d:\d\d/);
  await page.getByRole('button', { name: 'Dismiss rest timer' }).click();
  await expect(bar).toBeHidden();
});

test('the rest timer can be turned off in Settings', async ({ page }) => {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Off', exact: true }).click();
  await page.goto('/');
  await page.getByRole('button', { name: /Start workout|Do it today/ }).first().click();
  const w = page.getByLabel('Set 1 weight');
  await expect(page.getByRole('button', { name: 'Log set 1' })).toBeVisible();
  if (await w.isVisible().catch(() => false)) await w.fill('20');
  await page.getByRole('button', { name: 'Log set 1' }).click();
  await expect(page.getByRole('button', { name: 'Undo set 1' })).toBeVisible();
  await expect(page.getByRole('timer')).toBeHidden();
});
