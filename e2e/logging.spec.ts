import { expect, test } from '@playwright/test';

test('log a workout, survive a reload, and see it in history', async ({ page }) => {
  await page.goto('/');
  const start = page.getByRole('button', { name: /Start workout|Do it today/ }).first();
  await expect(start).toBeVisible();
  await start.click();
  await expect(page).toHaveURL(/\/workout\//);

  const title = await page.locator('.move-title').innerText();
  const weight = page.getByLabel('Set 1 weight');
  const firstTick = page.getByRole('button', { name: 'Log set 1' });

  // Reps are pre-filled in grey (placeholder) from the plan.
  const reps1 = page.getByLabel(/Set 1 (reps|seconds)/);
  await expect(reps1).toHaveAttribute('placeholder', /\d+/);

  if (await weight.isVisible().catch(() => false)) {
    // Weight starts blank; ticking without one asks for it instead of logging.
    await firstTick.click();
    await expect(page.getByText('Enter a weight')).toBeVisible();
    await weight.fill('25');
  }
  await reps1.fill('9');
  await firstTick.click();
  await expect(page.getByRole('button', { name: 'Undo set 1' })).toBeVisible();

  // Set 2: weight carries forward in grey, so one tap logs "same again".
  if (await page.getByLabel('Set 2 weight').isVisible().catch(() => false)) {
    await expect(page.getByLabel('Set 2 weight')).toHaveAttribute('placeholder', '25');
  }
  await page.getByRole('button', { name: 'Log set 2' }).click();
  await expect(page.getByRole('button', { name: 'Undo set 2' })).toBeVisible();
  await expect(page.getByText(/^2 \/ \d+ sets$/)).toBeVisible();

  // Every tap is saved on the device: a reload keeps both sets.
  await page.reload();
  await expect(page.locator('.move-title')).toHaveText(title);
  await expect(page.getByRole('button', { name: 'Undo set 2' })).toBeVisible();
  await expect(page.getByLabel(/Set 1 (reps|seconds)/)).toHaveValue('9');

  // Untick removes the log.
  await page.getByRole('button', { name: 'Undo set 2' }).click();
  await expect(page.getByRole('button', { name: 'Log set 2' })).toBeVisible();

  await page.getByRole('button', { name: '‹ Today' }).click();
  await page.getByRole('link', { name: 'History' }).click();
  await expect(page.getByRole('link', { name: new RegExp(title) })).toBeVisible();
});

test('calendar shows the block and previews a future workout', async ({ page }) => {
  await page.goto('/calendar');
  await expect(page.getByText(/L legs · U upper · C core/)).toBeVisible();
  await page.getByRole('button', { name: 'Week' }).click();
  await expect(page.locator('.list .item').first()).toBeVisible();
});

test('sync token connects to the server', async ({ page }) => {
  await page.goto('/settings');
  await page.getByPlaceholder('Sync token').fill('e2e-token');
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByText(/Last synced/)).toBeVisible();
});
