import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { logSet, sessionFor, startSession, unlogSet, updateSession } from '../../db/repo';
import { lastTimeHint, summarizeHistory, fmtNum } from '../../generator/progression';
import { prescription } from '../../lib/format';
import { useExercises, useProfile, useToday, useWakeLock } from '../../lib/hooks';
import { Photo } from '../../ui/Photo';
import type { Exercise, LoggedSet, PlannedExercise } from '../../types';
import { HistoryPanel } from './HistoryPanel';
import { SetRow, type Carry } from './SetRow';
import { FinishSheet, InfoSheet, SwapSheet } from './WorkoutSheets';

export default function Workout() {
  const { plannedId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const today = useToday();
  const profile = useProfile();
  const exercises = useExercises();
  const workout = useLiveQuery(() => db.plannedWorkouts.get(plannedId), [plannedId]);
  const session = useLiveQuery(() => sessionFor(plannedId), [plannedId]);
  const liveSets = useLiveQuery(async () => (session ? (await db.loggedSets.where('sessionId').equals(session.id).toArray()).filter((s) => !s.deletedAt) : undefined), [session?.id]);
  const sessionSets = liveSets ?? [];
  const [sheet, setSheet] = useState<'swap' | 'info' | 'finish' | null>(null);
  useWakeLock(true);

  // Opening a workout by link starts its session (dated today) so every tap has somewhere to save.
  useEffect(() => {
    if (workout && session === undefined) {
      const t = setTimeout(() => sessionFor(plannedId).then((s) => s || startSession(plannedId, today)), 50);
      return () => clearTimeout(t);
    }
  }, [workout, session, plannedId, today]);

  // Opened without ?m: land on the first unfinished movement once, then stay put while logging.
  useEffect(() => {
    if (workout && liveSets && !params.has('m')) setParams({ m: String(firstUnfinished(workout.exercises, liveSets, session?.skipped)) }, { replace: true });
  }, [workout, liveSets, params, setParams, session?.skipped]);

  const index = Math.min(Number(params.get('m') ?? firstUnfinished(workout?.exercises ?? [], sessionSets, session?.skipped)), Math.max(0, (workout?.exercises.length ?? 1) - 1));
  const go = (i: number) => setParams({ m: String(i) }, { replace: true });

  const touch = useRef<{ x: number; y: number } | null>(null);

  if (workout === undefined || !session) return null;
  if (!workout) return <p className="muted">Workout not found.</p>;

  const pe = workout.exercises[index];
  const actualId = session.swaps?.[pe.id] ?? pe.exerciseId;
  const ex = exercises.get(actualId);
  const plannedTotal = workout.exercises.filter((e) => !session.skipped?.includes(e.id)).reduce((n, e) => n + e.sets.length, 0);
  const isLast = index === workout.exercises.length - 1;

  return (
    <div
      className="with-footer"
      onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
      onTouchEnd={(e) => {
        const t = touch.current;
        touch.current = null;
        if (!t || (e.target as HTMLElement).closest('input,button,.band-chips')) return;
        const dx = e.changedTouches[0].clientX - t.x;
        const dy = e.changedTouches[0].clientY - t.y;
        if (Math.abs(dx) > 70 && Math.abs(dy) < 40) go(Math.max(0, Math.min(workout.exercises.length - 1, index + (dx < 0 ? 1 : -1))));
      }}
    >
      <div className="topbar">
        <button className="icon-btn" onClick={() => nav('/')}>‹ Today</button>
        <span className="spacer center small muted">{index + 1} of {workout.exercises.length}</span>
        <button className="icon-btn" onClick={() => setSheet('swap')}>Swap</button>
        <button className="icon-btn" onClick={() => setSheet('info')} aria-label="More">⋯</button>
      </div>
      <div className="row small muted">
        <div className="strip grow">
          {workout.exercises.map((e, i) => {
            const n = sessionSets.filter((s) => s.plannedExerciseId === e.id).length;
            const cls = [n >= e.sets.length ? 'done' : n > 0 ? 'partial' : '', i === index ? 'current' : '', e.role === 'G' ? 'grip' : ''].join(' ');
            return <button key={e.id} className={cls} onClick={() => go(i)} aria-label={`Movement ${i + 1}`}>{e.supersetGroup ?? i + 1}</button>;
          })}
        </div>
        <span>{sessionSets.length} / {plannedTotal} sets</span>
      </div>

      {ex ? (
        <MovementLogger key={pe.id + actualId} pe={pe} ex={ex} sessionId={session.id} sessionDate={session.date} sets={sessionSets} />
      ) : (
        <p className="muted">Unknown movement {actualId}.</p>
      )}

      <div className="footer-nav">
        <div className="inner">
          <button className="btn" disabled={index === 0} onClick={() => go(index - 1)}>‹ Prev</button>
          {isLast ? (
            <button className="btn primary grow" onClick={() => setSheet('finish')}>Finish</button>
          ) : (
            <NextButton pe={pe} next={workout.exercises[index + 1]} sets={sessionSets} names={exercises} swaps={session.swaps} onClick={() => go(index + 1)} />
          )}
        </div>
      </div>

      {sheet === 'swap' && ex && <SwapSheet pe={pe} current={ex} session={session} location={workout.location} profile={profile} onClose={() => setSheet(null)} />}
      {sheet === 'info' && ex && <InfoSheet pe={pe} ex={ex} session={session} onClose={() => setSheet(null)} onFinish={() => setSheet('finish')} />}
      {sheet === 'finish' && <FinishSheet workout={workout} session={session} sets={sessionSets} onClose={() => setSheet(null)} onDone={async (patch) => {
        await updateSession(session.id, { ...patch, endedAt: new Date().toISOString() });
        nav('/');
      }} />}
    </div>
  );
}

function NextButton({ pe, next, sets, names, swaps, onClick }: { pe: PlannedExercise; next: PlannedExercise; sets: LoggedSet[]; names: Map<string, Exercise>; swaps?: Record<string, string>; onClick: () => void }) {
  const done = sets.filter((s) => s.plannedExerciseId === pe.id).length >= pe.sets.length;
  const nextName = names.get(swaps?.[next.id] ?? next.exerciseId)?.name ?? 'next';
  return (
    <button className={`btn grow ${done ? 'primary' : ''}`} onClick={onClick}>
      {done ? <span className="ellipsis">Next: {nextName} ›</span> : 'Next ›'}
    </button>
  );
}

function firstUnfinished(list: PlannedExercise[], sets: LoggedSet[], skipped?: string[]): number {
  const i = list.findIndex((e) => !skipped?.includes(e.id) && sets.filter((s) => s.plannedExerciseId === e.id).length < e.sets.length);
  return i < 0 ? 0 : i;
}

function MovementLogger({ pe, ex, sessionId, sessionDate, sets }: { pe: PlannedExercise; ex: Exercise; sessionId: string; sessionDate: string; sets: LoggedSet[] }) {
  const profile = useProfile();
  const allHistory = useLiveQuery(async () => (await db.loggedSets.where('exerciseId').equals(ex.id).toArray()).filter((s) => !s.deletedAt), [ex.id]) ?? [];
  const history = useMemo(() => summarizeHistory(ex, allHistory.filter((s) => s.sessionId !== sessionId), profile), [ex, allHistory, sessionId, profile]);
  // Sets for this slot and this movement: after a swap, the other movement's sets stay in its own history.
  const mine = sets.filter((s) => s.plannedExerciseId === pe.id && s.exerciseId === ex.id).sort((a, b) => a.setIndex - b.setIndex);
  const [extraRows, setExtraRows] = useState(0);
  const [focusWeightRow, setFocusWeightRow] = useState<number | null>(null);
  const rowCount = Math.max(pe.sets.length + extraRows, mine.length ? mine[mine.length - 1].setIndex + 1 : 0);
  const mainTarget = pe.sets[pe.sets.length - 1]?.targetReps ?? pe.sets[0]?.targetReps;
  const bandName = (id: string) => profile.bands.find((b) => b.id === id)?.name ?? 'band';
  const hint = lastTimeHint(ex, history, mainTarget, bandName);
  const allDone = mine.length >= pe.sets.length;
  const effort = mine.find((s) => s.effort)?.effort;
  // The plan is written at block start, so its "first time" advice goes stale once the movement has history.
  const note = history.length ? pe.note?.replace(/First time:[^.]*\.\s*/, '').trim() : pe.note;

  const session = { id: sessionId, date: sessionDate } as Parameters<typeof logSet>[0];
  const carryFor = (i: number): Carry => {
    const before = mine.filter((s) => s.setIndex < i);
    const src = before[before.length - 1] ?? mine[mine.length - 1];
    if (src) return { weight: src.weight, bandId: src.bandId, stanceSteps: src.stanceSteps };
    // Band movements start from last time's band and stance; weights stay blank on purpose.
    if (ex.weightConvention === 'band' && hint) return { bandId: hint.bandId, stanceSteps: hint.stanceSteps };
    return {};
  };

  return (
    <>
      <div className="row" style={{ alignItems: 'flex-start', marginTop: 8 }}>
        <div className="grow">
          {pe.supersetGroup && <div className="pill">Superset {pe.supersetGroup}</div>}
          <div className="move-title">{ex.name}</div>
          <div className="muted">Plan: {prescription(pe, ex)} {ex.metric === 'time' ? '' : 'reps'} · {pe.sets[0]?.rir} in reserve</div>
          {hint && (
            <div className="hint">
              {hint.text}
              {hint.suggest != null && <span className="muted"> · try {fmtNum(hint.suggest)}</span>}
            </div>
          )}
          {note && <div className="small faint" style={{ marginTop: 4 }}>{note}</div>}
        </div>
        <Photo ex={ex} />
      </div>

      <table className="sets">
        <thead>
          <tr>
            <th>Set</th>
            <th>{ex.weightConvention === 'band' ? 'Band · steps from anchor' : ex.weightConvention === 'assist' ? 'Assist (lb)' : ex.weightConvention === 'per-hand' ? 'Weight (each)' : ex.loadType === 'smith' ? 'Plates added (lb)' : ex.weightConvention === 'added' ? 'Added (lb)' : ex.weightConvention === 'none' ? '' : 'Weight (lb)'}</th>
            <th>{ex.metric === 'time' ? 'Seconds' : 'Reps'}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rowCount }, (_, i) => {
            const logged = mine.find((s) => s.setIndex === i);
            return (
              <SetRow
                key={i}
                index={i}
                ex={ex}
                planned={pe.sets[i] ?? pe.sets[pe.sets.length - 1]}
                logged={logged}
                carry={carryFor(i)}
                bands={[...profile.bands].sort((a, b) => a.order - b.order)}
                autoFocusWeight={focusWeightRow === i}
                onLog={async (v) => {
                  setFocusWeightRow(null);
                  await logSet(session, ex.id, pe.id, i, v);
                }}
                onUnlog={() => logged && unlogSet(logged.id)}
                onDelete={i >= pe.sets.length && i === rowCount - 1 && !logged ? () => setExtraRows((n) => Math.max(0, n - 1)) : undefined}
              />
            );
          })}
        </tbody>
      </table>
      <button className="btn ghost" onClick={() => setExtraRows((n) => n + 1)}>+ Add set</button>

      {allDone && (
        <div className="row small" style={{ margin: '8px 0' }}>
          <span className="muted">How did that feel?</span>
          {(['easy', 'right', 'hard'] as const).map((e) => (
            <button key={e} className={`chip ${effort === e ? 'on' : ''}`} onClick={() => Promise.all(mine.map((s) => logSet(session, s.exerciseId, s.plannedExerciseId, s.setIndex, { effort: effort === e ? null : e })))}>
              {e[0].toUpperCase() + e.slice(1)}
            </button>
          ))}
        </div>
      )}

      <HistoryPanel ex={ex} history={history} profile={profile} limit={rowCount >= 5 ? 2 : 3} />
    </>
  );
}
