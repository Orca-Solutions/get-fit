import { useLiveQuery } from 'dexie-react-hooks';
import { blockEnd, type DayState, db, plannedSetCount, workoutState } from '@orca-solutions/get-fit-core/client';
import type { Block, PlannedWorkout, Session } from '@orca-solutions/get-fit-core';

export type WorkoutView = {
  workout: PlannedWorkout;
  session?: Session;
  logged: number;
  planned: number;
  state: DayState;
  block?: Block;
};

export type PlanData = {
  blocks: Block[];
  views: WorkoutView[];
  byId: Map<string, WorkoutView>;
  trackedFrom: string;
};

/** Everything the plan-facing screens need, live from the on-device database. */
export function usePlan(today: string): PlanData | undefined {
  return useLiveQuery(async () => {
    const [blocks, workouts, sessions, sets, profile] = await Promise.all([
      db.blocks.toArray(),
      db.plannedWorkouts.toArray(),
      db.sessions.toArray(),
      db.loggedSets.toArray(),
      db.profile.get('me'),
    ]);
    const liveBlocks = blocks.filter((b) => !b.deletedAt).sort((a, b) => a.startDate.localeCompare(b.startDate));
    const blockById = new Map(liveBlocks.map((b) => [b.id, b]));
    const sessionByWorkout = new Map<string, Session>();
    for (const s of sessions) if (!s.deletedAt && s.plannedWorkoutId) sessionByWorkout.set(s.plannedWorkoutId, s);
    const counts = new Map<string, number>();
    for (const s of sets) if (!s.deletedAt) counts.set(s.sessionId, (counts.get(s.sessionId) ?? 0) + 1);
    // Days before the app was first set up aren't "missed".
    const trackedFrom = profile?.createdAt.slice(0, 10) ?? today;
    const views = workouts
      .filter((w) => !w.deletedAt && blockById.has(w.blockId))
      .map((workout) => {
        const session = sessionByWorkout.get(workout.id);
        const logged = session ? (counts.get(session.id) ?? 0) : 0;
        const planned = plannedSetCount(workout, session);
        return { workout, session, logged, planned, block: blockById.get(workout.blockId), state: workoutState(workout, session, logged, planned, today, trackedFrom) };
      })
      .sort((a, b) => a.workout.date.localeCompare(b.workout.date));
    return { blocks: liveBlocks, views, byId: new Map(views.map((v) => [v.workout.id, v])), trackedFrom };
  }, [today]);
}

export function currentBlock(blocks: Block[], date: string): Block | undefined {
  return blocks.find((b) => b.startDate <= date && date <= blockEnd(b));
}
