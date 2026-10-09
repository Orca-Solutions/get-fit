import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * Rest between sets. The timer stores when rest ends (wall-clock time), never a count of ticks, so
 * it stays right while the screen is locked or the app is in the background: whatever happened in
 * between, coming back shows the true time left, or how long ago rest ended.
 */
export type RestState = { startedAt: number; endsAt: number; label: string; alerted?: boolean };

/** Rest that ended longer ago than this is cleared, so an old timer never greets the next workout. */
export const STALE_AFTER_MS = 5 * 60_000;
export const STEP_SEC = 30;
const KEY = 'restTimer';
const PREFS_KEY = 'restTimerPrefs';

export type RestPrefs = { enabled: boolean; sound: boolean };
const DEFAULT_PREFS: RestPrefs = { enabled: true, sound: true };

// ---- pure helpers (tested) ----

export function startRest(now: number, seconds: number, label: string): RestState {
  return { startedAt: now, endsAt: now + seconds * 1000, label };
}

/** Seconds left (negative once rest is over). */
export function secondsLeft(s: RestState, now: number): number {
  return Math.ceil((s.endsAt - now) / 1000);
}

/** Adds or removes time; never ends sooner than now. */
export function adjustRest(s: RestState, deltaSec: number, now: number): RestState {
  return { ...s, endsAt: Math.max(now, s.endsAt + deltaSec * 1000) };
}

export function isStale(s: RestState, now: number): boolean {
  return now - s.endsAt > STALE_AFTER_MS;
}

/** Fraction of rest done, 0 to 1. */
export function progress(s: RestState, now: number): number {
  const total = s.endsAt - s.startedAt;
  return total <= 0 ? 1 : Math.min(1, Math.max(0, (now - s.startedAt) / total));
}

export function formatRest(sec: number): string {
  const a = Math.abs(sec);
  return `${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')}`;
}

// ---- store (one timer for the app, kept in localStorage so a reload or relaunch keeps it) ----

const listeners = new Set<() => void>();
let current: RestState | null = read<RestState>(KEY);
let prefs: RestPrefs = { ...DEFAULT_PREFS, ...read<Partial<RestPrefs>>(PREFS_KEY) };

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode or blocked storage: the timer still works for this page.
  }
}

function set(next: RestState | null) {
  current = next;
  write(KEY, next);
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const restTimer = {
  start(seconds: number, label: string) {
    if (!prefs.enabled || seconds <= 0) return;
    unlockAudio();
    set(startRest(Date.now(), seconds, label));
  },
  adjust(deltaSec: number) {
    if (current) set(adjustRest(current, deltaSec, Date.now()));
  },
  stop() {
    set(null);
  },
  get: () => current,
};

export function useRestTimer(): RestState | null {
  return useSyncExternalStore(subscribe, () => current);
}

export function useRestPrefs(): [RestPrefs, (patch: Partial<RestPrefs>) => void] {
  const value = useSyncExternalStore(subscribe, () => prefs);
  return [
    value,
    (patch) => {
      prefs = { ...prefs, ...patch };
      write(PREFS_KEY, prefs);
      if (!prefs.enabled) set(null);
      else listeners.forEach((l) => l());
    },
  ];
}

/**
 * Re-renders every quarter second while a timer runs, and right away when the app comes back to the
 * foreground. Plays the end-of-rest cue once, and clears a timer that went stale.
 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      const s = current;
      if (!s) return;
      if (isStale(s, t)) return set(null);
      if (t >= s.endsAt && !s.alerted) {
        set({ ...s, alerted: true });
        // Only a cue that lands close to the end is useful; one that fires minutes later on return is noise.
        if (document.visibilityState === 'visible' && t - s.endsAt < 5_000) cue();
      }
    };
    tick();
    const id = setInterval(tick, 250);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [active]);
  return now;
}

// ---- end-of-rest cue: a short soft tone and a buzz where the platform allows ----

let audio: AudioContext | null = null;

/** iOS only plays sound from an audio context first resumed in a tap, so do it when a set is logged. */
function unlockAudio() {
  if (!prefs.sound) return;
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    if (audio.state === 'suspended') void audio.resume();
  } catch {
    audio = null;
  }
}

function cue() {
  if (!prefs.sound) return;
  try {
    navigator.vibrate?.([120, 80, 120]);
  } catch {
    // Not supported (iPhone): the sound and the bar carry it.
  }
  if (!audio || audio.state !== 'running') return;
  const t = audio.currentTime;
  for (const [i, freq] of [660, 880].entries()) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const at = t + i * 0.18;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.12, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.35);
    osc.connect(gain).connect(audio.destination);
    osc.start(at);
    osc.stop(at + 0.4);
  }
}
