import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { idb } from './helpers';

test('the sets spreadsheet opens band names that look like formulas as text', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByText('My bands')).toBeVisible();
  const [profile] = await idb(page, 'profile');
  const t = new Date().toISOString();
  const bands = [{ id: 'b-sum', name: '@SUM(1,1)', order: 1 }, { id: 'b-eq', name: '=1+1', order: 2 }];
  const set = { createdAt: t, updatedAt: t, deletedAt: null, sessionId: 's-csv', exerciseId: 'goblet-squat', plannedExerciseId: null, date: '2026-10-01', loggedAt: t, weight: null, reps: 10, seconds: null, stanceSteps: -1, effort: null };
  const backup = {
    app: 'get-fit',
    tables: {
      profile: [{ ...profile, bands, updatedAt: t }],
      loggedSets: [{ ...set, id: 'csv-1', setIndex: 0, bandId: 'b-sum' }, { ...set, id: 'csv-2', setIndex: 1, bandId: 'b-eq', stanceSteps: 0 }],
    },
  };
  await page.locator('input[type=file]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
  await expect(page.getByText('Backup restored')).toBeVisible();

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Sets (CSV)' }).click()]);
  const rows = readFileSync((await download.path())!, 'utf8').trim().split('\n');
  expect(rows).toHaveLength(3);
  expect(rows[1].endsWith(`,1,,10,,"'@SUM(1,1)",-1,,${t}`)).toBe(true);
  expect(rows[2].endsWith(`,2,,10,,'=1+1,0,,${t}`)).toBe(true);
});
