// What a multi-user app needs from the client: its own database per account, and its own auth.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { changedFields, mergeSession } from '../src/session';
import type { Session } from '../src/types';
import { db, GetFitDB, setDefaultDb } from '../src/client/db';
import { getProfile, put } from '../src/client/repo';
import { configureSync, getSyncStatus, isSyncConnected, setSyncToken, syncNow } from '../src/client/sync';

const empty = { cursor: 0, epoch: 'e1', changes: [], accepted: 0 };
const ok = () => new Response(JSON.stringify(empty), { status: 200, headers: { 'Content-Type': 'application/json' } });

afterEach(() => configureSync({}));

describe('client for many accounts', () => {
  it('uses the database set as default for writes and reads', async () => {
    const original = db;
    const mine = new GetFitDB('get-fit:user-1');
    setDefaultDb(mine);
    try {
      const p = await getProfile();
      await put('profile', { ...p, bodyweightLb: 150 });
      expect((await mine.profile.get(p.id))?.bodyweightLb).toBe(150);
      expect(await original.profile.count()).toBe(0);
    } finally {
      setDefaultDb(original);
    }
  });

  it('keeps the sync token and status in the database configureSync names', async () => {
    const d = new GetFitDB('get-fit:configured');
    configureSync({ db: d });
    await setSyncToken('token-1');
    expect((await d.meta.get('syncToken'))?.value).toBe('token-1');
    expect(await db.meta.get('syncToken')).toBeUndefined();
    expect((await getSyncStatus()).configured).toBe(true);
    expect(await isSyncConnected()).toBe(true);
  });

  it('syncs with caller-supplied headers and credentials instead of a stored token', async () => {
    const fetch = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ok());
    const d = new GetFitDB('get-fit:cookies');
    configureSync({ fetch, headers: () => ({ 'X-Account': 'user-1' }), credentials: 'include' });
    expect(await syncNow({ db: d })).toMatchObject({ ok: true });
    const init = fetch.mock.calls[0]![1]!;
    expect(init.credentials).toBe('include');
    expect(init.headers).toMatchObject({ 'x-account': 'user-1', 'Content-Type': 'application/json' });
    expect(JSON.stringify(init.headers)).not.toContain('Bearer');
  });

  it('waits while there are no headers yet, and reports a 401', async () => {
    const onUnauthorized = vi.fn();
    const d = new GetFitDB('get-fit:signed-out');
    configureSync({ fetch: async () => ok(), headers: () => undefined });
    expect(await syncNow({ db: d })).toMatchObject({ ok: false, skipped: 'no-token' });
    configureSync({ fetch: async () => new Response('{}', { status: 401 }), headers: () => ({}), onUnauthorized });
    expect(await syncNow({ db: d })).toMatchObject({ ok: false, error: 'Not signed in.' });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});

describe('session merge', () => {
  const base: Session = { id: 's', plannedWorkoutId: 'w', date: '2026-10-12', startedAt: 't', createdAt: 't', updatedAt: '2026-10-12T10:00:00Z' };

  it('stamps and merges any per-slot map, like swaps', () => {
    expect(changedFields(base, { swaps: { a: 'x' }, swapReasons: { a: 'busy' } })).toEqual(['swaps.a', 'swapReasons.a']);
    const phone: Session = { ...base, swapReasons: { a: 'busy' }, fieldAt: { 'swapReasons.a': '2026-10-12T10:05:00Z' }, updatedAt: '2026-10-12T10:05:00Z' };
    const laptop: Session = { ...base, swapReasons: { b: 'pain' }, notes: 'ok', fieldAt: { 'swapReasons.b': '2026-10-12T10:06:00Z', notes: '2026-10-12T10:06:00Z' }, updatedAt: '2026-10-12T10:06:00Z' };
    const { session } = mergeSession(phone, laptop);
    expect(session.swapReasons).toEqual({ a: 'busy', b: 'pain' });
    expect(session.notes).toBe('ok');
  });
});
