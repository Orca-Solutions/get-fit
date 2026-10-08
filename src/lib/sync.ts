// Background sync with the get-fit server (product spec §4.2).
// Push: every local record whose updatedAt is past the push watermark. Pull: everything the server
// stored since our cursor. Last write wins per record, by updatedAt. Never throws into the UI.
// A device's first sync joins the server's plan instead of pushing its own (see joinServer).
import { db as defaultDb, SYNC_TABLES, type GetFitDB, type SyncTable } from '../db/db';
import type { Session } from '../types';
import { mergeSession } from './session';
import { validRow } from './validate';

type SyncRecord = { id: string; createdAt?: string; updatedAt: string; deletedAt?: string | null };
type Change = { table: SyncTable; record: SyncRecord };
/** The last record pulled: lets the server tell when it has gone back in time (restored from a backup). */
type CursorKey = { table: string; id: string; updatedAt: string };
type SyncResponse = { cursor: number; cursorKey?: CursorKey; epoch?: string; more?: boolean; reset?: boolean; accepted?: number; changes: Change[] };

export type SyncOptions = { db?: GetFitDB; fetch?: typeof fetch; baseUrl?: string };
export type SyncResult =
  | { ok: true; pushed: number; pulled: number }
  | { ok: false; error: string; skipped?: 'no-token' | 'offline' };
export type SyncStatus = { configured: boolean; syncing: boolean; lastSyncedAt: string | null; lastError: string | null };

const PUSH_BATCH = 500;
/** The watermark trails the sync start by this much, so a write racing the sync is pushed next time (re-pushes are no-ops). */
const WATERMARK_MARGIN_MS = 30_000;
const DEBOUNCE_MS = 2_000;
const FETCH_TIMEOUT_MS = 30_000;

const inflight = new WeakMap<GetFitDB, Promise<SyncResult>>();

const getMeta = async <T>(db: GetFitDB, key: string) => (await db.meta.get(key))?.value as T | undefined;
const setMeta = (db: GetFitDB, key: string, value: unknown) => db.meta.put({ key, value });
const newer = (a: string, b: string) => Date.parse(a) > Date.parse(b);

export async function setSyncToken(token: string | null, db: GetFitDB = defaultDb) {
  if (token?.trim()) await setMeta(db, 'syncToken', token.trim());
  else await db.meta.delete('syncToken');
}

export async function getSyncStatus(db: GetFitDB = defaultDb): Promise<SyncStatus> {
  const [token, lastSyncedAt, lastError] = await Promise.all([
    getMeta<string>(db, 'syncToken'),
    getMeta<string>(db, 'lastSyncedAt'),
    getMeta<string>(db, 'lastError'),
  ]);
  return { configured: !!token, syncing: inflight.has(db), lastSyncedAt: lastSyncedAt ?? null, lastError: lastError ?? null };
}

/** Runs one sync, or joins the one already running. Resolves with { ok: false, error } instead of throwing. */
export function syncNow(opts: SyncOptions = {}): Promise<SyncResult> {
  const db = opts.db ?? defaultDb;
  const running = inflight.get(db);
  if (running) return running;
  const p = runSync(db, opts).finally(() => inflight.delete(db));
  inflight.set(db, p);
  return p;
}

/** While the app is open and visible, pull at least this often so another device's logs show up. */
const POLL_MS = 60_000;

/**
 * Keeps an open app current: syncs when the app comes back into view or focus, when the network
 * returns, and every minute while it is visible. Plain polling is plenty for one person's devices.
 */
export function startAutoSync(opts: SyncOptions = {}) {
  const visible = () => document.visibilityState === 'visible';
  window.addEventListener('online', () => syncNow(opts));
  window.addEventListener('focus', () => syncNow(opts));
  document.addEventListener('visibilitychange', () => visible() && syncNow(opts));
  setInterval(() => visible() && syncNow(opts), POLL_MS);
}

let timer: ReturnType<typeof setTimeout> | undefined;

/** Debounced background sync, e.g. after each logged set. Waits for a running sync, then syncs again. */
export function scheduleSync(opts: SyncOptions = {}) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const running = inflight.get(opts.db ?? defaultDb);
    void (running ?? Promise.resolve()).then(() => syncNow(opts));
  }, DEBOUNCE_MS);
}

async function runSync(db: GetFitDB, opts: SyncOptions): Promise<SyncResult> {
  try {
    const token = await getMeta<string>(db, 'syncToken');
    if (!token) return { ok: false, error: 'No sync token set.', skipped: 'no-token' };
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return { ok: false, error: 'Offline.', skipped: 'offline' };

    const doFetch = opts.fetch ?? ((input, init) => fetch(input, init));
    const url = `${opts.baseUrl ?? ''}/api/sync`;
    const startedAt = Date.now();
    const lastPushedAt = (await getMeta<string>(db, 'lastPushedAt')) ?? '';
    const post = async (cursor: number, changes: Change[], cursorKey?: CursorKey, epoch?: string) => {
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ cursor, cursorKey, epoch, changes }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(await describeHttpError(res));
      return (await res.json()) as SyncResponse;
    };
    let pulled = 0;
    if (!lastPushedAt && !(await getMeta<boolean>(db, 'joined'))) pulled += await joinServer(db, post);

    let cursor = (await getMeta<number>(db, 'syncCursor')) ?? 0;
    let cursorKey = await getMeta<CursorKey>(db, 'syncCursorKey');
    let outbox = await collectChanges(db, lastPushedAt);
    let pushed = 0;
    let resetDone = false;
    const knownEpoch = await getMeta<string>(db, 'serverEpoch');
    let epoch = knownEpoch;

    for (;;) {
      const data = await post(cursor, outbox.splice(0, PUSH_BATCH), cursorKey, epoch);
      epoch = data.epoch ?? epoch;
      if (data.epoch && knownEpoch && data.epoch !== knownEpoch && !resetDone) {
        // A different server database (e.g. a wiped volume): start over from cursor 0 and re-push everything.
        resetDone = true;
        cursor = 0;
        cursorKey = undefined;
        outbox = await collectChanges(db, '');
        await setMeta(db, 'serverEpoch', data.epoch);
        continue;
      }
      if (data.epoch && data.epoch !== knownEpoch) await setMeta(db, 'serverEpoch', data.epoch);
      pushed += data.accepted ?? 0;
      const merged: Change[] = [];
      pulled += await applyPulled(db, data.changes, data.cursor, [], merged, data.cursorKey);
      outbox.push(...merged);
      cursor = data.cursor;
      cursorKey = data.cursorKey ?? cursorKey;
      if (data.reset && !resetDone) {
        // The server lost its data (e.g. a fresh volume): send it everything we have.
        resetDone = true;
        outbox = await collectChanges(db, '');
        continue;
      }
      if (!outbox.length && !data.more) break;
    }

    const watermark = new Date(startedAt - WATERMARK_MARGIN_MS).toISOString();
    if (!lastPushedAt || newer(watermark, lastPushedAt)) await setMeta(db, 'lastPushedAt', watermark);
    await db.meta.bulkPut([
      { key: 'lastSyncedAt', value: new Date().toISOString() },
      { key: 'lastError', value: null },
    ]);
    return { ok: true, pushed, pulled };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await setMeta(db, 'lastError', error).catch(() => {});
    return { ok: false, error };
  }
}

/**
 * A device's first sync: pull everything before pushing anything. If the server already has a plan,
 * the server's blocks and planned workouts replace the ones this device generated on its own (which
 * may start on a different Monday), so two devices never end up with overlapping plans. Logged sets
 * and sessions are never dropped; they are pushed afterwards like any other change.
 */
async function joinServer(db: GetFitDB, post: (cursor: number, changes: Change[]) => Promise<SyncResponse>): Promise<number> {
  const serverBlocks = new Set<string>();
  const serverWorkouts = new Set<string>();
  let cursor = 0;
  let pulled = 0;
  for (;;) {
    const data = await post(cursor, []);
    if (data.epoch) await setMeta(db, 'serverEpoch', data.epoch);
    for (const { table, record } of data.changes) {
      if (table === 'blocks' && record?.id) serverBlocks.add(record.id);
      if (table === 'plannedWorkouts' && record?.id) serverWorkouts.add(record.id);
    }
    pulled += await applyPulled(db, data.changes, data.cursor, ['blocks', 'plannedWorkouts'], [], data.cursorKey);
    cursor = data.cursor;
    if (!data.more) break;
  }
  await db.transaction('rw', [db.blocks, db.plannedWorkouts, db.sessions, db.loggedSets, db.meta], async () => {
    if (serverBlocks.size) {
      const sessions = (await db.sessions.toArray()).filter((s) => !s.deletedAt);
      const withSets = new Set((await db.loggedSets.toArray()).filter((s) => !s.deletedAt).map((s) => s.sessionId));
      const logged = new Set(sessions.filter((s) => s.plannedWorkoutId && withSets.has(s.id)).map((s) => s.plannedWorkoutId));
      await db.blocks.bulkDelete((await db.blocks.toArray()).filter((b) => !serverBlocks.has(b.id)).map((b) => b.id));
      await db.plannedWorkouts.bulkDelete((await db.plannedWorkouts.toArray()).filter((w) => !serverWorkouts.has(w.id) && !logged.has(w.id)).map((w) => w.id));
    }
    await setMeta(db, 'joined', true);
  });
  return pulled;
}

/**
 * Local records changed after the watermark, soft-deleted ones included. A damaged record (say, left
 * by an old version) is never uploaded, so it can't spread to the server or other devices; the
 * server's good copy replaces it on the next pull (see applyPulled).
 */
async function collectChanges(db: GetFitDB, since: string): Promise<Change[]> {
  return db.transaction('r', SYNC_TABLES.map((t) => db.table(t)), async () => {
    const out: Change[] = [];
    let damaged = 0;
    for (const table of SYNC_TABLES) {
      const records = (await db.table(table).where('updatedAt').above(since).toArray()) as SyncRecord[];
      for (const record of records) {
        if (validRow(table, record)) out.push({ table, record });
        else damaged++;
      }
    }
    if (damaged) console.warn(`Not uploading ${damaged} damaged local record(s).`);
    return out;
  });
}

/** Stores pulled records that are newer than ours (or any server record for `serverWins` tables), and the new cursor, in one transaction. */
/**
 * Stores pulled records that are newer than ours (or any server record for `serverWins` tables), and
 * the new cursor, in one transaction. Two exceptions to last write wins:
 * - a planned workout this device has logged sets in keeps its local copy, so a plan rebuilt on
 *   another device never reshuffles a workout in progress here;
 * - sessions merge field by field (lib/session.ts); merged results go into `repush`.
 */
async function applyPulled(db: GetFitDB, changes: Change[], cursor: number, serverWins: SyncTable[] = [], repush: Change[] = [], cursorKey?: CursorKey): Promise<number> {
  const tables = [...SYNC_TABLES.map((t) => db.table(t)), db.meta];
  return db.transaction('rw', tables, async () => {
    let applied = 0;
    let logged: Set<string> | undefined;
    for (const { table, record } of changes) {
      // A row that would crash a screen (e.g. a workout with no exercises) is never stored.
      if (!SYNC_TABLES.includes(table) || !validRow(table, record)) continue;
      const found = (await db.table(table).get(record.id)) as SyncRecord | undefined;
      // A damaged local copy always gives way to the server's good one, whatever its timestamp.
      const local = found && validRow(table, found) ? found : undefined;
      if (local && table === 'sessions') {
        const { session, changed } = mergeSession(local as Session, record as Session);
        if (changed) {
          const stamped = { ...session, updatedAt: laterThan(local.updatedAt, record.updatedAt) };
          await db.sessions.put(stamped);
          repush.push({ table, record: stamped });
          applied++;
          continue;
        }
      }
      if (local?.createdAt && record.createdAt && table === 'profile') {
        // Keep the earliest createdAt: the calendar tracks missed days from it, and a device set up
        // later must agree with the first one even when neither profile has been edited.
        const first = [record.createdAt, local.createdAt].sort()[0];
        if (!newer(record.updatedAt, local.updatedAt)) {
          if (first !== local.createdAt) await db.profile.update(record.id, { createdAt: first });
          continue;
        }
        record.createdAt = first;
      }
      if (local && !serverWins.includes(table) && !newer(record.updatedAt, local.updatedAt)) continue;
      if (local && table === 'plannedWorkouts' && !serverWins.includes(table)) {
        logged ??= await loggedWorkoutIds(db);
        if (logged.has(record.id)) continue;
      }
      await db.table(table).put(record);
      applied++;
    }
    await setMeta(db, 'syncCursor', cursor);
    if (cursorKey) await setMeta(db, 'syncCursorKey', cursorKey);
    return applied;
  });
}

/** Now, or just after the later of two timestamps if a clock is ahead. */
function laterThan(a: string, b: string): string {
  const t = Math.max(Date.now(), Date.parse(a) + 1, Date.parse(b) + 1);
  return new Date(t).toISOString();
}

async function loggedWorkoutIds(db: GetFitDB): Promise<Set<string>> {
  const withSets = new Set((await db.loggedSets.toArray()).filter((s) => !s.deletedAt).map((s) => s.sessionId));
  return new Set((await db.sessions.toArray()).filter((s) => !s.deletedAt && s.plannedWorkoutId && withSets.has(s.id)).map((s) => s.plannedWorkoutId!));
}

async function describeHttpError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (res.status === 401) return 'The server rejected the sync token.';
  return body?.error ?? `Sync failed (HTTP ${res.status}).`;
}
