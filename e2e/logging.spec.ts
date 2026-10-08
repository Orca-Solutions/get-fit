import { expect, test, type Page } from '@playwright/test';

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

test('finishing a movement stays on it, and editing a logged set then tapping ✓ keeps it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Start workout|Do it today/ }).first().click();
  // Wait for the workout screen: on a rest day the Today screen has its own title ("Rest day").
  await expect(page).toHaveURL(/\/workout\//);
  await expect(page.getByRole('button', { name: 'Log set 1' })).toBeVisible();
  const title = await page.locator('.move-title').innerText();
  const rows = await page.getByRole('button', { name: /^Log set \d+$/ }).count();
  for (let i = 1; i <= rows; i++) {
    const w = page.getByLabel(`Set ${i} weight`);
    if (i === 1 && (await w.isVisible().catch(() => false))) await w.fill('20');
    await page.getByRole('button', { name: `Log set ${i}` }).click();
    await expect(page.getByRole('button', { name: `Undo set ${i}` })).toBeVisible();
  }
  // Still on the same movement, with the effort question showing.
  await expect(page.locator('.move-title')).toHaveText(title);
  await expect(page.getByText('How did that feel?')).toBeVisible();

  const reps1 = page.getByLabel(/Set 1 (reps|seconds)/);
  await reps1.fill('7');
  await page.getByRole('button', { name: 'Undo set 1' }).click();
  await expect(page.getByRole('button', { name: 'Undo set 1' })).toBeVisible();
  // Wait for the edit to reach IndexedDB before reloading, or the reload can cut the write off.
  await expect.poll(() => storedFirstSet(page)).toBe(7);
  await page.reload();
  await expect(page.getByLabel(/Set 1 (reps|seconds)/)).toHaveValue('7');
});

/** Reps (or seconds) of the live set 1 as stored in the app's IndexedDB. */
function storedFirstSet(page: Page) {
  return page.evaluate(
    () =>
      new Promise<number | null>((resolve, reject) => {
        const open = indexedDB.open('get-fit');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction('loggedSets').objectStore('loggedSets').getAll();
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            const set = (req.result as { setIndex: number; deletedAt?: string | null; reps?: number | null; seconds?: number | null }[]).find((s) => s.setIndex === 0 && !s.deletedAt);
            open.result.close();
            resolve(set ? (set.reps ?? set.seconds ?? null) : null);
          };
        };
      }),
  );
}
