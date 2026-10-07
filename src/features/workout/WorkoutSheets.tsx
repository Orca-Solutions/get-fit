import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { updateSession } from '../../db/repo';
import { setE1rm } from '../../generator/progression';
import { useExercises, useProfile } from '../../lib/hooks';
import { Sheet } from '../../ui/Sheet';
import { Photo } from '../../ui/Photo';
import type { Exercise, Location, LoggedSet, PlannedExercise, PlannedWorkout, Profile, Session } from '../../types';

/** Same slot first, then same movement pattern and muscles; only what's available where you are. */
export function substitutes(pe: PlannedExercise, current: Exercise, all: Exercise[], location: Location, profile: Profile): Exercise[] {
  const have = profile.equipmentByLocation[location];
  return all
    .filter((e) => e.id !== current.id && e.equipment.every((q) => have.includes(q)))
    .map((e) => {
      const sameSlot = e.slots.includes(pe.slot);
      const samePattern = e.movementPattern === current.movementPattern && e.primaryMuscles.some((m) => current.primaryMuscles.includes(m));
      return { e, score: (sameSlot ? 2 : 0) + (samePattern ? 1 : 0) + (e.family === current.family ? 0.5 : 0) };
    })
    .filter((x) => x.score >= 1)
    .sort((a, b) => b.score - a.score || a.e.name.localeCompare(b.e.name))
    .map((x) => x.e);
}

export function SwapSheet({ pe, current, session, location, profile, onClose }: { pe: PlannedExercise; current: Exercise; session: Session; location: Location; profile: Profile; onClose: () => void }) {
  const exercises = useExercises();
  const flags = useLiveQuery(() => db.exerciseFlags.toArray(), []) ?? [];
  const list = useMemo(() => {
    const avoid = new Set(flags.filter((f) => f.avoid || f.unavailable).map((f) => f.id));
    return substitutes(pe, current, [...exercises.values()], location, profile).filter((e) => !avoid.has(e.id));
  }, [pe, current, exercises, location, profile, flags]);
  const planned = exercises.get(pe.exerciseId);
  const choose = async (id: string) => {
    const swaps = { ...(session.swaps ?? {}) };
    if (id === pe.exerciseId) delete swaps[pe.id];
    else swaps[pe.id] = id;
    await updateSession(session.id, { swaps });
    onClose();
  };
  return (
    <Sheet title={`Swap ${current.name}`} onClose={onClose}>
      {current.id !== pe.exerciseId && planned && (
        <button className="btn block" style={{ marginBottom: 8 }} onClick={() => choose(pe.exerciseId)}>Back to the plan: {planned.name}</button>
      )}
      <ul className="list">
        {list.slice(0, 12).map((e) => (
          <li key={e.id}>
            <button className="item" onClick={() => choose(e.id)}>
              <span className="grow">
                <div>{e.name}</div>
                <div className="small muted">{e.equipment.filter((q) => q !== 'none').join(', ') || 'bodyweight'}</div>
              </span>
              {e.slots.includes(pe.slot) && <span className="pill accent">same slot</span>}
            </button>
          </li>
        ))}
      </ul>
      {!list.length && <p className="muted">Nothing else fits this slot with the equipment here.</p>}
    </Sheet>
  );
}

export function InfoSheet({ pe, ex, session, onClose, onFinish }: { pe: PlannedExercise; ex: Exercise; session: Session; onClose: () => void; onFinish: () => void }) {
  const skipped = session.skipped?.includes(pe.id);
  const [note, setNote] = useState(session.notes ?? '');
  return (
    <Sheet title={ex.name} onClose={onClose}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <Photo ex={ex} size={120} />
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          {ex.cues.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </div>
      {ex.instructions.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary className="muted small">Full instructions</summary>
          <ol className="small muted">{ex.instructions.map((s) => <li key={s}>{s}</li>)}</ol>
        </details>
      )}
      <label className="field-label">Workout note</label>
      <textarea className="text-in" value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => updateSession(session.id, { notes: note })} />
      <div className="row" style={{ marginTop: 12 }}>
        <button
          className="btn grow"
          onClick={async () => {
            const list = new Set(session.skipped ?? []);
            if (skipped) list.delete(pe.id);
            else list.add(pe.id);
            await updateSession(session.id, { skipped: [...list] });
            onClose();
          }}
        >
          {skipped ? 'Un-skip movement' : 'Skip movement'}
        </button>
        <button className="btn grow" onClick={onFinish}>Finish workout</button>
      </div>
    </Sheet>
  );
}

export function FinishSheet({ workout, session, sets, onClose, onDone }: { workout: PlannedWorkout; session: Session; sets: LoggedSet[]; onClose: () => void; onDone: (patch: Partial<Session>) => void }) {
  const exercises = useExercises();
  const profile = useProfile();
  const [effort, setEffort] = useState<number | null>(session.effort ?? null);
  const [beatUp, setBeatUp] = useState(!!session.beatUp);
  const [note, setNote] = useState(session.notes ?? '');
  const prior = useLiveQuery(async () => {
    const ids = [...new Set(sets.map((s) => s.exerciseId))];
    const rows = await db.loggedSets.where('exerciseId').anyOf(ids).toArray();
    return rows.filter((r) => !r.deletedAt && r.sessionId !== session.id);
  }, [sets.length, session.id]) ?? [];

  const planned = workout.exercises.filter((e) => !session.skipped?.includes(e.id)).reduce((n, e) => n + e.sets.length, 0);
  const unfinished = workout.exercises.filter((e) => !session.skipped?.includes(e.id) && sets.filter((s) => s.plannedExerciseId === e.id).length < e.sets.length);
  let volume = 0;
  const prs: string[] = [];
  for (const id of new Set(sets.map((s) => s.exerciseId))) {
    const ex = exercises.get(id);
    if (!ex) continue;
    const mine = sets.filter((s) => s.exerciseId === id);
    for (const s of mine) if (s.weight && s.reps && ex.weightConvention !== 'assist') volume += s.weight * s.reps * (ex.weightConvention === 'per-hand' ? 2 : 1);
    const before = Math.max(0, ...prior.filter((s) => s.exerciseId === id).map((s) => setE1rm(ex, s, profile) ?? 0));
    const now = Math.max(0, ...mine.map((s) => setE1rm(ex, s, profile) ?? 0));
    if (before > 0 && now > before) prs.push(ex.name);
  }
  const minutes = Math.round((Date.now() - new Date(session.startedAt).getTime()) / 60000);

  return (
    <Sheet title="Finish workout" onClose={onClose}>
      <div className="stack">
        <div>{sets.length} of {planned} sets{minutes > 0 && minutes < 600 ? ` · ${minutes} min` : ''}{volume ? ` · ${Math.round(volume).toLocaleString()} lb moved` : ''}</div>
        {prs.length > 0 && <div style={{ color: 'var(--accent)' }}>New best: {prs.join(', ')}</div>}
        {unfinished.length > 0 && <div className="small" style={{ color: 'var(--warn)' }}>Not finished: {unfinished.map((e) => exercises.get(session.swaps?.[e.id] ?? e.exerciseId)?.name).join(', ')}</div>}
      </div>
      <label className="field-label">How hard was today?</label>
      <div className="row">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className={`chip ${effort === n ? 'on' : ''}`} onClick={() => setEffort(effort === n ? null : n)}>{n}</button>
        ))}
      </div>
      <label className="row small" style={{ marginTop: 12 }}>
        <input type="checkbox" checked={beatUp} onChange={(e) => setBeatUp(e.target.checked)} style={{ width: 22, height: 22 }} />
        <span>I'm beat up (lighter next block)</span>
      </label>
      <label className="field-label">Note</label>
      <textarea className="text-in" value={note} onChange={(e) => setNote(e.target.value)} />
      <button className="btn primary block" style={{ marginTop: 12 }} onClick={() => onDone({ effort, beatUp, notes: note })}>Finish</button>
    </Sheet>
  );
}
