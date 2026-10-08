import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';

/** Same list as SYNC_TABLES in src/db/db.ts (duplicated so the server never imports app code). */
export const TABLES = ['profile', 'blocks', 'plannedWorkouts', 'sessions', 'loggedSets', 'exerciseFlags', 'customExercises'] as const;
export type TableName = (typeof TABLES)[number];

export type SyncRecord = { id: string; updatedAt: string; deletedAt?: string | null; [key: string]: unknown };
export type Change = { table: TableName; record: SyncRecord };
type Row = { tbl: TableName; id: string; updated_at: string; data: string; seq: number };
/** The last record a client pulled: which one, and the version it saw. */
export type CursorKey = { table: string; id: string; updatedAt: string };

export type Store = ReturnType<typeof openStore>;

/** Opens (or creates) the sync database. Pass ':memory:' for tests. */
export function openStore(file: string) {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      tbl TEXT NOT NULL,
      id TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      data TEXT NOT NULL,
      seq INTEGER NOT NULL,
      PRIMARY KEY (tbl, id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS records_seq ON records (seq);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `);
  // A random id for this database. If the volume is ever wiped, clients see a new epoch and re-push.
  db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('epoch', ?)").run(randomUUID());
  let epoch = db.prepare<[], { value: string }>("SELECT value FROM meta WHERE key = 'epoch'").get()!.value;
  const setEpoch = db.prepare("UPDATE meta SET value = ? WHERE key = 'epoch'");

  const getStored = db.prepare<[string, string], { updated_at: string }>('SELECT updated_at FROM records WHERE tbl = ? AND id = ?');
  const maxSeqStmt = db.prepare<[], { m: number }>('SELECT COALESCE(MAX(seq), 0) AS m FROM records');
  const upsert = db.prepare(`
    INSERT INTO records (tbl, id, updated_at, deleted_at, data, seq) VALUES (@tbl, @id, @updatedAt, @deletedAt, @data, @seq)
    ON CONFLICT (tbl, id) DO UPDATE SET updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, data = excluded.data, seq = excluded.seq
  `);
  const since = db.prepare<[number, number], Row>('SELECT tbl, id, updated_at, data, seq FROM records WHERE seq > ? ORDER BY seq LIMIT ?');
  const live = db.prepare<[], Row>('SELECT tbl, id, updated_at, data, seq FROM records WHERE deleted_at IS NULL ORDER BY tbl, id');

  /** Last write wins: a change is stored only if it is new or strictly newer than what is stored. */
  const applyChanges = db.transaction((changes: Change[]) => {
    let seq = maxSeqStmt.get()!.m;
    const written = new Map<string, number>(); // "tbl/id" -> seq it was stored with
    for (const { table, record } of changes) {
      const updatedAt = new Date(record.updatedAt).toISOString();
      const stored = getStored.get(table, record.id);
      if (stored && updatedAt <= stored.updated_at) continue;
      seq += 1;
      upsert.run({ tbl: table, id: record.id, updatedAt, deletedAt: record.deletedAt ?? null, data: JSON.stringify(record), seq });
      written.set(`${table}/${record.id}`, seq);
    }
    return written;
  });

  return {
    get epoch() {
      return epoch;
    },
    /** A new id for this database, so every device re-pulls and re-pushes everything. */
    rotateEpoch() {
      epoch = randomUUID();
      setEpoch.run(epoch);
      return epoch;
    },
    /**
     * False when this database no longer has the version of a record a client last pulled: it went
     * back in time (restored from an older backup), so writes made since then are missing here.
     */
    hasSeen(key: CursorKey) {
      const stored = getStored.get(key.table, key.id);
      return !!stored && stored.updated_at >= new Date(key.updatedAt).toISOString();
    },
    applyChanges,
    maxSeq: () => maxSeqStmt.get()!.m,
    /** Records with seq > cursor, oldest first, up to `limit` (plus whether more remain). */
    pull(cursor: number, limit: number) {
      const rows = since.all(cursor, limit + 1);
      const more = rows.length > limit;
      const page = more ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];
      return {
        rows: page.map((r) => ({ table: r.tbl, record: JSON.parse(r.data) as SyncRecord, seq: r.seq })),
        more,
        lastKey: last ? ({ table: last.tbl, id: last.id, updatedAt: last.updated_at } satisfies CursorKey) : undefined,
      };
    },
    /** All non-deleted records grouped by table. */
    exportAll() {
      const out = Object.fromEntries(TABLES.map((t) => [t, [] as SyncRecord[]])) as Record<TableName, SyncRecord[]>;
      for (const r of live.all()) out[r.tbl]?.push(JSON.parse(r.data));
      return out;
    },
    close: () => db.close(),
  };
}
