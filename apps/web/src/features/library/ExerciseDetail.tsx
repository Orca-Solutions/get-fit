import { Link, useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, setFlag } from '@orca-solutions/get-fit-core/client';
import { useExercises, useProfile } from '../../lib/hooks';
import type { Location } from '@orca-solutions/get-fit-core';
import { Photo } from '../../ui/Photo';

export default function ExerciseDetail() {
  const { exerciseId = '' } = useParams();
  const nav = useNavigate();
  const ex = useExercises().get(exerciseId);
  const flag = useLiveQuery(() => db.exerciseFlags.get(exerciseId), [exerciseId]);
  const profile = useProfile();
  if (!ex) return <p className="muted">Unknown movement.</p>;
  const toggle = (k: 'favourite' | 'avoid') => setFlag(ex.id, { [k]: !flag?.[k] });
  // "Can't do" is per place: the gym might lack a machine you have at home, or the other way round.
  const places = (['gym', 'home'] as Location[]).filter((l) => ex.equipment.every((q) => profile.equipmentByLocation[l].includes(q)));
  const blockedAt = flag?.unavailable ? places : (flag?.unavailableAt ?? []);
  const toggleAt = (l: Location) => setFlag(ex.id, { unavailable: false, unavailableAt: blockedAt.includes(l) ? blockedAt.filter((x) => x !== l) : [...blockedAt, l] });
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
        {places.map((l) => (
          <button key={l} className={`chip ${blockedAt.includes(l) ? 'on' : ''}`} onClick={() => toggleAt(l)}>
            Can't do at {l === 'gym' ? 'the gym' : 'home'}
          </button>
        ))}
      </div>
      <p className="small faint">Avoided movements are left out of new plans and swaps everywhere; can't-do ones only at that place. Favourites are picked more often.</p>
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
      <p className="small faint">Source: {ex.source.name === 'free-exercise-db' ? 'get-fit, photos from free-exercise-db' : 'get-fit'}</p>
    </>
  );
}
