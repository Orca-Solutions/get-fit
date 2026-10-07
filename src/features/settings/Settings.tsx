import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../db/db';
import { ensurePlan, exportAll, getProfile, importAll, put, regenerateUpcoming } from '../../db/repo';
import { getSyncStatus, setSyncToken, syncNow, type SyncStatus } from '../../lib/sync';
import { uuid } from '../../lib/ids';
import { today } from '../../lib/dates';
import { useProfile } from '../../lib/hooks';
import type { Profile } from '../../types';

export default function Settings() {
  const profile = useProfile();
  const [msg, setMsg] = useState('');
  const save = async (patch: Partial<Profile>) => {
    const p = await getProfile();
    await put('profile', { ...p, ...patch });
  };
  const flash = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(''), 2500);
  };

  return (
    <>
      <div className="topbar"><h1>Settings</h1></div>

      <h2 className="section">You</h2>
      <div className="card">
        <NumberField label="Bodyweight (lb), used for assisted machines" value={profile.bodyweightLb} onSave={(v) => save({ bodyweightLb: v })} />
        <NumberField label="Smith machine bar weight (lb), added to the plates you log" value={profile.smithBarLb} onSave={(v) => save({ smithBarLb: v })} />
        <label className="field-label">Kettlebells (lb, comma separated)</label>
        <TextField value={profile.kettlebellsLb.join(', ')} onSave={(v) => save({ kettlebellsLb: v.split(',').map((x) => Number(x.trim())).filter((n) => n > 0).sort((a, b) => a - b) })} />
        <label className="field-label">Core day</label>
        <div className="seg">
          <button className={profile.coreWave === 'wave' ? 'on' : ''} onClick={() => save({ coreWave: 'wave' })}>Light wave</button>
          <button className={profile.coreWave === 'flat' ? 'on' : ''} onClick={() => save({ coreWave: 'flat' })}>Flat</button>
        </div>
      </div>

      <h2 className="section">My bands (lightest first)</h2>
      <div className="card">
        {[...profile.bands].sort((a, b) => a.order - b.order).map((b, i, list) => (
          <div className="row" key={b.id} style={{ marginBottom: 6 }}>
            <TextField value={b.name} onSave={(name) => save({ bands: profile.bands.map((x) => (x.id === b.id ? { ...x, name } : x)) })} />
            <button className="btn small" disabled={i === 0} onClick={() => save({ bands: swapOrder(list, i, i - 1) })} aria-label="Lighter">↑</button>
            <button className="btn small danger" onClick={() => save({ bands: profile.bands.filter((x) => x.id !== b.id) })} aria-label="Remove">✕</button>
          </div>
        ))}
        <button className="btn ghost" onClick={() => save({ bands: [...profile.bands, { id: uuid(), name: 'New band', order: profile.bands.length + 1 }] })}>+ Add band</button>
      </div>

      <h2 className="section">Plan</h2>
      <div className="card stack">
        <p className="small muted" style={{ margin: 0 }}>Mon legs · Wed chest & biceps · Fri back, triceps & shoulders · Sat or Sun core at home. Runs stay out of the app.</p>
        <button
          className="btn block"
          onClick={async () => {
            if (!confirm('Rebuild the rest of this block from today? Logged workouts are kept.')) return;
            await regenerateUpcoming(today());
            flash('Upcoming workouts regenerated');
          }}
        >
          Regenerate upcoming workouts
        </button>
      </div>

      <SyncCard flash={flash} />

      <h2 className="section">Backup</h2>
      <div className="card row">
        <button
          className="btn grow"
          onClick={async () => {
            const data = await exportAll();
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `get-fit-${today()}.json`;
            a.click();
            URL.revokeObjectURL(a.href);
          }}
        >
          Export JSON
        </button>
        <label className="btn grow">
          Import JSON
          <input
            type="file"
            accept="application/json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                await importAll(JSON.parse(await f.text()));
                flash('Imported');
              } catch {
                flash('That file could not be read');
              }
            }}
          />
        </label>
      </div>
      <p className="small faint center">get-fit · MIT · exercise photos from free-exercise-db (public domain)</p>
      {msg && <div className="toast">{msg}</div>}
    </>
  );
}

function swapOrder<T extends { order: number }>(list: T[], i: number, j: number): T[] {
  const out = list.map((b) => ({ ...b }));
  [out[i].order, out[j].order] = [out[j].order, out[i].order];
  return out;
}

function SyncCard({ flash }: { flash: (m: string) => void }) {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [token, setToken] = useState('');
  const meta = useLiveQuery(() => db.meta.toArray(), []);
  useEffect(() => {
    getSyncStatus().then(setStatus);
  }, [meta]);
  return (
    <>
      <h2 className="section">Sync</h2>
      <div className="card stack">
        {status?.configured ? (
          <>
            <div className="small">
              {status.lastSyncedAt ? `Last synced ${new Date(status.lastSyncedAt).toLocaleString()}` : 'Not synced yet'}
              {status.lastError && <div style={{ color: 'var(--warn)' }}>{status.lastError}</div>}
            </div>
            <div className="row">
              <button
                className="btn grow"
                onClick={async () => {
                  const r = await syncNow();
                  flash(r.ok ? 'Synced' : `Sync failed: ${'error' in r ? r.error : ''}`);
                }}
              >
                Sync now
              </button>
              <button className="btn danger" onClick={() => setSyncToken(null)}>Disconnect</button>
            </div>
          </>
        ) : (
          <>
            <p className="small muted" style={{ margin: 0 }}>Paste the sync token from the server to back up and share your data with other devices.</p>
            <input className="text-in" type="password" autoComplete="off" placeholder="Sync token" value={token} onChange={(e) => setToken(e.target.value)} />
            <button
              className="btn primary block"
              disabled={!token.trim()}
              onClick={async () => {
                await connectSync(token.trim());
                const r = await syncNow();
                await getProfile();
                await ensurePlan();
                flash(r.ok ? 'Connected and synced' : `Saved, but sync failed: ${'error' in r ? r.error : ''}`);
                setToken('');
              }}
            >
              Connect
            </button>
          </>
        )}
      </div>
    </>
  );
}

/**
 * On a fresh device (nothing logged yet), drop the default profile and generated plan before the
 * first sync so the server's copies come down instead of two plans existing side by side.
 */
async function connectSync(token: string) {
  const logged = await db.loggedSets.count();
  const synced = await db.meta.get('syncCursor');
  if (!logged && !synced) {
    await db.transaction('rw', [db.blocks, db.plannedWorkouts, db.sessions, db.profile], async () => {
      await db.profile.clear();
      await db.blocks.clear();
      await db.plannedWorkouts.clear();
      await db.sessions.clear();
    });
  }
  await setSyncToken(token);
}

function NumberField({ label, value, onSave }: { label: string; value: number; onSave: (v: number) => void }) {
  return (
    <>
      <label className="field-label">{label}</label>
      <TextField value={String(value)} inputMode="decimal" onSave={(v) => Number(v) > 0 && onSave(Number(v))} />
    </>
  );
}

function TextField({ value, onSave, inputMode }: { value: string; onSave: (v: string) => void; inputMode?: 'decimal' }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <input className="text-in" value={v} inputMode={inputMode} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v)} />;
}
