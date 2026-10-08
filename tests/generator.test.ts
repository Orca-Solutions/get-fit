import { describe, expect, it } from 'vitest';
import catalog from '../src/data/exercises.json';
import { generateBlock, type GeneratorInput } from '../src/generator/generateBlock';
import { e1rm, effectiveLoad, isStalled, lastTimeHint, summarizeHistory } from '../src/generator/progression';
import { defaultProfile } from '../src/lib/defaultProfile';
import { parseKettlebells } from '../src/lib/kettlebells';
import type { Exercise, LoggedSet, PlannedWorkout } from '../src/types';

const exercises = catalog as unknown as Exercise[];
const byId = new Map(exercises.map((e) => [e.id, e]));
const profile = defaultProfile('2026-10-07T00:00:00Z');

function gen(extra: Partial<GeneratorInput> = {}) {
  return generateBlock({ profile, exercises, startDate: '2026-10-12', now: '2026-10-07T00:00:00Z', ...extra });
}

const totalSets = (w: PlannedWorkout) => w.exercises.reduce((n, e) => n + e.sets.length, 0);
const lifts = (ws: PlannedWorkout[]) => ws.filter((w) => w.sessionType !== 'core');

describe('generateBlock: block 1', () => {
  const { block, workouts, coverage } = gen();

  it('places 4 weeks of Mon/Wed/Fri lifting (legs midweek) and a Sat–Sun core window', () => {
    expect(workouts).toHaveLength(16);
    expect(workouts.slice(0, 4).map((w) => [w.date, w.sessionType])).toEqual([
      ['2026-10-12', 'chest-biceps'],
      ['2026-10-14', 'legs'],
      ['2026-10-16', 'back-tri-shoulders'],
      ['2026-10-17', 'core'],
    ]);
    expect(workouts[3].windowEnd).toBe('2026-10-18');
    expect(block.index).toBe(1);
    expect(block.focusMuscle).toBe('side-delts');
  });

  it('rotates zones by one day each week, then deloads', () => {
    const zones = (type: string) => workouts.filter((w) => w.sessionType === type).map((w) => w.zone);
    expect(zones('legs')).toEqual(['H', 'M', 'L', 'deload']);
    expect(zones('chest-biceps')).toEqual(['M', 'L', 'H', 'deload']);
    expect(zones('back-tri-shoulders')).toEqual(['L', 'H', 'M', 'deload']);
    // Each loading week has one heavy, one moderate and one light lifting day.
    for (let week = 0; week < 3; week++) expect(lifts(workouts).filter((w) => w.weekIndex === week).map((w) => w.zone).sort()).toEqual(['H', 'L', 'M']);
  });

  it('keeps every lifting session to 6–8 movements and 12–22 sets', () => {
    for (const w of lifts(workouts)) {
      const moves = w.exercises.filter((e) => e.role !== 'G').length;
      expect(moves, w.focus).toBeGreaterThanOrEqual(6);
      expect(moves, w.focus).toBeLessThanOrEqual(8);
      expect(totalSets(w), w.focus).toBeGreaterThanOrEqual(12);
      expect(totalSets(w), w.focus).toBeLessThanOrEqual(22);
    }
  });

  it('shapes heavy, moderate and light days differently', () => {
    const legs = workouts.filter((w) => w.sessionType === 'legs');
    const [h, m, l, d] = legs;
    expect(h.exercises.filter((e) => e.role === 'V')).toHaveLength(0);
    expect(m.exercises.filter((e) => e.role === 'V')).toHaveLength(1);
    expect(l.exercises.filter((e) => e.role === 'V')).toHaveLength(2);
    expect(h.exercises[0].sets[0].targetReps).toEqual({ min: 6, max: 8 });
    expect(m.exercises[0].sets[0].targetReps).toEqual({ min: 8, max: 12 });
    expect(d.exercises).toHaveLength(6);
    expect(d.exercises.every((e) => e.sets.length === 2 && e.sets[0].rir === 4)).toBe(true);
  });

  it('adds a grip finisher, last, only on moderate and light days', () => {
    for (const w of lifts(workouts)) {
      const grip = w.exercises.filter((e) => e.role === 'G');
      if (w.zone === 'M' || w.zone === 'L') {
        expect(grip, w.focus).toHaveLength(1);
        expect(w.exercises[w.exercises.length - 1].role).toBe('G');
      } else expect(grip, w.focus).toHaveLength(0);
    }
  });

  it('runs the effort ramp RIR 3 → 2 → 1–2 → deload', () => {
    const legs = workouts.filter((w) => w.sessionType === 'legs');
    expect(legs.map((w) => w.exercises[0].sets[0].rir)).toEqual([3, 2, 2, 4]);
    expect(legs[2].exercises.find((e) => e.role === 'I')!.sets[0].rir).toBe(1);
  });

  it('never repeats a movement within a session and uses only equipment at that location', () => {
    for (const w of workouts) {
      const ids = w.exercises.map((e) => e.exerciseId);
      expect(new Set(ids).size, w.focus).toBe(ids.length);
      const have = profile.equipmentByLocation[w.location];
      for (const id of ids) expect(byId.get(id)!.equipment.every((q) => have.includes(q)), `${id} at ${w.location}`).toBe(true);
    }
  });

  it('keeps base movements fixed for the block, except light-day stand-ins', () => {
    for (const type of ['legs', 'chest-biceps', 'back-tri-shoulders']) {
      const weeks = workouts.filter((w) => w.sessionType === type);
      const base = (w: PlannedWorkout) => w.exercises.filter((e) => ['P', 'C', 'I'].includes(e.role) && !e.note?.startsWith('Stands in')).map((e) => `${e.slot}=${e.exerciseId}`);
      const all = new Set(weeks.flatMap(base));
      expect(all.size, type).toBe(6);
    }
  });

  it('never programs an axial hinge on a light day', () => {
    for (const w of lifts(workouts).filter((w) => w.zone === 'L')) {
      for (const pe of w.exercises) {
        const ex = byId.get(pe.exerciseId)!;
        expect(ex.movementPattern === 'hinge' && ex.axialLoad, `${ex.id} on ${w.focus}`).toBe(false);
      }
    }
  });

  it('covers all 8 core dynamics at home in 4 supersets every week', () => {
    const core = workouts.filter((w) => w.sessionType === 'core');
    expect(core.map((w) => w.zone)).toEqual(['M', 'H', 'L', 'deload']);
    for (const w of core) {
      expect(new Set(w.exercises.map((e) => e.slot)).size).toBe(8);
      expect(new Set(w.exercises.map((e) => e.supersetGroup))).toEqual(new Set(['A', 'B', 'C', 'D']));
      expect(w.location).toBe('home');
      expect(w.exercises.every((e) => e.sets.length === (w.isDeload ? 1 : 2))).toBe(true);
    }
  });

  it('meets the weekly floors and the block average for major muscles', () => {
    expect(coverage.warnings).toEqual([]);
    for (const g of ['quads', 'glutes-hamstrings', 'chest', 'back', 'side-delts', 'biceps', 'triceps'] as const) {
      expect(coverage.average[g], g).toBeGreaterThanOrEqual(6);
    }
  });

  it('gives the focus muscle (side delts) a variety slot on moderate and light days', () => {
    const fri = workouts.filter((w) => w.sessionType === 'back-tri-shoulders' && (w.zone === 'M' || w.zone === 'L'));
    for (const w of fri) expect(w.exercises.some((e) => e.role === 'V' && e.note?.startsWith('Focus'))).toBe(true);
  });

  it('derives ids from dates so two devices generate the same records', () => {
    expect(block.id).toBe('block-2026-10-12');
    expect(workouts[0].id).toBe('w-2026-10-12-chest-biceps');
    expect(workouts[0].exercises[1].id).toBe('w-2026-10-12-chest-biceps-1');
    expect(new Set(workouts.flatMap((w) => w.exercises.map((e) => e.id))).size).toBe(workouts.reduce((n, w) => n + w.exercises.length, 0));
  });

  it('is deterministic for the same inputs', () => {
    const again = gen();
    expect(again.workouts.map((w) => w.exercises.map((e) => e.exerciseId))).toEqual(workouts.map((w) => w.exercises.map((e) => e.exerciseId)));
  });

  it('prefers starter movements in block 1', () => {
    const base = Object.values(block.baseSlots).map((id) => byId.get(id)!);
    const lifting = base.filter((e) => !e.slots.some((s) => s.startsWith('core:')));
    expect(lifting.filter((e) => e.starter).length).toBeGreaterThanOrEqual(lifting.length - 2);
  });
});

describe('generateBlock: later blocks', () => {
  const b1 = gen();
  const b2 = gen({ previousBlock: b1.block, startDate: '2026-11-09' });
  const b3 = gen({ previousBlock: b2.block, startDate: '2026-12-07' });

  it('rotates one or two base slots per lifting day and moves the focus', () => {
    expect(b2.block.index).toBe(2);
    expect(b2.block.focusMuscle).toBe('chest');
    for (const type of ['legs', 'chest-biceps', 'back-tri-shoulders']) {
      const keys = Object.keys(b1.block.baseSlots).filter((k) => k.startsWith(`${type}|`));
      const changed = keys.filter((k) => b1.block.baseSlots[k] !== b2.block.baseSlots[k]);
      expect(changed.length, type).toBeGreaterThanOrEqual(1);
      expect(changed.length, type).toBeLessThanOrEqual(2);
    }
  });

  it('rotates core variants every block', () => {
    const keys = Object.keys(b1.block.baseSlots).filter((k) => k.startsWith('core|'));
    const changed = keys.filter((k) => b1.block.baseSlots[k] !== b2.block.baseSlots[k]);
    expect(changed.length).toBeGreaterThanOrEqual(6);
  });

  it('adds the Anatoly-style top set from block 3', () => {
    const heavy = b3.workouts.find((w) => w.zone === 'H' && w.sessionType === 'legs')!;
    expect(heavy.exercises[0].sets[0].targetReps).toEqual({ min: 3, max: 5 });
    const heavy1 = b1.workouts.find((w) => w.zone === 'H' && w.sessionType === 'legs')!;
    expect(heavy1.exercises[0].sets[0].targetReps).toEqual({ min: 6, max: 8 });
  });

  it('keeps sessions within 22 sets as volume ramps', () => {
    for (const w of lifts(b3.workouts)) expect(totalSets(w)).toBeLessThanOrEqual(22);
  });

  it('skips avoided movements and rotates stalled ones', () => {
    const squat = b1.block.baseSlots['legs|legs:squat'];
    const avoided = gen({ flags: { [squat]: { avoid: true } } });
    expect(avoided.block.baseSlots['legs|legs:squat']).not.toBe(squat);
    const curl = b1.block.baseSlots['chest-biceps|biceps:neutral'];
    const next = gen({ previousBlock: b1.block, startDate: '2026-11-09', stalled: [curl] });
    expect(next.block.baseSlots['chest-biceps|biceps:neutral']).not.toBe(curl);
  });
});

describe('kettlebells', () => {
  it('parses a pair and a single bell', () => {
    expect(parseKettlebells('25x2, 35')).toEqual([{ lb: 25, count: 2 }, { lb: 35, count: 1 }]);
    expect(parseKettlebells('35, 25 x 2, junk')).toEqual([{ lb: 25, count: 2 }, { lb: 35, count: 1 }]);
  });

  it('only programs double-bell moves when there is a matched pair', () => {
    const singles = { ...profile, kettlebells: [{ lb: 25, count: 1 }, { lb: 35, count: 1 }] };
    for (let b = 0, prev: GeneratorInput['previousBlock']; b < 5; b++) {
      const r = gen({ profile: singles, previousBlock: prev, startDate: '2026-10-12' });
      expect(r.workouts.flatMap((w) => w.exercises).some((e) => e.exerciseId === 'double-kettlebell-front-rack-carry')).toBe(false);
      prev = r.block;
    }
  });
});

describe('progression', () => {
  it('computes e1RM with reps in reserve', () => {
    expect(e1rm(135, 8, 3)).toBeCloseTo(184.5);
  });

  it('adds the Smith bar and subtracts assistance', () => {
    expect(effectiveLoad({ weightConvention: 'added', loadType: 'smith' }, 90, profile)).toBe(110);
    expect(effectiveLoad({ weightConvention: 'assist', loadType: 'assisted' }, 60, profile)).toBe(108);
    expect(effectiveLoad({ weightConvention: 'band', loadType: 'band' }, null, profile)).toBeNull();
  });

  const curl = exercises.find((e) => e.weightConvention === 'per-hand' && e.metric === 'reps')!;
  const set = (sessionId: string, date: string, weight: number, reps: number, setIndex = 0): LoggedSet => ({
    id: `${sessionId}-${setIndex}`, createdAt: date, updatedAt: date, deletedAt: null, sessionId, exerciseId: curl.id, plannedExerciseId: null,
    setIndex, weight, reps, date, loggedAt: `${date}T10:0${setIndex}:00Z`,
  });

  it('hints last time at a similar rep count, and suggests an increment after topping out', () => {
    const history = summarizeHistory(curl, [set('a', '2026-10-01', 25, 12), set('a', '2026-10-01', 25, 12, 1), set('b', '2026-10-08', 30, 6)], profile);
    const hint = lastTimeHint(curl, history, { min: 10, max: 12 })!;
    expect(hint.text).toBe('Last time at 10–12: 25 lb each');
    expect(hint.suggest).toBe(30);
    const heavy = lastTimeHint(curl, history, { min: 5, max: 8 })!;
    expect(heavy.text).toBe('Last time at 5–8: 30 lb each');
    expect(heavy.suggest).toBeUndefined();
  });

  it('falls back to the newest session when no rep count is close', () => {
    const history = summarizeHistory(curl, [set('a', '2026-10-01', 25, 12)], profile);
    expect(lastTimeHint(curl, history, { min: 3, max: 5 })!.text).toBe('Last time: 25 lb each × 12');
  });

  it('flags a movement as stalled after 3 exposures without a gain', () => {
    const mk = (vals: number[]) => vals.map((v, i) => ({ sessionId: `${i}`, date: `2026-10-0${9 - i}`, sets: [], bestE1rm: v }));
    expect(isStalled(mk([100, 100, 99, 101]))).toBe(true);
    expect(isStalled(mk([105, 100, 99, 101]))).toBe(false);
    expect(isStalled(mk([100, 100, 100]))).toBe(false);
  });
});

