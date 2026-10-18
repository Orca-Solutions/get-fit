import { expect, test } from '@playwright/test';
import { DESKTOP, PHONE, connectSync, controlledBySW, device, liveBlocks, liveSets, logSet, openMovement, plan, pokeSync, serverSets, summary } from './helpers';

// Its own server and data (see playwright.config.ts); each test uses a different workout, so they don't overlap.
const BASE = 'http://localhost:4175';
test.describe.configure({ timeout: 60_000 });

const inSession = (id: string) => (sets: Record<string, any>[]) => sets.filter((s) => s.sessionId === `s-${id}`);

test("phone and desktop see each other's logs, and a new device pulls the full history", async ({ browser }) => {
  const MON = 'w-2026-10-12-chest-biceps';
  const mon = inSession(MON);
  const phone = await device(browser, PHONE, '2026-10-12T16:00:00-04:00', BASE);
  await phone.page.goto('/');
  await connectSync(phone.page);
  await openMovement(phone.page, MON, 0);
  const first = await phone.page.locator('.move-title').innerText();
  await logSet(phone.page, 1, { weight: '50' });
  await logSet(phone.page, 2);
  await logSet(phone.page, 3, { weight: '55', reps: '8' });
  await expect.poll(async () => mon(await serverSets(BASE)).length, { timeout: 10_000 }).toBe(3);

  // The desktop plans on first open, then joins the server's plan and sees the phone's sets.
  const desk = await device(browser, DESKTOP, '2026-10-12T16:05:00-04:00', BASE);
  await desk.page.goto('/');
  await connectSync(desk.page);
  await expect.poll(async () => summary(await liveSets(desk.page))).toEqual(summary(await liveSets(phone.page)));
  await desk.page.goto('/');
  await expect(desk.page.getByText(/^3 \/ \d+ sets$/)).toBeVisible();
  await openMovement(desk.page, MON, 0);
  await expect(desk.page.getByRole('button', { name: 'Undo set 3', exact: true })).toBeVisible();
  await expect(desk.page.getByLabel('Set 3 weight')).toHaveValue('55');

  // The desktop logs movement 2; the phone picks it up when it gains focus.
  await openMovement(desk.page, MON, 1);
  await logSet(desk.page, 1, { weight: '30', reps: '10' });
  await expect.poll(async () => mon(await serverSets(BASE)).length, { timeout: 10_000 }).toBe(4);
  await pokeSync(phone.page);
  await expect.poll(async () => mon(await liveSets(phone.page)).length).toBe(4);
  await openMovement(phone.page, MON, 1);
  await expect(phone.page.getByRole('button', { name: 'Undo set 1', exact: true })).toBeVisible();
  expect(await plan(desk.page)).toEqual(await plan(phone.page));

  // A brand-new device a week later gets every set, the history and both planned blocks.
  const fresh = await device(browser, PHONE, '2026-10-19T16:00:00-04:00', BASE);
  await fresh.page.goto('/');
  await connectSync(fresh.page);
  await expect.poll(async () => summary(mon(await liveSets(fresh.page)))).toEqual(summary(mon(await liveSets(phone.page))));
  await fresh.page.goto('/history');
  await expect(fresh.page.getByRole('link', { name: new RegExp(first) })).toBeVisible();
  expect((await liveBlocks(fresh.page)).map((b) => b.startDate).sort()).toEqual(['2026-10-12', '2026-11-09']);
  for (const d of [phone, desk, fresh]) expect(d.errors).toEqual([]);
  await Promise.all([phone.ctx.close(), desk.ctx.close(), fresh.ctx.close()]);
});

test('sets logged and edited offline survive a reload and all reach the server on reconnect', async ({ browser }) => {
  const WED = 'w-2026-10-14-legs';
  const wed = inSession(WED);
  const phone = await device(browser, PHONE, '2026-10-14T16:00:00-04:00', BASE);
  await phone.page.goto('/');
  await connectSync(phone.page);
  await controlledBySW(phone.page);
  const desk = await device(browser, DESKTOP, '2026-10-14T16:00:00-04:00', BASE);
  await desk.page.goto('/');
  await connectSync(desk.page);

  await openMovement(phone.page, WED, 0);
  await logSet(phone.page, 1, { weight: '40', reps: '8' });
  await expect.poll(async () => wed(await serverSets(BASE)).length, { timeout: 10_000 }).toBe(1);

  // Signal drops: two more sets, an edit to set 1 (saved on blur), then two sets of the next movement.
  await phone.ctx.setOffline(true);
  await logSet(phone.page, 2, { weight: '45' });
  await logSet(phone.page, 3, { weight: '45', reps: '7' });
  await phone.page.getByLabel('Set 1 reps').fill('9');
  await phone.page.getByLabel('Set 1 reps').blur();
  await expect.poll(async () => wed(await liveSets(phone.page)).find((s) => s.plannedExerciseId === `${WED}-0` && s.setIndex === 0)?.reps).toBe(9);
  await phone.page.getByRole('button', { name: /^Next/ }).click();
  await expect(phone.page).toHaveURL(/m=1/);
  await logSet(phone.page, 1, { weight: '20', reps: '12' });
  await logSet(phone.page, 2);

  // The app is reopened with no signal: everything is still there.
  await phone.page.reload();
  await expect(phone.page.getByRole('button', { name: 'Undo set 2', exact: true })).toBeVisible();
  const offline = summary(wed(await liveSets(phone.page)));
  expect(offline).toHaveLength(5);

  // Meanwhile the desktop logs another movement of the same workout.
  await openMovement(desk.page, WED, 2);
  await logSet(desk.page, 1, { weight: '25', reps: '12' });
  await expect.poll(async () => wed(await serverSets(BASE)).length, { timeout: 10_000 }).toBe(2);

  // Signal returns: the server and both devices end with all six sets and the offline edit.
  const all = [...offline, `${WED}-2#0=25x12`].sort();
  await phone.ctx.setOffline(false);
  await expect.poll(async () => summary(wed(await serverSets(BASE))), { timeout: 15_000 }).toEqual(all);
  await expect.poll(async () => summary(wed(await liveSets(phone.page))), { timeout: 15_000 }).toEqual(all);
  await pokeSync(desk.page);
  await expect.poll(async () => summary(wed(await liveSets(desk.page)))).toEqual(all);
  await phone.page.goto('/');
  await expect(phone.page.getByText(/^6 \/ \d+ sets$/)).toBeVisible();
  for (const d of [phone, desk]) expect(d.errors).toEqual([]);
  await Promise.all([phone.ctx.close(), desk.ctx.close()]);
});

test('sets logged offline with the app then closed upload when it opens again online', async ({ browser }) => {
  const FRI = 'w-2026-10-16-back-tri-shoulders';
  const fri = inSession(FRI);
  const phone = await device(browser, PHONE, '2026-10-16T16:00:00-04:00', BASE);
  await phone.page.goto('/');
  await connectSync(phone.page);
  await controlledBySW(phone.page);
  await phone.ctx.setOffline(true);
  await openMovement(phone.page, FRI, 0);
  await logSet(phone.page, 1, { weight: '60', reps: '10' });
  await logSet(phone.page, 2, { weight: '60', reps: '9' });
  const offline = summary(fri(await liveSets(phone.page)));
  await phone.page.close();

  await phone.ctx.setOffline(false);
  const reopened = await phone.ctx.newPage();
  await reopened.goto('/');
  await expect.poll(async () => summary(fri(await serverSets(BASE))), { timeout: 10_000 }).toEqual(offline);
  await phone.ctx.close();
});
