import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { db } from '@orca-solutions/get-fit-core/client';
import { movementFor, type PlannedWorkout, prescription, type Session } from '@orca-solutions/get-fit-core';
import { useExercises } from '../../lib/hooks';

/** One row per movement: name, sets × reps, status. Tapping jumps into logging (or does nothing in preview). */
export function WorkoutList({ workout, session, interactive }: { workout: PlannedWorkout; session?: Session; interactive: boolean }) {
  const exercises = useExercises();
  const nav = useNavigate();
  const sets = useLiveQuery(async () => (session ? (await db.loggedSets.where('sessionId').equals(session.id).toArray()).filter((s) => !s.deletedAt) : []), [session?.id]) ?? [];
  return (
    <ul className="list">
      {workout.exercises.map((pe, i) => {
        const actualId = movementFor(pe, session, sets);
        const ex = exercises.get(actualId);
        const done = sets.filter((s) => s.plannedExerciseId === pe.id).length;
        const skipped = session?.skipped?.includes(pe.id);
        const status = skipped ? 'skipped' : done >= pe.sets.length ? 'done' : done > 0 ? 'partial' : '';
        const group = pe.supersetGroup ? `${pe.supersetGroup}${workout.exercises.filter((x) => x.supersetGroup === pe.supersetGroup).indexOf(pe) + 1}` : String(i + 1);
        return (
          <li key={pe.id}>
            <button className="item" disabled={!interactive} onClick={() => interactive && nav(`/workout/${workout.id}?m=${i}`)}>
              <span className="num">{group}</span>
              <span className="grow">
                <div className="ellipsis">{ex?.name ?? actualId}{pe.role === 'G' && <span className="pill" style={{ marginLeft: 6 }}>grip</span>}</div>
                <div className="small muted">{prescription(pe, ex)}{skipped ? ' · skipped' : actualId !== pe.exerciseId ? ' · swapped' : ''}</div>
              </span>
              <span className={`status ${status}`} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
