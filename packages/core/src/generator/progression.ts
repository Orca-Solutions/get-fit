// Loads and progression from what was actually logged (docs/periodization.md §4.4).
import type { Exercise, LoggedSet, Profile } from '../types.js';
import { daysBetween } from '../dates.js';

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
      // Weight goes up only at or below the target effort (§4.4.2): a set tapped Hard holds it.
      const hard = h.sets.some((s) => s.effort === 'hard');
      const loaded = top.weight != null && ex.loadIncrementLb && ex.weightConvention !== 'band';
      const suggest = allTopped && !hard && loaded ? nextLoad(ex, top.weight!) : undefined;
      const hold = allTopped && hard && loaded ? ' · that was Hard, so hold this weight' : '';
      return { text: `Last time at ${repsLabel}: ${fmt(top)}${hold}`, date: h.date, weight: top.weight, bandId: top.bandId, stanceSteps: top.stanceSteps, suggest };
    }
  }
  const h = past[0];
  const top = h.sets[0];
  const summary = h.sets.map((s) => `${fmt(s)}${s.reps != null ? ` × ${s.reps}` : s.seconds != null ? ` × ${s.seconds}s` : ''}`).join(', ');
  return { text: `Last time: ${summary}`, date: h.date, weight: top.weight, bandId: top.bandId, stanceSteps: top.stanceSteps };
}

/**
 * The hint for a lift that comes round only some weeks, such as the Friday deadlift (§4.8): last time's line,
 * with a suggested load from the latest session's e1RM at the bottom of today's reps and planned RIR. That
 * links sessions planned at different rep ranges. The suggestion rounds down to the lift's increment, never
 * goes more than one increment past last time's top weight, and starts at about 95% when the last session
 * was more than 3 weeks before `date` (a safety margin, not a cited rule).
 */
export function e1rmLoadHint(
  ex: Exercise,
  history: SessionSummary[],
  target: { min: number; max: number } | undefined,
  rir: number,
  date: string,
  profile: Pick<Profile, 'smithBarLb'>,
  bandName?: (id: string) => string,
): WeightHint | null {
  const hint = lastTimeHint(ex, history, target, bandName);
  const last = history.find((h) => h.bestE1rm != null);
  const inc = ex.loadIncrementLb;
  const loaded = ex.weightConvention === 'total' || ex.weightConvention === 'per-hand' || ex.weightConvention === 'added';
  if (!hint || !last || !target || !inc || ex.metric !== 'reps' || !loaded) return hint;
  let load = last.bestE1rm! / (1 + (target.min + rir) / 30);
  if (daysBetween(last.date, date) > 21) load *= 0.95;
  // e1RM counts the Smith bar; the weight logged is the plates.
  if (ex.weightConvention === 'added' && ex.loadType === 'smith') load -= profile.smithBarLb;
  let suggest = Math.max(0, Math.floor(load / inc) * inc);
  const tops = last.sets.map((s) => s.weight).filter((w): w is number => w != null);
  if (tops.length) suggest = Math.min(suggest, nextLoad(ex, Math.max(...tops)));
  return { ...hint, suggest };
}

/** Deload weeks lift about 10% lighter (§4.5). */
export const DELOAD_LOAD = 0.9;
/** Back-off sets after a heavy top set are about 10% lighter (§4.1). */
export const BACK_OFF_LOAD = 0.9;

/**
 * `factor` of a logged weight, rounded down to the lift's increment: assisted machines add assistance instead,
 * and Smith lifts count the bar. When the cut is under half an increment (a 10 or 15 lb dumbbell) the weight
 * stays, since rounding would take a third or half off. Null for band and bodyweight movements.
 */
export function lighterLoad(ex: Exercise, weight: number | null | undefined, profile: Pick<Profile, 'bodyweightLb' | 'smithBarLb'>, factor: number): number | null {
  const inc = ex.loadIncrementLb;
  const load = effectiveLoad(ex, weight, profile);
  if (!inc || weight == null || load == null || load <= 0) return null;
  if (load * (1 - factor) < inc / 2 - 1e-9) return weight;
  const target = load * factor;
  let w: number;
  if (ex.weightConvention === 'assist') w = Math.ceil((profile.bodyweightLb - target) / inc) * inc;
  else if (ex.weightConvention === 'added' && ex.loadType === 'smith') w = Math.floor((target - profile.smithBarLb) / inc) * inc;
  else w = Math.floor(target / inc) * inc;
  return Math.max(0, w);
}

/**
 * A deload week's hint: last time's line, with the suggestion about 10% under the working weight (§4.5); see
 * lighterLoad for the rounding. With `from`, the working weight is the heaviest set at the deload's reps (±1) in
 * the 3 weeks before `date`, so a leg-day deload keys off the moderate week, not the lighter light week before
 * it; without it, last time's weight. Band and bodyweight movements get no suggestion; the deload's fewer sets
 * and extra reps in reserve do the work there.
 */
export function deloadHint(
  ex: Exercise,
  hint: WeightHint | null,
  profile: Pick<Profile, 'bodyweightLb' | 'smithBarLb'>,
  from?: { history: SessionSummary[]; target: { min: number; max: number } | undefined; date: string },
): WeightHint | null {
  if (!hint) return null;
  let weight = hint.weight;
  if (from?.target && ex.metric === 'reps') {
    const { target } = from;
    const recent = from.history.filter((h) => daysBetween(h.date, from.date) <= 21).flatMap((h) => h.sets);
    const near = recent.filter((s) => s.reps != null && s.weight != null && s.reps >= target.min - 1 && s.reps <= target.max + 1);
    // "Heaviest" in effect: more assistance is lighter.
    const moved = (s: LoggedSet) => effectiveLoad(ex, s.weight, profile) ?? 0;
    if (near.length) weight = near.reduce((a, b) => (moved(b) > moved(a) ? b : a)).weight;
  }
  const suggest = lighterLoad(ex, weight, profile, DELOAD_LOAD);
  return { ...hint, suggest: suggest ?? undefined };
}

/** The pre-filled weight for a back-off set after a top set at `topWeight`: about 10% lighter (§4.1). */
export function backOffLoad(ex: Exercise, topWeight: number | null | undefined, profile: Pick<Profile, 'bodyweightLb' | 'smithBarLb'>): number | null {
  return lighterLoad(ex, topWeight, profile, BACK_OFF_LOAD);
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

/** Where a logged session sat in the plan: its block and whether it was a deload. */
export type SessionPlace = { blockId: string; deload: boolean };

/**
 * Stalled (§4.3), so it rotates out at the next block: the best e1RM of the newest block it was trained in is not
 * at least `gain` (1%) above the best of the block before, like for like across each block's heavy, moderate and
 * light days. Deload sessions and sessions off the plan don't count, and each block needs 2 or more loading
 * sessions; otherwise it isn't stalled. `placeOf` says where a session sat (from its planned workout).
 */
export function isStalled(history: SessionSummary[], placeOf: (h: SessionSummary) => SessionPlace | undefined, gain = 0.01): boolean {
  const blocks: { id: string; best: number[] }[] = [];
  for (const h of history) {
    const place = placeOf(h);
    if (!place || place.deload || h.bestE1rm == null) continue;
    let b = blocks.find((x) => x.id === place.blockId);
    if (!b) blocks.push((b = { id: place.blockId, best: [] }));
    b.best.push(h.bestE1rm);
  }
  // History is newest first, so blocks are too.
  const [last, before] = blocks;
  if (!last || !before || last.best.length < 2 || before.best.length < 2) return false;
  return Math.max(...last.best) < Math.max(...before.best) * (1 + gain);
}

/**
 * Outgrown (§4.8 step-up): in each of the last two exposures the heaviest set reached the top of its target
 * reps at Right or Easy, at the same weight both times. A topped-out session suggests the next weight up, so
 * a second one at the same weight reads as the next weight not being there, such as the heaviest dumbbell
 * on the rack (inference: the app can't see the rack). `targetMax` gives a logged set's planned top rep.
 */
export function isOutgrown(history: SessionSummary[], targetMax: (s: LoggedSet) => number | undefined): boolean {
  const last = history.slice(0, 2).map((h) => {
    const weighted = h.sets.filter((s) => s.reps && s.weight != null);
    const top = Math.max(...weighted.map((s) => s.weight!));
    return weighted.filter((s) => s.weight === top);
  });
  if (last.length < 2 || last.some((sets) => !sets.length) || last[0][0].weight !== last[1][0].weight) return false;
  return last.every((sets) => sets.some((s) => {
    const max = targetMax(s);
    return max != null && s.reps! >= max && (s.effort === 'right' || s.effort === 'easy');
  }));
}
