// What devices and the sync server exchange. Shared by the client sync engine, every server store
// and the server's request checks, so the table list exists once.

/** Tables that sync. Every record carries id/createdAt/updatedAt/deletedAt. */
export const SYNC_TABLES = ['profile', 'blocks', 'plannedWorkouts', 'sessions', 'loggedSets', 'exerciseFlags', 'customExercises'] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

export type SyncRecord = { id: string; updatedAt: string; deletedAt?: string | null; [key: string]: unknown };
export type Change = { table: SyncTable; record: SyncRecord };
/** The last record a client pulled: which one, and the version it saw. */
export type CursorKey = { table: string; id: string; updatedAt: string };
export type PulledRow = { table: SyncTable; record: SyncRecord; seq: number };

type MaybePromise<T> = T | Promise<T>;

/**
 * Where the server keeps synced records. The SQLite store (`/sqlite`) implements it for one person;
 * a multi-user server implements it per account. Methods may be sync or async.
 */
export interface SyncStore {
  /** A random id for this database. A new one tells every device to pull and push everything. */
  readonly epoch: string;
  rotateEpoch(): MaybePromise<string>;
  /** False when the store no longer has the version of a record a client last pulled (it went back in time). */
  hasSeen(key: CursorKey): MaybePromise<boolean>;
  /** Last write wins: stores each change that is new or strictly newer; returns "table/id" → seq for those written. */
  applyChanges(changes: Change[]): MaybePromise<Map<string, number>>;
  maxSeq(): MaybePromise<number>;
  /** Records with seq > cursor, oldest first, up to `limit` (plus whether more remain). */
  pull(cursor: number, limit: number): MaybePromise<{ rows: PulledRow[]; more: boolean; lastKey?: CursorKey }>;
  /** All non-deleted records grouped by table. */
  exportAll(): MaybePromise<Record<SyncTable, SyncRecord[]>>;
  close(): MaybePromise<void>;
}
