import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { setFlag } from '../../db/repo';
import { useExercises } from '../../lib/hooks';
import { Photo } from '../../ui/Photo';

export default function ExerciseDetail() {
  const { exerciseId = '' } = useParams();
  const nav = useNavigate();
  const ex = useExercises().get(exerciseId);
  const flag = useLiveQuery(() => db.exerciseFlags.get(exerciseId), [exerciseId]);
  if (!ex) return <p className="muted">Unknown movement.</p>;
  const toggle = (k: 'favourite' | 'avoid' | 'unavailable') => setFlag(ex.id, { [k]: !flag?.[k] });
  return (
    <>
      <div className="topbar">
        <button className="icon-btn" onClick={() => nav(-1)}>‹ Back</button>
        <span className="spacer" />
        <Link to={`/history/${ex.id}`} className="small">History ›</Link>
      </div>
      <div className="move-title">{ex.name}</div>
      {ex.aliases.length > 0 && <div className="small muted">Also: {ex.aliases.join(', ')}</div>}
      <div className="card row" style={{ alignItems: 'flex-start' }}>
        <Photo ex={ex} size={140} />
        <div className="small stack">
          <div><span className="muted">Works</span> {ex.primaryMuscles.join(', ')}{ex.secondaryMuscles.length ? <span className="muted"> (+ {ex.secondaryMuscles.join(', ')})</span> : null}</div>
          <div><span className="muted">Equipment</span> {ex.equipment.filter((q) => q !== 'none').join(', ') || 'bodyweight'}</div>
          <div><span className="muted">Reps</span> {ex.repRange.min}–{ex.repRange.max}{ex.metric === 'time' ? ' s' : ''}{ex.perSide ? ' per side' : ''}</div>
        </div>
      </div>
      <div className="row">
        <button className={`chip ${flag?.favourite ? 'on' : ''}`} onClick={() => toggle('favourite')}>★ Favourite</button>
        <button className={`chip ${flag?.avoid ? 'on' : ''}`} onClick={() => toggle('avoid')}>Avoid</button>
        <button className={`chip ${flag?.unavailable ? 'on' : ''}`} onClick={() => toggle('unavailable')}>Can't do here</button>
      </div>
      <p className="small faint">Avoided and can't-do movements are left out of new plans and swaps. Favourites are picked more often.</p>
      {ex.cues.length > 0 && (
        <div className="card">
          <div className="small muted">Cues</div>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{ex.cues.map((c) => <li key={c}>{c}</li>)}</ul>
        </div>
      )}
      {ex.instructions.length > 0 && (
        <div className="card">
          <div className="small muted">How to</div>
          <ol className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{ex.instructions.map((c) => <li key={c}>{c}</li>)}</ol>
        </div>
      )}
      <p className="small faint">Source: {ex.source.name === 'free-exercise-db' ? 'free-exercise-db (public domain)' : 'get-fit'}</p>
    </>
  );
}
