import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { startSession } from '../../db/repo';
import { addDays, formatShort, mondayOf, monthName, parseISODate, toISODate } from '../../lib/dates';
import { sessionLetter } from '../../lib/format';
import { useToday } from '../../lib/hooks';
import { usePlan, type WorkoutView } from '../plan/usePlan';

const STATE_MARK: Record<string, string> = { done: '✓', 'done-late': '✓', partial: '½', missed: '✕', planned: '·', today: '·', 'not-tracked': '' };
const STATE_LABEL: Record<string, string> = { done: 'done', 'done-late': 'done late', partial: 'partial', missed: 'missed', planned: 'planned', today: 'today', 'not-tracked': 'before you started' };

export default function CalendarView() {
  const today = useToday();
  const plan = usePlan(today);
  const nav = useNavigate();
  const [mode, setMode] = useState<'month' | 'week'>('month');
  const [cursor, setCursor] = useState(today);
  const [selected, setSelected] = useState<string | null>(today);

  // A workout is drawn on the day it was actually done when that differs from its planned day.
  const byDay = useMemo(() => {
    const m = new Map<string, WorkoutView[]>();
    for (const v of plan?.views ?? []) {
      const day = v.session && v.logged > 0 ? v.session.date : v.workout.date;
      m.set(day, [...(m.get(day) ?? []), v]);
    }
    return m;
  }, [plan]);

  if (!plan) return null;
  const deloadDays = new Set(plan.views.filter((v) => v.workout.isDeload).flatMap((v) => weekDays(mondayOf(v.workout.date))));
  const blockStarts = new Set(plan.blocks.map((b) => b.startDate));

  const c = parseISODate(cursor);
  const first = toISODate(new Date(c.getFullYear(), c.getMonth(), 1));
  const gridStart = mondayOf(first);
  const days = mode === 'month' ? Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)).filter((d, i) => i < 35 || parseISODate(d).getMonth() === c.getMonth()) : weekDays(mondayOf(cursor));
  const step = (dir: number) => {
    if (mode === 'month') setCursor(toISODate(new Date(c.getFullYear(), c.getMonth() + dir, 1)));
    else setCursor(addDays(cursor, 7 * dir));
  };
  const sel = selected ? byDay.get(selected) ?? [] : [];

  return (
    <>
      <div className="topbar">
        <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous">‹</button>
        <h1 className="center">{mode === 'month' ? `${monthName(c.getMonth())} ${c.getFullYear()}` : `Week of ${formatShort(mondayOf(cursor))}`}</h1>
        <button className="icon-btn" onClick={() => step(1)} aria-label="Next">›</button>
      </div>
      <div className="center" style={{ marginBottom: 8 }}>
        <div className="seg">
          <button className={mode === 'month' ? 'on' : ''} onClick={() => setMode('month')}>Month</button>
          <button className={mode === 'week' ? 'on' : ''} onClick={() => setMode('week')}>Week</button>
        </div>
      </div>

      {mode === 'month' ? (
        <div className="cal">
          {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((h) => <div className="h" key={h}>{h}</div>)}
          {days.map((d) => {
            const vs = byDay.get(d) ?? [];
            const cls = ['d', parseISODate(d).getMonth() !== c.getMonth() ? 'out' : '', d === today ? 'today' : '', deloadDays.has(d) ? 'deload' : '', blockStarts.has(d) ? 'block-start' : '', d === selected ? 'sel' : ''].join(' ');
            return (
              <button key={d} className={cls} onClick={() => setSelected(d)}>
                <span>{parseISODate(d).getDate()}</span>
                {vs.map((v) => (
                  <span key={v.workout.id} className={`tag ${v.state}`}>{sessionLetter(v.workout.sessionType)}{STATE_MARK[v.state]}</span>
                ))}
              </button>
            );
          })}
        </div>
      ) : (
        <ul className="list card">
          {days.map((d) => {
            const vs = byDay.get(d) ?? [];
            return (
              <li key={d}>
                <button className="item" onClick={() => setSelected(d)}>
                  <span style={{ width: 90 }} className={d === today ? '' : 'muted'}>{formatShort(d)}</span>
                  <span className="grow">
                    {vs.length ? vs.map((v) => (
                      <div key={v.workout.id}>
                        {v.workout.focus}
                        <div className="small muted">{v.planned} sets · {STATE_LABEL[v.state]}</div>
                      </div>
                    )) : <span className="faint">Rest</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="legend">
        <span>L legs · U upper · C core</span>
        <span>✓ done · ½ partial · ✕ missed · · planned</span>
        <span>shaded = deload week · green edge = new block</span>
      </div>

      {selected && (
        <div className="card">
          <div className="muted small">{formatShort(selected)}</div>
          {sel.length === 0 && <div className="faint">Rest day</div>}
          {sel.map((v) => (
            <div key={v.workout.id} style={{ marginTop: 6 }}>
              <div>{v.workout.focus} · <span className="muted">{STATE_LABEL[v.state]}</span></div>
              <div className="small muted">{v.workout.exercises.length} moves · {v.planned} sets{v.logged ? ` · ${v.logged} logged` : ''}{v.logged > 0 && v.session && v.session.date !== v.workout.date ? ` · planned ${formatShort(v.workout.date)}` : ''}</div>
              <div className="row" style={{ marginTop: 8 }}>
                {v.logged > 0 ? (
                  <button className="btn small grow" onClick={() => nav(`/workout/${v.workout.id}`)}>Open log</button>
                ) : (
                  <>
                    <button className="btn small" onClick={() => nav(`/plan/${v.workout.id}`)}>Preview</button>
                    {(v.state === 'missed' || v.state === 'planned' || v.state === 'today') && (
                      <button
                        className="btn small primary grow"
                        onClick={async () => {
                          await startSession(v.workout.id, today);
                          nav(`/workout/${v.workout.id}`);
                        }}
                      >
                        Do it today
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function weekDays(monday: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}
