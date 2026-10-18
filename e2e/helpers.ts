import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

// Shared by the multi-device specs. Each of them talks to its own server (see playwright.config.ts),
// so their data never mixes with the other tests'.
export const TOKEN = 'e2e-token';

export const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
export const DESKTOP = { viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false };

export type Device = { ctx: BrowserContext; page: Page; errors: string[] };

/** A separate browser (its own storage) at the given New York time, with a clock the test can move. */
export async function device(browser: Browser, kind: typeof PHONE | typeof DESKTOP, time: string, baseURL: string): Promise<Device> {
  const ctx = await browser.newContext({ ...kind, baseURL, timezoneId: 'America/New_York' });
  await ctx.clock.install({ time: new Date(time) });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return { ctx, page, errors };
}

/** Moves a device's clock to a New York date and time, e.g. at(d, '2026-11-09T16:00:00-05:00'). */
export const at = (d: Device, time: string) => d.ctx.clock.setSystemTime(new Date(time));

export async function connectSync(page: Page) {
  await page.goto('/settings');
  await page.getByPlaceholder('Sync token').fill(TOKEN);
  await page.getByRole('button', { name: 'Connect' }).click();
  await expect(page.getByText(/Last synced/)).toBeVisible();
}

/** Waits until the service worker controls the page, so a reload or navigation works offline. */
export async function controlledBySW(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

/** The app syncs when its window gains focus. */
export const pokeSync = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('focus')));

type Row = Record<string, any>;

/** All rows of a table in the app's IndexedDB. */
export function idb(page: Page, table: string): Promise<Row[]> {
  return page.evaluate(
    (t) =>
      new Promise<Row[]>((resolve, reject) => {
        const open = indexedDB.open('get-fit');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction(t).objectStore(t).getAll();
          req.onerror = () => reject(req.error);
          req.onsuccess = () => {
            open.result.close();
            resolve(req.result);
          };
        };
      }),
    table,
  );
}

const live = (rows: Row[]) => rows.filter((r) => !r.deletedAt);
export const liveSets = async (page: Page) => live(await idb(page, 'loggedSets'));
export const liveBlocks = async (page: Page) => live(await idb(page, 'blocks'));

/** The device's plan: every workout with its movements, comparable across devices. */
export const plan = async (page: Page) =>
  live(await idb(page, 'plannedWorkouts'))
    .map((w) => `${w.id}:${w.exercises.map((e: Row) => e.exerciseId).join(',')}`)
    .sort();

/** Logged sets as sorted "plannedExercise#set=weightxreps" lines, comparable across devices and the server. */
export const summary = (sets: Row[]) => sets.map((s) => `${s.plannedExerciseId}#${s.setIndex}=${s.weight ?? '-'}x${s.reps ?? s.seconds}`).sort();

/** Live logged sets on the server. */
export async function serverSets(baseURL: string): Promise<Row[]> {
  const r = await fetch(`${baseURL}/api/export`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  return live((await r.json()).tables.loggedSets);
}

/** Opens movement m (0-based) of a workout and waits for its first set row. */
export async function openMovement(page: Page, workoutId: string, m = 0) {
  await page.goto(`/workout/${workoutId}?m=${m}`);
  await expect(page.getByLabel(/^Set 1 (reps|seconds)$/)).toBeVisible();
}

/** Logs set i (1-based) on the open movement, filling weight and reps first when given. */
export async function logSet(page: Page, i: number, v: { weight?: string; reps?: string } = {}) {
  const w = page.getByLabel(`Set ${i} weight`);
  if (v.weight != null && (await w.count())) await w.fill(v.weight);
  if (v.reps != null) await page.getByLabel(new RegExp(`^Set ${i} (reps|seconds)$`)).fill(v.reps);
  await page.getByRole('button', { name: `Log set ${i}`, exact: true }).click();
  await expect(page.getByRole('button', { name: `Undo set ${i}`, exact: true })).toBeVisible();
}
