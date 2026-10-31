// Loads and progression from what was actually logged (docs/periodization.md §4.4).
import type { Exercise, LoggedSet, PlannedExercise, Profile } from '../types.js';
import { daysBetween } from '../dates.js';
import { swapSlotKeys } from '../program.js';

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

/**
 * The sessions the weight hint reads (§4.4): deload sessions are lighter on purpose, so they're left out
 * while any loading session remains, or the week after a deload would suggest building on the deload weight.
 */
export function withoutDeloads(history: SessionSummary[], isDeload: (h: SessionSummary) => boolean): SessionSummary[] {
  const loading = history.filter((h) => !isDeload(h));
  return loading.length ? loading : history;
}

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
  /** On a heavy top-set day, the back-off sets' weight that goes with `suggest` (or last time's top set). */
  backOff?: number;
  /** The lift is back from 4+ weeks off this block: skip the heavy top set (show it with withoutTopSet). */
  noTopSet?: boolean;
};

/**
 * What you did last time at a similar rep count. Looks for the newest session with a set inside
 * the target range (±1), else the newest session at all.
 */
const HOLD = ' · that was Hard, so hold this weight';

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
      // The heaviest set: most weight, or least assistance on an assisted machine.
      const heavier = (a: LoggedSet, b: LoggedSet) => (ex.weightConvention === 'assist' ? (b.weight ?? Infinity) < (a.weight ?? Infinity) : (b.weight ?? 0) > (a.weight ?? 0));
      const top = near.reduce((a, b) => (heavier(a, b) ? b : a));
      const repsLabel = target.min === target.max ? `${target.min}` : `${target.min}–${target.max}`;
      const allTopped = h.sets.length > 0 && h.sets.every((s) => (s.reps ?? 0) >= target.max);
      // Weight goes up only at or below the target effort (§4.4 item 3): a set tapped Hard holds it.
      const hard = h.sets.some((s) => s.effort === 'hard');
      const loaded = top.weight != null && ex.loadIncrementLb && ex.weightConvention !== 'band';
      const suggest = allTopped && !hard && loaded ? nextLoad(ex, top.weight!) : undefined;
      const hold = allTopped && hard && loaded ? HOLD : '';
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
 * goes more than one increment past last time's top weight (nor past it at all after a set tapped Hard). Long gaps
 * are workoutHint's (§4.5 rev 3.9), stale numbers included; the date argument is kept for callers.
 */
export function e1rmLoadHint(
  ex: Exercise,
  history: SessionSummary[],
  target: { min: number; max: number } | undefined,
  rir: number,
  _date: string,
  profile: Pick<Profile, 'smithBarLb'>,
  bandName?: (id: string) => string,
): WeightHint | null {
  const hint = lastTimeHint(ex, history, target, bandName);
  const last = history.find((h) => h.bestE1rm != null);
  const inc = ex.loadIncrementLb;
  const loaded = ex.weightConvention === 'total' || ex.weightConvention === 'per-hand' || ex.weightConvention === 'added';
  if (!hint || !last || !target || !inc || ex.metric !== 'reps' || !loaded) return hint;
  let load = last.bestE1rm! / (1 + (target.min + rir) / 30);
  // e1RM counts the Smith bar; the weight logged is the plates.
  if (ex.weightConvention === 'added' && ex.loadType === 'smith') load -= profile.smithBarLb;
  let suggest = Math.max(0, Math.floor(load / inc) * inc);
  const tops = last.sets.map((s) => s.weight).filter((w): w is number => w != null);
  // At most one increment up, and none after a set tapped Hard: Hard holds the weight, as in lastTimeHint.
  const hard = last.sets.some((s) => s.effort === 'hard');
  if (tops.length) suggest = Math.min(suggest, hard ? Math.max(...tops) : nextLoad(ex, Math.max(...tops)));
  return { ...hint, suggest };
}

/** What the weight hint needs from the plan about logged work (the client's hintContext gives all of it). */
export type HintContext = {
  isDeload: (h: SessionSummary) => boolean;
  /** A logged set's planned rep target, which tells a change of rep range from a repeat. */
  targetOf?: (s: LoggedSet) => { min: number; max: number } | undefined;
  /** How many sets the movement a logged set belongs to was planned with, so a partly logged session can't earn a step. */
  setsPlanned?: (s: LoggedSet) => number | undefined;
  /** The block a logged session was planned in. */
  blockOf?: (h: SessionSummary) => string | undefined;
  /**
   * When this movement's time off began, between its last log `from` and `to`: `from` if nothing at all was logged
   * in between; else the earlier of a week before the first planned day it went unlogged (lifting days repeat
   * weekly, so that is when it was last due) and the start of 10+ days with nothing logged at all; else undefined,
   * for a gap the plan made (the Friday deadlift a few weeks apart, an RDL that skips light weeks, a lift rotated
   * out for a block). Without it, the whole gap counts.
   */
  timeOffFrom?: (exerciseId: string, from: string, to: string) => string | undefined;
  /**
   * Whether a whole block between this movement's last log `from` and `to` was planned without it: it was rotated
   * out. A lift the plan runs only some weeks (the Friday deadlift, the RDL that skips light weeks) stays in every
   * block, so its gaps never count. Without it, no gap does.
   */
  rotatedOut?: (exerciseId: string, from: string, to: string) => boolean;
};

/**
 * Long gaps, counted per lift from its last logged loading session (§4.5 rev 3.9): days, and the load factor. A gap
 * the plan made is no time off, but a lift rotated out for a block and back after `staleDays` has a stale number,
 * so it starts at `staleFactor`.
 */
export const LONG_GAP = { days: 10, factor: 0.9, monthDays: 28, monthFactor: 0.8, newDays: 56, staleDays: 28, staleFactor: 0.95 } as const;

/**
 * The weight hint for one planned movement, as the workout screen shows it (§4.4): last time's line and a
 * suggestion, read from loading sessions only. `history` is the movement's sessions, newest first, leaving out
 * the one being logged; `blockId` is today's block.
 * - Same reps as last time (with `targetOf`): double progression, judging each set against its own planned target.
 *   On a heavy top-set day the top set drives the load and two or more back-off sets under their range hold it;
 *   the hint then gives the back-off weight too. A session logged short of its planned sets earns no step, and
 *   neither does a step the e1RM can't carry for the bottom of the range (a few more reps first).
 * - Other reps than last time, and lifts that come round only some weeks (the Friday deadlift): from e1RM at the
 *   bottom of today's reps and RIR (§4.4 item 3, §4.8).
 * - Deload weeks: about 10% under the working weight (§4.5).
 * - After a long gap in this lift's logged work (never app opens or sign-ins), counted from when it was due and went
 *   unlogged (`timeOffFrom`): 90% of last time after 10 days, 80% and no top set for the
 *   rest of the block after 4 weeks, and a fresh start after 8 weeks (§4.5 rev 3.9).
 * - Back from a block rotated out (`rotatedOut`), 4 weeks or more since its last log, with less time off than 10 days:
 *   about 5% lighter for one session, since its number is stale. A deload week is lighter already.
 */
export function workoutHint(
  ex: Exercise,
  pe: Pick<PlannedExercise, 'slot' | 'sets'>,
  history: SessionSummary[],
  o: HintContext & { deload: boolean; date: string; blockId?: string; profile: Pick<Profile, 'bodyweightLb' | 'smithBarLb'>; bandName?: (id: string) => string },
): WeightHint | null {
  const loading = withoutDeloads(history, o.isDeload);
  const newest = loading[0];
  // Days off this lift since its last logged session (a deload counts): only from when it was due and went unlogged.
  const off = (from: string, to: string) => {
    const start = o.timeOffFrom ? o.timeOffFrom(ex.id, from, to) : from;
    return start ? daysBetween(start, to) : 0;
  };
  const gap = history[0] ? off(history[0].date, o.date) : 0;
  const since = history[0] ? daysBetween(history[0].date, o.date) : 0;
  const stale = !o.deload && since >= LONG_GAP.staleDays && !!o.rotatedOut?.(ex.id, history[0].date, o.date);
  const returned = returnedThisBlock(loading, gap, off, o);
  const last = pe.sets[pe.sets.length - 1];
  const target = last?.targetReps ?? pe.sets[0]?.targetReps;
  const rir = last?.rir ?? 2;
  // A top-set day's suggestion is the top set's weight; back-off sets follow at about 90% (§4.1).
  const topDay = isTopSet(pe, 0) && !returned;
  const lead = topDay ? { target: pe.sets[0].targetReps, rir: pe.sets[0].rir } : { target, rir };
  const was = newest && o.targetOf?.(newest.sets[newest.sets.length - 1]);
  const shifted = !!target && !!was && (was.min !== target.min || was.max !== target.max);
  let line: WeightHint | null;
  let fromE1 = true;
  if (SWAP_SLOTS.has(pe.slot)) line = e1rmLoadHint(ex, loading, lead.target, lead.rir, o.date, o.profile, o.bandName);
  else if (shifted && !o.deload) {
    line = rangeShiftHint(ex, newest, was!, lead.target!, lead.rir, o) ?? lastTimeHint(ex, loading, target, o.bandName);
    // Topped out last time and today asks no more reps: the step double progression earned, where it can land.
    const earned = target!.min <= was!.min ? sameRangeHint(ex, newest, was!, pe.sets.length, o)?.suggest : undefined;
    if (line && earned != null && (line.suggest == null || lighterOf(ex, line.suggest, earned) !== earned)) {
      line = bigStepCheck(ex, { ...line, suggest: earned }, loading, lead.target, lead.rir, o.profile);
    }
  }
  else {
    fromE1 = false;
    const same = o.targetOf && newest && target && !o.deload ? sameRangeHint(ex, newest, target, pe.sets.length, o) : null;
    line = bigStepCheck(ex, same ?? lastTimeHint(ex, loading, target, o.bandName), loading, lead.target, lead.rir, o.profile);
  }
  if (o.deload) line = deloadCap(ex, deloadHint(ex, line, o.profile, { history: loading, target, date: o.date }), loading, target, rir, o.profile);
  if (line && topDay && !o.deload) line = { ...line, backOff: backOffLoad(ex, line.suggest ?? line.weight, o.profile) ?? undefined };
  if (line && (gap >= LONG_GAP.days || stale)) {
    const most = e1rmCeiling(ex, line, loading, lead.target, lead.rir, o.profile);
    line = afterBreak(ex, line, fromE1 && !o.deload ? line.suggest : line.weight, most, gap, since, o);
  }
  return line && returned && isTopSet(pe, 0) ? { ...line, noTopSet: true, backOff: undefined } : line;
}

/**
 * The movement as the workout screen shows it when the hint drops its top set (WeightHint.noTopSet): set 1 runs
 * at the back-off sets' target, effort and rest.
 */
export function withoutTopSet<T extends Pick<PlannedExercise, 'sets'>>(pe: T): T {
  const [, next] = pe.sets;
  return isTopSet(pe, 0) ? { ...pe, sets: pe.sets.map((s, i) => (i === 0 ? { ...next, setIndex: 0 } : s)) } : pe;
}

/**
 * Whether this lift came back from 4 or more weeks without logged work in today's block: its first session in the
 * block (or today) came that long after the one before. Without `blockOf`, only today's return counts.
 */
function returnedThisBlock(loading: SessionSummary[], gap: number, off: (from: string, to: string) => number, o: Pick<HintContext, 'blockOf'> & { blockId?: string; date: string }): boolean {
  if (!o.blockOf || !o.blockId) return gap >= LONG_GAP.monthDays;
  const inBlock = loading.filter((h) => o.blockOf!(h) === o.blockId);
  const first = inBlock[inBlock.length - 1];
  const before = first ? loading[loading.indexOf(first) + 1] : loading[0];
  return !!before && off(before.date, first?.date ?? o.date) >= LONG_GAP.monthDays;
}

/**
 * Double progression on the same reps as last time (§4.4 item 2), each set judged against its own planned target:
 * every working set at the top of its range, the session logged in full and nothing tapped Hard earns one increment;
 * two or more sets under their range hold the weight. On a top-set day the top set drives the load and the back-off
 * sets are the brake. The heaviest set is the one that moved the most (least assistance). Null for movements
 * without a load to step, so the plain line takes over.
 */
function sameRangeHint(
  ex: Exercise,
  h: SessionSummary,
  target: { min: number; max: number },
  plannedToday: number,
  o: Pick<HintContext, 'targetOf' | 'setsPlanned'> & { profile: Pick<Profile, 'bodyweightLb' | 'smithBarLb'>; bandName?: (id: string) => string },
): WeightHint | null {
  const loaded = ex.weightConvention === 'total' || ex.weightConvention === 'per-hand' || ex.weightConvention === 'added' || ex.weightConvention === 'assist';
  const sets = h.sets.filter((s) => s.reps != null);
  if (ex.metric !== 'reps' || !loaded || !ex.loadIncrementLb || !sets.length) return null;
  const own = (s: LoggedSet) => o.targetOf?.(s) ?? target;
  const moved = (s: LoggedSet) => effectiveLoad(ex, s.weight, o.profile) ?? 0;
  const topDay = sets.length > 1 && sets[0].setIndex === 0 && own(sets[0]).max < own(sets[sets.length - 1]).max;
  const working = topDay ? sets.slice(1) : sets;
  const complete = h.sets.length >= (o.setsPlanned?.(h.sets[0]) ?? plannedToday);
  const hard = h.sets.some((s) => s.effort === 'hard');
  const short = working.filter((s) => s.reps! < own(s).min).length >= 2;
  const lead = topDay ? sets[0] : working.reduce((a, b) => (moved(b) > moved(a) ? b : a));
  const topped = complete && !short && (topDay ? [lead] : working).every((s) => s.reps! >= own(s).max);
  const suggest = topped && !hard ? nextLoad(ex, lead.weight ?? 0) : undefined;
  const why = topped && hard ? HOLD : short ? SHORT : '';
  const range = own(lead);
  const label = topDay ? 'Top set last time' : `Last time at ${range.min === range.max ? range.min : `${range.min}–${range.max}`}`;
  return { text: `${label}: ${describeLoad(ex, lead, o.bandName)}${topDay ? ` × ${lead.reps}` : ''}${why}`, date: h.date, weight: lead.weight, bandId: lead.bandId, stanceSteps: lead.stanceSteps, suggest };
}

const SHORT = ' · two sets fell short of the range, so hold this weight';

/**
 * The first session back after a long gap in this lift's logged work (§4.5 rev 3.9): `base` (last time's weight,
 * or the e1RM suggestion when the reps changed) about 10% lighter after 10 days and 20% after 4 weeks, with no step
 * up; after 8 weeks no number at all, and the lift is found again like a new one (§4.4 item 4). With less time off
 * than 10 days, the lift was rotated out (`since` days since the last log): about 5% lighter, for a stale number.
 * The suggestion also stays under `most`, what last time's e1RM carries for today's reps: a cut too small to round
 * (40 lb on 10 lb kettlebell steps) mustn't leave a weight last time fell well short with. The line then says how
 * much lighter the suggestion really is.
 */
function afterBreak(
  ex: Exercise,
  line: WeightHint,
  base: number | null | undefined,
  most: number | null,
  gap: number,
  since: number,
  o: { deload: boolean; profile: Pick<Profile, 'bodyweightLb' | 'smithBarLb'> },
): WeightHint {
  const stale = gap < LONG_GAP.days;
  const days = stale ? since : gap;
  const ago = days >= 14 ? `${Math.floor(days / 7)} weeks` : `${days} days`;
  const text = line.text.replace(HOLD, '').replace(SHORT, '').replace(/ · the next weight up is a big jump.*$/, '');
  if (gap >= LONG_GAP.newDays) {
    return { ...line, suggest: undefined, backOff: undefined, text: `${text} · first session back after ${ago}: ramp up across sets to a weight that leaves about 3 reps in the tank` };
  }
  const factor = stale ? LONG_GAP.staleFactor : gap >= LONG_GAP.monthDays ? LONG_GAP.monthFactor : LONG_GAP.factor;
  let suggest = lighterLoad(ex, base, o.profile, factor) ?? undefined;
  let cut = Math.round((1 - factor) * 100);
  if (suggest != null && most != null && lighterOf(ex, suggest, most) !== suggest) {
    suggest = most;
    const from = effectiveLoad(ex, base, o.profile);
    const to = effectiveLoad(ex, most, o.profile);
    if (from && to != null) cut = Math.round((1 - to / from) * 100);
  }
  // A deload week after a gap takes the lighter of the two.
  if (o.deload && suggest != null && line.suggest != null) suggest = lighterOf(ex, suggest, line.suggest);
  const backOff = line.backOff != null ? backOffLoad(ex, suggest ?? base, o.profile) ?? undefined : undefined;
  const when = stale ? `first time in ${ago}` : `first session back after ${ago}`;
  return { ...line, suggest, backOff, text: `${text} · ${when}, so about ${cut}% lighter` };
}

/**
 * A deload's 10% off is taken from the weight last used, so when that weight was too heavy for these reps (5 reps
 * where the deload asks for 10–15) the suggestion also stays under what the session's e1RM carries for the bottom
 * of the deload's reps at its RIR.
 */
function deloadCap(
  ex: Exercise,
  hint: WeightHint | null,
  history: SessionSummary[],
  target: { min: number; max: number } | undefined,
  rir: number,
  profile: Pick<Profile, 'bodyweightLb' | 'smithBarLb'>,
): WeightHint | null {
  const most = hint?.suggest != null ? e1rmCeiling(ex, hint, history, target, rir, profile) : null;
  return most == null ? hint : { ...hint!, suggest: lighterOf(ex, hint!.suggest!, most) };
}

/** The most the session a hint reads from carries for the bottom of `target` at `rir`, by its e1RM; null without one. */
function e1rmCeiling(
  ex: Exercise,
  hint: WeightHint | null,
  history: SessionSummary[],
  target: { min: number; max: number } | undefined,
  rir: number,
  profile: Pick<Profile, 'bodyweightLb' | 'smithBarLb'>,
): number | null {
  const e1 = hint && history.find((h) => h.date === hint.date)?.bestE1rm;
  if (e1 == null || !target || ex.metric !== 'reps') return null;
  return weightFor(ex, e1 / (1 + (target.min + rir) / 30), profile);
}

/** The lighter of two weights: more assistance is lighter. */
const lighterOf = (ex: Exercise, a: number, b: number) => (ex.weightConvention === 'assist' ? Math.max(a, b) : Math.min(a, b));

/**
 * Last session ran other reps than today's (a heavy week before a moderate one): its heaviest set at its own
 * reps for the line, and a suggestion from its e1RM at the bottom of today's reps and today's RIR (§4.4 item 3),
 * rounded to the lift's increment on the light side. Going to fewer reps the weight goes up as far as e1RM says,
 * with one more rep in reserve; going to more reps it never goes past one increment over last time (nor past it
 * after a set tapped Hard). Null for movements without a load or an e1RM.
 */
function rangeShiftHint(
  ex: Exercise,
  h: SessionSummary,
  was: { min: number; max: number },
  target: { min: number; max: number },
  rir: number,
  o: Pick<HintContext, 'targetOf'> & { profile: Pick<Profile, 'bodyweightLb' | 'smithBarLb'>; bandName?: (id: string) => string },
): WeightHint | null {
  if (ex.metric !== 'reps' || h.bestE1rm == null || !ex.loadIncrementLb) return null;
  const moved = (s: LoggedSet) => effectiveLoad(ex, s.weight, o.profile) ?? 0;
  const weighted = h.sets.filter((s) => s.weight != null && moved(s) > 0);
  if (!weighted.length) return null;
  const same = weighted.filter((s) => { const t = o.targetOf?.(s); return t?.min === was.min && t.max === was.max; });
  const top = (same.length ? same : weighted).reduce((a, b) => (moved(b) > moved(a) ? b : a));
  // Going to fewer reps, a rep more in reserve: Epley from higher reps tends to overstate strength at lower ones.
  let suggest = weightFor(ex, h.bestE1rm / (1 + (target.min + rir + (target.min < was.min ? 1 : 0)) / 30), o.profile);
  if (suggest == null) return null;
  if (target.min >= was.min) {
    const heaviest = weighted.reduce((a, b) => (moved(b) > moved(a) ? b : a)).weight!;
    const cap = h.sets.some((s) => s.effort === 'hard') ? heaviest : nextLoad(ex, heaviest);
    suggest = ex.weightConvention === 'assist' ? Math.max(suggest, cap) : Math.min(suggest, cap);
  }
  const label = was.min === was.max ? `${was.min}` : `${was.min}–${was.max}`;
  return { text: `Last time at ${label}: ${describeLoad(ex, top, o.bandName)}`, date: h.date, weight: top.weight, bandId: top.bandId, stanceSteps: top.stanceSteps, suggest };
}

/**
 * Double progression's step up only where it can land: the e1RM of last time's session has to carry the next
 * weight for the bottom of today's reps at today's RIR. A 20 to 25 lb dumbbell is a 25% jump that topping out
 * at 15 reps can't bridge, so the line asks for up to 3 more reps at the same weight first (§4.4; the review of
 * 2026-10-18 on small lifts with big steps).
 */
function bigStepCheck(
  ex: Exercise,
  line: WeightHint | null,
  history: SessionSummary[],
  target: { min: number; max: number } | undefined,
  rir: number,
  profile: Pick<Profile, 'bodyweightLb' | 'smithBarLb'>,
): WeightHint | null {
  if (!line || line.suggest == null || line.weight == null || !target || ex.metric !== 'reps') return line;
  const e1 = history.find((h) => h.date === line.date)?.bestE1rm;
  const next = effectiveLoad(ex, line.suggest, profile);
  if (e1 == null || next == null || next <= 0 || e1 >= next * (1 + (target.min + rir) / 30)) return line;
  return { ...line, suggest: undefined, text: `${line.text} · the next weight up is a big jump, so aim for ${target.max + 1}–${target.max + 3} reps first` };
}

/** The weight to log for an effective load, rounded to the lift's increment on the light side (more assistance). */
function weightFor(ex: Exercise, load: number, profile: Pick<Profile, 'bodyweightLb' | 'smithBarLb'>): number | null {
  const inc = ex.loadIncrementLb;
  if (!inc) return null;
  if (ex.weightConvention === 'assist') return Math.max(0, Math.ceil((profile.bodyweightLb - load) / inc) * inc);
  if (ex.weightConvention === 'added' && ex.loadType === 'smith') return Math.max(0, Math.floor((load - profile.smithBarLb) / inc) * inc);
  if (ex.weightConvention === 'total' || ex.weightConvention === 'per-hand' || ex.weightConvention === 'added') return Math.max(0, Math.floor(load / inc) * inc);
  return null;
}

const SWAP_SLOTS = swapSlotKeys();

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
  // A deload doesn't hold a weight after Hard, it drops it.
  let out: WeightHint = { ...hint, text: hint.text.replace(HOLD, '') };
  if (from?.target && ex.metric === 'reps') {
    const { target } = from;
    const inside = (s: LoggedSet) => s.reps != null && s.weight != null && s.reps >= target.min && s.reps <= target.max;
    // "Heaviest" in effect: more assistance is lighter.
    const moved = (s: LoggedSet) => effectiveLoad(ex, s.weight, profile) ?? 0;
    const heaviest = (h: SessionSummary) => h.sets.filter(inside).reduce((a, b) => (moved(b) > moved(a) ? b : a));
    // The recent session run closest to today's reps (median reps nearest the middle of the range), the heavier
    // on a tie: the moderate week, not a heavy week's 8s or a light week's 12s.
    const mid = (target.min + target.max) / 2;
    const off = (h: SessionSummary) => {
      const reps = h.sets.flatMap((s) => (s.reps != null ? [s.reps] : [])).sort((a, b) => a - b);
      return Math.abs((reps[(reps.length - 1) >> 1] + reps[reps.length >> 1]) / 2 - mid);
    };
    const recent = from.history.filter((h) => daysBetween(h.date, from.date) <= 21 && h.sets.some(inside));
    const src = recent.reduce<SessionSummary | undefined>((a, b) => (!a || off(b) < off(a) || (off(b) === off(a) && moved(heaviest(b)) > moved(heaviest(a))) ? b : a), undefined);
    if (src) {
      const top = heaviest(src);
      const repsLabel = target.min === target.max ? `${target.min}` : `${target.min}–${target.max}`;
      // The line and the suggestion come from the same session.
      out = { ...out, text: `Last time at ${repsLabel}: ${describeLoad(ex, top)}`, date: src.date, weight: top.weight, bandId: top.bandId, stanceSteps: top.stanceSteps };
    }
  }
  const suggest = lighterLoad(ex, out.weight, profile, DELOAD_LOAD);
  return { ...out, suggest: suggest ?? undefined };
}

/**
 * Set `i` of a planned movement is a heavy top set (§4.1): the first set, with a lower rep target than the sets
 * after it. A top set's 3–5 reps can touch the back-off sets' 5–8, so the ranges' tops are compared.
 */
export function isTopSet(pe: Pick<PlannedExercise, 'sets'>, i: number): boolean {
  const [a, b] = pe.sets;
  return i === 0 && !!a?.targetReps && !!b?.targetReps && a.targetReps.max < b.targetReps.max;
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

/**
 * Where a logged session sat in the plan: its block, whether it was a deload, and the planned workout's date
 * (which orders blocks when an old workout is logged late; the session's own date stands in without it).
 */
export type SessionPlace = { blockId: string; deload: boolean; plannedDate?: string };

/** Loading sessions on the plan, by block, newest block first by when its workouts were planned. */
function byBlock(history: SessionSummary[], placeOf: (h: SessionSummary) => SessionPlace | undefined): { id: string; sessions: SessionSummary[]; date: string }[] {
  const blocks: { id: string; sessions: SessionSummary[]; date: string }[] = [];
  for (const h of history) {
    const place = placeOf(h);
    if (!place || place.deload) continue;
    const date = place.plannedDate ?? h.date;
    let b = blocks.find((x) => x.id === place.blockId);
    if (!b) blocks.push((b = { id: place.blockId, sessions: [], date }));
    b.sessions.push(h);
    if (date > b.date) b.date = date;
  }
  return blocks.sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * Stalled (§4.3), so it rotates out at the next block: the best e1RM of the newest block it was trained in is not
 * at least `gain` (1%) above the best of the block before, like for like across each block's heavy, moderate and
 * light days. Deload sessions and sessions off the plan don't count, and each block needs 2 or more loading
 * sessions; otherwise it isn't stalled. `placeOf` says where a session sat (from its planned workout). A flat block
 * that topped out (isToppedOut) is waiting on a weight step, not stuck; the caller tells the two apart.
 */
export function isStalled(history: SessionSummary[], placeOf: (h: SessionSummary) => SessionPlace | undefined, gain = 0.01): boolean {
  const best = byBlock(history, placeOf).map((b) => b.sessions.flatMap((h) => (h.bestE1rm == null ? [] : [h.bestE1rm])));
  const [last, before] = best.filter((b) => b.length);
  if (!last || !before || last.length < 2 || before.length < 2) return false;
  return Math.max(...last) < Math.max(...before) * (1 + gain);
}

/**
 * Topped out (§4.3, review of 2026-10-18): in the newest block's loading sessions, the heaviest set reached the top
 * of its planned reps (`targetMax`) at Right or Easy. Double progression shows a gain only inside the rep range, so
 * a lift whose next weight is too big a step to land (a 20 to 25 lb dumbbell is 25%) logs a flat e1RM while the
 * lifter gets stronger; such a block is not a stall. `load` ranks sets by the weight moved (more assistance is
 * lighter); it defaults to the logged weight.
 */
export function isToppedOut(
  history: SessionSummary[],
  placeOf: (h: SessionSummary) => SessionPlace | undefined,
  targetMax: (s: LoggedSet) => number | undefined,
  load: (s: LoggedSet) => number = (s) => s.weight ?? 0,
): boolean {
  const newest = byBlock(history, placeOf).find((b) => b.sessions.some((h) => h.bestE1rm != null));
  const sets = newest?.sessions.flatMap((h) => h.sets.filter((s) => s.reps && s.weight != null)) ?? [];
  if (!sets.length) return false;
  const top = Math.max(...sets.map(load));
  return sets.some((s) => {
    const max = targetMax(s);
    return load(s) === top && max != null && s.reps! >= max && (s.effort === 'right' || s.effort === 'easy');
  });
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
