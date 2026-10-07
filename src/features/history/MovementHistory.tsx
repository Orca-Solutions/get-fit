import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { bestSet, fmtNum, summarizeHistory } from '../../generator/progression';
import { formatShort } from '../../lib/dates';
import { useExercises, useProfile } from '../../lib/hooks';
import { Sparkline, setText } from '../workout/HistoryPanel';

export default function MovementHistory() {
  const { exerciseId = '' } = useParams();
  const nav = useNavigate();
  const ex = useExercises().get(exerciseId);
  const profile = useProfile();
  const sets = useLiveQuery(async () => (await db.loggedSets.where('exerciseId').equals(exerciseId).toArray()).filter((s) => !s.deletedAt), [exerciseId]) ?? [];
  const history = useMemo(() => (ex ? summarizeHistory(ex, sets, profile) : []), [ex, sets, profile]);
  if (!ex) return <p className="muted">Unknown movement.</p>;
  const best = bestSet(ex, history, profile);
  const series = history.map((h) => h.bestE1rm).filter((v): v is number => v != null).reverse();
  return (
    <>
      <div className="topbar">
        <button className="icon-btn" onClick={() => nav(-1)}>‹ Back</button>
        <span className="spacer" />
        <Link to={`/library/${ex.id}`} className="small">About ›</Link>
      </div>
      <div className="move-title">{ex.name}</div>
      {best && <p className="muted">Best: {setText(ex, best.set, profile.bands)} on {formatShort(best.date)}</p>}
      {series.length >= 2 && (
        <div className="card">
          <div className="small muted">Estimated 1-rep max</div>
          <Sparkline values={series} width={320} height={80} />
          <div className="small muted row"><span className="grow">{fmtNum(Math.round(series[0]))} lb</span><span>{fmtNum(Math.round(series[series.length - 1]))} lb</span></div>
        </div>
      )}
      <div className="card">
        {history.map((h) => (
          <div className="history-line" key={h.sessionId}>
            <span className="d" style={{ width: 92 }}>{formatShort(h.date)}</span>
            <span className="grow">{h.sets.map((s) => setText(ex, s, profile.bands)).join(', ')}</span>
          </div>
        ))}
        {!history.length && <span className="muted small">Nothing logged yet.</span>}
      </div>
    </>
  );
}
