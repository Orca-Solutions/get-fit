// Loads and progression from what was actually logged (docs/periodization.md §4.4).
import type { Exercise, LoggedSet, Profile } from '../types';

/** Epley with reps in reserve: e1RM = load × (1 + (reps + RIR) / 30). */
export function e1rm(load: number, reps: number, rir = 0): number {
  return load * (1 + (reps + rir) / 30);
}

/** The load the muscles actually moved, so Smith and assisted lifts compare fairly. */
export function effectiveLoad(ex: Pick<Exercise, 'weightConvention' | 'loadType'>, weight: number | null | undefined, profile: Pick<Profile, 'bodyweightLb' | 'smithBarLb'>): number | null {
  if (ex.weightConvention === 'band' || ex.weightConvention === 'none') return null;
  const w = weight ?? 0;
  if (ex.weightConvention === 'assist') return Math.max(0, profile.bodyweightLb - w);
  if (ex.weightConvention === 'added') return w + (ex.loadType === 'smith' ? profile.smithBarLb : 0);
  return weight == null ? null : w;
}

const EFFORT_RIR = { easy: 4, right: 2, hard: 0.5 } as const;

export function setE1rm(ex: Exercise, s: LoggedSet, profile: Pick<Profile, 'bodyweightLb' | 'smithBarLb'>): number | null {
  if (ex.metric !== 'reps' || !s.reps) return null;
  const load = effectiveLoad(ex, s.weight, profile);
  if (load == null || load <= 0) return null;
  const rir = s.effort ? EFFORT_RIR[s.effort] : 2;
  return e1rm(load, s.reps, rir);
}

export type SessionSummary = { sessionId: string; date: string; sets: LoggedSet[]; bestE1rm: number | null };

/** Group a movement's logged sets into sessions, newest first. */
export function summarizeHistory(ex: Exercise, sets: LoggedSet[], profile: Pick<Profile, 'bodyweightLb' | 'smithBarLb'>): SessionSummary[] {
  const bySession = new Map<string, LoggedSet[]>();
  for (const s of sets) {
    if (s.deletedAt) continue;
    const list = bySession.get(s.sessionId) ?? [];
    list.push(s);
    bySession.set(s.sessionId, list);
  }
  const out: SessionSummary[] = [];
  for (const [sessionId, list] of bySession) {
    list.sort((a, b) => a.setIndex - b.setIndex);
    const e = list.map((s) => setE1rm(ex, s, profile)).filter((v): v is number => v != null);
    out.push({ sessionId, date: list[0].date, sets: list, bestE1rm: e.length ? Math.max(...e) : null });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || b.sets[0].loggedAt.localeCompare(a.sets[0].loggedAt));
}

export type WeightHint = {
  /** "Last time at 12: 40 lb each" style line. */
  text: string;
  date: string;
  weight?: number | null;
  bandId?: string | null;
  stanceSteps?: number | null;
  /** Suggested next load when the last exposure at this rep range topped out (double progression). */
  suggest?: number;
};

/**
 * What you did last time at a similar rep count. Looks for the newest session with a set inside
 * the target range (±1), else the newest session at all.
 */
export function lastTimeHint(
  ex: Exercise,
  history: SessionSummary[],
  target: { min: number; max: number } | undefined,
  bandName: (id: string) => string = (id) => id,
  excludeSessionId?: string,
): WeightHint | null {
  const past = history.filter((h) => h.sessionId !== excludeSessionId);
  if (!past.length) return null;
  const fmt = (s: LoggedSet) => describeLoad(ex, s, bandName);
  if (target && ex.metric === 'reps') {
    for (const h of past) {
      const near = h.sets.filter((s) => s.reps != null && s.reps >= target.min - 1 && s.reps <= target.max + 1);
      if (!near.length) continue;
      const top = near.reduce((a, b) => ((b.weight ?? 0) > (a.weight ?? 0) ? b : a));
      const repsLabel = target.min === target.max ? `${target.min}` : `${target.min}–${target.max}`;
      const allTopped = h.sets.length > 0 && h.sets.every((s) => (s.reps ?? 0) >= target.max);
      const suggest = allTopped && top.weight != null && ex.loadIncrementLb && ex.weightConvention !== 'band' ? nextLoad(ex, top.weight) : undefined;
      return { text: `Last time at ${repsLabel}: ${fmt(top)}`, date: h.date, weight: top.weight, bandId: top.bandId, stanceSteps: top.stanceSteps, suggest };
    }
  }
  const h = past[0];
  const top = h.sets[0];
  const summary = h.sets.map((s) => `${fmt(s)}${s.reps != null ? ` × ${s.reps}` : s.seconds != null ? ` × ${s.seconds}s` : ''}`).join(', ');
  return { text: `Last time: ${summary}`, date: h.date, weight: top.weight, bandId: top.bandId, stanceSteps: top.stanceSteps };
}

/** One increment up; assisted machines progress by taking assistance away. */
export function nextLoad(ex: Exercise, weight: number): number {
  const inc = ex.loadIncrementLb ?? 5;
  return ex.weightConvention === 'assist' ? Math.max(0, weight - inc) : weight + inc;
}

export function describeLoad(ex: Exercise, s: Pick<LoggedSet, 'weight' | 'bandId' | 'stanceSteps'>, bandName: (id: string) => string = (id) => id): string {
  if (ex.weightConvention === 'band') {
    const band = s.bandId ? bandName(s.bandId) : 'band';
    return s.stanceSteps != null ? `${band}, ${s.stanceSteps} step${s.stanceSteps === 1 ? '' : 's'}` : band;
  }
  if (ex.weightConvention === 'none') return 'bodyweight';
  if (s.weight == null) return ex.weightConvention === 'added' ? 'no added weight' : '—';
  const w = `${fmtNum(s.weight)} lb`;
  if (ex.weightConvention === 'per-hand') return `${w} each`;
  if (ex.weightConvention === 'assist') return `${w} assist`;
  if (ex.weightConvention === 'added') return ex.loadType === 'smith' ? `${w} plates` : `+${w}`;
  return w;
}

export function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Best set ever by e1RM (reps movements) or by reps/seconds otherwise. */
export function bestSet(ex: Exercise, history: SessionSummary[], profile: Pick<Profile, 'bodyweightLb' | 'smithBarLb'>): { set: LoggedSet; date: string } | null {
  let top: { set: LoggedSet; date: string; score: number } | null = null;
  for (const h of history) {
    for (const s of h.sets) {
      const score = setE1rm(ex, s, profile) ?? (s.reps ?? s.seconds ?? 0) + (s.stanceSteps ?? 0) / 100;
      if (!top || score > top.score) top = { set: s, date: h.date, score };
    }
  }
  return top ? { set: top.set, date: top.date } : null;
}

/** No e1RM gain over the last 3 exposures (§4.3): rotate it out at the next block. */
export function isStalled(history: SessionSummary[]): boolean {
  const vals = history.map((h) => h.bestE1rm).filter((v): v is number => v != null);
  if (vals.length < 4) return false;
  return Math.max(...vals.slice(0, 3)) <= Math.max(...vals.slice(3));
}
