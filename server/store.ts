import Database from 'better-sqlite3';

/** Same list as SYNC_TABLES in src/db/db.ts (duplicated so the server never imports app code). */
export const TABLES = ['profile', 'blocks', 'plannedWorkouts', 'sessions', 'loggedSets', 'exerciseFlags', 'customExercises'] as const;
export type TableName = (typeof TABLES)[number];

export type SyncRecord = { id: string; updatedAt: string; deletedAt?: string | null; [key: string]: unknown };
export type Change = { table: TableName; record: SyncRecord };
type Row = { tbl: TableName; data: string; seq: number };

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
  `);

  const getStored = db.prepare<[string, string], { updated_at: string }>('SELECT updated_at FROM records WHERE tbl = ? AND id = ?');
  const maxSeqStmt = db.prepare<[], { m: number }>('SELECT COALESCE(MAX(seq), 0) AS m FROM records');
  const upsert = db.prepare(`
    INSERT INTO records (tbl, id, updated_at, deleted_at, data, seq) VALUES (@tbl, @id, @updatedAt, @deletedAt, @data, @seq)
    ON CONFLICT (tbl, id) DO UPDATE SET updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, data = excluded.data, seq = excluded.seq
  `);
  const since = db.prepare<[number, number], Row>('SELECT tbl, data, seq FROM records WHERE seq > ? ORDER BY seq LIMIT ?');
  const live = db.prepare<[], Row>('SELECT tbl, data, seq FROM records WHERE deleted_at IS NULL ORDER BY tbl, id');

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
    applyChanges,
    maxSeq: () => maxSeqStmt.get()!.m,
    /** Records with seq > cursor, oldest first, up to `limit` (plus whether more remain). */
    pull(cursor: number, limit: number) {
      const rows = since.all(cursor, limit + 1);
      const more = rows.length > limit;
      const page = more ? rows.slice(0, limit) : rows;
      return { rows: page.map((r) => ({ table: r.tbl, record: JSON.parse(r.data) as SyncRecord, seq: r.seq })), more };
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
