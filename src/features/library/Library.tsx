import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { muscleGroupOf } from '../../data/muscleGroups';
import { useExercises } from '../../lib/hooks';

const GROUPS = ['all', 'chest', 'back', 'shoulders', 'arms', 'core', 'legs'] as const;

export default function Library() {
  const exercises = useExercises();
  const flags = useLiveQuery(() => db.exerciseFlags.toArray(), []) ?? [];
  const [q, setQ] = useState('');
  const [group, setGroup] = useState<(typeof GROUPS)[number]>('all');
  const flagById = new Map(flags.map((f) => [f.id, f]));
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return [...exercises.values()]
      .filter((e) => group === 'all' || e.primaryMuscles.some((m) => muscleGroupOf[m] === group))
      .filter((e) => !needle || e.name.toLowerCase().includes(needle) || e.aliases.some((a) => a.toLowerCase().includes(needle)) || e.equipment.some((q) => q.includes(needle)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [exercises, q, group]);
  return (
    <>
      <div className="topbar"><h1>Library</h1><span className="muted small">{list.length}</span></div>
      <input className="search" placeholder="Search name, alias or equipment" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="strip" style={{ marginTop: 6 }}>
        {GROUPS.map((g) => (
          <button key={g} className={`chip ${group === g ? 'on' : ''}`} style={{ width: 'auto', height: 'auto', borderRadius: 999 }} onClick={() => setGroup(g)}>{g}</button>
        ))}
      </div>
      <ul className="list card">
        {list.map((e) => {
          const f = flagById.get(e.id);
          return (
            <li key={e.id}>
              <Link className="item" to={`/library/${e.id}`}>
                {e.images[0] ? <img className="photo" style={{ width: 44, height: 44 }} src={`/${e.images[0]}`} alt="" loading="lazy" /> : <span className="photo" style={{ width: 44, height: 44 }} />}
                <span className="grow">
                  <div className="ellipsis">{e.name}{f?.favourite ? ' ★' : ''}</div>
                  <div className="small muted ellipsis">{e.primaryMuscles.join(', ')}{f?.avoid ? ' · avoided' : f?.unavailable ? " · can't do here" : ''}</div>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}
