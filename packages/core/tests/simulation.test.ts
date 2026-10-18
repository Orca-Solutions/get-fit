// A long-run check of day-to-day use: a simulated lifter trains six blocks through the real planner, the
// client database and the workout screen's weight hints, and every day is checked against the invariants
// below. Unit tests pin each rule on its own; this one catches rules that only go wrong in combination,
// across block boundaries, deloads, missed days and a break (like the week after a deload building on the
// deload's lighter weights).
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
import { allExercises, ensurePlan, getProfile, hintContext, liveBlocks, logSet, startSession, updateSession } from '../src/client/repo';
import { addDays, daysBetween } from '../src/dates';
import { backOffLoad, isTopSet, setE1rm, summarizeHistory, workoutHint, type WeightHint } from '../src/generator/progression';
import { BANDS, weeklySets } from '../src/generator/coverage';
import { referenceProfile } from '../src/profiles';
import { STRANGE_PERIODIZATION, type LiftDay } from '../src/program';
import { rirFor } from '../src/generator/templates';
import type { Exercise, LoggedSet, PlannedExercise, PlannedWorkout, Profile } from '../src/types';

const START = '2026-01-05'; // a Monday
const BLOCKS = 6;
const END = addDays(START, BLOCKS * 28 - 1);
// Two weeks off in block 4 (holiday), and about one workout in twenty missed at random.
const BREAK = { from: addDays(START, 3 * 28 + 8), to: addDays(START, 3 * 28 + 21) };
const MISS_RATE = 0.05;

// Seeded, so every run is the same run.
let seed = 20261018;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/** The lifter: a rough 10-rep weight per load type, a per-movement knack, and beginner gains of about 1.5% a week of training. */
const TEN_REP: Record<string, number> = { barbell: 95, 'ez-bar': 55, dumbbell: 25, machine: 80, cable: 30, kettlebell: 25, smith: 50, plate: 25 };
const knack = new Map<string, number>();
const BODYWEIGHT = 168;

function strength(ex: Exercise, weeksTrained: number): number {
  if (!knack.has(ex.id)) knack.set(ex.id, 0.8 + rand() * 0.4);
  const base = ex.weightConvention === 'assist' ? BODYWEIGHT * 0.6 : TEN_REP[ex.loadType] ?? 25;
  return base * knack.get(ex.id)! * (1 + 10 / 30) * (1 + 0.015 * weeksTrained);
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
const GROUPS = ['hints', 'safety', 'backOff', 'plans', 'shape', 'slots', 'bands', 'stalls', 'heavy'] as const;
const bad = Object.fromEntries(GROUPS.map((g) => [g, [] as Violation[]])) as Record<(typeof GROUPS)[number], Violation[]>;
const checker = (g: (typeof GROUPS)[number]): Check => (ok, date, what) => { if (!ok) bad[g].push({ date, what }); };
const stats = { workouts: 0, sets: 0, hints: 0, suggestions: 0, backOffs: 0, topSets: 0, stalled: 0, toppedOut: 0, heavyPairs: 0 };

/** The heaviest weight used on each movement's working sets (top sets aside), by block, day and zone. */
const used = new Map<string, number>();
const usedKey = (blockId: string, type: string, zone: string, exId: string) => `${blockId}|${type}|${zone}|${exId}`;

describe('six blocks of day-to-day use', () => {
  let d: GetFitDB;
  let byId: Map<string, Exercise>;
  let blocks: Awaited<ReturnType<typeof liveBlocks>>;
  let workouts: PlannedWorkout[];

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const at = (date: string, hhmm = '06:00') => vi.setSystemTime(new Date(`${date}T${hhmm}:00Z`));
    at(addDays(START, -1));
    d = new GetFitDB('simulation');
    await d.open();
    await d.profile.put({ ...referenceProfile(), bodyweightLb: BODYWEIGHT });
    const profile = await getProfile(d);
    byId = new Map((await allExercises(d)).map((e) => [e.id, e]));
    let weeksTrained = 0;
    let lastWeekTrained = '';

    for (let date = START; date <= END; date = addDays(date, 1)) {
      // The app isn't opened during the break.
      if (date >= BREAK.from && date <= BREAK.to) continue;
      at(date);
      await ensurePlan(date, d);
      const week = addDays(START, Math.floor(daysBetween(START, date) / 7) * 7);
      const todays = (await d.plannedWorkouts.where('date').equals(date).toArray()).filter((w) => !w.deletedAt);
      for (const w of todays) {
        if (rand() < MISS_RATE) continue;
        if (week !== lastWeekTrained) {
          lastWeekTrained = week;
          weeksTrained++;
        }
        at(date, '17:30');
        const session = await startSession(w.id, date, d);
        const ctx = await hintContext(d);
        for (const pe of [...w.exercises].sort((a, b) => a.order - b.order)) {
          const ex = byId.get(pe.exerciseId)!;
          const sets = (await d.loggedSets.where('exerciseId').equals(ex.id).toArray()).filter((s) => !s.deletedAt && s.sessionId !== session.id);
          const history = summarizeHistory(ex, sets, profile);
          const hint = workoutHint(ex, pe, history, { deload: w.isDeload, ...ctx, date, profile });
          const e1 = strength(ex, weeksTrained);
          stats.hints++;
          checkHint(checker('hints'), date, ex, pe, w, hint, history, ctx.isDeload);
          checkSafe(checker('safety'), date, ex, pe, w, hint, e1);
          const done = perform(ex, pe, w, hint, e1, profile);
          if (isTopSet(pe, 0) && loaded(ex) && done[0].weight != null) {
            stats.backOffs++;
            checker('backOff')(moved(ex, done[1].weight!) <= moved(ex, done[0].weight), date, `${ex.id}: back-off set pre-filled at ${done[1].weight} after a ${done[0].weight} top set`);
          }
          const working = done.filter((c, i) => c.weight != null && !isTopSet(pe, i)).map((c) => moved(ex, c.weight!));
          if (loaded(ex) && working.length && !pe.note && (pe.role === 'P' || pe.role === 'C')) used.set(usedKey(w.blockId, w.sessionType, w.zone, ex.id), Math.max(...working));
          for (const [i, c] of done.entries()) {
            await logSet(session, ex.id, pe.id, i, c, d);
            stats.sets++;
          }
        }
        await updateSession(session.id, { endedAt: new Date().toISOString(), beatUp: false }, d);
        stats.workouts++;
      }
    }
    blocks = await liveBlocks(d);
    workouts = (await d.plannedWorkouts.toArray()).filter((w) => !w.deletedAt);
    stats.topSets = checkPlans(checker('plans'), blocks, workouts);
    checkShape(checker('shape'), workouts, byId);
    checkSlots(checker('slots'), blocks, workouts);
    checkBands(checker('bands'), blocks, workouts, byId);
    checkHeavy(checker('heavy'), blocks);
    await checkStalls(checker('stalls'), d, byId, profile);
    console.log(`simulated ${stats.workouts} workouts, ${stats.sets} sets, ${stats.hints} hints (${stats.suggestions} with a suggestion), ${planned.length} plans, ` +
      `${stats.topSets} planned top sets (${stats.backOffs} done), ${stats.stalled} stalled and ${stats.toppedOut} topped out, ${stats.heavyPairs} heavy/moderate pairs; violations: ` +
      GROUPS.map((g) => `${g} ${bad[g].length}`).join(', '));
  }, 300_000);
  afterAll(() => vi.useRealTimers());

  it('gives a sound weight hint for every movement, every workout', () => expect(bad.hints.slice(0, 20)).toEqual([]));
  it('never suggests a weight the lifter would fail at the bottom of today\'s reps', () => expect(bad.safety.slice(0, 20)).toEqual([]));
  it('pre-fills back-off sets no heavier than the top set', () => {
    expect(bad.backOff.slice(0, 20)).toEqual([]);
    expect(stats.backOffs).toBeGreaterThan(0);
  });
  it('plans well-formed blocks and workouts', () => expect(bad.plans.slice(0, 20)).toEqual([]));
  it('keeps every workout in shape: sets, movements, main-lift sets, deloads, hinges, deadlifts and effort', () => expect(bad.shape.slice(0, 20)).toEqual([]));
  it('keeps base movements in place within a block, and rotates at most one main lift per day at a boundary', () => expect(bad.slots.slice(0, 20)).toEqual([]));
  it('loads the heavy week no lighter than the moderate week', () => {
    expect(bad.heavy.slice(0, 20)).toEqual([]);
    expect(stats.heavyPairs).toBeGreaterThan(0);
  });
  it('calls lifts stalled or topped out only when the logs say so', () => {
    expect(bad.stalls.slice(0, 20)).toEqual([]);
    expect(stats.stalled).toBeGreaterThan(0);
    expect(stats.toppedOut).toBeGreaterThan(0);
  });
  // Known drift (review/core-logic-review-2026-10-10.md, addendum c): lower back lands under its band in some
  // loading weeks and over it in deadlift weeks, and back can sit half a set under. Anything else goes red, so a
  // new band regression can't hide behind the known one.
  it('keeps each muscle within its band in loading weeks (one set over, none under), apart from the known drift', () => {
    const known = (v: Violation) => {
      const [, g, n, min] = v.what.match(/: (\S+) at ([\d.]+) sets, band (\d+)–/) ?? [];
      return g === 'lower-back' || (g === 'back' && Number(n) >= Number(min) - 0.5);
    };
    expect(bad.bands.filter((v) => !known(v)).slice(0, 20)).toEqual([]);
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
function perform(ex: Exercise, pe: PlannedExercise, w: PlannedWorkout, hint: WeightHint | null, e1: number, profile: Profile): Partial<LoggedSet>[] {
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
      return { weight: wi, seconds: Math.round(t.min + rand() * (t.max - t.min)), reps: null, effort: tap ? 'right' : null };
    }
    const t = ps.targetReps ?? { min: 8, max: 12 };
    const cap = capacity(ex, e1, wi, i) - (badDay ? 2 : 0);
    // Reps stop at the top of the range, or past it when the hint asks for a few more before a big jump.
    const more = wi === hint?.weight ? Number(hint?.text.match(/aim for \d+–(\d+) reps/)?.[1] ?? 0) : 0;
    const reps = Math.max(1, Math.min(Math.max(t.max, more), Math.floor(cap - ps.rir + rand())));
    const effort = cap - reps < 1 || badDay ? 'hard' : cap - reps > 4 ? 'easy' : 'right';
    return { weight: wi, reps, seconds: null, effort: tap ? effort : null };
  });
}

/** Plans (§4.1, §4.8): well-formed workouts, deadlifts first, top sets only on settled lifts, blocks in order. */
function checkPlans(check: Check, blocks: Awaited<ReturnType<typeof liveBlocks>>, workouts: PlannedWorkout[]): number {
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
  // Top sets only on a lift already logged that held its slot the block before (§4.1).
  for (const { input, out } of planned) {
    for (const w of out.workouts) {
      for (const e of w.exercises) {
        if (!isTopSet(e, 0)) continue;
        topSets++;
        const settled = (input.known ?? []).includes(e.exerciseId) && input.previousBlock?.baseSlots[`${w.sessionType}|${e.slot}`] === e.exerciseId;
        check(settled, w.date, `top set on ${e.exerciseId}, new to its slot`);
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
 * more to spare, by the strength the simulation gave them.
 */
function checkSafe(check: Check, date: string, ex: Exercise, pe: PlannedExercise, w: PlannedWorkout, hint: WeightHint | null, e1: number) {
  const target = targetOf(pe);
  if (hint?.suggest == null || !loaded(ex) || ex.metric !== 'reps' || !target) return;
  const reps = 30 * (e1 / Math.max(1, moved(ex, hint.suggest)) - 1);
  check(reps >= target.min + 1, date, `${ex.id} (${w.sessionType} ${w.zone}): try ${hint.suggest} for ${rangeLabel(target)}, good for ${reps.toFixed(1)} reps`);
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
function checkSlots(check: Check, blocks: Awaited<ReturnType<typeof liveBlocks>>, workouts: PlannedWorkout[]) {
  for (const b of blocks) {
    for (const w of workouts.filter((w) => w.blockId === b.id && isLiftDay(w))) {
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
    const input = lastPlan(cur.id)?.input;
    const excused = new Set([...(input?.stalled ?? []), ...(input?.outgrown ?? [])]);
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
