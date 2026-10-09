import { describe, expect, it } from 'vitest';
import { openSqliteStore as openStore } from '@orca-solutions/get-fit-core/sqlite';
import { createApp } from '../app.js';

const TOKEN = 'test-token-123';

function setup(opts: { token?: string | undefined; pageSize?: number } = {}) {
  const db = openStore(':memory:');
  const app = createApp({ db, token: 'token' in opts ? opts.token : TOKEN, pageSize: opts.pageSize });
  const sync = (body: unknown, token = TOKEN) =>
    app.request('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  return { app, db, sync };
}

const rec = (id: string, updatedAt: string, extra: Record<string, unknown> = {}) => ({
  id,
  createdAt: '2026-10-01T10:00:00.000Z',
  updatedAt,
  deletedAt: null,
  ...extra,
});

describe('auth', () => {
  it('serves health without a token', async () => {
    const { app } = setup();
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('rejects missing and wrong tokens', async () => {
    const { app, sync } = setup();
    expect((await app.request('/api/sync', { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await sync({ cursor: 0, changes: [] }, 'wrong')).status).toBe(401);
    expect((await app.request('/api/export', { headers: { Authorization: 'Bearer nope' } })).status).toBe(401);
    expect((await sync({ cursor: 0, changes: [] })).status).toBe(200);
  });

  it('answers 503 when the server has no token configured', async () => {
    const { sync } = setup({ token: undefined });
    const res = await sync({ cursor: 0, changes: [] });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toMatch(/SYNC_TOKEN/);
  });
});

describe('validation', () => {
  it('rejects bad cursors and junk bodies', async () => {
    const { sync } = setup();
    const bad = [{ cursor: -1, changes: [] }, { cursor: 0, changes: 'nope' }, 'not json'];
    for (const body of bad) expect((await sync(body)).status).toBe(400);
  });

  it('skips malformed changes (unknown table, bad id, bad date) but stores the rest of the batch', async () => {
    const { sync, db } = setup();
    const res = await sync({
      cursor: 0,
      changes: [
        { table: 'meta', record: rec('a', '2026-10-01T10:00:00.000Z') },
        { table: 'sessions', record: { ...rec('a', '2026-10-01T10:00:00.000Z'), id: 5 } },
        { table: 'sessions', record: rec('b', 'yesterday') },
        { table: 'loggedSets', record: rec('good', '2026-10-01T10:00:00.000Z') },
      ],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ accepted: 1, rejected: 3 });
    expect(db.exportAll().loggedSets.map((r) => r.id)).toEqual(['good']);
  });

  it('sends security headers', async () => {
    const { app } = setup();
    const res = await app.request('/api/health');
    expect(res.headers.get('Strict-Transport-Security')).toContain('max-age=');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('caps the number of changes and the body size', async () => {
    const { sync } = setup();
    const many = Array.from({ length: 5001 }, (_, i) => ({ table: 'loggedSets', record: rec(`s${i}`, '2026-10-01T10:00:00.000Z') }));
    expect((await sync({ cursor: 0, changes: many })).status).toBe(400);
    const huge = [{ table: 'sessions', record: rec('big', '2026-10-01T10:00:00.000Z', { notes: 'x'.repeat(6 * 1024 * 1024) }) }];
    expect((await sync({ cursor: 0, changes: huge })).status).toBe(413);
  });
});

describe('last write wins', () => {
  it('stores new records, takes newer writes, ignores older ones and ties', async () => {
    const { sync, app } = setup();
    const first = await (await sync({ cursor: 0, changes: [{ table: 'sessions', record: rec('s1', '2026-10-01T10:00:00.000Z', { notes: 'v1' }) }] })).json();
    expect(first).toMatchObject({ accepted: 1, cursor: 1, changes: [] }); // own write is not echoed

    const newer = await (await sync({ cursor: 1, changes: [{ table: 'sessions', record: rec('s1', '2026-10-01T11:00:00.000Z', { notes: 'v2' }) }] })).json();
    expect(newer.accepted).toBe(1);

    const older = await (await sync({ cursor: 2, changes: [{ table: 'sessions', record: rec('s1', '2026-10-01T09:00:00.000Z', { notes: 'old' }) }] })).json();
    const tie = await (await sync({ cursor: 2, changes: [{ table: 'sessions', record: rec('s1', '2026-10-01T11:00:00.000Z', { notes: 'tie' }) }] })).json();
    expect(older.accepted).toBe(0);
    expect(tie.accepted).toBe(0);

    const full = await (await sync({ cursor: 0, changes: [] })).json();
    expect(full.changes).toEqual([{ table: 'sessions', record: expect.objectContaining({ id: 's1', notes: 'v2' }) }]);
    expect(full.cursor).toBe(2);

    const exp = await (await app.request('/api/export', { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
    expect(exp.tables.sessions).toHaveLength(1);
  });

  it('compares instants, not strings, across ISO formats', async () => {
    const { sync } = setup();
    await sync({ cursor: 0, changes: [{ table: 'sessions', record: rec('s1', '2026-10-01T10:00:00.000Z') }] });
    const sameInstant = await (await sync({ cursor: 1, changes: [{ table: 'sessions', record: rec('s1', '2026-10-01T12:00:00+02:00') }] })).json();
    expect(sameInstant.accepted).toBe(0);
  });

  it('keeps record ids separate per table', async () => {
    const { sync } = setup();
    const res = await (await sync({
      cursor: 0,
      changes: [
        { table: 'exerciseFlags', record: rec('x', '2026-10-01T10:00:00.000Z') },
        { table: 'customExercises', record: rec('x', '2026-10-01T10:00:00.000Z') },
      ],
    })).json();
    expect(res.accepted).toBe(2);
  });
});

describe('pull', () => {
  it('paginates by cursor with a `more` flag', async () => {
    const { sync } = setup({ pageSize: 3 });
    const changes = Array.from({ length: 7 }, (_, i) => ({ table: 'loggedSets', record: rec(`set${i}`, '2026-10-01T10:00:00.000Z') }));
    await sync({ cursor: 0, changes });

    const ids: string[] = [];
    let cursor = 0;
    let pages = 0;
    for (let more = true; more; pages++) {
      const page = await (await sync({ cursor, changes: [] })).json();
      ids.push(...page.changes.map((c: { record: { id: string } }) => c.record.id));
      cursor = page.cursor;
      more = page.more;
    }
    expect(pages).toBe(3);
    expect(ids).toEqual(changes.map((c) => c.record.id));
    expect(cursor).toBe(7);

    const empty = await (await sync({ cursor, changes: [] })).json();
    expect(empty).toMatchObject({ cursor: 7, more: false, changes: [] });
  });

  it('flags a reset when the client cursor is ahead of the server', async () => {
    const { sync } = setup();
    await sync({ cursor: 0, changes: [{ table: 'sessions', record: rec('s1', '2026-10-01T10:00:00.000Z') }] });
    const res = await (await sync({ cursor: 50, changes: [] })).json();
    expect(res).toMatchObject({ reset: true, cursor: 1 });
    expect(res.changes).toHaveLength(1);
  });

  it('starts a new epoch when it no longer has the record a client last pulled', async () => {
    const { sync } = setup();
    const first = await (await sync({ cursor: 0, changes: [{ table: 'sessions', record: rec('s1', '2026-10-01T10:00:00.000Z') }, { table: 'sessions', record: rec('s2', '2026-10-01T11:00:00.000Z') }] })).json();
    const pulled = await (await sync({ cursor: 0, changes: [] })).json();
    expect(pulled.cursorKey).toEqual({ table: 'sessions', id: 's2', updatedAt: '2026-10-01T11:00:00.000Z' });

    // Same or newer version still here: carry on.
    const ok = await (await sync({ cursor: pulled.cursor, cursorKey: pulled.cursorKey, changes: [] })).json();
    expect(ok).toMatchObject({ reset: false, epoch: first.epoch });
    // A version the server doesn't have (it was restored from before it): new epoch, everyone re-syncs.
    const behind = await (await sync({ cursor: 1, cursorKey: { table: 'sessions', id: 's3', updatedAt: '2026-10-01T12:00:00.000Z' }, changes: [] })).json();
    expect(behind.reset).toBe(true);
    expect(behind.epoch).not.toBe(first.epoch);
    // Another device still on the old epoch re-syncs on its own; it doesn't start yet another epoch.
    const other = await (await sync({ cursor: 1, epoch: first.epoch, cursorKey: { table: 'sessions', id: 's3', updatedAt: '2026-10-01T12:00:00.000Z' }, changes: [] })).json();
    expect(other.epoch).toBe(behind.epoch);
  });
});

describe('planned restore', () => {
  it('starts a new epoch once for each new SYNC_EPOCH_RESET value', () => {
    const db = openStore(':memory:');
    const start = db.epoch;
    expect(db.resetEpochOnce(undefined)).toBe(false);
    expect(db.resetEpochOnce('2026-10-08')).toBe(true);
    const after = db.epoch;
    expect(after).not.toBe(start);
    // Later restarts with the same value leave it alone; a new value rotates again.
    expect(db.resetEpochOnce('2026-10-08')).toBe(false);
    expect(db.epoch).toBe(after);
    expect(db.resetEpochOnce('2026-11-01')).toBe(true);
    expect(db.epoch).not.toBe(after);
  });
});

describe('export', () => {
  it('returns live records grouped by table, without soft-deleted ones', async () => {
    const { sync, app } = setup();
    await sync({
      cursor: 0,
      changes: [
        { table: 'sessions', record: rec('s1', '2026-10-01T10:00:00.000Z') },
        { table: 'sessions', record: rec('s2', '2026-10-01T10:00:00.000Z', { deletedAt: '2026-10-01T10:00:00.000Z' }) },
        { table: 'profile', record: rec('me', '2026-10-01T10:00:00.000Z') },
      ],
    });
    const res = await app.request('/api/export', { headers: { Authorization: `Bearer ${TOKEN}` } });
    const body = await res.json();
    expect(body.tables.sessions.map((r: { id: string }) => r.id)).toEqual(['s1']);
    expect(body.tables.profile).toHaveLength(1);
    expect(body.tables.loggedSets).toEqual([]);
  });
});
