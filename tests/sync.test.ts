import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GetFitDB } from '../src/db/db';
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
    expect(calls).toHaveBeenCalledTimes(1);
  });
});
