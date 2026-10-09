import { Dexie, type Table } from 'dexie';
import type { Block, ExerciseFlag, LoggedSet, PlannedWorkout, Profile, Session } from '../types.js';

/** Custom movements the user adds; same shape as catalog entries. */
export type CustomExercise = import('../types.js').Exercise & import('../types.js').SyncFields;

export type Meta = { key: string; value: unknown };

export { SYNC_TABLES, type SyncTable } from '../protocol.js';

export class GetFitDB extends Dexie {
  profile!: Table<Profile, string>;
  blocks!: Table<Block, string>;
  plannedWorkouts!: Table<PlannedWorkout, string>;
  sessions!: Table<Session, string>;
  loggedSets!: Table<LoggedSet, string>;
  exerciseFlags!: Table<ExerciseFlag, string>;
  customExercises!: Table<CustomExercise, string>;
  /** Local-only bookkeeping: sync cursor, dirty markers, token. Never synced. */
  meta!: Table<Meta, string>;

  constructor(name = 'get-fit') {
    super(name);
    this.version(1).stores({
      profile: 'id, updatedAt',
      blocks: 'id, startDate, updatedAt',
      plannedWorkouts: 'id, date, blockId, updatedAt',
      sessions: 'id, plannedWorkoutId, date, updatedAt',
      loggedSets: 'id, sessionId, exerciseId, [exerciseId+date], date, updatedAt',
      exerciseFlags: 'id, updatedAt',
      customExercises: 'id, updatedAt',
      meta: 'key',
    });
  }
}

/** The database every function uses unless given another. */
export let db = new GetFitDB();

/** Use another database by default, e.g. one per signed-in account (`new GetFitDB('get-fit:<userId>')`). */
export function setDefaultDb(d: GetFitDB) {
  db = d;
}
