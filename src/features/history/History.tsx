import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { formatShort } from '../../lib/dates';
import { useExercises } from '../../lib/hooks';

export default function History() {
  const [tab, setTab] = useState<'movement' | 'session'>('movement');
  const [q, setQ] = useState('');
  const exercises = useExercises();
  const nav = useNavigate();
  const data = useLiveQuery(async () => {
    const [sets, sessions, workouts] = await Promise.all([db.loggedSets.toArray(), db.sessions.toArray(), db.plannedWorkouts.toArray()]);
    return { sets: sets.filter((s) => !s.deletedAt), sessions: sessions.filter((s) => !s.deletedAt), workouts: new Map(workouts.map((w) => [w.id, w])) };
  }, []);

  const movements = useMemo(() => {
    const last = new Map<string, { date: string; n: number }>();
    for (const s of data?.sets ?? []) {
      const cur = last.get(s.exerciseId);
      last.set(s.exerciseId, { date: !cur || s.date > cur.date ? s.date : cur.date, n: (cur?.n ?? 0) + 1 });
    }
    return [...last.entries()]
      .map(([id, v]) => ({ id, name: exercises.get(id)?.name ?? id, ...v }))
      .filter((m) => m.name.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [data, exercises, q]);

  if (!data) return null;
  const sessions = data.sessions
    .map((s) => ({ s, n: data.sets.filter((x) => x.sessionId === s.id).length, w: s.plannedWorkoutId ? data.workouts.get(s.plannedWorkoutId) : undefined }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.s.date.localeCompare(a.s.date));

  return (
    <>
      <div className="topbar"><h1>History</h1></div>
      <div className="seg" style={{ marginBottom: 10 }}>
        <button className={tab === 'movement' ? 'on' : ''} onClick={() => setTab('movement')}>By movement</button>
        <button className={tab === 'session' ? 'on' : ''} onClick={() => setTab('session')}>By workout</button>
      </div>
      {tab === 'movement' ? (
        <>
          <input className="search" placeholder="Search movements" value={q} onChange={(e) => setQ(e.target.value)} />
          <ul className="list card">
            {movements.map((m) => (
              <li key={m.id}>
                <Link className="item" to={`/history/${m.id}`}>
                  <span className="grow">{m.name}<div className="small muted">{m.n} sets · last {formatShort(m.date)}</div></span>
                  <span className="muted">›</span>
                </Link>
              </li>
            ))}
            {!movements.length && <li className="muted small" style={{ padding: 12 }}>Nothing logged yet.</li>}
          </ul>
        </>
      ) : (
        <ul className="list card">
          {sessions.map(({ s, n, w }) => (
            <li key={s.id}>
              <button className="item" onClick={() => w && nav(`/workout/${w.id}`)}>
                <span className="grow">{w?.focus ?? 'Workout'}<div className="small muted">{formatShort(s.date)} · {n} sets{s.effort ? ` · effort ${s.effort}/5` : ''}</div></span>
                <span className="muted">›</span>
              </button>
            </li>
          ))}
          {!sessions.length && <li className="muted small" style={{ padding: 12 }}>No workouts logged yet.</li>}
        </ul>
      )}
    </>
  );
}
