// Background sync with the get-fit server (product spec §4.2).
// Push: every local record whose updatedAt is past the push watermark. Pull: everything the server
// stored since our cursor. Last write wins per record, by updatedAt. Never throws into the UI.
import { db as defaultDb, SYNC_TABLES, type GetFitDB, type SyncTable } from '../db/db';

type SyncRecord = { id: string; updatedAt: string; deletedAt?: string | null };
type Change = { table: SyncTable; record: SyncRecord };
type SyncResponse = { cursor: number; epoch?: string; more?: boolean; reset?: boolean; accepted?: number; changes: Change[] };

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
    let cursor = (await getMeta<number>(db, 'syncCursor')) ?? 0;
    let outbox = await collectChanges(db, lastPushedAt);
    let pushed = 0;
    let pulled = 0;
    let resetDone = false;
    const knownEpoch = await getMeta<string>(db, 'serverEpoch');

    for (;;) {
      const batch = outbox.splice(0, PUSH_BATCH);
      const res = await doFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ cursor, changes: batch }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(await describeHttpError(res));
      const data = (await res.json()) as SyncResponse;
      if (data.epoch && knownEpoch && data.epoch !== knownEpoch && !resetDone) {
        // A different server database (e.g. a wiped volume): start over from cursor 0 and re-push everything.
        resetDone = true;
        cursor = 0;
        outbox = await collectChanges(db, '');
        await setMeta(db, 'serverEpoch', data.epoch);
        continue;
      }
      if (data.epoch && data.epoch !== knownEpoch) await setMeta(db, 'serverEpoch', data.epoch);
      pushed += data.accepted ?? 0;
      pulled += await applyPulled(db, data.changes, data.cursor);
      cursor = data.cursor;
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

/** Local records changed after the watermark, soft-deleted ones included. */
async function collectChanges(db: GetFitDB, since: string): Promise<Change[]> {
  return db.transaction('r', SYNC_TABLES.map((t) => db.table(t)), async () => {
    const out: Change[] = [];
    for (const table of SYNC_TABLES) {
      const records = (await db.table(table).where('updatedAt').above(since).toArray()) as SyncRecord[];
      for (const record of records) out.push({ table, record });
    }
    return out;
  });
}

/** Stores pulled records that are newer than ours, and the new cursor, in one transaction. */
async function applyPulled(db: GetFitDB, changes: Change[], cursor: number): Promise<number> {
  const tables = [...SYNC_TABLES.map((t) => db.table(t)), db.meta];
  return db.transaction('rw', tables, async () => {
    let applied = 0;
    for (const { table, record } of changes) {
      if (!SYNC_TABLES.includes(table) || !record?.id || !record.updatedAt) continue;
      const local = (await db.table(table).get(record.id)) as SyncRecord | undefined;
      if (local && !newer(record.updatedAt, local.updatedAt)) continue;
      await db.table(table).put(record);
      applied++;
    }
    await setMeta(db, 'syncCursor', cursor);
    return applied;
  });
}

async function describeHttpError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  if (res.status === 401) return 'The server rejected the sync token.';
  return body?.error ?? `Sync failed (HTTP ${res.status}).`;
}
