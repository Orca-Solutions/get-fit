import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GetFitDB } from '../src/db/db';
import { ensurePlan, getProfile, liveBlocks, logSet, regenerateUpcoming, setFlagIn, startSession, updateSession } from '../src/db/repo';
import { movementFor } from '../src/lib/session';
import { getSyncStatus, setSyncToken, syncNow } from '../src/lib/sync';
import { createApp } from '../server/app';
import { openStore } from '../server/store';

const TOKEN = 'round-trip-token';
let n = 0;

function makeServer() {
  const app = createApp({ db: openStore(':memory:'), token: TOKEN });
  const fetchShim = ((input: RequestInfo | URL, init?: RequestInit) => app.request(String(input), init)) as typeof fetch;
  return { app, fetch: fetchShim };
}

async function makeDevice(fetchShim: typeof fetch, token: string | null = TOKEN) {
  const db = new GetFitDB(`device-${++n}`);
  await db.open();
  if (token) await setSyncToken(token, db);
  return { db, sync: () => syncNow({ db, fetch: fetchShim }) };
}

const at = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
const session = (id: string, notes: string, updatedAt = at()) => ({
  id, plannedWorkoutId: null, date: '2026-10-07', startedAt: updatedAt, notes, createdAt: updatedAt, updatedAt, deletedAt: null,
});
const loggedSet = (id: string, reps: number, updatedAt = at()) => ({
  id, sessionId: 's1', exerciseId: 'goblet-squat', plannedExerciseId: null, setIndex: 0, weight: 50, reps,
  date: '2026-10-07', loggedAt: updatedAt, createdAt: updatedAt, updatedAt, deletedAt: null,
});

afterEach(() => vi.unstubAllGlobals());

describe('syncNow', () => {
  it('round-trips phone -> server -> laptop', async () => {
    const server = makeServer();
    const phone = await makeDevice(server.fetch);
    const laptop = await makeDevice(server.fetch);

    await phone.db.sessions.put(session('s1', 'felt good'));
    await phone.db.loggedSets.bulkPut([loggedSet('l1', 10), loggedSet('l2', 9)]);
    await phone.db.exerciseFlags.put({ id: 'goblet-squat', favourite: true, createdAt: at(), updatedAt: at() });

    expect(await phone.sync()).toEqual({ ok: true, pushed: 4, pulled: 0 });
    expect(await laptop.sync()).toEqual({ ok: true, pushed: 0, pulled: 4 });

    expect(await laptop.db.sessions.get('s1')).toMatchObject({ notes: 'felt good' });
    expect(await laptop.db.loggedSets.orderBy('id').toArray()).toEqual(await phone.db.loggedSets.orderBy('id').toArray());
    expect(await laptop.db.exerciseFlags.get('goblet-squat')).toMatchObject({ favourite: true });

    const status = await getSyncStatus(laptop.db);
    expect(status).toMatchObject({ configured: true, syncing: false, lastError: null });
    expect(status.lastSyncedAt).toBeTruthy();
  });

  it('gives a new device the full plan and history, and keeps its own logs', async () => {
    const server = makeServer();
    const phone = await makeDevice(server.fetch);
    const phoneBlock = await ensurePlan('2026-10-14', phone.db);
    const legs = (await phone.db.plannedWorkouts.where('blockId').equals(phoneBlock.id).toArray()).find((w) => w.sessionType === 'legs')!;
    await logSet(await startSession(legs.id, legs.date, phone.db), legs.exercises[0].exerciseId, legs.exercises[0].id, 0, { weight: 95, reps: 8 }, phone.db);
    await phone.sync();

    // The laptop was opened a week later before sync was set up, so it planned its own block from that Monday, and logged a set.
    const laptop = await makeDevice(server.fetch, null);
    const own = await ensurePlan('2026-10-21', laptop.db);
    expect(own.startDate).toBe('2026-10-19');
    const ownWorkout = (await laptop.db.plannedWorkouts.where('blockId').equals(own.id).toArray())[0];
    await logSet(await startSession(ownWorkout.id, ownWorkout.date, laptop.db), ownWorkout.exercises[0].exerciseId, null, 0, { weight: 40, reps: 12 }, laptop.db);
    await setSyncToken(TOKEN, laptop.db);
    expect(await laptop.sync()).toMatchObject({ ok: true });

    // The laptop now follows the phone's plan, with the phone's history, and its own set survives.
    expect((await liveBlocks(laptop.db)).map((b) => b.id)).toEqual((await liveBlocks(phone.db)).map((b) => b.id));
    expect((await ensurePlan('2026-10-21', laptop.db)).id).toBe(phoneBlock.id);
    expect(await laptop.db.plannedWorkouts.get(legs.id)).toEqual(await phone.db.plannedWorkouts.get(legs.id));
    expect((await laptop.db.loggedSets.toArray()).map((s) => s.weight).sort()).toEqual([40, 95]);

    // The phone's plan is untouched by the laptop, and it gets the laptop's set.
    await phone.sync();
    expect((await liveBlocks(phone.db)).map((b) => b.id)).toEqual([phoneBlock.id, 'block-2026-11-09']);
    expect((await phone.db.loggedSets.toArray()).map((s) => s.weight).sort()).toEqual([40, 95]);
  });

  it('keeps every set when two devices log the same workout before syncing', async () => {
    const server = makeServer();
    const phone = await makeDevice(server.fetch);
    const laptop = await makeDevice(server.fetch);
    const block = await ensurePlan('2026-10-14', phone.db);
    await phone.sync();
    await laptop.sync();
    const w = (await laptop.db.plannedWorkouts.where('blockId').equals(block.id).toArray()).find((x) => x.sessionType === 'legs')!;
    const [a, b] = [w.exercises[0], w.exercises[1]];
    await logSet(await startSession(w.id, w.date, phone.db), a.exerciseId, a.id, 0, { weight: 95, reps: 8 }, phone.db);
    await logSet(await startSession(w.id, w.date, laptop.db), b.exerciseId, b.id, 0, { weight: 60, reps: 10 }, laptop.db);
    await phone.sync();
    await laptop.sync();
    await phone.sync();
    for (const d of [phone.db, laptop.db]) {
      expect(await d.sessions.count()).toBe(1);
      expect((await d.loggedSets.toArray()).map((s) => s.weight).sort()).toEqual([60, 95]);
    }
  });

  it('keeps sets logged offline mid-workout and uploads them once back online', async () => {
    const server = makeServer();
    let online = false;
    const flaky = ((input: RequestInfo | URL, init?: RequestInit) => (online ? server.fetch(input, init) : Promise.reject(new TypeError('Failed to fetch')))) as typeof fetch;
    const phone = await makeDevice(flaky);
    const laptop = await makeDevice(server.fetch);
    // An older copy of set l1 already sits on the server (e.g. logged on the laptop earlier).
    await laptop.db.loggedSets.put(loggedSet('l1', 6, at(-60_000)));
    await laptop.sync();

    // At the gym with no signal: the phone edits l1 and logs two new sets; every sync attempt fails.
    await phone.db.loggedSets.bulkPut([loggedSet('l1', 10, at(-1_000)), loggedSet('l2', 9), loggedSet('l3', 8)]);
    expect(await phone.sync()).toEqual({ ok: false, error: 'Failed to fetch' });
    vi.stubGlobal('navigator', { onLine: false });
    expect(await phone.sync()).toMatchObject({ ok: false, skipped: 'offline' });
    vi.unstubAllGlobals();
    expect((await phone.db.loggedSets.toArray()).map((s) => s.reps).sort()).toEqual([10, 8, 9].sort());

    // Back online: the queued sets upload, and pulling the server's older l1 doesn't overwrite the phone's edit.
    online = true;
    expect(await phone.sync()).toMatchObject({ ok: true, pushed: 3 });
    expect((await phone.db.loggedSets.get('l1'))?.reps).toBe(10);
    await laptop.sync();
    expect((await laptop.db.loggedSets.orderBy('id').toArray()).map((s) => [s.id, s.reps])).toEqual([['l1', 10], ['l2', 9], ['l3', 8]]);
  });

  it("never lets a plan rebuilt on another device hide sets logged here", async () => {
    const server = makeServer();
    let online = true;
    const flaky = ((input: RequestInfo | URL, init?: RequestInit) => (online ? server.fetch(input, init) : Promise.reject(new TypeError('Failed to fetch')))) as typeof fetch;
    const phone = await makeDevice(flaky);
    const laptop = await makeDevice(server.fetch);
    const block = await ensurePlan('2026-10-14', phone.db);
    await phone.sync();
    await laptop.sync();
    const legs = (await phone.db.plannedWorkouts.where('blockId').equals(block.id).toArray()).find((w) => w.sessionType === 'legs')!;
    const squat = legs.exercises[0];

    // Phone at the gym, offline: logs a squat set. Laptop flags the squat and regenerates.
    online = false;
    const s = await startSession(legs.id, legs.date, phone.db);
    await logSet(s, squat.exerciseId, squat.id, 0, { weight: 95, reps: 8 }, phone.db);
    await setFlagIn(laptop.db, squat.exerciseId, { avoid: true });
    await regenerateUpcoming(legs.date, laptop.db);
    await laptop.sync();
    const rebuilt = (await laptop.db.plannedWorkouts.get(legs.id))!;
    expect(rebuilt.exercises[0].exerciseId).not.toBe(squat.exerciseId);

    // Phone back online: its workout in progress keeps its plan, and the laptop shows the squat set in slot 1.
    online = true;
    await phone.sync();
    await laptop.sync();
    expect((await phone.db.plannedWorkouts.get(legs.id))!.exercises[0].exerciseId).toBe(squat.exerciseId);
    const laptopSets = await laptop.db.loggedSets.toArray();
    const laptopSession = await laptop.db.sessions.get(s.id);
    expect(movementFor(rebuilt.exercises[0], laptopSession, laptopSets)).toBe(squat.exerciseId);
  });

  it('merges a swap made on one device with a note written on another', async () => {
    const server = makeServer();
    const phone = await makeDevice(server.fetch);
    const laptop = await makeDevice(server.fetch);
    const block = await ensurePlan('2026-10-14', phone.db);
    const w = (await phone.db.plannedWorkouts.where('blockId').equals(block.id).toArray()).find((x) => x.sessionType === 'legs')!;
    const s = await startSession(w.id, w.date, phone.db);
    await phone.sync();
    await laptop.sync();

    await updateSession(s.id, { swaps: { [w.exercises[1].id]: 'leg-press' } }, phone.db);
    await new Promise((r) => setTimeout(r, 5));
    await updateSession(s.id, { notes: 'knee felt fine' }, laptop.db);
    await laptop.sync();
    await phone.sync();
    await laptop.sync();
    for (const d of [phone.db, laptop.db]) {
      const merged = (await d.sessions.get(s.id))!;
      expect(merged.swaps).toEqual({ [w.exercises[1].id]: 'leg-press' });
      expect(merged.notes).toBe('knee felt fine');
    }
  });

  it('counts the same set logged on two devices before syncing once', async () => {
    const server = makeServer();
    const phone = await makeDevice(server.fetch);
    const laptop = await makeDevice(server.fetch);
    const block = await ensurePlan('2026-10-14', phone.db);
    await phone.sync();
    await laptop.sync();
    const w = (await laptop.db.plannedWorkouts.where('blockId').equals(block.id).toArray()).find((x) => x.sessionType === 'legs')!;
    const pe = w.exercises[0];
    await logSet(await startSession(w.id, w.date, phone.db), pe.exerciseId, pe.id, 0, { weight: 95, reps: 8 }, phone.db);
    await new Promise((r) => setTimeout(r, 5));
    await logSet(await startSession(w.id, w.date, laptop.db), pe.exerciseId, pe.id, 0, { weight: 95, reps: 9 }, laptop.db);
    await phone.sync();
    await laptop.sync();
    await phone.sync();
    for (const d of [phone.db, laptop.db]) {
      const sets = (await d.loggedSets.toArray()).filter((x) => !x.deletedAt);
      expect(sets.map((x) => x.reps)).toEqual([9]);
    }
  });

  it('agrees on when tracking started, so missed days match across devices', async () => {
    const server = makeServer();
    const phone = await makeDevice(server.fetch);
    const laptop = await makeDevice(server.fetch);
    await phone.db.profile.put({ ...(await getProfile(phone.db)), createdAt: '2026-10-07T08:00:00.000Z' });
    await getProfile(laptop.db); // set up later, with its own (later) createdAt and an untouched profile
    await phone.sync();
    await laptop.sync();
    expect((await getProfile(laptop.db)).createdAt).toBe('2026-10-07T08:00:00.000Z');
  });

  it('resolves conflicts by last write wins', async () => {
    const server = makeServer();
    const phone = await makeDevice(server.fetch);
    const laptop = await makeDevice(server.fetch);
    await phone.db.sessions.put(session('s1', 'original', at(-60_000)));
    await phone.sync();
    await laptop.sync();

    // Both edit offline; the laptop's edit is later, but the phone syncs last.
    await laptop.db.sessions.put(session('s1', 'laptop edit', at(2_000)));
    await phone.db.sessions.put(session('s1', 'phone edit', at(1_000)));
    await laptop.sync();
    const res = await phone.sync();
    expect(res).toMatchObject({ ok: true, pushed: 0, pulled: 1 });
    expect((await phone.db.sessions.get('s1'))?.notes).toBe('laptop edit');

    // A newer phone edit then wins everywhere.
    await phone.db.sessions.put(session('s1', 'phone again', at(3_000)));
    await phone.sync();
    await laptop.sync();
    expect((await laptop.db.sessions.get('s1'))?.notes).toBe('phone again');
  });

  it('propagates soft deletes', async () => {
    const server = makeServer();
    const phone = await makeDevice(server.fetch);
    const laptop = await makeDevice(server.fetch);
    await phone.db.loggedSets.put(loggedSet('l1', 10, at(-60_000)));
    await phone.sync();
    await laptop.sync();

    const deletedAt = at(1_000);
    await phone.db.loggedSets.update('l1', { deletedAt, updatedAt: deletedAt });
    expect(await phone.sync()).toMatchObject({ ok: true, pushed: 1 });
    await laptop.sync();
    expect((await laptop.db.loggedSets.get('l1'))?.deletedAt).toBe(deletedAt);

    const exported = await (await server.app.request('/api/export', { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
    expect(exported.tables.loggedSets).toEqual([]);
  });

  it('is idempotent when nothing changed', async () => {
    const server = makeServer();
    const phone = await makeDevice(server.fetch);
    const laptop = await makeDevice(server.fetch);
    await phone.db.loggedSets.bulkPut([loggedSet('l1', 10), loggedSet('l2', 8)]);
    await phone.sync();
    await laptop.sync();
    const before = await laptop.db.loggedSets.toArray();

    // Recent records sit inside the watermark margin and get re-sent, but the server ignores ties.
    expect(await phone.sync()).toEqual({ ok: true, pushed: 0, pulled: 0 });
    expect(await laptop.sync()).toEqual({ ok: true, pushed: 0, pulled: 0 });
    expect(await laptop.db.loggedSets.toArray()).toEqual(before);
    expect(await phone.db.loggedSets.count()).toBe(2);
  });

  it('pages through large pulls', async () => {
    const server = makeServer();
    const phone = await makeDevice(server.fetch);
    const laptop = await makeDevice(server.fetch);
    await phone.db.loggedSets.bulkPut(Array.from({ length: 2600 }, (_, i) => loggedSet(`l${i}`, i % 12)));
    expect(await phone.sync()).toMatchObject({ ok: true, pushed: 2600 });
    expect(await laptop.sync()).toMatchObject({ ok: true, pulled: 2600 });
    expect(await laptop.db.loggedSets.count()).toBe(2600);
  });

  it('re-pushes everything when the server lost its data', async () => {
    const first = makeServer();
    const phone = await makeDevice(first.fetch);
    await phone.db.sessions.put(session('s1', 'keep me', at(-120_000)));
    await phone.db.sessions.put(session('s2', 'me too', at(-120_000)));
    await phone.sync();

    const fresh = makeServer(); // e.g. a new volume
    await fresh.app.request('/api/sync', {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ cursor: 0, changes: [] }),
    });
    expect(await syncNow({ db: phone.db, fetch: fresh.fetch })).toMatchObject({ ok: true, pushed: 2 });
    const laptop = await makeDevice(fresh.fetch);
    expect(await laptop.sync()).toMatchObject({ pulled: 2 });
  });

  it('re-pushes everything when it meets a different server database, even with a low cursor', async () => {
    const first = makeServer();
    let target = first.fetch;
    const viaTarget = ((i: RequestInfo | URL, init?: RequestInit) => target(i, init)) as typeof fetch;
    const phone = await makeDevice(viaTarget);
    await phone.db.loggedSets.bulkPut([loggedSet('l1', 10, at(-60 * 60_000))]);
    await phone.sync();

    // The volume is replaced, and another device pushes more records than the phone's cursor before it syncs again.
    const second = makeServer();
    target = second.fetch;
    const laptop = await makeDevice(second.fetch);
    await laptop.db.loggedSets.bulkPut([loggedSet('x1', 5), loggedSet('x2', 6), loggedSet('x3', 7)]);
    await laptop.sync();

    expect((await phone.sync()).ok).toBe(true);
    await laptop.sync();
    expect(await laptop.db.loggedSets.get('l1')).toBeTruthy();
    expect(await phone.db.loggedSets.count()).toBe(4);
  });

  it('skips without a token or when offline, and never throws', async () => {
    const server = makeServer();
    const noToken = await makeDevice(server.fetch, null);
    expect(await noToken.sync()).toMatchObject({ ok: false, skipped: 'no-token' });

    const phone = await makeDevice(server.fetch);
    vi.stubGlobal('navigator', { onLine: false });
    expect(await phone.sync()).toMatchObject({ ok: false, skipped: 'offline' });
    vi.unstubAllGlobals();

    const wrong = await makeDevice(server.fetch, 'wrong-token');
    const res = await wrong.sync();
    expect(res).toMatchObject({ ok: false, error: expect.stringMatching(/token/) });
    expect((await getSyncStatus(wrong.db)).lastError).toMatch(/token/);

    const broken = await makeDevice((() => Promise.reject(new TypeError('Failed to fetch'))) as typeof fetch);
    expect(await broken.sync()).toEqual({ ok: false, error: 'Failed to fetch' });
  });

  it('shares one in-flight sync between concurrent callers', async () => {
    const server = makeServer();
    const calls = vi.fn(server.fetch);
    const phone = await makeDevice(calls as typeof fetch);
    await phone.db.sessions.put(session('s1', 'x'));
    const a = phone.sync();
    const b = phone.sync();
    expect(a).toBe(b);
    await a;
    // A first sync pulls once before pushing (joinServer), then pushes once.
    expect(calls).toHaveBeenCalledTimes(2);
  });
});
