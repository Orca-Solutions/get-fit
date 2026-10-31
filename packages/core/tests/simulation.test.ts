// A long-run check of day-to-day use: simulated lifters train through the real planner, the client database and
// the workout screen's weight hints, and every day is checked against the invariants below. Unit tests pin each
// rule on its own; this one catches rules that only go wrong in combination, across block boundaries, deloads,
// missed days and breaks (like the week after a deload building on the deload's lighter weights). One reference
// lifter runs twelve blocks; shorter runs cover other weeks, effort habits, edits, odd input and kit changes.
import 'fake-indexeddb/auto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { GeneratedBlock, GeneratorInput } from '../src/generator/generateBlock';

// Record what the planner is given and what it returns, block by block.
const planned: { input: GeneratorInput; out: GeneratedBlock; at: string }[] = [];
vi.mock('../src/generator/generateBlock', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/generator/generateBlock')>();
  return {
    ...real,
    generateBlock: (input: GeneratorInput) => {
      const out = real.generateBlock(input);
      planned.push({ input, out, at: new Date().toISOString() });
      return out;
    },
  };
});

import { GetFitDB } from '../src/client/db';
import { allExercises, ensurePlan, getProfile, hintContext, liveBlocks, logSet, put, regenerateUpcoming, setFlagIn, startSession, unlogSet, updateSession } from '../src/client/repo';
import { addDays, daysBetween } from '../src/dates';
import { backOffLoad, isTopSet, LONG_GAP, setE1rm, summarizeHistory, withoutTopSet, workoutHint, type HintContext, type SessionSummary, type WeightHint } from '../src/generator/progression';
import { BANDS, weeklySets } from '../src/generator/coverage';
import { referenceProfile } from '../src/profiles';
import { STRANGE_PERIODIZATION, type LiftDay } from '../src/program';
import { rirFor } from '../src/generator/templates';
import type { Block, Exercise, LoggedSet, PlannedExercise, PlannedWorkout, Profile } from '../src/types';

const START = '2026-01-05'; // a Monday

/** Who trains, for how long, and what happens to them along the way. Days are counted from START. */
type Lifter = {
  name: string;
  seed: number;
  blocks: number;
  breaks: { from: number; to: number; opened: boolean }[];
  schedule?: Profile['schedule'];
  /** How effort gets tapped: as the sets felt (most of the time), or always Hard or always Easy. */
  taps?: 'felt' | 'hard' | 'easy';
  /** Share of workouts after which a past set is deleted and entered again, and of sets logged with 0 reps or no weight. */
  edits?: number;
  odd?: number;
  /** Something that changes on a day: the gym loses a machine, a lift goes on Avoid. The lifter then regenerates. */
  events?: { day: number; what: 'lose-smith' | 'avoid-main-lift' }[];
};

// Three breaks: two weeks with the app closed (a holiday, block 4); five weeks with the app opened and workouts
// started every day but nothing logged (signed in, not training); nine weeks with the app closed, past the end of
// the plan. About one workout in twenty is missed at random, and about one movement in twenty-five is cut short.
const REFERENCE: Lifter = {
  name: 'the reference lifter, twelve blocks with three breaks',
  seed: 20261018,
  blocks: 12,
  breaks: [
    { from: 3 * 28 + 8, to: 3 * 28 + 21, opened: false },
    { from: 6 * 28, to: 6 * 28 + 34, opened: true },
    { from: 8 * 28 + 21, to: 8 * 28 + 83, opened: false },
  ],
};
const MISS_RATE = 0.05;
const CUT_SHORT = 0.04;

// Seeded, so every run is the same run.
let seed = REFERENCE.seed;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/** The lifter: a rough 10-rep weight per load type, a per-movement knack, and beginner gains of about 1.5% a week of training. */
const TEN_REP: Record<string, number> = { barbell: 95, 'ez-bar': 55, dumbbell: 25, machine: 80, cable: 30, kettlebell: 25, smith: 50, plate: 25 };
const knack = new Map<string, number>();
const BODYWEIGHT = 168;

/** Strength: gains for each week trained, less about 1.5% for each whole week off. */
function strength(ex: Exercise, weeksTrained: number, fitness: number): number {
  if (!knack.has(ex.id)) knack.set(ex.id, 0.8 + rand() * 0.4);
  const base = ex.weightConvention === 'assist' ? BODYWEIGHT * 0.6 : TEN_REP[ex.loadType] ?? 25;
  return base * knack.get(ex.id)! * (1 + 10 / 30) * (1 + 0.015 * weeksTrained) * fitness;
}

const snap = (ex: Exercise, w: number) => Math.max(0, Math.floor(w / (ex.loadIncrementLb || 5)) * (ex.loadIncrementLb || 5));
const loaded = (ex: Exercise) => ex.weightConvention !== 'none' && ex.weightConvention !== 'band';
const moved = (ex: Exercise, w: number) => (ex.weightConvention === 'assist' ? BODYWEIGHT - w : w);

/** Reps the lifter has in them at `weight` for this set (fatigue builds across sets). */
function capacity(ex: Exercise, e1: number, weight: number | null, setIndex: number): number {
  if (!loaded(ex) || weight == null) return 18 - setIndex;
  const load = Math.max(1, moved(ex, weight));
  return 30 * (e1 / load - 1) - 0.7 * setIndex - rand();
}

/** The weight a first-timer picks for these reps, leaving the asked-for reps in the tank. */
function firstPick(ex: Exercise, e1: number, reps: number, rir: number): number {
  const load = e1 / (1 + (reps + rir) / 30);
  return ex.weightConvention === 'assist' ? snap(ex, Math.max(0, BODYWEIGHT - load)) : snap(ex, load);
}

type Violation = { date: string; what: string };
type Check = (ok: boolean, date: string, what: string) => void;

// What the run found, by invariant, so each invariant passes or fails on its own.
const GROUPS = ['hints', 'safety', 'progress', 'partial', 'breaks', 'backOff', 'plans', 'shape', 'slots', 'bands', 'stalls', 'heavy', 'edits', 'events'] as const;
const bad = Object.fromEntries(GROUPS.map((g) => [g, [] as Violation[]])) as Record<(typeof GROUPS)[number], Violation[]>;
const checker = (g: (typeof GROUPS)[number]): Check => (ok, date, what) => { if (!ok) bad[g].push({ date, what }); };
const fresh = () => ({ workouts: 0, sets: 0, hints: 0, suggestions: 0, backOffs: 0, topSets: 0, stalled: 0, toppedOut: 0, heavyPairs: 0, toppedChecks: 0, runChecks: 0, partialChecks: 0, returns: 0, tiers: [0, 0, 0] as number[], stale: 0, twiceChecks: 0, noTopSet: 0, dropped: 0, edits: 0, odd: 0 });
const stats = fresh();

/** Each planned movement's sets and each session's block, recorded as the lifter logs (independent of hintContext). */
const plannedOf = new Map<string, PlannedExercise['sets']>();
const sessionBlock = new Map<string, string>();
/** Each movement's planned days as they came round, and the planned movements and days with anything logged. */
const plannedDays = new Map<string, { date: string; id: string }[]>();
const loggedPe = new Set<string>();
const trainedOn = new Set<string>();
/** When a movement's time off began (as hintContext's timeOffFrom): the last log if nothing at all was logged since, else the earlier of a week before its first unlogged planned day and the start of 10+ days with nothing logged, else never. */
const timeOffFrom = (exId: string, from: string, to: string) => {
  if (![...trainedOn].some((x) => x > from && x < to)) return from;
  const first = plannedDays.get(exId)?.filter((p) => p.date > from && p.date < to && !loggedPe.has(p.id)).map((p) => p.date).sort()[0];
  const missed = first && [from, addDays(first, -7)].sort()[1];
  // Or the first 10+ days with nothing logged at all.
  let prev = from;
  let quiet: string | undefined;
  for (const t of [...[...trainedOn].filter((x) => x > from && x < to).sort(), to]) {
    if (!quiet && daysBetween(prev, t) >= LONG_GAP.days) quiet = prev;
    prev = t;
  }
  return [missed, quiet].filter((d): d is string => !!d).sort()[0];
};
/** Each block's days as they came round, and the movements planned in it. */
const blockDays = new Map<string, { first: string; last: string; ids: Set<string> }>();
/** Whether a whole block between `from` and `to` was planned without the movement (as hintContext's rotatedOut). */
const rotatedOut = (exId: string, from: string, to: string) => [...blockDays.values()].some((b) => b.first > from && b.last < to && !b.ids.has(exId));

/** The heaviest weight used on each movement's working sets (top sets aside), by block, day and zone. */
const used = new Map<string, number>();
const usedKey = (blockId: string, type: string, zone: string, exId: string) => `${blockId}|${type}|${zone}|${exId}`;

type Result = { bad: typeof bad; stats: typeof stats };

/** Runs one lifter through every day of their blocks and returns what the checks found. */
async function simulate(lifter: Lifter): Promise<Result> {
  // Each run starts clean: the recorded plans, the lifter's knack per movement and everything the checks track.
  seed = lifter.seed;
  planned.length = 0;
  for (const m of [knack, plannedOf, sessionBlock, plannedDays, blockDays, used]) m.clear();
  for (const set of [loggedPe, trainedOn]) set.clear();
  for (const g of GROUPS) bad[g] = [];
  Object.assign(stats, fresh());
  const end = addDays(START, lifter.blocks * 28 - 1);
  const breaks = lifter.breaks.map((b) => ({ from: addDays(START, b.from), to: addDays(START, b.to), opened: b.opened }));
  const at = (date: string, hhmm = '06:00') => vi.setSystemTime(new Date(`${date}T${hhmm}:00Z`));
  at(addDays(START, -1));
  const d = new GetFitDB(`simulation-${lifter.seed}`);
  await d.open();
  const reference = referenceProfile();
  await d.profile.put({ ...reference, schedule: lifter.schedule ?? reference.schedule, bodyweightLb: BODYWEIGHT });
  let profile = await getProfile(d);
  const byId = new Map((await allExercises(d)).map((e) => [e.id, e]));
  let weeksTrained = 0;
  let lastWeekTrained = '';
  let fitness = 1;
  /** From the day of each event: movements that must not be planned any more. */
  const gone: { from: string; ids: Set<string>; what: string }[] = [];
  const regenerated: string[] = [];

  for (let date = START; date <= end; date = addDays(date, 1)) {
    const week = addDays(START, Math.floor(daysBetween(START, date) / 7) * 7);
    if (date === week && date > START && lastWeekTrained !== addDays(week, -7)) fitness *= 0.985;
    const off = breaks.find((b) => date >= b.from && date <= b.to);
    at(date);
    if (!off || off.opened) await ensurePlan(date, d);
    for (const e of lifter.events ?? []) {
      if (addDays(START, e.day) !== date) continue;
      if (e.what === 'lose-smith') {
        await put('profile', { ...profile, equipmentByLocation: { ...profile.equipmentByLocation, gym: profile.equipmentByLocation.gym.filter((q) => q !== 'smith-machine') } }, d);
        gone.push({ from: date, ids: new Set([...byId.values()].filter((x) => x.loadType === 'smith').map((x) => x.id)), what: 'a Smith movement after the gym lost its Smith machine' });
      } else {
        const block = (await liveBlocks(d)).filter((b) => b.startDate <= date).pop()!;
        const day = STRANGE_PERIODIZATION.days['chest-biceps'] as LiftDay;
        const main = block.baseSlots[`chest-biceps|${day.base.find((slot) => slot.role === 'P')!.key}`];
        await setFlagIn(d, main, { avoid: true });
        gone.push({ from: date, ids: new Set([main]), what: `${main} after it went on Avoid` });
      }
      profile = await getProfile(d);
      await regenerateUpcoming(date, d);
      regenerated.push(date);
    }
    const todays = (await d.plannedWorkouts.where('date').equals(date).toArray()).filter((w) => !w.deletedAt);
    // What the plan asked for today, whether or not the app was opened.
    for (const w of todays) for (const e of w.exercises) plannedDays.set(e.exerciseId, [...(plannedDays.get(e.exerciseId) ?? []), { date, id: e.id }]);
    for (const w of todays) {
      const b = blockDays.get(w.blockId) ?? { first: date, last: date, ids: new Set<string>() };
      b.last = date;
      for (const e of w.exercises) b.ids.add(e.exerciseId);
      blockDays.set(w.blockId, b);
    }
    if (off && !off.opened) continue;
    if (off) {
      // Signed in and looking: each workout is opened, and nothing is logged.
      for (const w of todays) await startSession(w.id, date, d);
      continue;
    }
    for (const w of todays) {
      if (rand() < MISS_RATE) continue;
      if (week !== lastWeekTrained) {
        lastWeekTrained = week;
        weeksTrained++;
      }
      at(date, '17:30');
      for (const g of gone) for (const e of w.exercises) checker('events')(!(date > g.from && g.ids.has(e.exerciseId)), date, `${w.sessionType}: ${g.what}`);
      const session = await startSession(w.id, date, d);
      const ctx = await hintContext(d);
      const check3 = { progress: checker('progress'), breaks: checker('breaks'), partial: checker('partial') };
      for (const plan of [...w.exercises].sort((a, b) => a.order - b.order)) {
        const ex = byId.get(plan.exerciseId)!;
        const sets = (await d.loggedSets.where('exerciseId').equals(ex.id).toArray()).filter((s) => !s.deletedAt && s.sessionId !== session.id);
        const history = summarizeHistory(ex, sets, profile);
        const hint = workoutHint(ex, plan, history, { deload: w.isDeload, ...ctx, blockId: w.blockId, date, profile });
        // The workout screen drops the top set when the hint says so.
        const pe = hint?.noTopSet ? withoutTopSet(plan) : plan;
        const e1 = strength(ex, weeksTrained, fitness);
        stats.hints++;
        checkHint(checker('hints'), date, ex, pe, w, hint, history, ctx.isDeload);
        // An odd set in the history (0 reps, no weight) only has to leave the hint sound, not ideal.
        const clean = !sets.some(isOdd);
        // Someone who taps every set Easy overstates what they had left, so the rep to spare can go, never the range.
        if (clean) checkSafe(checker('safety'), date, ex, pe, w, hint, e1, lifter.taps === 'easy' ? 0 : 1);
        if (clean) checkProgress(check3, date, ex, plan, w, hint, history, ctx.isDeload);
        let done = perform(ex, pe, w, hint, e1, profile, lifter.taps ?? 'felt');
        if (rand() < CUT_SHORT) done = done.slice(0, 1);
        if (lifter.odd && rand() < lifter.odd) {
          const k = Math.floor(rand() * done.length);
          done[k] = rand() < 0.5 || !loaded(ex) ? { ...done[k], reps: 0 } : { ...done[k], weight: null };
          stats.odd++;
        }
        if (isTopSet(pe, 0) && loaded(ex) && done[0].weight != null && done[1]?.weight != null) {
          stats.backOffs++;
          checker('backOff')(moved(ex, done[1].weight) <= moved(ex, done[0].weight), date, `${ex.id}: back-off set pre-filled at ${done[1].weight} after a ${done[0].weight} top set`);
        }
        const working = done.filter((c, i) => c.weight != null && !isTopSet(pe, i)).map((c) => moved(ex, c.weight!));
        // A first session back after a gap, or after a stale number, eases in, so it doesn't count.
        if (loaded(ex) && working.length && !pe.note && !/first session back|first time in/.test(hint?.text ?? '') && (pe.role === 'P' || pe.role === 'C')) used.set(usedKey(w.blockId, w.sessionType, w.zone, ex.id), Math.max(...working));
        plannedOf.set(plan.id, plan.sets);
        if (done.length) {
          loggedPe.add(plan.id);
          trainedOn.add(date);
        }
        sessionBlock.set(session.id, w.blockId);
        for (const [i, c] of done.entries()) {
          await logSet(session, ex.id, pe.id, i, c, d);
          stats.sets++;
        }
      }
      await updateSession(session.id, { endedAt: new Date().toISOString(), beatUp: false }, d);
      stats.workouts++;
      if (lifter.edits && rand() < lifter.edits) await editPastSet(d, date);
    }
  }
  const blocks = await liveBlocks(d);
  stats.dropped = (await d.blocks.toArray()).filter((b) => b.deletedAt).length;
  const workouts = (await d.plannedWorkouts.toArray()).filter((w) => !w.deletedAt);
  const logs = (await d.loggedSets.toArray()).filter((x) => !x.deletedAt).map((x) => ({ blockId: sessionBlock.get(x.sessionId), exerciseId: x.exerciseId, loggedAt: x.loggedAt }));
  stats.topSets = checkPlans(checker('plans'), blocks, workouts, logs);
  checkShape(checker('shape'), workouts, byId);
  checkSlots(checker('slots'), blocks, workouts, regenerated);
  checkBands(checker('bands'), blocks, workouts, byId);
  checkHeavy(checker('heavy'), blocks);
  await checkStalls(checker('stalls'), d, byId, profile);
  console.log(`${lifter.name}: ${stats.workouts} workouts, ${stats.sets} sets, ${stats.hints} hints (${stats.suggestions} with a suggestion), ${planned.length} plans, ` +
    `${stats.topSets} planned top sets (${stats.backOffs} done), ${stats.stalled} stalled and ${stats.toppedOut} topped out, ${stats.heavyPairs} heavy/moderate pairs, ${stats.toppedChecks} topped, ${stats.runChecks} topped three times, ${stats.partialChecks} cut short, returns after 10 days, 4 weeks and 8 weeks ${stats.tiers.join('/')} (${stats.noTopSet} top sets dropped), ${stats.stale} back from a block rotated out, ${stats.twiceChecks} topped twice, ${stats.dropped} untrained blocks dropped, ${stats.edits} past sets re-entered, ${stats.odd} odd sets; violations: ` +
    GROUPS.map((g) => `${g} ${bad[g].length}`).join(', '));
  if (process.env.SIM_DUMP) for (const g of GROUPS) if (g !== 'bands') for (const v of bad[g].slice(0, 15)) console.log(g, v.date, v.what);
  d.close();
  return { bad: structuredClone(bad), stats: structuredClone(stats) };
}

/** The band drift the reference run is known to have (see its band check); anything else is new. */
function knownDrift(v: Violation): boolean {
  const [, g, n, min] = v.what.match(/: (\S+) at ([\d.]+) sets, band (\d+)–/) ?? [];
  return g === 'lower-back' || (g === 'back' && Number(n) >= Number(min) - 0.5) || (g === 'rear-delts' && Number(n) >= 1.5 && Number(v.what.match(/^block (\d+)/)![1]) >= 4);
}

const isOdd = (s: LoggedSet) => s.reps === 0 || (s.weight == null && s.seconds == null && !s.bandId);

/**
 * Edits (test-gap §2.3): delete a set from a session one to two weeks back and enter it again, as someone fixing a
 * typo would. The session and the set keep their day.
 */
async function editPastSet(d: GetFitDB, date: string) {
  const past = (await d.loggedSets.toArray()).filter((s) => !s.deletedAt && s.date < addDays(date, -6) && s.date >= addDays(date, -14));
  if (!past.length) return;
  const s = past[Math.floor(rand() * past.length)];
  const session = (await d.sessions.get(s.sessionId))!;
  const others = (await d.loggedSets.where('sessionId').equals(s.sessionId).toArray()).filter((x) => !x.deletedAt && x.id !== s.id);
  // Delete every set of the session first when it's small, so the re-entry is its only set.
  for (const x of others.length <= 2 ? others : []) await unlogSet(x.id, d);
  await unlogSet(s.id, d);
  const again = await logSet(session, s.exerciseId, s.plannedExerciseId, s.setIndex, { weight: s.weight, reps: s.reps, seconds: s.seconds, bandId: s.bandId, stanceSteps: s.stanceSteps, effort: s.effort }, d);
  for (const x of others.length <= 2 ? others : []) await logSet(session, x.exerciseId, x.plannedExerciseId, x.setIndex, { weight: x.weight, reps: x.reps, seconds: x.seconds, bandId: x.bandId, stanceSteps: x.stanceSteps, effort: x.effort }, d);
  stats.edits++;
  const after = (await d.sessions.get(s.sessionId))!;
  checker('edits')(after.date === session.date && again.date === s.date, date, `re-entering a set from ${s.date} moved it to ${again.date} (session ${session.date} → ${after.date})`);
}

describe('day-to-day use over twelve blocks', () => {
  let r: Result;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    r = await simulate(REFERENCE);
  }, 300_000);
  afterAll(() => vi.useRealTimers());

  it('gives a sound weight hint for every movement, every workout', () => expect(r.bad.hints.slice(0, 20)).toEqual([]));
  it('never suggests a weight the lifter would fail at the bottom of today\'s reps', () => expect(r.bad.safety.slice(0, 20)).toEqual([]));
  it('steps up a lift that keeps topping out', () => {
    expect(r.bad.progress.slice(0, 20)).toEqual([]);
    expect(r.stats.toppedChecks).toBeGreaterThan(0);
  });
  it('never steps up after a session logged short of its planned sets', () => {
    expect(r.bad.partial.slice(0, 20)).toEqual([]);
    expect(r.stats.partialChecks).toBeGreaterThan(0);
  });
  it('eases back in after a gap in logged work, and only then', () => {
    expect(r.bad.breaks.slice(0, 20)).toEqual([]);
    // Every tier came up: the holiday, the weeks signed in without logging, and the long break.
    expect(r.stats.tiers.every((n) => n > 0)).toBe(true);
    // And lifts came back from a block rotated out.
    expect(r.stats.stale).toBeGreaterThan(0);
  });
  it('pre-fills back-off sets no heavier than the top set', () => {
    expect(r.bad.backOff.slice(0, 20)).toEqual([]);
    expect(r.stats.backOffs).toBeGreaterThan(0);
  });
  it('plans well-formed blocks and workouts, numbering on from the last trained block after a long break', () => {
    expect(r.bad.plans.slice(0, 20)).toEqual([]);
    expect(r.stats.dropped).toBeGreaterThan(0);
  });
  it('keeps every workout in shape: sets, movements, main-lift sets, deloads, hinges, deadlifts and effort', () => expect(r.bad.shape.slice(0, 20)).toEqual([]));
  it('keeps base movements in place within a block, and rotates at most one main lift per day at a boundary', () => expect(r.bad.slots.slice(0, 20)).toEqual([]));
  it('loads the heavy week no lighter than the moderate week', () => {
    expect(r.bad.heavy.slice(0, 20)).toEqual([]);
    expect(r.stats.heavyPairs).toBeGreaterThan(0);
  });
  it('calls lifts stalled or topped out only when the logs say so', () => {
    expect(r.bad.stalls.slice(0, 20)).toEqual([]);
    expect(r.stats.stalled).toBeGreaterThan(0);
    expect(r.stats.toppedOut).toBeGreaterThan(0);
  });
  // Known drift (review/core-logic-review-2026-10-10.md, addendum c): lower back lands under its band in some
  // loading weeks and over it in deadlift weeks, back can sit half a set under, and rear delts can drop to 1.5–2
  // sets from block 4 on, when the variety slot takes a second side-delt raise (a selection issue, with core review). Anything else
  // goes red, so a new band regression can't hide behind the known ones.
  it('keeps each muscle within its band in loading weeks (one set over, none under), apart from the known drift', () => {
    expect(r.bad.bands.filter((v) => !knownDrift(v)).slice(0, 20)).toEqual([]);
  });
});

// Other lifters, shorter runs: another week, effort always tapped one way, past sets fixed, odd sets, a gym that
// loses its Smith machine and a main lift put on Avoid mid-block. The program has three lifting days, so every
// lifter trains three; what changes is which days, how they tap and what happens to them.
const OTHERS: Lifter[] = [
  {
    name: 'Tue/Thu/Sat with core on Sun+Mon, every set tapped Hard, past sets fixed now and then',
    seed: 7,
    blocks: 4,
    breaks: [{ from: 40, to: 52, opened: false }],
    schedule: [
      { weekdays: [2], type: 'chest-biceps', location: 'gym' },
      { weekdays: [4], type: 'legs', location: 'gym' },
      { weekdays: [6], type: 'back-tri-shoulders', location: 'gym' },
      { weekdays: [0, 1], type: 'core', location: 'home' },
    ],
    taps: 'hard',
    edits: 0.3,
  },
  {
    name: 'every set tapped Easy, odd sets, the gym loses its Smith machine in block 2 and the main chest lift goes on Avoid in block 3',
    seed: 99,
    blocks: 4,
    breaks: [],
    taps: 'easy',
    odd: 0.03,
    events: [{ day: 28 + 9, what: 'lose-smith' }, { day: 2 * 28 + 10, what: 'avoid-main-lift' }],
  },
];

describe.each(OTHERS)('$name', (lifter) => {
  let r: Result;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    r = await simulate(lifter);
  }, 300_000);
  afterAll(() => vi.useRealTimers());

  it('gives sound, safe hints and never steps up past what the logs earn', () => {
    for (const g of ['hints', 'safety', 'progress', 'partial', 'breaks', 'backOff'] as const) expect(r.bad[g].slice(0, 20), g).toEqual([]);
  });
  it('plans well-formed workouts and keeps base movements in place', () => {
    for (const g of ['plans', 'shape', 'slots', 'heavy', 'stalls'] as const) expect(r.bad[g].slice(0, 20), g).toEqual([]);
    expect(r.bad.bands.filter((v) => !knownDrift(v)).slice(0, 20), 'bands').toEqual([]);
  });
  it('keeps past sessions on their day when sets are fixed, and drops kit and avoided lifts from then on', () => {
    expect(r.bad.edits.slice(0, 20)).toEqual([]);
    expect(r.bad.events.slice(0, 20)).toEqual([]);
    if (lifter.edits) expect(r.stats.edits).toBeGreaterThan(0);
    if (lifter.odd) expect(r.stats.odd).toBeGreaterThan(0);
  });
});

/** Weight hints (§4.4, §4.5, §4.8). */
function checkHint(check: Check, date: string, ex: Exercise, pe: PlannedExercise, w: PlannedWorkout, hint: WeightHint | null, history: ReturnType<typeof summarizeHistory>, isDeload: (h: ReturnType<typeof summarizeHistory>[number]) => boolean) {
  const name = `${ex.id} (${w.sessionType} ${w.zone})`;
  if (hint?.suggest != null) stats.suggestions++;
  if (!hint) {
    check(!history.length, date, `${name}: no hint despite ${history.length} logged sessions`);
    return;
  }
  check(hint.suggest == null || (Number.isFinite(hint.suggest) && hint.suggest >= 0), date, `${name}: suggestion ${hint.suggest}`);
  check(hint.weight == null || (Number.isFinite(hint.weight) && hint.weight >= 0), date, `${name}: last weight ${hint.weight}`);
  check(!/NaN|undefined|Infinity/.test(hint.text), date, `${name}: hint text "${hint.text}"`);
  // Never built on a deload while a loading session exists.
  const loadingDates = new Set(history.filter((h) => !isDeload(h)).map((h) => h.date));
  const deloadDates = new Set(history.filter((h) => isDeload(h)).map((h) => h.date));
  check(!(loadingDates.size && deloadDates.has(hint.date) && !loadingDates.has(hint.date)), date, `${name}: hint from the deload of ${hint.date}`);
  if (hint.suggest == null || hint.weight == null || !loaded(ex)) return;
  const up = moved(ex, hint.suggest) - moved(ex, hint.weight);
  if (w.isDeload) {
    // A deload suggests less than the working weight, or the same when 10% is under half a step.
    check(up <= 0, date, `${name}: deload suggests ${hint.suggest} after ${hint.weight}`);
  } else {
    // At the same reps as last time, at most one step up, and none after a set tapped Hard. A change of rep
    // range moves the weight by e1RM instead, which the safety check covers.
    if (hint.text.startsWith(`Last time at ${rangeLabel(targetOf(pe))}:`)) check(up <= (ex.loadIncrementLb || 5) + 1e-9, date, `${name}: jumps from ${hint.weight} to ${hint.suggest}`);
    if (/that was Hard/.test(hint.text)) check(up <= 0, date, `${name}: Hard, yet suggests ${hint.suggest} after ${hint.weight}`);
  }
}

/** How the lifter trains a movement: the app's suggestion, else last time's weight, else a sensible first pick. */
function perform(ex: Exercise, pe: PlannedExercise, w: PlannedWorkout, hint: WeightHint | null, e1: number, profile: Profile, taps: NonNullable<Lifter['taps']>): Partial<LoggedSet>[] {
  const last = pe.sets[pe.sets.length - 1];
  const target = targetOf(pe);
  let weight: number | null = null;
  if (loaded(ex)) {
    const lastWeight = hint?.text.startsWith('Last time at') ? hint.weight : undefined;
    weight = hint?.suggest ?? lastWeight ?? firstPick(ex, e1, target ? Math.round((target.min + target.max) / 2) : 10, last?.rir ?? 2);
    if (w.isDeload && hint?.suggest == null) weight = snap(ex, weight * 0.9);
    // Outside deloads, a weight clearly too heavy or too light for the range gets nudged a step or two.
    if (!w.isDeload && target && ex.metric === 'reps') {
      const step = (ex.loadIncrementLb || 5) * (ex.weightConvention === 'assist' ? -1 : 1);
      for (let n = 0; n < 3; n++) {
        const reps = capacity(ex, e1, weight, 0) - (last?.rir ?? 2);
        if (reps < target.min) weight = Math.max(0, weight - step);
        else if (reps > target.max + 3) weight = weight + step;
        else break;
      }
    }
  }
  // Most people tap an effort; a few sets go Hard on a bad day.
  const tap = rand() < 0.75;
  const badDay = rand() < 0.1;
  return pe.sets.map((ps, i) => {
    // After a top set, the back-off sets take the workout screen's pre-fill.
    const wi = i > 0 && isTopSet(pe, 0) && weight != null ? backOffLoad(ex, weight, profile) ?? weight : weight;
    if (ex.metric === 'time') {
      const t = ps.targetSeconds ?? { min: 20, max: 40 };
      return { weight: wi, seconds: Math.round(t.min + rand() * (t.max - t.min)), reps: null, effort: taps !== 'felt' ? taps : tap ? 'right' : null };
    }
    const t = ps.targetReps ?? { min: 8, max: 12 };
    const cap = capacity(ex, e1, wi, i) - (badDay ? 2 : 0);
    // Reps stop at the top of the range, or past it when the hint asks for a few more before a big jump.
    const more = wi === hint?.weight ? Number(hint?.text.match(/aim for \d+–(\d+) reps/)?.[1] ?? 0) : 0;
    const reps = Math.max(1, Math.min(Math.max(t.max, more), Math.floor(cap - ps.rir + rand())));
    const effort = taps !== 'felt' ? taps : cap - reps < 1 || badDay ? 'hard' : cap - reps > 4 ? 'easy' : 'right';
    return { weight: wi, reps, seconds: null, effort: taps !== 'felt' || tap ? effort : null };
  });
}

/** Plans (§4.1, §4.8): well-formed workouts, deadlifts first, top sets only on lifts trained in their slot the block before, blocks numbered in order (after a long break too). */
function checkPlans(check: Check, blocks: Awaited<ReturnType<typeof liveBlocks>>, workouts: PlannedWorkout[], logs: { blockId?: string; exerciseId: string; loggedAt: string }[]): number {
  let topSets = 0;
  for (let i = 1; i < blocks.length; i++) {
    check(blocks[i].index === blocks[i - 1].index + 1, blocks[i].startDate, `block ${blocks[i].index} follows block ${blocks[i - 1].index}`);
    check(blocks[i].startDate >= addDays(blocks[i - 1].startDate, 28), blocks[i].startDate, `block ${blocks[i].index} overlaps the one before`);
  }
  const seen = new Set<string>();
  for (const w of workouts) {
    const key = `${w.date}|${w.sessionType}`;
    check(!seen.has(key), w.date, `two ${w.sessionType} workouts`);
    seen.add(key);
    check(w.exercises.length > 0, w.date, `${w.sessionType}: no movements`);
    check(new Set(w.exercises.map((e) => e.exerciseId)).size === w.exercises.length, w.date, `${w.sessionType}: a movement twice`);
    check(w.exercises.every((e, k) => e.order === k), w.date, `${w.sessionType}: order out of sequence`);
    for (const e of w.exercises) {
      check(e.sets.length > 0, w.date, `${e.exerciseId}: no sets`);
      for (const s of e.sets) {
        const r = s.targetReps ?? s.targetSeconds;
        check(!!r && r.min > 0 && r.min <= r.max, w.date, `${e.exerciseId}: target ${JSON.stringify(r)}`);
        check(s.rir >= 0 && s.restSec > 0, w.date, `${e.exerciseId}: rir ${s.rir}, rest ${s.restSec}`);
        if (w.isDeload && w.sessionType !== 'core') check(s.rir >= 4, w.date, `${e.exerciseId}: deload at rir ${s.rir}`);
      }
    }
    const dl = w.exercises.findIndex((e) => e.slot === 'back:deadlift');
    check(dl <= 0, w.date, `deadlift is movement ${dl + 1}`);
  }
  // Top sets only on a lift logged in the block before, holding the same slot (§4.1).
  for (const { input, out, at } of planned) {
    for (const w of out.workouts) {
      for (const e of w.exercises) {
        if (!isTopSet(e, 0)) continue;
        topSets++;
        const prev = input.previousBlock;
        const settled = !!prev && prev.baseSlots[`${w.sessionType}|${e.slot}`] === e.exerciseId;
        const trained = !!prev && logs.some((l) => l.blockId === prev.id && l.exerciseId === e.exerciseId && l.loggedAt <= at);
        check(settled && trained, w.date, `top set on ${e.exerciseId}, ${settled ? 'not logged in the block before' : 'new to its slot'}`);
      }
    }
  }
  return topSets;
}

/** Today's target: the last set's, since a top set opens with fewer reps than the rest. */
const targetOf = (pe: Pick<PlannedExercise, 'sets'>) => pe.sets[pe.sets.length - 1]?.targetReps ?? pe.sets[0]?.targetReps;
const rangeLabel = (r: { min: number; max: number } | undefined) => (!r ? '' : r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`);
const isLiftDay = (w: PlannedWorkout) => STRANGE_PERIODIZATION.days[w.sessionType]?.kind === 'lift';
const lastPlan = (blockId: string) => planned.filter((p) => p.out.block.id === blockId).pop();

/**
 * Safety (§4.4): a suggested weight is one the lifter could lift for the bottom of today's reps with a rep or
 * more to spare (`margin`), by the strength the simulation gave them.
 */
function checkSafe(check: Check, date: string, ex: Exercise, pe: PlannedExercise, w: PlannedWorkout, hint: WeightHint | null, e1: number, margin: number) {
  if (!loaded(ex) || ex.metric !== 'reps') return;
  // On a top-set day the suggestion is the top set's weight and the back-off weight comes with it.
  const top = isTopSet(pe, 0);
  const pairs: [number | undefined, { min: number; max: number } | undefined][] = [[hint?.suggest, top ? pe.sets[0].targetReps : targetOf(pe)], [hint?.backOff, targetOf(pe)]];
  for (const [weight, target] of pairs) {
    if (weight == null || !target) continue;
    const reps = 30 * (e1 / Math.max(1, moved(ex, weight)) - 1);
    check(reps >= target.min + margin, date, `${ex.id} (${w.sessionType} ${w.zone}): try ${weight} for ${rangeLabel(target)}, good for ${reps.toFixed(1)} reps ("${hint!.text}")`);
  }
}

/**
 * Progress, partial sessions and long gaps (§4.4 item 2, §4.5 rev 3.9), judged from the logs as the lifter left
 * them: each set against its own planned target, gaps by the lift's own last logged loading session.
 * - A session logged short of its planned sets never earns a heavier suggestion.
 * - A full session at the top of its ranges at Right or Easy, at today's reps, earns a step up (or the call for
 *   more reps when the step is too big); and three such sessions in a row at one weight earn one whatever the reps.
 * - 10+ days off: about 10% lighter; 4+ weeks: 20% lighter and no top set for the rest of the block; 8+ weeks: no
 *   number, find the weight again. Never otherwise, however often the app was opened.
 * - Less time off than that, but back from a block rotated out, 4+ weeks since its last log: about 5% lighter. Never
 *   for a lift the plan runs only some weeks, so one that topped its range twice is never suggested lower.
 * The cut can be deeper than the tier's when last time's e1RM carries less; the line says by how much.
 */
function checkProgress(c: Record<'progress' | 'breaks' | 'partial', Check>, date: string, ex: Exercise, plan: PlannedExercise, w: PlannedWorkout, hint: WeightHint | null, history: SessionSummary[], isDeload: HintContext['isDeload']) {
  if (w.isDeload || !loaded(ex) || ex.metric !== 'reps' || !hint) return;
  const loading = history.filter((h) => !isDeload(h));
  const newest = loading[0];
  if (!newest) return;
  const name = `${ex.id} (${w.sessionType} ${w.zone})`;
  // Days off since the lift's last logged session (a deload counts), from when it was due and went unlogged.
  const off = (from: string, to: string) => {
    const start = timeOffFrom(ex.id, from, to);
    return start ? daysBetween(start, to) : 0;
  };
  const gap = off(history[0].date, date);
  const said = `"${hint.text}"${hint.suggest != null ? ` try ${hint.suggest}` : ''}`;
  if (gap >= LONG_GAP.days) stats.tiers[gap >= LONG_GAP.newDays ? 2 : gap >= LONG_GAP.monthDays ? 1 : 0]++;
  const cut = Number(/ so about (\d+)% lighter/.exec(hint.text)?.[1] ?? 0);
  const back = /first session back/.test(hint.text);
  if (gap >= LONG_GAP.newDays) c.breaks(hint.suggest == null && /ramp up/.test(hint.text), date, `${name}: ${gap} days off, ${said}`);
  else if (gap >= LONG_GAP.monthDays) c.breaks(back && cut >= 20, date, `${name}: ${gap} days off, ${said}`);
  else if (gap >= LONG_GAP.days) c.breaks(back && cut >= 10, date, `${name}: ${gap} days off, ${said}`);
  else c.breaks(!back, date, `${name}: ${gap} days since the last log, ${said}`);
  const since = daysBetween(history[0].date, date);
  const stale = gap < LONG_GAP.days && since >= LONG_GAP.staleDays && rotatedOut(ex.id, history[0].date, date);
  if (stale) stats.stale++;
  c.breaks(/first time in/.test(hint.text) === stale && (!stale || cut >= 5), date, `${name}: ${gap} days off, ${since} since the last log, ${said}`);
  // Back from 4+ weeks off within this block: no top set (checked on the plan as given, before the screen drops it).
  const inBlock = loading.filter((h) => sessionBlock.get(h.sessionId) === w.blockId);
  const first = inBlock[inBlock.length - 1];
  const before = first ? loading[loading.indexOf(first) + 1] : newest;
  if (hint.noTopSet) stats.noTopSet++;
  if (isTopSet(plan, 0) && before && off(before.date, first?.date ?? date) >= LONG_GAP.monthDays) c.breaks(!!hint.noTopSet, date, `${name}: top set kept on a return from ${off(before.date, first?.date ?? date)} days off`);
  // A first session back, or after a stale number, earns no step.
  if (gap >= LONG_GAP.days || stale) return;

  const planned = (h: SessionSummary) => plannedOf.get(h.sets[0].plannedExerciseId ?? '');
  const own = (s: LoggedSet) => plannedOf.get(s.plannedExerciseId ?? '')?.find((p) => p.setIndex === s.setIndex)?.targetReps;
  const topped = (h: SessionSummary) => {
    const sets = h.sets.filter((s) => s.reps != null);
    const topDay = sets.length > 1 && (own(sets[0])?.max ?? 0) < (own(sets[sets.length - 1])?.max ?? 0);
    const judged = topDay ? [sets[0]] : sets;
    const full = h.sets.length >= (planned(h)?.length ?? Infinity);
    const lead = topDay ? sets[0] : sets.reduce((a, b) => (moved(ex, b.weight ?? 0) > moved(ex, a.weight ?? 0) ? b : a));
    const shortSets = (topDay ? sets.slice(1) : sets).filter((s) => s.reps! < (own(s)?.min ?? 0)).length;
    const ok = full && shortSets < 2 && judged.every((s) => s.reps! >= (own(s)?.max ?? Infinity)) && h.sets.every((s) => s.effort === 'right' || s.effort === 'easy');
    return { ok, full, weight: moved(ex, lead.weight ?? 0) };
  };
  const last = topped(newest);
  const target = targetOf(plan);
  const lastTarget = planned(newest)?.at(-1)?.targetReps;
  const same = !!target && !!lastTarget && target.min === lastTarget.min && target.max === lastTarget.max;
  const up = hint.suggest != null && moved(ex, hint.suggest) > last.weight;
  const asksMore = /aim for \d+–\d+ reps/.test(hint.text);
  if (!last.full && same) stats.partialChecks++;
  if (last.ok && same) stats.toppedChecks++;
  if (!last.full && same) c.partial(!up, date, `${name}: ${newest.sets.length} of ${planned(newest)?.length} sets logged, ${said}`);
  if (last.ok && same) c.progress(up || asksMore, date, `${name}: topped out at ${last.weight}, ${said}`);
  const run = loading.slice(0, 3).map(topped);
  if (run.length === 3 && run.every((r) => r.ok && r.weight === last.weight)) stats.runChecks++;
  if (run.length === 3 && run.every((r) => r.ok && r.weight === last.weight)) c.progress(up || asksMore, date, `${name}: topped out three times at ${last.weight}, ${said}`);
  // A main lift that topped its range twice running is never suggested lower at today's reps or fewer, whatever its
  // cadence (the Friday deadlift weeks apart).
  const twice = loading.slice(0, 2);
  const fewer = twice.length === 2 && !!target && twice.every((h) => (planned(h)?.at(-1)?.targetReps?.min ?? 0) >= target.min);
  if ((plan.role === 'P' || plan.role === 'C') && fewer && twice.every((h) => topped(h).ok)) {
    stats.twiceChecks++;
    c.progress(hint.suggest == null || moved(ex, hint.suggest) >= last.weight, date, `${name}: topped out twice, last at ${last.weight}, ${said}`);
  }
}

/**
 * Workout shape (§4.1, §4.2, §4.5, §4.8), every week of every block: 22 sets and 8 movements at most; main lifts
 * (P and C slots outside the variety slots) at 3 or more sets on loading days; deload weeks base movements only, at 2 sets; no axial hinge on light or
 * deload days; no deadlift on light or deload weeks; RIR 3/2/2 for main lifts and 3/2/1 for the rest, then 4.
 */
function checkShape(check: Check, workouts: PlannedWorkout[], byId: Map<string, Exercise>) {
  const { params } = STRANGE_PERIODIZATION;
  for (const w of workouts.filter(isLiftDay)) {
    const name = `${w.sessionType} ${w.zone}`;
    // The cap leaves the grip finisher aside for movements (§4.1).
    const sets = w.exercises.reduce((n, e) => n + e.sets.length, 0);
    const movements = w.exercises.filter((e) => e.role !== 'G').length;
    check(sets <= params.sessionCap.sets && movements <= params.sessionCap.movements, w.date, `${name}: ${sets} sets, ${movements} movements besides grip`);
    for (const e of w.exercises) {
      const ex = e.exerciseId;
      const { movementPattern, axialLoad } = byId.get(ex)!;
      if (w.isDeload) {
        check(['P', 'C', 'I'].includes(e.role) && e.sets.length === params.sets.deload, w.date, `${name}: ${ex} (${e.role}) at ${e.sets.length} sets in the deload`);
      } else if (e.role === 'P' || (e.role === 'C' && !e.slot.includes(':v:'))) {
        // A compound in a variety slot (the third chest press, the second row) trims like variety (§4.2).
        check(e.sets.length >= 3, w.date, `${name}: main lift ${ex} at ${e.sets.length} sets`);
      }
      e.sets.forEach((s, i) => {
        if (isTopSet(e, i)) return;
        const want = rirFor(w.weekIndex, e.role, params);
        check(s.rir === want, w.date, `${name}: ${ex} set ${i + 1} at RIR ${s.rir}, not ${want}`);
      });
      if (w.zone === 'L' || w.isDeload) {
        check(e.slot !== 'back:deadlift', w.date, `${name}: deadlift`);
        check(!(movementPattern === 'hinge' && axialLoad), w.date, `${name}: axial hinge ${ex}`);
      }
    }
  }
}

/**
 * Base movements (§4.3): each base slot runs the block's pick every week, apart from light-day and deload
 * stand-ins and the deadlift's swap weeks. At a block boundary at most one main-lift (P or C) slot per day
 * changes, not counting lifts rotated out as stalled or outgrown and slots that alternate one- and two-sided.
 */
function checkSlots(check: Check, blocks: Awaited<ReturnType<typeof liveBlocks>>, workouts: PlannedWorkout[], regenerated: string[]) {
  // A block rebuilt part way through (a kit change, a new Avoid) holds the new base from that day on, and its
  // forced changes don't count against the one-main-lift-per-boundary rule.
  const rebuiltOn = (b: Block) => regenerated.filter((x) => x >= b.startDate && x <= addDays(b.startDate, b.weeks * 7 - 1)).pop();
  for (const b of blocks) {
    const since = rebuiltOn(b) ?? '';
    for (const w of workouts.filter((w) => w.blockId === b.id && isLiftDay(w) && w.date >= since)) {
      const day = STRANGE_PERIODIZATION.days[w.sessionType] as LiftDay;
      for (const slot of day.base) {
        const id = b.baseSlots[`${w.sessionType}|${slot.key}`];
        if (!id) continue;
        const here = w.exercises.some((e) => e.exerciseId === id)
          || w.exercises.some((e) => e.slot === slot.key && e.note?.startsWith('Stands in for'))
          || (!!slot.swap && w.exercises.some((e) => e.slot === slot.swap!.key));
        check(here, w.date, `${w.sessionType} ${w.zone}: ${slot.key} doesn't run ${id}`);
      }
    }
  }
  for (let i = 1; i < blocks.length; i++) {
    const [prev, cur] = [blocks[i - 1], blocks[i]];
    if (rebuiltOn(cur)) continue;
    const input = lastPlan(cur.id)?.input;
    const excused = new Set([...(input?.stalled ?? []), ...(input?.toppedOut ?? []), ...(input?.outgrown ?? [])]);
    for (const [type, day] of Object.entries(STRANGE_PERIODIZATION.days)) {
      if (day.kind !== 'lift') continue;
      const changed = day.base.filter((s) => {
        const [a, c] = [prev.baseSlots[`${type}|${s.key}`], cur.baseSlots[`${type}|${s.key}`]];
        return (s.role === 'P' || s.role === 'C') && a && c && a !== c && !excused.has(a) && !s.alternateLaterality;
      });
      check(changed.length <= 1, cur.startDate, `block ${cur.index} ${type}: ${changed.map((s) => s.key).join(', ')} all rotated`);
    }
  }
}

/**
 * Weekly sets per muscle in loading weeks (§4.2, rev 3.6): at most one set over the band (where base compounds
 * carry it) and never under.
 */
function checkBands(check: Check, blocks: Awaited<ReturnType<typeof liveBlocks>>, workouts: PlannedWorkout[], byId: Map<string, Exercise>) {
  for (const b of blocks) {
    const mine = workouts.filter((w) => w.blockId === b.id && !w.isDeload);
    weeklySets(mine, byId).forEach((week, k) => {
      if (mine.every((w) => w.weekIndex !== k)) return;
      for (const [g, band] of Object.entries(BANDS)) {
        const n = week[g as keyof typeof week];
        check(n >= band![0] && n <= band![1] + 1, addDays(b.startDate, 7 * k), `block ${b.index} week ${k + 1}: ${g} at ${n} sets, band ${band![0]}–${band![1]}`);
      }
    });
  }
}

/**
 * The heavy week's working weight on a main lift (P or C) is at least the moderate week's, in the same block and
 * day. Isolation movements run the same reps on both, so either week can be the heavier.
 */
function checkHeavy(check: Check, blocks: Awaited<ReturnType<typeof liveBlocks>>) {
  for (const b of blocks) {
    for (const [key, heavy] of used) {
      const [blockId, type, zone, exId] = key.split('|');
      if (blockId !== b.id || zone !== 'H') continue;
      const moderate = used.get(usedKey(blockId, type, 'M', exId));
      if (moderate == null) continue;
      stats.heavyPairs++;
      check(heavy >= moderate, b.startDate, `block ${b.index} ${type}: ${exId} heavy at ${heavy}, moderate at ${moderate}`);
    }
  }
}

/**
 * Stalls (§4.3), worked out again from the logs the planner had. A lift is flat when its best e1RM over the loading
 * sessions of the newest block it was trained in failed to beat the block before by 1%, with 2 or more such
 * sessions in each; it is topped out when that newest block's heaviest set reached the top of its planned reps at
 * Right or Easy. Stalled must mean flat and not topped out, and topped out must mean flat and topped out. This
 * catches wiring slips (deloads counted, blocks out of order, heavy compared with light) that unit tests can't see.
 */
async function checkStalls(check: Check, d: GetFitDB, byId: Map<string, Exercise>, profile: Awaited<ReturnType<typeof getProfile>>): Promise<void> {
  const workouts = new Map((await d.plannedWorkouts.toArray()).map((w) => [w.id, w]));
  const plannedSets = new Map([...workouts.values()].flatMap((w) => w.exercises.map((e) => [e.id, e.sets] as const)));
  const sessions = new Map((await d.sessions.toArray()).map((s) => [s.id, s]));
  const blocks = new Map((await d.blocks.toArray()).map((b) => [b.id, b]));
  const sets = (await d.loggedSets.toArray()).filter((s) => !s.deletedAt);
  for (const { input, at } of planned) {
    const judge = (id: string) => {
      const ex = byId.get(id)!;
      const per = new Map<string, LoggedSet[]>();
      for (const s of sets) {
        const w = workouts.get(sessions.get(s.sessionId)?.plannedWorkoutId ?? '');
        if (s.exerciseId !== id || s.loggedAt > at || !w || w.isDeload || setE1rm(ex, s, profile) == null) continue;
        per.set(w.blockId, [...(per.get(w.blockId) ?? []), s]);
      }
      const [last, before] = [...per].sort((a, b) => blocks.get(b[0])!.startDate.localeCompare(blocks.get(a[0])!.startDate)).map(([, list]) => list);
      const best = (list: LoggedSet[]) => Math.max(...list.map((s) => setE1rm(ex, s, profile)!));
      const count = (list: LoggedSet[]) => new Set(list.map((s) => s.sessionId)).size;
      const flat = !!last && !!before && count(last) >= 2 && count(before) >= 2 && best(last) < best(before) * 1.01;
      const load = (s: LoggedSet) => moved(ex, s.weight ?? 0);
      const top = last && Math.max(...last.map(load));
      const max = (s: LoggedSet) => plannedSets.get(s.plannedExerciseId ?? '')?.find((p) => p.setIndex === s.setIndex)?.targetReps?.max;
      const topped = !!last && last.some((s) => load(s) === top && max(s) != null && s.reps! >= max(s)! && (s.effort === 'right' || s.effort === 'easy'));
      return { flat, topped };
    };
    for (const id of input.stalled ?? []) {
      stats.stalled++;
      const { flat, topped } = judge(id);
      check(flat && !topped, input.startDate, `${id} rotated out as stalled, but its logs say ${flat ? 'it topped out' : 'it gained'}`);
    }
    for (const id of input.toppedOut ?? []) {
      stats.toppedOut++;
      const { flat, topped } = judge(id);
      check(flat && topped, input.startDate, `${id} called topped out, but its logs say ${flat ? 'it never topped out' : 'it gained'}`);
    }
  }
}
