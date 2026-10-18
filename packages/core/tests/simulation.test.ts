// A long-run check of day-to-day use: a simulated lifter trains six blocks through the real planner, the
// client database and the workout screen's weight hints, and every day is checked against the invariants
// below. Unit tests pin each rule on its own; this one catches rules that only go wrong in combination,
// across block boundaries, deloads, missed days and a break (like the week after a deload building on the
// deload's lighter weights).
import 'fake-indexeddb/auto';
import { afterAll, describe, expect, it, vi } from 'vitest';
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
import { allExercises, deloadSessionIds, ensurePlan, getProfile, liveBlocks, logSet, startSession, updateSession } from '../src/client/repo';
import { addDays, daysBetween } from '../src/dates';
import { backOffLoad, isTopSet, setE1rm, summarizeHistory, workoutHint, type WeightHint } from '../src/generator/progression';
import { BANDS, weeklySets } from '../src/generator/coverage';
import { referenceProfile } from '../src/profiles';
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

describe('six blocks of day-to-day use', () => {
  afterAll(() => vi.useRealTimers());

  it('keeps every planning and weight-hint invariant', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const at = (date: string, hhmm = '06:00') => vi.setSystemTime(new Date(`${date}T${hhmm}:00Z`));
    at(addDays(START, -1));
    const d = new GetFitDB('simulation');
    await d.open();
    await d.profile.put({ ...referenceProfile(), bodyweightLb: BODYWEIGHT });
    const profile = await getProfile(d);
    const byId = new Map((await allExercises(d)).map((e) => [e.id, e]));
    const bad: Violation[] = [];
    const check = (ok: boolean, date: string, what: string) => { if (!ok) bad.push({ date, what }); };
    let weeksTrained = 0;
    let workoutsDone = 0;
    let setsLogged = 0;
    let hintsChecked = 0;
    let backOffs = 0;
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
        const deloads = await deloadSessionIds(d);
        for (const pe of [...w.exercises].sort((a, b) => a.order - b.order)) {
          const ex = byId.get(pe.exerciseId)!;
          const sets = (await d.loggedSets.where('exerciseId').equals(ex.id).toArray()).filter((s) => !s.deletedAt && s.sessionId !== session.id);
          const history = summarizeHistory(ex, sets, profile);
          const hint = workoutHint(ex, pe, history, { deload: w.isDeload, isDeload: (h) => deloads.has(h.sessionId), date, profile });
          hintsChecked++;
          checkHint(check, date, ex, w, hint, history, deloads);
          const e1 = strength(ex, weeksTrained);
          const done = perform(ex, pe, w, hint, e1, profile);
          if (isTopSet(pe, 0) && loaded(ex) && done[0].weight != null) {
            backOffs++;
            check(moved(ex, done[1].weight!) <= moved(ex, done[0].weight), date, `${ex.id}: back-off set pre-filled at ${done[1].weight} after a ${done[0].weight} top set`);
          }
          for (const [i, c] of done.entries()) {
            await logSet(session, ex.id, pe.id, i, c, d);
            setsLogged++;
          }
        }
        await updateSession(session.id, { endedAt: new Date().toISOString(), beatUp: false }, d);
        workoutsDone++;
      }
    }

    const topSets = checkPlans(check, await liveBlocks(d), (await d.plannedWorkouts.toArray()).filter((w) => !w.deletedAt), byId);
    const rotated = await checkStalls(check, d, byId, profile);

    console.log(`simulated ${workoutsDone} workouts, ${setsLogged} sets, ${hintsChecked} hints, ${planned.length} plans, ${topSets} planned top sets (${backOffs} done), ${rotated} stall rotations; ${bad.length} violations`);
    expect(bad.slice(0, 20)).toEqual([]);
    // The rules under test actually came up: top sets were done and lifts rotated out as stalled.
    expect(backOffs).toBeGreaterThan(0);
    expect(rotated).toBeGreaterThan(0);
  }, 300_000);
});

type Check = (ok: boolean, date: string, what: string) => void;

/** Weight hints (§4.4, §4.5, §4.8). */
function checkHint(check: Check, date: string, ex: Exercise, w: PlannedWorkout, hint: WeightHint | null, history: ReturnType<typeof summarizeHistory>, deloads: Set<string>) {
  const name = `${ex.id} (${w.sessionType} ${w.zone})`;
  if (!hint) {
    check(!history.length, date, `${name}: no hint despite ${history.length} logged sessions`);
    return;
  }
  check(hint.suggest == null || (Number.isFinite(hint.suggest) && hint.suggest >= 0), date, `${name}: suggestion ${hint.suggest}`);
  check(hint.weight == null || (Number.isFinite(hint.weight) && hint.weight >= 0), date, `${name}: last weight ${hint.weight}`);
  check(!/NaN|undefined|Infinity/.test(hint.text), date, `${name}: hint text "${hint.text}"`);
  // Never built on a deload while a loading session exists.
  const loadingDates = new Set(history.filter((h) => !deloads.has(h.sessionId)).map((h) => h.date));
  const deloadDates = new Set(history.filter((h) => deloads.has(h.sessionId)).map((h) => h.date));
  check(!(loadingDates.size && deloadDates.has(hint.date) && !loadingDates.has(hint.date)), date, `${name}: hint from the deload of ${hint.date}`);
  if (hint.suggest == null || hint.weight == null || !loaded(ex)) return;
  const up = moved(ex, hint.suggest) - moved(ex, hint.weight);
  if (w.isDeload) {
    // A deload suggests less than the working weight, or the same when 10% is under half a step.
    check(up <= 0, date, `${name}: deload suggests ${hint.suggest} after ${hint.weight}`);
  } else {
    // At most one step up, and none after a set tapped Hard.
    check(up <= (ex.loadIncrementLb || 5) + 1e-9, date, `${name}: jumps from ${hint.weight} to ${hint.suggest}`);
    if (/that was Hard/.test(hint.text)) check(up <= 0, date, `${name}: Hard, yet suggests ${hint.suggest} after ${hint.weight}`);
  }
}

/** How the lifter trains a movement: the app's suggestion, else last time's weight, else a sensible first pick. */
function perform(ex: Exercise, pe: PlannedExercise, w: PlannedWorkout, hint: WeightHint | null, e1: number, profile: Profile): Partial<LoggedSet>[] {
  const last = pe.sets[pe.sets.length - 1];
  const target = last?.targetReps ?? pe.sets[0]?.targetReps;
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
    const reps = Math.max(1, Math.min(t.max, Math.floor(cap - ps.rir + rand())));
    const effort = cap - reps < 1 || badDay ? 'hard' : cap - reps > 4 ? 'easy' : 'right';
    return { weight: wi, reps, seconds: null, effort: tap ? effort : null };
  });
}

/** Plans (§4.1, §4.2, §4.8): well-formed workouts, deadlifts first, top sets only on settled lifts, blocks in order, muscles in band. */
function checkPlans(check: Check, blocks: Awaited<ReturnType<typeof liveBlocks>>, workouts: PlannedWorkout[], byId: Map<string, Exercise>): number {
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
  // Weekly sets per muscle stay within a set and a half of their bands in loading weeks.
  for (const b of blocks) {
    const mine = workouts.filter((w) => w.blockId === b.id && !w.isDeload);
    weeklySets(mine, byId).forEach((week, k) => {
      if (mine.every((w) => w.weekIndex !== k)) return;
      for (const [g, band] of Object.entries(BANDS)) {
        const n = week[g as keyof typeof week];
        check(n >= band![0] - 1.5 && n <= band![1] + 1.5, addDays(b.startDate, 7 * k), `block ${b.index} week ${k + 1}: ${g} at ${n} sets, band ${band![0]}–${band![1]}`);
      }
    });
  }
  return topSets;
}

/**
 * Stalls (§4.3), worked out again from the logs the planner had: a lift rotates out as stalled only when its
 * best e1RM over the loading sessions of the newest block it was trained in failed to beat the block before by
 * 1%, with 2 or more such sessions in each. This catches wiring slips (deloads counted, blocks out of order,
 * heavy compared with light) that the unit tests can't see.
 */
async function checkStalls(check: Check, d: GetFitDB, byId: Map<string, Exercise>, profile: Awaited<ReturnType<typeof getProfile>>): Promise<number> {
  const workouts = new Map((await d.plannedWorkouts.toArray()).map((w) => [w.id, w]));
  const sessions = new Map((await d.sessions.toArray()).map((s) => [s.id, s]));
  const blocks = new Map((await d.blocks.toArray()).map((b) => [b.id, b]));
  const sets = (await d.loggedSets.toArray()).filter((s) => !s.deletedAt);
  let rotated = 0;
  for (const { input, at } of planned) {
    for (const id of input.stalled ?? []) {
      rotated++;
      const ex = byId.get(id)!;
      const best = new Map<string, Map<string, number>>();
      for (const s of sets) {
        const w = workouts.get(sessions.get(s.sessionId)?.plannedWorkoutId ?? '');
        const e = setE1rm(ex, s, profile);
        if (s.exerciseId !== id || s.loggedAt > at || !w || w.isDeload || e == null) continue;
        const per = best.get(w.blockId) ?? new Map<string, number>();
        per.set(s.sessionId, Math.max(per.get(s.sessionId) ?? 0, e));
        best.set(w.blockId, per);
      }
      const [last, before] = [...best].sort((a, b) => blocks.get(b[0])!.startDate.localeCompare(blocks.get(a[0])!.startDate)).map(([, per]) => [...per.values()]);
      const ok = !!last && !!before && last.length >= 2 && before.length >= 2 && Math.max(...last) < Math.max(...before) * 1.01;
      check(ok, input.startDate, `${id} rotated out as stalled, but its logs say otherwise`);
    }
  }
  return rotated;
}
