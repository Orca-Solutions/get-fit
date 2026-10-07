import { useNavigate, useParams } from 'react-router-dom';
import { startSession } from '../../db/repo';
import { formatShort } from '../../lib/dates';
import { useToday } from '../../lib/hooks';
import { WorkoutList } from './WorkoutList';
import { usePlan } from './usePlan';

export default function PlanPreview() {
  const { plannedId } = useParams();
  const today = useToday();
  const plan = usePlan(today);
  const nav = useNavigate();
  const v = plan?.byId.get(plannedId ?? '');
  if (!plan) return null;
  if (!v) return <p className="muted">That workout isn't in the plan any more.</p>;
  const w = v.workout;
  return (
    <>
      <div className="topbar">
        <button className="icon-btn" onClick={() => nav(-1)}>‹ Back</button>
        <span className="spacer" />
      </div>
      <div className="card">
        <div style={{ fontSize: 20, fontWeight: 700 }}>{w.focus}</div>
        <div className="small muted">{formatShort(w.date)}{w.windowEnd ? `–${formatShort(w.windowEnd).slice(4)}` : ''} · week {w.weekIndex + 1} · {v.planned} sets</div>
        <p className="small muted">{w.rationale}</p>
        <WorkoutList workout={w} session={v.session} interactive={v.logged > 0} />
        {w.exercises.some((e) => e.note) && (
          <div className="small faint stack" style={{ marginTop: 10 }}>
            {w.exercises.filter((e) => e.note).map((e) => <div key={e.id}>{e.note}</div>)}
          </div>
        )}
        <button
          className="btn primary block"
          style={{ marginTop: 12 }}
          onClick={async () => {
            await startSession(w.id, today);
            nav(`/workout/${w.id}`);
          }}
        >
          {v.logged > 0 ? 'Open log' : w.date === today ? 'Start workout' : 'Do it today'}
        </button>
      </div>
    </>
  );
}
