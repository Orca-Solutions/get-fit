import { useNavigate } from 'react-router-dom';
import { startSession } from '../../db/repo';
import { formatShort, mondayOf } from '../../lib/dates';
import { useToday } from '../../lib/hooks';
import { WorkoutList } from '../plan/WorkoutList';
import { currentBlock, usePlan, type WorkoutView } from '../plan/usePlan';

export default function Today() {
  const today = useToday();
  const plan = usePlan(today);
  const nav = useNavigate();
  if (!plan) return null;
  const block = currentBlock(plan.blocks, today);
  const active = plan.views.find((v) => v.workout.date <= today && today <= (v.workout.windowEnd ?? v.workout.date));
  // A session pulled forward or done late shows up today too.
  const loggedToday = plan.views.find((v) => v.logged > 0 && v.session?.date === today && v !== active);
  const main = loggedToday ?? active;
  // Missed sessions from this week can still be made up (periodization §4.5).
  const weekStart = mondayOf(today);
  const overdue = plan.views.filter((v) => v.state === 'missed' && v.workout.date >= weekStart && v !== main);
  const next = plan.views.find((v) => v.workout.date > today && v.logged === 0);

  const open = async (v: WorkoutView) => {
    await startSession(v.workout.id, today);
    nav(`/workout/${v.workout.id}`);
  };

  return (
    <>
      <div className="topbar">
        <h1>{formatShort(today)}</h1>
        {main && block && <span className="muted small">Week {main.workout.weekIndex + 1} / {block.weeks}{main.workout.isDeload ? ' · deload' : ''}</span>}
      </div>

      {main ? (
        <TodayCard v={main} today={today} onOpen={() => open(main)} />
      ) : (
        <div className="card">
          <div className="move-title">Rest day</div>
          {next && (
            <>
              <p className="muted">Next: {formatShort(next.workout.date)} · {next.workout.focus}</p>
              <div className="row">
                <button className="btn" onClick={() => nav(`/plan/${next.workout.id}`)}>Preview</button>
                <button className="btn primary grow" onClick={() => open(next)}>Do it today</button>
              </div>
            </>
          )}
        </div>
      )}

      {overdue.map((v) => (
        <div className="card row" key={v.workout.id}>
          <div className="grow">
            <div>{formatShort(v.workout.date)} · {v.workout.focus}</div>
            <div className="small" style={{ color: 'var(--bad)' }}>Missed</div>
          </div>
          <button className="btn small" onClick={() => open(v)}>Do it today</button>
        </div>
      ))}

      {block && <p className="small faint">{block.rationale}</p>}
    </>
  );
}

function TodayCard({ v, today, onOpen }: { v: WorkoutView; today: string; onOpen: () => void }) {
  const w = v.workout;
  const pct = v.planned ? Math.min(100, (v.logged / v.planned) * 100) : 0;
  const label = v.logged === 0 ? 'Start workout' : v.state === 'done' || v.state === 'done-late' ? 'Review workout' : 'Resume workout';
  return (
    <div className="card">
      <div className="row">
        <div className="grow">
          <div style={{ fontSize: 20, fontWeight: 700 }}>{w.focus}</div>
          <div className="small muted">
            {w.exercises.length} moves · {v.planned} sets{w.date !== today ? ` · planned ${formatShort(w.date)}` : ''}
            {w.location === 'home' ? ' · at home' : ''}
          </div>
        </div>
      </div>
      <p className="small muted" style={{ margin: '8px 0' }}>{w.rationale}</p>
      <div className="row small muted" style={{ marginBottom: 6 }}>
        <div className="progress grow"><div style={{ width: `${pct}%` }} /></div>
        <span>{v.logged} / {v.planned} sets</span>
      </div>
      <WorkoutList workout={w} session={v.session} interactive />
      <button className="btn primary block" style={{ marginTop: 12 }} onClick={onOpen}>{label}</button>
    </div>
  );
}
