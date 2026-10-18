import { expect, test } from '@playwright/test';
import { DESKTOP, PHONE, at, connectSync, controlledBySW, device, idb, liveBlocks, liveSets, logSet, openMovement, plan, pokeSync, serverSets } from './helpers';

// Its own server and data (see playwright.config.ts). The second test picks up the history the first one logged.
const BASE = 'http://localhost:4176';
test.describe.configure({ mode: 'serial', timeout: 90_000 });

test('phone and desktop roll into block 2 apart, one of them offline, and end with the same plan and every set', async ({ browser }) => {
  const phone = await device(browser, PHONE, '2026-10-12T16:00:00-04:00', BASE);
  await phone.page.goto('/');
  await connectSync(phone.page);
  await controlledBySW(phone.page);
  const desk = await device(browser, DESKTOP, '2026-10-12T16:00:00-04:00', BASE);
  await desk.page.goto('/');
  await connectSync(desk.page);

  // Block 1, weeks 1-3: the phone (online) logs two sets of the first movement on every lifting day.
  const days = ['2026-10-12-chest-biceps', '2026-10-14-legs', '2026-10-16-back-tri-shoulders', '2026-10-19-chest-biceps', '2026-10-21-legs', '2026-10-23-back-tri-shoulders', '2026-10-26-chest-biceps', '2026-10-28-legs', '2026-10-30-back-tri-shoulders'];
  for (const d of days) {
    await at(phone, `${d.slice(0, 10)}T16:00:00-04:00`);
    await openMovement(phone.page, `w-${d}`);
    await logSet(phone.page, 1, { weight: '40', reps: '10' });
    await logSet(phone.page, 2);
  }
  await expect.poll(async () => (await serverSets(BASE)).length, { timeout: 10_000 }).toBe(18);

  // Deload Friday, Nov 6: the phone has no signal at the gym and logs a set of every movement it can.
  await at(phone, '2026-11-06T16:00:00-05:00');
  await phone.page.goto('/');
  await phone.ctx.setOffline(true);
  const fri = (await idb(phone.page, 'plannedWorkouts')).find((w) => w.id === 'w-2026-11-06-back-tri-shoulders')!;
  let friday = 0;
  for (let m = 0; m < fri.exercises.length; m++) {
    await openMovement(phone.page, fri.id, m);
    if (!(await phone.page.getByLabel('Set 1 reps').count())) continue;
    await logSet(phone.page, 1, { weight: '30', reps: '10' });
    friday++;
  }
  expect(friday).toBeGreaterThan(3);

  // Monday, Nov 9: the desktop opens first (online) and rolls into block 2 without Friday's sets.
  await at(desk, '2026-11-09T07:00:00-05:00');
  await desk.page.goto('/');
  await expect.poll(async () => (await liveBlocks(desk.page)).length).toBe(3);

  // The phone, still offline that afternoon, rolls over on its own and logs Monday.
  await at(phone, '2026-11-09T16:00:00-05:00');
  await phone.page.goto('/');
  await expect.poll(async () => (await liveBlocks(phone.page)).length).toBe(3);
  await openMovement(phone.page, 'w-2026-11-09-chest-biceps');
  await logSet(phone.page, 1, { weight: '55', reps: '9' });
  await logSet(phone.page, 2);

  // Signal back: both devices settle on one plan, and every set the phone holds is on the server.
  await phone.ctx.setOffline(false);
  await expect
    .poll(async () => {
      await pokeSync(phone.page);
      await pokeSync(desk.page);
      const [p, d] = [await plan(phone.page), await plan(desk.page)];
      return p.length > 0 && p.join('\n') === d.join('\n');
    }, { timeout: 15_000 })
    .toBe(true);
  const ids = async () => (await liveSets(phone.page)).map((s) => s.id).sort();
  await expect.poll(async () => (await serverSets(BASE)).map((s) => s.id).sort(), { timeout: 10_000 }).toEqual(await ids());
  expect((await ids()).length).toBe(18 + friday + 2);

  // Monday's sets still show in the workout on the phone.
  await openMovement(phone.page, 'w-2026-11-09-chest-biceps');
  await expect(phone.page.getByRole('button', { name: 'Undo set 2', exact: true })).toBeVisible();
  await expect(phone.page.getByText(/^2 \/ \d+ sets$/)).toBeVisible();
  for (const d of [phone, desk]) expect(d.errors).toEqual([]);
  await Promise.all([phone.ctx.close(), desk.ctx.close()]);
});

test('regenerate keeps logged workouts; a swap logs to the swapped movement; a missed day can be done today', async ({ browser }) => {
  const d = await device(browser, PHONE, '2026-11-11T16:00:00-05:00', BASE);
  await d.page.goto('/');
  await connectSync(d.page);
  await expect.poll(async () => (await liveSets(d.page)).length).toBe((await serverSets(BASE)).length);
  const before = (await liveSets(d.page)).map((s) => s.id).sort();

  d.page.once('dialog', (dlg) => dlg.accept());
  await d.page.getByRole('button', { name: 'Regenerate upcoming workouts' }).click();
  await expect(d.page.getByText('Upcoming workouts regenerated')).toBeVisible();
  expect((await liveSets(d.page)).map((s) => s.id).sort()).toEqual(before);
  await openMovement(d.page, 'w-2026-11-09-chest-biceps');
  await expect(d.page.getByRole('button', { name: 'Undo set 2', exact: true })).toBeVisible();

  // Swap movement 2 of today's legs and log it: the set is saved under the movement swapped in.
  const LEGS = 'w-2026-11-11-legs';
  await openMovement(d.page, LEGS, 1);
  const planned = await d.page.locator('.move-title').innerText();
  await d.page.getByRole('button', { name: 'Swap' }).click();
  const choice = d.page.locator('.list .item').first();
  const swapIn = (await choice.locator('div').first().innerText()).trim();
  await choice.click();
  await expect(d.page.locator('.move-title')).toHaveText(swapIn);
  expect(swapIn).not.toBe(planned);
  await logSet(d.page, 1, { weight: '20', reps: '12' });
  const plannedId = (await idb(d.page, 'plannedWorkouts')).find((w) => w.id === LEGS)!.exercises[1].exerciseId;
  const set = (await liveSets(d.page)).find((s) => s.plannedExerciseId === `${LEGS}-1`)!;
  expect(set.exerciseId).not.toBe(plannedId);
  await d.page.reload();
  await expect(d.page.locator('.move-title')).toHaveText(swapIn);
  await expect(d.page.getByRole('button', { name: 'Undo set 1', exact: true })).toBeVisible();

  // Friday goes by unlogged; on Saturday it shows as missed and can be done today.
  await at(d, '2026-11-14T09:00:00-05:00');
  await d.page.goto('/');
  const missed = d.page.locator('.card', { hasText: 'Missed' });
  await expect(missed).toContainText('Nov 13');
  await missed.getByRole('button', { name: 'Do it today' }).click();
  await expect(d.page).toHaveURL(/w-2026-11-13-back-tri-shoulders/);
  await expect(d.page.getByLabel(/^Set 1 (reps|seconds)$/)).toBeVisible();
  await logSet(d.page, 1, { weight: '40', reps: '10' });
  const session = (await idb(d.page, 'sessions')).find((s) => s.plannedWorkoutId === 'w-2026-11-13-back-tri-shoulders')!;
  expect(session.date).toBe('2026-11-14');
  expect(d.errors).toEqual([]);
  await d.ctx.close();
});
