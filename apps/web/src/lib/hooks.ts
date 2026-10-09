import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { CATALOG, db, defaultProfile, PROFILE_ID } from '@orca-solutions/get-fit-core/client';
import { type Exercise, type Profile, today } from '@orca-solutions/get-fit-core';

export function useProfile(): Profile {
  return useLiveQuery(() => db.profile.get(PROFILE_ID), []) ?? defaultProfile();
}

/** Catalog plus custom movements, by id. Custom ones load async; catalog is there immediately. */
export function useExercises(): Map<string, Exercise> {
  const custom = useLiveQuery(() => db.customExercises.toArray(), []);
  return useMemo(() => {
    const m = new Map<string, Exercise>(CATALOG.map((e) => [e.id, e]));
    for (const c of custom ?? []) if (!c.deletedAt) m.set(c.id, c);
    return m;
  }, [custom]);
}

/** Today's date, refreshed when the app comes back to the foreground after midnight. */
export function useToday(): string {
  const [d, setD] = useState(today());
  useEffect(() => {
    const onVis = () => setD(today());
    document.addEventListener('visibilitychange', onVis);
    const t = setInterval(onVis, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      clearInterval(t);
    };
  }, []);
  return d;
}

/** Keep the screen awake while logging (Screen Wake Lock; best effort). */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch {
        /* not allowed right now */
      }
      if (cancelled) lock?.release();
    };
    acquire();
    const onVis = () => document.visibilityState === 'visible' && acquire();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      lock?.release();
    };
  }, [active]);
}
