// Shape checks for records coming from outside this device (a backup file, the sync server). A row
// that would crash a screen (a workout with no exercises, a profile with no schedule) is skipped.
import type { SyncTable } from '../db/db';

type Row = Record<string, unknown>;

const str = (v: unknown) => typeof v === 'string' && v.length > 0;
const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const arr = (v: unknown) => Array.isArray(v);
const obj = (v: unknown): v is Row => !!v && typeof v === 'object' && !Array.isArray(v);
const date = (v: unknown) => typeof v === 'string' && !Number.isNaN(Date.parse(v));

const plannedExercise = (e: unknown) => obj(e) && str(e.id) && str(e.exerciseId) && arr(e.sets) && (e.sets as unknown[]).every((s) => obj(s) && num(s.setIndex));

const CHECKS: Record<SyncTable, (r: Row) => boolean> = {
  profile: (r) => arr(r.schedule) && obj(r.equipmentByLocation) && arr(r.bands) && arr(r.kettlebells),
  blocks: (r) => str(r.startDate) && num(r.weeks) && num(r.index) && obj(r.baseSlots),
  plannedWorkouts: (r) => str(r.blockId) && str(r.date) && str(r.sessionType) && str(r.location) && num(r.weekIndex) && arr(r.exercises) && (r.exercises as unknown[]).every(plannedExercise),
  sessions: (r) => str(r.date) && (r.swaps === undefined || obj(r.swaps)) && (r.skipped === undefined || arr(r.skipped)),
  loggedSets: (r) => str(r.sessionId) && str(r.exerciseId) && num(r.setIndex) && str(r.date) && str(r.loggedAt),
  exerciseFlags: () => true,
  customExercises: (r) => str(r.name) && arr(r.slots) && arr(r.primaryMuscles) && arr(r.secondaryMuscles) && arr(r.equipment) && obj(r.repRange),
};

/**
 * True when `row` has the fields its table's screens rely on. Deleted rows only need id and timestamps.
 * This is also the upload gate (lib/sync collectChanges): a row that fails it stays on the device and
 * is counted in Settings › Sync. So a field added later must not be required here unless every older
 * row is migrated to have it, or those rows would quietly stop syncing.
 */
export function validRow(table: SyncTable, row: unknown): boolean {
  if (!obj(row) || !str(row.id) || !date(row.updatedAt)) return false;
  if (row.deletedAt) return date(row.deletedAt);
  return CHECKS[table](row);
}
