import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, ensurePlan, exportAll, exportSetsCsv, getProfile, getSyncStatus, importAll, put, regenerateUpcoming, setSyncToken, syncNow, type SyncStatus } from '@orca-solutions/get-fit-core/client';
import { parseKettlebells, type Profile, today, uuid } from '@orca-solutions/get-fit-core';
import { useProfile } from '../../lib/hooks';
import { useRestPrefs } from '../../lib/restTimer';

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
        <label className="field-label">Kettlebells at home (lb, "25x2" for a pair)</label>
        <TextField value={profile.kettlebells.map((k) => (k.count > 1 ? `${k.lb}x${k.count}` : `${k.lb}`)).join(', ')} onSave={(v) => save({ kettlebells: parseKettlebells(v) })} />
        <label className="field-label">Core day</label>
        <div className="seg">
          <button className={profile.coreWave === 'wave' ? 'on' : ''} onClick={() => save({ coreWave: 'wave' })}>Light wave</button>
          <button className={profile.coreWave === 'flat' ? 'on' : ''} onClick={() => save({ coreWave: 'flat' })}>Flat</button>
        </div>
      </div>

      <RestCard />

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
        <p className="small muted" style={{ margin: 0 }}>Mon chest & biceps · Wed legs · Fri back, triceps & shoulders · Sat or Sun core at home. Runs stay out of the app.</p>
        <button
          className="btn block"
          onClick={async () => {
            if (!confirm('Rebuild the rest of this block from today, and the next block? Logged workouts are kept.')) return;
            await syncNow();
            await regenerateUpcoming(today());
            flash('Upcoming workouts regenerated');
          }}
        >
          Regenerate upcoming workouts
        </button>
      </div>

      <SyncCard flash={flash} />

      <h2 className="section">Export my data</h2>
      <div className="card stack">
        <p className="small muted" style={{ margin: 0 }}>
          Save a copy of everything (logs, plan, settings and bands) as a backup file, or your logged sets as a spreadsheet. Restoring a backup adds what's missing and never removes sets.
        </p>
        <div className="row">
          <button className="btn grow" onClick={async () => download(`get-fit-backup-${today()}.json`, JSON.stringify(await exportAll(), null, 2), 'application/json')}>
            Back up (JSON)
          </button>
          <button className="btn grow" onClick={async () => download(`get-fit-sets-${today()}.csv`, await exportSetsCsv(), 'text/csv')}>
            Sets (CSV)
          </button>
        </div>
        <label className="btn block">
          Restore from backup
          <input
            type="file"
            accept="application/json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const { skipped } = await importAll(JSON.parse(await f.text()));
                flash(skipped ? `Backup restored; skipped ${skipped} damaged ${skipped === 1 ? 'entry' : 'entries'}` : 'Backup restored');
              } catch {
                flash("That file isn't a get-fit backup");
              }
              e.target.value = '';
            }}
          />
        </label>
      </div>
      <p className="small faint center">get-fit · FSL-1.1-MIT · exercise photos from free-exercise-db</p>
      {msg && <div className="toast">{msg}</div>}
    </>
  );
}

/** Saved on this device only: the phone at the gym and a laptop at home can differ. */
function RestCard() {
  const [prefs, setPrefs] = useRestPrefs();
  return (
    <>
      <h2 className="section">Rest timer</h2>
      <div className="card">
        <p className="small muted" style={{ margin: '0 0 8px' }}>Starts when you log a set: longer after heavy compound lifts, shorter for isolation and core.</p>
        <div className="seg">
          <button className={prefs.enabled ? 'on' : ''} onClick={() => setPrefs({ enabled: true })}>On</button>
          <button className={!prefs.enabled ? 'on' : ''} onClick={() => setPrefs({ enabled: false })}>Off</button>
        </div>
        {prefs.enabled && (
          <>
            <label className="field-label">When rest is up (phones that can buzz always buzz once)</label>
            <div className="seg">
              <button className={!prefs.sound ? 'on' : ''} onClick={() => setPrefs({ sound: false })}>No sound</button>
              <button className={prefs.sound ? 'on' : ''} onClick={() => setPrefs({ sound: true })}>Soft chime</button>
            </div>
          </>
        )}
      </div>
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
              {status.heldBack > 0 && (
                <div style={{ color: 'var(--warn)' }}>
                  {status.heldBack} damaged {status.heldBack === 1 ? 'record stays' : 'records stay'} on this device and won't sync.
                </div>
              )}
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

async function download(filename: string, text: string, type: string) {
  // An installed iPhone app opens a download link in place with no way back, so use the share sheet
  // (Save to Files, AirDrop, Mail) there; browsers get a normal download.
  const installed = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  const file = new File([text], filename, { type });
  if (installed && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = filename;
  a.click();
  // Revoking right away can cancel the download in Safari.
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

/** A device's first sync replaces its own generated plan with the server's (joinServer in lib/sync). */
async function connectSync(token: string) {
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
