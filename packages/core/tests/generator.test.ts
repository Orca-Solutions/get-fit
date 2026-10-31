import { describe, expect, it } from 'vitest';
import catalog from '../src/data/exercises.json';
import { BANDS, creditOf, groupOf, weeklySets, type CoverageGroup } from '../src/generator/coverage';
import { generateBlock, type GeneratorInput } from '../src/generator/generateBlock';
import { backOffLoad, deloadHint, e1rm, e1rmLoadHint, effectiveLoad, isOutgrown, isStalled, isToppedOut, isTopSet, lastTimeHint, summarizeHistory, withoutDeloads, withoutTopSet, workoutHint, type HintContext } from '../src/generator/progression';
import { referenceProfile } from '../src/profiles';
import { STRANGE_PERIODIZATION, type LiftDay, type Program } from '../src/program';
import { addDays } from '../src/dates';
import { parseKettlebells, readKettlebells } from '../src/kettlebells';
import type { Equipment, Exercise, LoggedSet, PlannedWorkout, Profile, Weekday } from '../src/types';

const exercises = catalog as unknown as Exercise[];
const byId = new Map(exercises.map((e) => [e.id, e]));
const profile = referenceProfile('2026-10-07T00:00:00Z');

function gen(extra: Partial<GeneratorInput> = {}) {
  return generateBlock({ profile, exercises, startDate: '2026-10-12', now: '2026-10-07T00:00:00Z', ...extra });
}

const totalSets = (w: PlannedWorkout) => w.exercises.reduce((n, e) => n + e.sets.length, 0);
const lifts = (ws: PlannedWorkout[]) => ws.filter((w) => w.sessionType !== 'core');

/**
 * Weeks and muscles outside their band, leaving out what the hinge schedule costs (§4.8): in the deadlift week,
 * back up to half a set under (Friday's heavy day has no room for another row set) and lower back up to 1.5
 * over (the RDL and deadlift share that week); in a week with only the RDL, lower back under its band but at
 * its floor or above (no lifting day that week has a slot for lower-back work).
 */
function outsideBands(g: { workouts: PlannedWorkout[]; coverage: { weeks: Record<CoverageGroup, number>[]; under: { week: number; group: CoverageGroup }[]; over: { week: number; group: CoverageGroup }[] } }) {
  const deadliftWeeks = new Set(g.workouts.filter((w) => w.exercises.some((e) => e.slot === 'back:deadlift')).map((w) => w.weekIndex));
  const sets = (o: { week: number; group: CoverageGroup }) => g.coverage.weeks[o.week][o.group];
  const cost = (o: { week: number; group: CoverageGroup }, side: 'under' | 'over') => side === 'under'
    ? (deadliftWeeks.has(o.week) && o.group === 'back' && sets(o) >= BANDS.back![0] - 0.5) || (o.group === 'lower-back' && sets(o) >= STRANGE_PERIODIZATION.params.floors['lower-back'])
    : deadliftWeeks.has(o.week) && o.group === 'lower-back' && sets(o) <= BANDS['lower-back']![1] + 1.5;
  return { under: g.coverage.under.filter((o) => !cost(o, 'under')), over: g.coverage.over.filter((o) => !cost(o, 'over')) };
}

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
    expect(block.rationale).toContain('same sets per muscle');
  });

  it('runs a Sun+Mon window from Sunday into the next Monday, not across the whole week', () => {
    const schedule = [...profile.schedule.filter((e) => e.type !== 'core'), { weekdays: [0, 1] as Weekday[], type: 'core', location: 'home' as const }];
    const core = gen({ profile: { ...profile, schedule } }).workouts.filter((w) => w.sessionType === 'core');
    expect(core.slice(0, 2).map((w) => [w.date, w.windowEnd])).toEqual([['2026-10-18', '2026-10-19'], ['2026-10-25', '2026-10-26']]);
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
    // Variety slots: none on heavy days, up to 1 on moderate and light days, filled by need.
    expect(h.exercises.filter((e) => e.role === 'V')).toHaveLength(0);
    expect(m.exercises.filter((e) => e.role === 'V').length).toBeLessThanOrEqual(1);
    expect(l.exercises.filter((e) => e.role === 'V').length).toBeLessThanOrEqual(1);
    expect(h.exercises[0].sets[0].targetReps).toEqual({ min: 6, max: 8 });
    expect(m.exercises[0].sets[0].targetReps).toEqual({ min: 8, max: 12 });
    expect(d.exercises).toHaveLength(6);
    expect(d.exercises.every((e) => e.sets.length === 2 && e.sets[0].rir === 4)).toBe(true);
  });

  it('gives the main lifts 3 sets or more on every loading day, light days included', () => {
    const light = lifts(workouts).filter((w) => w.zone === 'L');
    expect(light).toHaveLength(3);
    for (const w of lifts(workouts).filter((w) => !w.isDeload)) {
      // The third chest press and second back compound (":v:" slots) can give a set back for balance.
      for (const e of w.exercises.filter((e) => (e.role === 'P' || e.role === 'C') && !e.slot.includes(':v:'))) {
        expect(e.sets.length, `${w.date} ${e.exerciseId}`).toBeGreaterThanOrEqual(3);
      }
    }
    for (const w of light) expect(w.exercises.filter((e) => e.role !== 'G').length, w.date).toBeLessThanOrEqual(7);
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
      const base = (w: PlannedWorkout) => w.exercises.filter((e) => ['P', 'C', 'I'].includes(e.role) && !e.note?.startsWith('Stands in') && !e.note?.startsWith('Takes the place')).map((e) => `${e.slot}=${e.exerciseId}`);
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

  it('keeps every muscle inside its weekly band in every loading week, but for what the Friday deadlift costs', () => {
    expect(coverage.warnings).toEqual([]);
    expect(outsideBands({ workouts, coverage })).toEqual({ under: [], over: [] });
  });

  it('adds a third chest press on Monday and a second back compound on Friday, each from a new family', () => {
    const fam = (key: string) => byId.get(block.baseSlots[key])!;
    const press = fam('chest-biceps|chest:v:press-variant');
    expect(press.loadType).not.toBe('bodyweight');
    expect([fam('chest-biceps|chest:flat-press').family, fam('chest-biceps|chest:incline-press').family]).not.toContain(press.family);
    const row = fam('back-tri-shoulders|back:v:row-variant');
    expect([fam('back-tri-shoulders|back:vertical-pull').family, fam('back-tri-shoulders|back:horizontal-pull').family]).not.toContain(row.family);
    expect(Object.keys(block.baseSlots)).not.toContain('chest-biceps|biceps:stretch');
    expect(Object.keys(block.baseSlots)).not.toContain('back-tri-shoulders|triceps:pushdown');
  });

  it('only gives a variety slot to a muscle still under its band', () => {
    for (const w of lifts(workouts).filter((w) => !w.isDeload)) {
      for (const pe of w.exercises.filter((e) => e.role === 'V')) {
        const ex = byId.get(pe.exerciseId)!;
        // Without this movement, each banded main muscle it trains sat under the band's floor.
        for (const g of ex.primaryMuscles.map(groupOf).filter((g): g is CoverageGroup => !!g && !!BANDS[g])) {
          expect(coverage.weeks[w.weekIndex][g] - pe.sets.length, `${ex.id} on ${w.date}`).toBeLessThan(BANDS[g]![0]);
        }
      }
    }
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
    // The Friday deadlift (a swap, dumbbells first) isn't a starter.
    const base = Object.entries(block.baseSlots).filter(([k]) => !k.endsWith('|back:deadlift')).map(([, id]) => byId.get(id)!);
    const lifting = base.filter((e) => !e.slots.some((s) => s.startsWith('core:')));
    expect(lifting.filter((e) => e.starter).length).toBeGreaterThanOrEqual(lifting.length - 2);
  });
});

describe('generateBlock: later blocks', () => {
  const b1 = gen();
  const b2 = gen({ previousBlock: b1.block, startDate: '2026-11-09' });
  const b3 = gen({ previousBlock: b2.block, startDate: '2026-12-07' });

  it('rotates one or two base slots per lifting day, besides the slot that alternates every block', () => {
    expect(b2.block.index).toBe(2);
    for (const type of ['legs', 'chest-biceps', 'back-tri-shoulders']) {
      const keys = Object.keys(b1.block.baseSlots).filter((k) => k.startsWith(`${type}|`) && k !== 'legs|legs:single-leg');
      const changed = keys.filter((k) => b1.block.baseSlots[k] !== b2.block.baseSlots[k]);
      expect(changed.length, type).toBeGreaterThanOrEqual(1);
      expect(changed.length, type).toBeLessThanOrEqual(2);
    }
  });

  it('alternates leg day slot 3 between single-leg work and a sumo squat by block (§4.8)', () => {
    const blocks = [b1, b2, b3, gen({ previousBlock: b3.block, startDate: '2027-01-04' })];
    const slot3 = blocks.map((g) => byId.get(g.block.baseSlots['legs|legs:single-leg'])!);
    expect(slot3.map((e) => e.laterality === 'bilateral')).toEqual([false, true, false, true]);
    expect(slot3.filter((e) => e.laterality === 'bilateral').every((e) => e.family === 'sumo-squat')).toBe(true);
    // Slot 3's rep clamp holds for the sumo squat: 8–10 on the heavy day.
    const heavy = b2.workouts.find((w) => w.zone === 'H' && w.sessionType === 'legs')!;
    const sumo = heavy.exercises.find((e) => e.exerciseId === slot3[1].id)!;
    expect(sumo.sets[0].targetReps).toEqual({ min: 8, max: 10 });
  });

  it('keeps main presses two-sided: the press rotates to the seated DB press, never a one-arm free press (§4.3, rev 3.7)', () => {
    const blocks = [b1];
    for (let i = 1; i < 8; i++) blocks.push(gen({ previousBlock: blocks[i - 1].block, startDate: addDays(blocks[i - 1].block.startDate, 28) }));
    const press = blocks.map((g) => g.block.baseSlots['back-tri-shoulders|shoulders:vertical-press']);
    expect(press.slice(0, 3)).toEqual(['smith-overhead-press', 'smith-overhead-press', 'smith-overhead-press']);
    expect(press.slice(3)).toEqual(Array(5).fill('seated-dumbbell-shoulder-press'));
    const tpl = STRANGE_PERIODIZATION.days;
    for (const g of blocks) {
      for (const [key, id] of Object.entries(g.block.baseSlots)) {
        const [type, slot] = key.split('|');
        const base = (tpl[type] as LiftDay).base?.find((s) => s.key === slot);
        if (!base || !slot.includes('press')) continue;
        const e = byId.get(id)!;
        expect(e.laterality === 'unilateral' && e.stability === 'free', `${key}: ${id}`).toBe(false);
      }
    }
    // Supported one-arm main lifts still count.
    expect(b1.block.baseSlots['back-tri-shoulders|back:horizontal-pull']).toBe('one-arm-dumbbell-row');
  });

  it('starts sumo blocks on the dumbbell sumo squat and steps up to the Smith one once it is outgrown (§4.8)', () => {
    expect(b2.block.baseSlots['legs|legs:single-leg']).toBe('dumbbell-sumo-squat');
    const stepped = gen({ previousBlock: b1.block, startDate: '2026-11-09', outgrown: ['dumbbell-sumo-squat'] });
    expect(stepped.block.baseSlots['legs|legs:single-leg']).toBe('smith-sumo-squat');
  });

  it('puts the leg press on moderate and light days of sumo blocks: squat, sumo squat and leg press', () => {
    const legs = (zone: string) => b2.workouts.find((w) => w.sessionType === 'legs' && w.zone === zone)!;
    expect(legs('M').exercises.find((e) => e.role === 'V')?.exerciseId).toBe('leg-press');
    expect(legs('L').exercises.find((e) => e.role === 'V')?.exerciseId).toBe('leg-press');
  });

  it('gives the varietyFirst movements first claim on the variety slot in bilateral blocks only', () => {
    const legs = STRANGE_PERIODIZATION.days.legs as LiftDay;
    const program: Program = {
      ...STRANGE_PERIODIZATION,
      days: {
        ...STRANGE_PERIODIZATION.days,
        legs: { ...legs, base: legs.base.map((s) => (s.alternateLaterality ? { ...s, alternateLaterality: { varietyFirst: ['hip-abduction-machine'] } } : s)) },
      },
    };
    const one = gen({ program });
    const two = gen({ program, previousBlock: one.block, startDate: '2026-11-09' });
    const firstV = (g: typeof one) => g.workouts.filter((w) => w.sessionType === 'legs' && (w.zone === 'M' || w.zone === 'L')).map((w) => w.exercises.find((e) => e.role === 'V')?.exerciseId);
    expect(firstV(two)).toEqual(['hip-abduction-machine', 'hip-abduction-machine']);
    expect(firstV(one)).not.toContain('hip-abduction-machine');
  });

  it('rotates core variants every block', () => {
    const keys = Object.keys(b1.block.baseSlots).filter((k) => k.startsWith('core|'));
    const changed = keys.filter((k) => b1.block.baseSlots[k] !== b2.block.baseSlots[k]);
    expect(changed.length).toBeGreaterThanOrEqual(6);
  });

  it('adds a heavy top set from block 3, only on a logged lift that held the slot last block', () => {
    const heavyLegs = (g: typeof b1) => g.workouts.find((w) => w.zone === 'H' && w.sessionType === 'legs')!;
    const squat = b2.block.baseSlots['legs|legs:squat'];
    const logged = gen({ previousBlock: b2.block, startDate: '2026-12-07', known: [squat] });
    expect(heavyLegs(logged).exercises[0].exerciseId).toBe(squat);
    expect(heavyLegs(logged).exercises[0].sets[0].targetReps).toEqual({ min: 3, max: 5 });
    expect(heavyLegs(logged).exercises[0].note).toContain('Set 1 is a heavy top set');
    // 3–5 touches the back-off sets' 5–8 from block 3, and still reads as a top set.
    expect(heavyLegs(logged).exercises[0].sets[1].targetReps).toEqual({ min: 5, max: 8 });
    expect([0, 1].map((i) => isTopSet(heavyLegs(logged).exercises[0], i))).toEqual([true, false]);
    expect(heavyLegs(b1).exercises[0].sets[0].targetReps).toEqual({ min: 6, max: 8 });
    // Never logged: the first sets find its weight, no top set.
    expect(heavyLegs(b3).exercises[0].sets[0].targetReps).toEqual({ min: 5, max: 8 });
    // Logged, but new to the slot this block (the old squat stalled): no top set either.
    const rotated = gen({ previousBlock: b2.block, startDate: '2026-12-07', known: exercises.map((e) => e.id), stalled: [squat] });
    expect(heavyLegs(rotated).exercises[0].exerciseId).not.toBe(squat);
    expect(heavyLegs(rotated).exercises[0].sets[0].targetReps).toEqual(heavyLegs(rotated).exercises[0].sets[1].targetReps);
    expect(heavyLegs(rotated).exercises[0].note ?? '').not.toContain('top set');
    expect(isTopSet(heavyLegs(rotated).exercises[0], 0)).toBe(false);
    // Held the slot, but not logged in that block (a block nobody trained): no top set.
    const untrained = gen({ previousBlock: b2.block, startDate: '2026-12-07', known: [squat], trainedLastBlock: [] });
    expect(isTopSet(heavyLegs(untrained).exercises[0], 0)).toBe(false);
    expect(isTopSet(heavyLegs(gen({ previousBlock: b2.block, startDate: '2026-12-07', known: [squat], trainedLastBlock: [squat] })).exercises[0], 0)).toBe(true);
  });

  it('keeps every muscle inside its weekly band as blocks rotate', () => {
    for (const b of [b2, b3]) expect(outsideBands(b), `block ${b.block.index}`).toEqual({ under: [], over: [] });
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

  it('rotates a topped-out isolation lift with a note saying why, and keeps a topped-out main lift (§4.3)', () => {
    const curl = b1.block.baseSlots['chest-biceps|biceps:neutral'];
    const bench = b1.block.baseSlots['chest-biceps|chest:flat-press'];
    const next = gen({ previousBlock: b1.block, startDate: '2026-11-09', toppedOut: [curl, bench] });
    const pick = byId.get(next.block.baseSlots['chest-biceps|biceps:neutral'])!;
    expect(pick.id).not.toBe(curl);
    expect(next.block.rationale).toContain(`${byId.get(curl)!.name} kept reaching the top of its reps without a weight step it could make, so ${pick.name} takes its place this block.`);
    expect(next.block.baseSlots['chest-biceps|chest:flat-press']).toBe(bench);
  });
});

describe('generateBlock: flags never stop the plan', () => {
  const inSlot = (slot: string) => exercises.filter((e) => e.slots.includes(slot as never)).map((e) => e.id);
  const avoidAll = (ids: string[]) => Object.fromEntries(ids.map((id) => [id, { avoid: true }]));

  it('fills a slot whose whole pool is avoided with a related movement, and says so', () => {
    const { block, workouts } = gen({ flags: avoidAll(inSlot('legs:knee-flexion')) });
    const pick = byId.get(block.baseSlots['legs|legs:knee-flexion'])!;
    expect(inSlot('legs:knee-flexion')).not.toContain(pick.id);
    expect(pick.primaryMuscles).toContain('hamstrings');
    expect(block.rationale).toMatch(/Every knee flexion movement is flagged, so .+ fills that slot\./);
    expect(workouts.filter((w) => w.sessionType === 'legs').every((w) => w.exercises.some((e) => e.exerciseId === pick.id))).toBe(true);
  });

  it('keeps a flagged movement, with a notice, when nothing related is left', () => {
    const hamstrings = exercises.filter((e) => e.primaryMuscles.includes('hamstrings')).map((e) => e.id);
    const { block } = gen({ flags: avoidAll(hamstrings) });
    expect(inSlot('legs:knee-flexion')).toContain(block.baseSlots['legs|legs:knee-flexion']);
    expect(block.rationale).toMatch(/nothing similar is left, so .+ stays in/);
  });

  it('does the same for an emptied core pool at home', () => {
    const { block } = gen({ flags: avoidAll(inSlot('core:hip-flexion')) });
    expect(block.baseSlots['core|core:hip-flexion']).toBeTruthy();
    expect(block.rationale).toContain('Every hip flexion movement is flagged');
  });

  it("applies can't-do-here only where it was set", () => {
    const core = gen().block.baseSlots['core|core:anti-extension'];
    // Marked as not possible at the gym: still fine for the home core day.
    expect(gen({ flags: { [core]: { unavailableAt: ['gym'] } } }).block.baseSlots['core|core:anti-extension']).toBe(core);
    expect(gen({ flags: { [core]: { unavailableAt: ['home'] } } }).block.baseSlots['core|core:anti-extension']).not.toBe(core);
  });
});

describe('generateBlock: thin equipment never stops the plan', () => {
  const kit = (equipment: Equipment[], kettlebells: Profile['kettlebells'] = []): Profile => ({
    ...profile,
    equipmentByLocation: { gym: equipment, home: equipment },
    kettlebells,
  });
  const dumbbellsOnly = kit(['dumbbell', 'bench', 'mat', 'none']);
  const homeOnly = kit(['band', 'kettlebell', 'ab-wheel', 'mat', 'none'], [{ lb: 25, count: 2 }, { lb: 35, count: 1 }]);
  const chain = (p: Profile, count: number) => {
    const out: ReturnType<typeof generateBlock>[] = [];
    for (let i = 0; i < count; i++) {
      const prev = out[i - 1]?.block;
      out.push(gen({ profile: p, startDate: prev ? addDays(prev.startDate, 28) : '2026-10-12', previousBlock: prev }));
    }
    return out;
  };

  it('does calf raises on bodyweight with dumbbells but no step or plate', () => {
    const { block } = gen({ profile: dumbbellsOnly });
    expect(block.baseSlots['legs|legs:calf']).toBe('single-leg-calf-raise');
  });

  it('fills every slot with bands, kettlebells and bodyweight only, from the home pack', () => {
    for (const g of chain(homeOnly, 8)) expect(g.unfilledSlots).toEqual([]);
    const { block } = gen({ profile: homeOnly });
    expect(block.baseSlots['legs|legs:squat']).toBe('kettlebell-goblet-squat');
    expect(block.baseSlots['chest-biceps|chest:flat-press']).toBe('kettlebell-floor-press');
    expect(byId.get(block.baseSlots['back-tri-shoulders|back:vertical-pull'])!.equipment).toContain('band');
    expect(block.rationale).not.toContain('flagged');
  });

  it('keeps one-arm rows and pulldowns as home main lifts, but not the one-arm kettlebell press (§4.3, rev 3.7)', () => {
    const picks = chain(homeOnly, 8).flatMap((g) => Object.entries(g.block.baseSlots));
    const pulls = picks.filter(([k]) => k === 'back-tri-shoulders|back:vertical-pull' || k === 'back-tri-shoulders|back:horizontal-pull').map(([, id]) => id);
    expect(pulls).toContain('band-single-arm-pulldown');
    expect(pulls).toContain('kettlebell-bent-over-row');
    expect(picks.filter(([k]) => k.includes('press')).map(([, id]) => id)).not.toContain('kettlebell-overhead-press');
  });

  it('keeps the home pack out of a gym plan that has machines, cables or dumbbells for the slot', () => {
    const home = (id: string) => byId.get(id)!.tags.includes('home-pack');
    for (const g of chain(profile, 8)) {
      for (const w of g.workouts) for (const e of w.exercises) expect(home(e.exerciseId), e.exerciseId).toBe(false);
    }
  });

  it('plans 8 blocks on thin kits using only the equipment there is', () => {
    const kits = [dumbbellsOnly, homeOnly, kit(['mat', 'none']), kit(['band', 'none']), kit(['pull-up-bar', 'mat', 'none'])];
    for (const p of kits) {
      for (const { workouts } of chain(p, 8)) {
        for (const w of workouts) {
          for (const e of w.exercises) expect(byId.get(e.exerciseId)!.equipment.every((q) => p.equipmentByLocation[w.location].includes(q))).toBe(true);
        }
      }
    }
  });

  it('plans barbell movements only for a kit with a barbell', () => {
    const barbellKit = kit([...profile.equipmentByLocation.gym, 'barbell', 'rack']);
    const isBarbell = (id: string) => byId.get(id)!.equipment.includes('barbell');
    const withBar = chain(barbellKit, 4).flatMap((g) => g.workouts.flatMap((w) => w.exercises.map((e) => e.exerciseId)));
    expect(withBar.some(isBarbell)).toBe(true);
    const without = chain(profile, 4).flatMap((g) => g.workouts.flatMap((w) => w.exercises.map((e) => e.exerciseId)));
    expect(without.some(isBarbell)).toBe(false);
    // A barbell without a rack: deadlifts, rows and curls, but no squats or presses from the rack.
    const noRack = chain(kit([...profile.equipmentByLocation.gym, 'barbell']), 4).flatMap((g) => g.workouts.flatMap((w) => w.exercises.map((e) => e.exerciseId)));
    expect(noRack.every((id) => !byId.get(id)!.equipment.includes('rack'))).toBe(true);
  });

  it('keeps the main lifts at 3 sets or more on every loading day for 8 blocks, with or without a barbell', () => {
    for (const p of [profile, kit([...profile.equipmentByLocation.gym, 'barbell', 'rack'])]) {
      for (const g of chain(p, 8)) {
        for (const w of g.workouts.filter((w) => !w.isDeload && w.sessionType !== 'core')) {
          for (const e of w.exercises.filter((e) => (e.role === 'P' || e.role === 'C') && !e.slot.includes(':v:'))) {
            expect(e.sets.length, `block ${g.block.index} ${w.date} ${e.exerciseId}`).toBeGreaterThanOrEqual(3);
          }
        }
      }
    }
  });

  it('runs the barbell squat, bench, overhead press and row from block 1 with a bar and rack', () => {
    const { block } = gen({ profile: kit([...profile.equipmentByLocation.gym, 'barbell', 'rack']) });
    expect(block.baseSlots['legs|legs:squat']).toBe('barbell-back-squat');
    expect(block.baseSlots['chest-biceps|chest:flat-press']).toBe('barbell-bench-press');
    expect(block.baseSlots['back-tri-shoulders|shoulders:vertical-press']).toBe('barbell-overhead-press');
    expect(block.baseSlots['back-tri-shoulders|back:horizontal-pull']).toBe('barbell-bent-over-row');
    // The hinge stays a dumbbell RDL: a barbell deadlift or RDL would stack two fatigue-3 lifts with the squat (§4.6).
    expect(block.baseSlots['legs|legs:hinge']).toBe('dumbbell-romanian-deadlift');
  });

  it('leaves a slot out, and says so, when nothing at all fits', () => {
    const { block, workouts } = gen({ profile: kit([]) });
    expect(block.rationale).toContain('No squat movement fits your equipment, so this block leaves that slot out');
    expect(block.baseSlots['legs|legs:squat']).toBeUndefined();
    expect(workouts.flatMap((w) => w.exercises).every((e) => byId.get(e.exerciseId)!.equipment.length === 0)).toBe(true);
  });

  it('lists the slots it leaves out, so a product can say it cannot plan them', () => {
    const empty = gen({ profile: kit([]) });
    expect(empty.unfilledSlots).toContainEqual({ dayType: 'legs', slot: 'legs:squat', reason: 'equipment' });
    // One entry per day and slot, and exactly the base slots the block has no movement for.
    const keys = empty.unfilledSlots.map((u) => `${u.dayType}|${u.slot}`);
    expect(new Set(keys).size).toBe(keys.length);
    const days = Object.entries(STRANGE_PERIODIZATION.days).filter(([type]) => profile.schedule.some((s) => s.type === type));
    const baseKeys = days.flatMap(([type, d]) => (d.kind === 'lift' ? d.base.map((b) => `${type}|${b.key}`) : d.supersets.flatMap(([, a, b]) => [`${type}|core:${a}`, `${type}|core:${b}`])));
    expect(keys.sort()).toEqual(baseKeys.filter((k) => !empty.block.baseSlots[k]).sort());
    // A full gym and the thin kits that still fill every slot report nothing.
    expect(gen().unfilledSlots).toEqual([]);
    expect(gen({ profile: kit([...profile.equipmentByLocation.gym, 'barbell', 'rack']) }).unfilledSlots).toEqual([]);
  });
});

describe('generateBlock: deadlifts, RDLs and lower back (§4.8)', () => {
  const kit = (gym: Equipment[]): Profile => ({ ...profile, equipmentByLocation: { ...profile.equipmentByLocation, gym } });
  const barbellKit = kit([...profile.equipmentByLocation.gym, 'barbell', 'rack']);
  const chain = (n: number, extra: Partial<GeneratorInput> = {}) => {
    const out = [gen(extra)];
    for (let i = 1; i < n; i++) out.push(gen({ ...extra, previousBlock: out[i - 1].block, startDate: addDays(out[i - 1].block.startDate, 28) }));
    return out;
  };
  const reference = chain(8);
  const barbell = chain(8, { profile: barbellKit });
  const day = (g: { workouts: PlannedWorkout[] }, type: string, zone: string) => g.workouts.find((w) => w.sessionType === type && w.zone === zone)!;
  const deadlift = (w: PlannedWorkout) => w.exercises.find((e) => e.slot === 'back:deadlift');
  const deadliftIds = exercises.filter((e) => e.slots.includes('back:deadlift')).map((e) => e.id);

  it('runs the RDL on heavy and moderate leg days only; light and deload weeks swap it, and leg day never deadlifts', () => {
    for (const g of reference) {
      const legs = g.workouts.filter((w) => w.sessionType === 'legs');
      const rdl = legs.filter((w) => w.exercises.some((e) => byId.get(e.exerciseId)!.family === 'romanian-deadlift'));
      expect(rdl.map((w) => w.zone), `block ${g.block.index}`).toEqual(['H', 'M']);
      for (const w of legs) expect(w.exercises.some((e) => deadliftIds.includes(e.exerciseId)), w.focus).toBe(false);
      expect(day(g, 'legs', 'deload').exercises[1].note).toMatch(/^Stands in for .* in the deload week\./);
      expect(day(g, 'legs', 'L').exercises[1].note).toMatch(/^Stands in for .* on the light day\./);
    }
    // Dumbbells first, at a gym with a barbell too.
    expect(barbell.every((g) => g.block.baseSlots['legs|legs:hinge'] === 'dumbbell-romanian-deadlift')).toBe(true);
  });

  it('runs a 3-set dumbbell deadlift in place of the second row on the heavy Friday, never on light or deload weeks', () => {
    for (const g of reference) {
      const h = deadlift(day(g, 'back-tri-shoulders', 'H'))!;
      // Deadlifts always come first.
      expect(day(g, 'back-tri-shoulders', 'H').exercises[0], `block ${g.block.index}`).toBe(h);
      expect(h.exerciseId, `block ${g.block.index}`).toBe('dumbbell-deadlift');
      expect(h.role).toBe('C');
      expect(h.sets).toHaveLength(3);
      expect(h.note).toMatch(/^Takes the place of /);
      expect(day(g, 'back-tri-shoulders', 'H').exercises.some((e) => e.slot === 'back:v:row-variant')).toBe(false);
      for (const zone of ['L', 'deload']) {
        const w = day(g, 'back-tri-shoulders', zone);
        expect(deadlift(w), w.focus).toBeUndefined();
        expect(w.exercises.some((e) => e.slot === 'back:v:row-variant'), w.focus).toBe(true);
      }
      expect(g.block.baseSlots['back-tri-shoulders|back:deadlift']).toBe('dumbbell-deadlift');
    }
  });

  it('adds the moderate-Friday deadlift only when back stays at 9 or more and glutes and hamstrings at 12 or fewer', () => {
    let moderate = 0;
    for (const g of [...reference, ...barbell]) {
      const w = day(g, 'back-tri-shoulders', 'M');
      if (!deadlift(w)) continue;
      moderate++;
      expect(deadlift(w)!.sets).toHaveLength(3);
      expect(w.exercises[0], w.date).toBe(deadlift(w));
      expect(g.coverage.weeks[w.weekIndex].back, w.date).toBeGreaterThanOrEqual(9);
      expect(g.coverage.weeks[w.weekIndex]['glutes-hamstrings'], w.date).toBeLessThanOrEqual(12);
    }
    expect(moderate).toBeGreaterThan(0);
    // On the reference gym back sits too close to 9 for the swap: the moderate Friday keeps its row.
    expect(deadlift(day(reference[0], 'back-tri-shoulders', 'M'))).toBeUndefined();
  });

  it('opens the day with the deadlift and numbers the rest after it', () => {
    for (const g of [...reference, ...barbell]) {
      for (const w of g.workouts.filter(deadlift)) {
        expect(w.exercises[0].slot, w.date).toBe('back:deadlift');
        expect(w.exercises.map((e) => e.order)).toEqual(w.exercises.map((_, k) => k));
        expect(w.exercises.map((e) => e.id)).toEqual(w.exercises.map((_, k) => `${w.id}-${k}`));
        // The pull-up still leads the rest of the day.
        expect(w.exercises[1].role, w.date).toBe('P');
      }
    }
  });

  it('keeps the row every week when every deadlift is avoided, or none fits the equipment', () => {
    const avoided = gen({ flags: Object.fromEntries(deadliftIds.map((id) => [id, { avoid: true }])) });
    const noFit = gen({ profile: kit(['machine', 'cable', 'bench', 'pull-up-bar', 'plate', 'mat', 'none']) });
    for (const g of [avoided, noFit]) {
      expect(Object.keys(g.block.baseSlots)).not.toContain('back-tri-shoulders|back:deadlift');
      const fridays = g.workouts.filter((w) => w.sessionType === 'back-tri-shoulders');
      expect(fridays.some(deadlift)).toBe(false);
      expect(fridays.every((w) => w.exercises.some((e) => e.slot === 'back:v:row-variant'))).toBe(true);
    }
  });

  it('moves to the next deadlift when one is avoided, and to the Smith one once the dumbbells are outgrown', () => {
    expect(gen({ flags: { 'dumbbell-deadlift': { avoid: true } } }).block.baseSlots['back-tri-shoulders|back:deadlift']).toBe('smith-deadlift');
    expect(gen({ flags: { 'dumbbell-deadlift': { unavailableAt: ['gym'] } } }).block.baseSlots['back-tri-shoulders|back:deadlift']).toBe('smith-deadlift');
    expect(gen({ outgrown: ['dumbbell-deadlift'] }).block.baseSlots['back-tri-shoulders|back:deadlift']).toBe('smith-deadlift');
    expect(gen({ outgrown: ['dumbbell-romanian-deadlift'] }).block.baseSlots['legs|legs:hinge']).toBe('smith-romanian-deadlift');
    // Barbell lifts stay opt-in even once the Smith is outgrown too.
    const both = gen({ profile: barbellKit, outgrown: ['dumbbell-deadlift', 'smith-deadlift'] }).block.baseSlots['back-tri-shoulders|back:deadlift'];
    expect(both).toBe('smith-deadlift');
  });

  it('plans barbell deadlifts and RDLs only when the lifter marks them Favourite', () => {
    const fav = gen({ profile: barbellKit, flags: { 'barbell-deadlift': { favourite: true }, 'barbell-romanian-deadlift': { favourite: true } } });
    expect(fav.block.baseSlots['back-tri-shoulders|back:deadlift']).toBe('barbell-deadlift');
    expect(fav.block.baseSlots['legs|legs:hinge']).toBe('barbell-romanian-deadlift');
    expect(barbell[0].block.baseSlots['back-tri-shoulders|back:deadlift']).toBe('dumbbell-deadlift');
    // Without a barbell the Favourite can't be planned.
    expect(gen({ flags: { 'barbell-deadlift': { favourite: true } } }).block.baseSlots['back-tri-shoulders|back:deadlift']).toBe('dumbbell-deadlift');
  });

  it('counts lower back: deadlifts and back extensions 1, RDLs and swings 0.5, core work toward lower back only', () => {
    const lb = (id: string) => creditOf(byId.get(id)!).get('lower-back');
    expect([lb('dumbbell-deadlift'), lb('back-extension'), lb('superman-hold'), lb('bird-dog')]).toEqual([1, 1, 1, 1]);
    expect([lb('dumbbell-romanian-deadlift'), lb('kettlebell-swing')]).toEqual([0.5, 0.5]);
    expect(creditOf(byId.get('dumbbell-deadlift')!).get('back')).toBe(0.5);
    const core: PlannedWorkout = { ...reference[0].workouts[0], sessionType: 'core', weekIndex: 0, exercises: [{ id: 'k', exerciseId: 'superman-hold', slot: 'core:hip-extension', role: 'K', order: 0, sets: [{ setIndex: 0, rir: 2, restSec: 45 }, { setIndex: 1, rir: 2, restSec: 45 }] }] };
    const [wk] = weeklySets([core], byId);
    expect(wk['lower-back']).toBe(2);
    expect(wk['glutes-hamstrings']).toBe(0);
  });

  it('plans decline presses only where the place has a decline bench', () => {
    const others = exercises.filter((e) => e.slots.includes('chest:v:press-variant') && e.family !== 'decline-press').map((e) => e.id);
    const flags = Object.fromEntries(others.map((id) => [id, { avoid: true }]));
    const withBench = gen({ profile: kit([...profile.equipmentByLocation.gym, 'decline-bench']), flags });
    expect(byId.get(withBench.block.baseSlots['chest-biceps|chest:v:press-variant'])!.family).toBe('decline-press');
    const without = gen({ flags });
    expect(byId.get(without.block.baseSlots['chest-biceps|chest:v:press-variant'])?.family).not.toBe('decline-press');
  });
});

describe('generateBlock: weekly bands over many blocks', () => {
  // TODO: from block 6 Friday runs out of room (back 8 one week, triceps 10.5, rear delts about 2 from
  // block 8). Expected to fail until that's fixed; it.fails turns red once it passes, as a reminder.
  it.fails('keeps every muscle inside its weekly band for 10 chained blocks', () => {
    let prev = gen().block;
    for (let i = 2; i <= 10; i++) {
      const next = gen({ previousBlock: prev, startDate: addDays(prev.startDate, 28) });
      expect(next.coverage.under, `block ${i}`).toEqual([]);
      expect(next.coverage.over, `block ${i}`).toEqual([]);
      prev = next.block;
    }
  });
});

describe('kettlebells', () => {
  it('parses a pair and a single bell', () => {
    expect(parseKettlebells('25x2, 35')).toEqual([{ lb: 25, count: 2 }, { lb: 35, count: 1 }]);
    expect(parseKettlebells('35, 25 x 2, junk')).toEqual([{ lb: 25, count: 2 }, { lb: 35, count: 1 }]);
  });

  it('reads units, count-first pairs and kg, and reports what it could not read', () => {
    const pair25 = { lb: 25, count: 2 };
    expect(readKettlebells('35 lbs, 25lbs x2')).toEqual({ kettlebells: [pair25, { lb: 35, count: 1 }], skipped: [] });
    expect(readKettlebells('2 x 25').kettlebells).toEqual([pair25]);
    expect(readKettlebells('2 × 25 lb').kettlebells).toEqual([pair25]);
    expect(readKettlebells('16kg, 2x12 kg').kettlebells).toEqual([{ lb: 26, count: 2 }, { lb: 35, count: 1 }]);
    expect(readKettlebells('lbs')).toEqual({ kettlebells: [], skipped: ['lbs'] });
    expect(readKettlebells('25x1.5, 0').skipped).toEqual(['25x1.5', '0']);
    expect(readKettlebells(' , ')).toEqual({ kettlebells: [], skipped: [] });
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

  it('calls a movement outgrown after two topped-out sessions at Right or Easy with the same top weight', () => {
    const top = (w: number, reps: number, effort: 'easy' | 'right' | 'hard') => ({ weight: w, reps, effort, setIndex: 0 }) as LoggedSet;
    const mk = (...sessions: LoggedSet[][]) => sessions.map((sets, i) => ({ sessionId: `${i}`, date: `2026-10-0${9 - i}`, sets, bestE1rm: null }));
    const max = () => 10;
    expect(isOutgrown(mk([top(50, 10, 'right')], [top(50, 10, 'easy')]), max)).toBe(true);
    expect(isOutgrown(mk([top(50, 10, 'right')], [top(45, 10, 'right')]), max)).toBe(false);
    expect(isOutgrown(mk([top(50, 10, 'hard')], [top(50, 10, 'right')]), max)).toBe(false);
    expect(isOutgrown(mk([top(50, 9, 'right')], [top(50, 10, 'right')]), max)).toBe(false);
    expect(isOutgrown(mk([top(50, 10, 'right')]), max)).toBe(false);
    expect(isOutgrown(mk([top(50, 10, 'right')], [top(50, 10, 'right')]), () => undefined)).toBe(false);
  });

  it('suggests a deadlift load from the latest e1RM: one increment at most', () => {
    const dl = byId.get('dumbbell-deadlift')!;
    const smith = byId.get('smith-deadlift')!;
    const log = (ex: Exercise, date: string, weight: number, reps: number, effort: LoggedSet['effort']): LoggedSet => ({
      ...set('s', date, weight, reps), id: `${ex.id}-${date}`, exerciseId: ex.id, sessionId: `${ex.id}-${date}`, effort,
    });
    const hist = (ex: Exercise, ...sets: LoggedSet[]) => summarizeHistory(ex, sets, profile);
    // 60 × 6 at Right is an e1RM of 76; 5–8 reps at RIR 2 gives 61.6, rounded down to 60.
    expect(e1rmLoadHint(dl, hist(dl, log(dl, '2026-10-02', 60, 6, 'right')), { min: 5, max: 8 }, 2, '2026-10-16', profile)!.suggest).toBe(60);
    // Same e1RM across a different rep range: 8–12 at RIR 2 gives 57, rounded to 55.
    expect(e1rmLoadHint(dl, hist(dl, log(dl, '2026-10-02', 60, 6, 'right')), { min: 8, max: 12 }, 2, '2026-10-16', profile)!.suggest).toBe(55);
    // 40 × 15 at Easy points at 50, but one increment past last time is the most: 45.
    expect(e1rmLoadHint(dl, hist(dl, log(dl, '2026-10-02', 40, 15, 'easy')), { min: 5, max: 8 }, 2, '2026-10-16', profile)!.suggest).toBe(45);
    // Its own 95% after 3 weeks off is retired (§4.5 rev 3.9): long gaps are workoutHint's, for every lift.
    expect(e1rmLoadHint(dl, hist(dl, log(dl, '2026-09-01', 60, 6, 'right')), { min: 5, max: 8 }, 2, '2026-10-16', profile)!.suggest).toBe(60);
    // Smith plates: 100 + the 20 lb bar × 6 at Right is an e1RM of 152; 123.2 at 5–8, less the bar, is 100.
    expect(e1rmLoadHint(smith, hist(smith, log(smith, '2026-10-02', 100, 6, 'right')), { min: 5, max: 8 }, 2, '2026-10-16', profile)!.suggest).toBe(100);
    expect(e1rmLoadHint(dl, [], { min: 5, max: 8 }, 2, '2026-10-16', profile)).toBeNull();
  });

  it('holds the deadlift weight after a set tapped Hard instead of stepping up', () => {
    const dl = byId.get('dumbbell-deadlift')!;
    const sets = [0, 1].map((i): LoggedSet => ({ ...set('s', '2026-10-02', 80, 9, i), exerciseId: dl.id, effort: i ? 'hard' : 'right' }));
    // 80 × 9 points at 85 by e1RM, one increment up, but the Hard set holds it at 80, as the line says.
    const hint = e1rmLoadHint(dl, summarizeHistory(dl, sets, profile), { min: 5, max: 8 }, 2, '2026-10-16', profile)!;
    expect(hint.text).toBe('Last time at 5–8: 80 lb each · that was Hard, so hold this weight');
    expect(hint.suggest).toBe(80);
  });

  it('suggests about 10% under last time on deload weeks, rounded down to a real increment (§4.5)', () => {
    const hint = (weight: number | null) => ({ text: 'Last time', date: '2026-10-28', weight, suggest: weight == null ? undefined : weight + 5 });
    const lift = (id: string) => byId.get(id)!;
    // Dumbbells per hand: 90% of 45 is 40.5, so 40.
    expect(deloadHint(lift('dumbbell-romanian-deadlift'), hint(45), profile)!.suggest).toBe(40);
    // Where 10% is under half a step the weight stays: a 10 or 15 lb dumbbell doesn't lose a third or half.
    expect(deloadHint(lift('dumbbell-romanian-deadlift'), hint(10), profile)!.suggest).toBe(10);
    expect(deloadHint(lift('dumbbell-romanian-deadlift'), hint(15), profile)!.suggest).toBe(15);
    expect(deloadHint(lift('dumbbell-romanian-deadlift'), hint(25), profile)!.suggest).toBe(20);
    // Smith plates count the 20 lb bar: 90% of 100 + 20 is 108, less the bar is 88, so 85.
    expect(deloadHint(lift('smith-machine-squat'), hint(100), profile)!.suggest).toBe(85);
    // Machine stack in 10s: 90% of 120 is 108, so 100.
    const machine = exercises.find((e) => e.weightConvention === 'total' && e.loadIncrementLb === 10 && e.loadType === 'machine')!;
    expect(deloadHint(machine, hint(120), profile)!.suggest).toBe(100);
    // Assisted: more assistance. 168 lb with 60 assist moves 108; 90% is 97.2, so at least 70.8 assist, rounded up.
    const assisted = exercises.find((e) => e.weightConvention === 'assist')!;
    const inc = assisted.loadIncrementLb!;
    expect(deloadHint(assisted, hint(60), profile)!.suggest).toBe(Math.ceil((168 - 108 * 0.9) / inc) * inc);
    // Bands and bodyweight: no suggestion, the line stays.
    const band = exercises.find((e) => e.weightConvention === 'band')!;
    expect(deloadHint(band, { text: 'Last time: red band', date: '2026-10-28', bandId: 'red' }, profile)).toEqual({ text: 'Last time: red band', date: '2026-10-28', bandId: 'red', suggest: undefined });
    expect(deloadHint(lift('dumbbell-romanian-deadlift'), null, profile)).toBeNull();
  });

  it('keys the deload off the heaviest working weight at its reps in the last 3 weeks, not the light week before it', () => {
    const squat = byId.get('smith-machine-squat')!;
    const log = (date: string, weight: number, reps: number): LoggedSet => ({ ...set(date, date, weight, reps), exerciseId: squat.id });
    // Moderate week 80 plates × 10, light week 60 × 12, then the deload at 8–12: 90% of 80 + the 20 lb bar is 90 moved, 70 plates.
    const history = summarizeHistory(squat, [log('2026-10-21', 80, 10), log('2026-10-28', 60, 12), log('2026-09-20', 120, 10)], profile);
    const last = lastTimeHint(squat, history, { min: 8, max: 12 });
    expect(last!.weight).toBe(60);
    expect(deloadHint(squat, last, profile, { history, target: { min: 8, max: 12 }, date: '2026-11-04' })!.suggest).toBe(70);
    // Without the history it keys off last time.
    expect(deloadHint(squat, last, profile)!.suggest).toBe(50);
  });

  it('keys the deload off the moderate week, not the heavy week, and words the line from the same session', () => {
    const week = (id: string, date: string, weight: number, reps: number[]) => reps.map((r, i) => set(id, date, weight, r, i));
    // Heavy week's 8s at 70 overlap 8–12, but the moderate week at 55 × 10 is the one run at these reps.
    const history = summarizeHistory(curl, [...week('m', '2026-10-14', 55, [10, 10, 9]), ...week('l', '2026-10-21', 40, [15, 14, 13]), ...week('h', '2026-10-28', 70, [8, 8, 7])], profile);
    const target = { min: 8, max: 12 };
    const last = lastTimeHint(curl, history, target)!;
    expect(last.weight).toBe(70);
    const deload = deloadHint(curl, last, profile, { history, target, date: '2026-11-04' })!;
    expect(deload).toMatchObject({ text: 'Last time at 8–12: 55 lb each', date: '2026-10-14', weight: 55, suggest: 45 });
    // A Hard hold doesn't carry into the deload line.
    const held = { ...last, text: `${last.text} · that was Hard, so hold this weight` };
    expect(deloadHint(curl, held, profile)!.text).toBe('Last time at 8–12: 70 lb each');
  });

  it('builds the week after a deload on the loading weeks, not the lighter deload', () => {
    const bench = byId.get('barbell-bench-press')!;
    const week = (id: string, date: string, weight: number, reps: number[], effort: LoggedSet['effort']) =>
      reps.map((r, i): LoggedSet => ({ ...set(id, date, weight, r, i), exerciseId: bench.id, effort }));
    // A block's moderate, light and heavy weeks, then the deload's 2 × 12 at 110 tapped Easy.
    const history = summarizeHistory(bench, [
      ...week('m', '2026-09-14', 125, [10, 9, 8], 'right'), ...week('l', '2026-09-21', 125, [11, 10, 10], 'right'),
      ...week('h', '2026-09-28', 130, [8, 8, 8], 'right'), ...week('d', '2026-10-05', 110, [12, 12], 'easy'),
    ], profile);
    const target = { min: 8, max: 12 };
    // Read with the deload, the first moderate week of the next block would suggest 115, under every loading week.
    expect(lastTimeHint(bench, history, target)).toMatchObject({ weight: 110, suggest: 115 });
    const loading = withoutDeloads(history, (h) => h.sessionId === 'd');
    expect(loading.map((h) => h.sessionId)).toEqual(['h', 'l', 'm']);
    expect(lastTimeHint(bench, loading, target)).toMatchObject({ text: 'Last time at 8–12: 130 lb', weight: 130, suggest: undefined });
    // With nothing but a deload logged, it still has something to go on.
    expect(withoutDeloads(history.filter((h) => h.sessionId === 'd'), () => true)).toHaveLength(1);
  });

  it('holds the weight instead of suggesting more when a topped-out session had a Hard set', () => {
    const hardSet = (i: number, effort: LoggedSet['effort']) => ({ ...set('a', '2026-10-01', 80, 12, i), effort });
    const hard = lastTimeHint(curl, summarizeHistory(curl, [hardSet(0, 'hard'), hardSet(1, 'hard')], profile), { min: 8, max: 12 })!;
    expect(hard.suggest).toBeUndefined();
    expect(hard.text).toBe('Last time at 8–12: 80 lb each · that was Hard, so hold this weight');
    const right = lastTimeHint(curl, summarizeHistory(curl, [hardSet(0, 'right'), hardSet(1, undefined)], profile), { min: 8, max: 12 })!;
    expect(right.suggest).toBe(85);
    expect(right.text).toBe('Last time at 8–12: 80 lb each');
  });

  it('starts back-off sets about 10% under the top set', () => {
    expect(backOffLoad(byId.get('smith-machine-squat')!, 100, profile)).toBe(85);
    expect(backOffLoad(curl, 50, profile)).toBe(45);
    expect(backOffLoad(curl, 10, profile)).toBe(10);
    expect(backOffLoad(byId.get('band-chest-press')!, null, profile)).toBeNull();
  });

  it("calls a lift stalled only when a block's best e1RM fails to beat the block before, leaving out deloads", () => {
    // Newest first. Each session: [block, deload?, e1RM].
    const mk = (rows: [string, boolean, number][]) => {
      const history = rows.map(([, , v], i) => ({ sessionId: `${i}`, date: addDays('2026-12-31', -7 * i), sets: [], bestE1rm: v }));
      const place = new Map(rows.map(([blockId, deload], i) => [`${i}`, { blockId, deload }]));
      return [history, (h: { sessionId: string }) => place.get(h.sessionId)] as const;
    };
    // The review's case: weights up every week, so block 2's heavy day beats block 1's, though its light day and deload don't.
    expect(isStalled(...mk([['b2', true, 120], ['b2', false, 132], ['b2', false, 143], ['b2', false, 150], ['b1', true, 120], ['b1', false, 126], ['b1', false, 132], ['b1', false, 147]]))).toBe(false);
    // No gain block on block: stalled. Within 1% counts as no gain.
    expect(isStalled(...mk([['b2', false, 140], ['b2', false, 147.5], ['b1', false, 132], ['b1', false, 147]]))).toBe(true);
    expect(isStalled(...mk([['b2', false, 140], ['b2', false, 150], ['b1', false, 132], ['b1', false, 147]]))).toBe(false);
    // One block of history, a block with fewer than 2 loading sessions, or sessions off the plan: not stalled.
    expect(isStalled(...mk([['b1', false, 100], ['b1', false, 99], ['b1', false, 101]]))).toBe(false);
    expect(isStalled(...mk([['b2', false, 90], ['b2', true, 80], ['b1', false, 132], ['b1', false, 147]]))).toBe(false);
    expect(isStalled(mk([['b2', false, 90], ['b2', false, 91], ['b1', false, 132], ['b1', false, 147]])[0], () => undefined)).toBe(false);
  });

  it("calls a flat block topped out when its heaviest set reached the top of its reps at Right or Easy", () => {
    // Newest first: [block, deload?, weight, reps, effort], each planned at 10–15.
    const mk = (rows: [string, boolean, number, number, LoggedSet['effort']][]) => {
      const history = rows.map(([, , weight, reps, effort], i) => ({ sessionId: `${i}`, date: addDays('2026-12-31', -7 * i), sets: [{ weight, reps, effort, setIndex: 0 } as LoggedSet], bestE1rm: e1rm(weight, reps, 2) }));
      const place = new Map(rows.map(([blockId, deload], i) => [`${i}`, { blockId, deload }]));
      return [history, (h: { sessionId: string }) => place.get(h.sessionId), () => 15] as const;
    };
    // A 20 lb curl topped at 15 reps, Right, while the 25 lb bell is out of reach.
    expect(isToppedOut(...mk([['b2', false, 20, 15, 'right'], ['b2', false, 20, 14, 'hard'], ['b1', false, 20, 15, 'easy']]))).toBe(true);
    // Topped only at Hard, short of the top, or only on a lighter set: stuck, not waiting on a step.
    expect(isToppedOut(...mk([['b2', false, 20, 15, 'hard'], ['b2', false, 20, 14, 'right']]))).toBe(false);
    expect(isToppedOut(...mk([['b2', false, 20, 13, 'right'], ['b2', false, 20, 12, 'easy']]))).toBe(false);
    expect(isToppedOut(...mk([['b2', false, 20, 12, 'right'], ['b2', false, 15, 15, 'easy']]))).toBe(false);
    // The deload and the block before don't count: only the newest block's loading sessions do.
    expect(isToppedOut(...mk([['b2', true, 15, 15, 'easy'], ['b2', false, 20, 12, 'right'], ['b1', false, 20, 15, 'right']]))).toBe(false);
    expect(isToppedOut(mk([['b2', false, 20, 15, 'right']])[0], () => undefined, () => 15)).toBe(false);
  });

  it('orders blocks by their planned dates when an old workout is logged late', () => {
    // Newest session first, but its workout was planned in block 1: block 2 (150) still beats block 1 (147).
    const rows: [string, string, number][] = [['b1', '2026-10-01', 147], ['b2', '2026-11-05', 150], ['b2', '2026-10-29', 140], ['b1', '2026-10-08', 132]];
    const history = rows.map(([, , v], i) => ({ sessionId: `${i}`, date: addDays('2026-12-31', -7 * i), sets: [], bestE1rm: v }));
    const place = new Map(rows.map(([blockId, plannedDate], i) => [`${i}`, { blockId, deload: false, plannedDate }]));
    expect(isStalled(history, (h) => place.get(h.sessionId))).toBe(false);
    // Read by session dates alone, block 1 looks newest and fails to beat block 2.
    expect(isStalled(history, (h) => ({ ...place.get(h.sessionId)!, plannedDate: undefined }))).toBe(true);
  });
});


describe('workoutHint (§4.4)', () => {
  const rdl = byId.get('dumbbell-romanian-deadlift')!;
  const press = byId.get('leg-press')!;
  const range = (min: number, max: number) => ({ min, max });
  /** A logged session: `sets` of [weight, reps, effort], each planned at `target`. */
  const session = (ex: Exercise, id: string, date: string, target: { min: number; max: number }, sets: [number, number, LoggedSet['effort']][]) =>
    sets.map(([weight, reps, effort], i): LoggedSet => ({
      id: `${id}-${i}`, createdAt: date, updatedAt: date, deletedAt: null, sessionId: id, exerciseId: ex.id, plannedExerciseId: `${id}|${target.min}-${target.max}`,
      setIndex: i, weight, reps, effort, date, loggedAt: `${date}T10:0${i}:00Z`,
    }));
  const targetOf = (s: LoggedSet) => { const [min, max] = s.plannedExerciseId!.split('|')[1].split('-').map(Number); return { min, max }; };
  const plan = (target: { min: number; max: number }, rir: number, n = 3) => ({ slot: 'legs:hinge', sets: Array.from({ length: n }, (_, i) => ({ setIndex: i, targetReps: target, rir, restSec: 90 })) });
  const hint = (ex: Exercise, sets: LoggedSet[], pe: ReturnType<typeof plan>, o: { deload?: boolean; targets?: boolean; date?: string; ctx?: Partial<HintContext> & { blockId?: string } } = {}) =>
    workoutHint(ex, pe, summarizeHistory(ex, sets, profile), { deload: !!o.deload, isDeload: () => false, targetOf: o.targets === false ? undefined : targetOf, date: o.date ?? '2026-10-16', profile, ...o.ctx });
  /** A heavy day: a 3–5 top set, then back-off sets at 5–8. */
  const squat = byId.get('smith-machine-squat')!;
  const topDay = (n = 4) => ({ slot: 'legs:squat', sets: Array.from({ length: n }, (_, i) => ({ setIndex: i, targetReps: i ? range(5, 8) : range(3, 5), rir: 2, restSec: 150 })) });
  const heavySession = (date: string, top: [number, number], back: [number, number][], effort: LoggedSet['effort'] = 'right') => [
    ...session(squat, `h${date}`, date, range(3, 5), [[...top, effort]]),
    ...session(squat, `h${date}`, date, range(5, 8), back.map(([w, r]) => [w, r, effort] as [number, number, LoggedSet['effort']])).map((s, i) => ({ ...s, id: `h${date}-b${i}`, setIndex: i + 1, loggedAt: `${date}T10:1${i}:00Z` })),
  ];

  it('suggests from e1RM when last time ran other reps: the moderate week after a heavy week', () => {
    const heavy = session(rdl, 'h', '2026-10-09', range(5, 8), [[30, 8, 'right'], [30, 8, 'right'], [30, 7, 'right']]);
    // 30 × 8 at Right is an e1RM of 40; 8–12 at RIR 3 gives 29.3, so 25, under the heavy week's 30.
    expect(hint(rdl, heavy, plan(range(8, 12), 3))).toMatchObject({ text: 'Last time at 5–8: 30 lb each', suggest: 25 });
    // Without the planned targets it reads the 8s as "at 8–12" and suggests nothing, as before.
    expect(hint(rdl, heavy, plan(range(8, 12), 3), { targets: false })).toMatchObject({ text: 'Last time at 8–12: 30 lb each', suggest: undefined });
  });

  it('goes up as far as e1RM says when the reps drop: the heavy week after a light week', () => {
    const light = session(press, 'l', '2026-10-09', range(12, 20), [[100, 20, 'right'], [100, 18, 'right']]);
    // 100 × 20 at Right is an e1RM of 173; 5–8 at RIR 2, plus a rep in reserve for the drop in reps, gives 136.8:
    // 130, well past one increment over 100.
    expect(hint(press, light, plan(range(5, 8), 2, 2))).toMatchObject({ text: 'Last time at 12–20: 100 lb', suggest: 130 });
  });

  it('holds the step up when the next weight is too big a jump to make the bottom of the range', () => {
    const topped = (ex: Exercise, w: number) => session(ex, 's', '2026-10-09', range(10, 15), [[w, 15, 'right'], [w, 15, 'right']]);
    // 20 × 15 at Right is an e1RM of 31.3; 25 lb for 10 reps at RIR 2 needs 35, so more reps first.
    expect(hint(rdl, topped(rdl, 20), plan(range(10, 15), 2, 2))).toMatchObject({
      text: 'Last time at 10–15: 20 lb each · the next weight up is a big jump, so aim for 16–18 reps first', suggest: undefined,
    });
    // A 10 lb step on a 100 lb leg press lands: an e1RM of 156.7 carries 110 for 10 at RIR 2 (154).
    expect(hint(press, topped(press, 100), plan(range(10, 15), 2, 2))!.suggest).toBe(110);
  });

  it('steps up a heavy day when its top set reaches the top of its own range, with the back-off weight to match', () => {
    // Smith squat, top set 100 lb of plates × 5 at Right, back-offs 90 × 8: the 3–5 top set topped out, so 105, and
    // back-offs about 90% of the 125 lb moved, less the bar: 92.5, so 90.
    const h = heavySession('2026-10-09', [100, 5], [[90, 8], [90, 8], [90, 7]]);
    expect(hint(squat, h, topDay())).toMatchObject({ text: 'Top set last time: 100 lb plates × 5', suggest: 105, backOff: 90 });
    // Two back-off sets under 5 reps hold it, top set or not.
    const short = heavySession('2026-10-09', [100, 5], [[90, 4], [90, 4], [90, 6]]);
    expect(hint(squat, short, topDay())).toMatchObject({ text: 'Top set last time: 100 lb plates × 5 · two sets fell short of the range, so hold this weight', suggest: undefined, backOff: 85 });
  });

  it('never steps up after a session logged short of its planned sets', () => {
    const one = session(rdl, 's', '2026-10-09', range(8, 12), [[60, 12, 'right']]);
    expect(hint(rdl, one, plan(range(8, 12), 2))!.suggest).toBeUndefined();
    // The same set, when one set was all the plan asked for.
    expect(hint(rdl, one, plan(range(8, 12), 2), { ctx: { setsPlanned: () => 1 } })!.suggest).toBe(65);
  });

  it('reads the least-assisted set as the heaviest on an assisted machine', () => {
    const pull = byId.get('assisted-pull-up')!;
    const sets = session(pull, 'a', '2026-10-09', range(8, 12), [[50, 12, 'right'], [40, 12, 'right'], [40, 12, 'right']]);
    expect(hint(pull, sets, plan(range(8, 12), 2))).toMatchObject({ text: 'Last time at 8–12: 40 lb assist', suggest: 30 });
    expect(lastTimeHint(pull, summarizeHistory(pull, sets, profile), range(8, 12))).toMatchObject({ text: 'Last time at 8–12: 40 lb assist', suggest: 30 });
  });

  it('eases back in after a gap in logged work: 10% after 10 days, 20% after 4 weeks, a fresh start after 8 (§4.5 rev 3.9)', () => {
    const last = session(rdl, 's', '2026-10-02', range(8, 12), [[60, 12, 'right'], [60, 12, 'right']]);
    const at = (date: string, ctx?: Partial<HintContext>) => hint(rdl, last, plan(range(8, 12), 2, 2), { date, ctx });
    // A week on: the usual step up.
    expect(at('2026-10-09')!.suggest).toBe(65);
    // 12 days: 90% of 60 is 54, so 50, and no step up.
    expect(at('2026-10-14')).toMatchObject({ text: 'Last time at 8–12: 60 lb each · first session back after 12 days, so about 10% lighter', suggest: 50 });
    // 5 weeks: 80%, 48, so 45.
    expect(at('2026-11-06')).toMatchObject({ text: 'Last time at 8–12: 60 lb each · first session back after 5 weeks, so about 20% lighter', suggest: 45 });
    // 9 weeks: no number; the weight is found again like a new lift's.
    expect(at('2026-12-04')).toMatchObject({ text: 'Last time at 8–12: 60 lb each · first session back after 9 weeks: ramp up across sets to a weight that leaves about 3 reps in the tank', suggest: undefined });
    // A gap the plan made (nothing planned for this lift was missed, and other work was logged) is no time off.
    expect(at('2026-10-30', { timeOffFrom: () => undefined })!.suggest).toBe(65);
    // So is a cadence the plan runs (the RDL that skips light weeks, the Friday deadlift): it stayed in every block.
    expect(at('2026-10-30', { timeOffFrom: () => undefined, rotatedOut: () => false })!.suggest).toBe(65);
    // Rotated out for a block, though, and back 4+ weeks on, its number is stale: 95% of 60 is 57, so 55, no step up.
    const rotated = { timeOffFrom: () => undefined, rotatedOut: () => true };
    expect(at('2026-10-30', rotated)).toMatchObject({ text: 'Last time at 8–12: 60 lb each · first time in 4 weeks, so about 5% lighter', suggest: 55 });
    expect(at('2026-12-04', rotated)).toMatchObject({ text: expect.stringContaining('first time in 9 weeks, so about 5% lighter'), suggest: 55 });
    // Under 4 weeks it isn't stale yet.
    expect(at('2026-10-23', rotated)!.suggest).toBe(65);
    // A deload week is lighter already.
    expect(hint(rdl, last, plan(range(10, 15), 4, 2), { date: '2026-10-30', deload: true, ctx: rotated })).toMatchObject({ text: 'Last time at 10–15: 60 lb each', suggest: 50 });
    // Rotated out, then due and missed once 10 days before coming back: 10 + 7 days off, not the whole gap.
    expect(at('2026-12-04', { timeOffFrom: () => '2026-11-17' })).toMatchObject({ text: expect.stringContaining('after 2 weeks, so about 10% lighter') });
  });

  it('drops the heavy top set for the rest of the block after 4+ weeks off', () => {
    const h = heavySession('2026-09-01', [100, 5], [[90, 8], [90, 8], [90, 8]]);
    const back = hint(squat, h, topDay(), { date: '2026-10-09' })!;
    expect(back).toMatchObject({ noTopSet: true, backOff: undefined });
    expect(withoutTopSet(topDay()).sets[0]).toEqual({ setIndex: 0, targetReps: range(5, 8), rir: 2, restSec: 150 });
    // Later in the same block, after the return session was logged.
    const ret = session(squat, 'r', '2026-10-09', range(5, 8), [[80, 8, 'right'], [80, 8, 'right'], [80, 8, 'right'], [80, 8, 'right']]);
    const blockOf = (x: { sessionId: string }) => (x.sessionId === 'r' ? 'b2' : 'b1');
    expect(hint(squat, [...h, ...ret], topDay(), { date: '2026-10-16', ctx: { blockOf, blockId: 'b2' } })!.noTopSet).toBe(true);
    // Next block, it's back.
    expect(hint(squat, [...h, ...ret], topDay(), { date: '2026-10-23', ctx: { blockOf, blockId: 'b3' } })!.noTopSet).toBeUndefined();
  });

  it('never comes back after a gap at a weight last time fell well short with, however coarse the steps', () => {
    // Leg extension in 10 lb steps, 40 × 6 twice for 8–12: 10% of 40 rounds back to 40, but 40 × 6 (e1RM 48) carries 36
    // for 8 at RIR 2, so 30, and the line says how much lighter that really is. The same after a stale number.
    const ext = byId.get('leg-extension')!;
    const short = session(ext, 'x', '2026-10-02', range(8, 12), [[40, 6, 'right'], [40, 6, 'right']]);
    expect(hint(ext, short, plan(range(8, 12), 2, 2), { date: '2026-10-14' })).toMatchObject({ text: 'Last time at 8–12: 40 lb · first session back after 12 days, so about 25% lighter', suggest: 30 });
    expect(hint(ext, short, plan(range(8, 12), 2, 2), { date: '2026-10-30', ctx: { timeOffFrom: () => undefined, rotatedOut: () => true } })).toMatchObject({ text: expect.stringContaining('first time in 4 weeks, so about 25% lighter'), suggest: 30 });
  });

  it('never walks down a lift the plan runs weeks apart (the Friday deadlift, the heavy-week RDL)', () => {
    // Topped 5–8 at 200 four weeks ago, its next week: the step, not 5% off it.
    const dl = byId.get('smith-deadlift')!;
    const pull = session(dl, 'd', '2026-10-02', range(5, 8), [[200, 8, 'right'], [200, 8, 'right'], [200, 8, 'right']]);
    const cadence = { timeOffFrom: () => undefined, rotatedOut: () => false };
    const friday = { slot: 'back:deadlift', sets: plan(range(5, 8), 2).sets };
    expect(hint(dl, pull, friday, { date: '2026-10-30', ctx: cadence })).toMatchObject({ text: 'Last time at 5–8: 200 lb plates', suggest: 205 });
    // RDL topped at 8–12, then the heavy week at 5–8 three weeks on: 65, as a week apart.
    const r = session(rdl, 'r', '2026-10-02', range(8, 12), [[60, 12, 'right'], [60, 12, 'right'], [60, 12, 'right']]);
    expect(hint(rdl, r, plan(range(5, 8), 2), { date: '2026-10-23', ctx: cadence })!.suggest).toBe(65);
    expect(hint(rdl, r, plan(range(5, 8), 2), { date: '2026-10-09', ctx: cadence })!.suggest).toBe(65);
  });

  it('climbs a lift that comes round once every 4 weeks and tops out, and never cuts it twice running', () => {
    // Every set at the top of 8–12 tapped Easy, the suggestion taken each visit, 28 days apart.
    const visits = (rotatedOut: () => boolean) => {
      const sets: LoggedSet[] = [];
      const out = [60];
      for (let k = 0; k < 6; k++) {
        const date = addDays('2026-01-05', 28 * k);
        if (k) out.push(hint(rdl, sets, plan(range(8, 12), 2), { date, ctx: { timeOffFrom: () => undefined, rotatedOut } })!.suggest ?? out[k - 1]);
        sets.push(...session(rdl, `v${k}`, date, range(8, 12), [[out[k], 12, 'easy'], [out[k], 12, 'easy'], [out[k], 12, 'easy']]));
      }
      return out;
    };
    // The plan's own rhythm: a step every visit.
    expect(visits(() => false)).toEqual([60, 65, 70, 75, 80, 85]);
    // Rotated out between every visit: one 5% cut, then that's its rhythm, so a step every visit after.
    expect(visits(() => true)).toEqual([60, 55, 60, 65, 70, 75]);
  });

  it('steps a lift that topped out when today asks no more reps, or asks for more reps when the step is too big', () => {
    // 30 lb hammer curls topped at 12–15; today 10–15 at RIR 1. e1RM from 15 reps says 30, but the range was topped,
    // so the step: 35 for 10 at RIR 1 needs an e1RM of 47.8, more than 30 × 15 shows (45), so more reps first.
    const curl = byId.get('cross-body-hammer-curl')!;
    const h = session(curl, 'c', '2026-10-09', range(12, 15), [[30, 15, 'right'], [30, 15, 'right']]);
    expect(hint(curl, h, plan(range(10, 15), 1, 2))).toMatchObject({ text: expect.stringContaining('the next weight up is a big jump, so aim for 16–18 reps first'), suggest: undefined });
    // Not topped: the e1RM's number stands.
    const short = session(curl, 'c', '2026-10-09', range(12, 15), [[30, 14, 'right'], [30, 13, 'right']]);
    expect(hint(curl, short, plan(range(10, 15), 1, 2))!.suggest).toBe(30);
  });

  it('keeps the top set for a lift back from rotation, about 5% lighter with the back-offs to match', () => {
    const h = heavySession('2026-09-01', [100, 5], [[90, 8], [90, 8], [90, 8]]);
    // A block rotated out, 4 weeks: 95% of the 125 lb moved is 118.75, less the bar, so 90; back-offs 90% of 115, less the bar: 75.
    const back = hint(squat, h, topDay(), { date: '2026-09-29', ctx: { timeOffFrom: () => undefined, rotatedOut: () => true } })!;
    expect(back).toMatchObject({ text: 'Top set last time: 100 lb plates × 5 · first time in 4 weeks, so about 5% lighter', suggest: 90, backOff: 75 });
    expect(back.noTopSet).toBeUndefined();
  });

  it('keeps a deload suggestion under what e1RM carries when last time was too heavy for the reps', () => {
    const heavy = session(rdl, 'h', '2026-10-09', range(5, 8), [[40, 5, 'right']]);
    // 10% off 40 is 35, but 40 × 5 is an e1RM of 49.3, which carries 33.6 for 10 at RIR 4: 30.
    expect(hint(rdl, heavy, plan(range(10, 15), 4, 2), { deload: true })!.suggest).toBe(30);
  });
});

describe('generateBlock: eight blocks in a row', () => {
  const blocks = [gen()];
  for (let i = 1; i < 8; i++) blocks.push(gen({ previousBlock: blocks[i - 1].block, startDate: addDays(blocks[i - 1].block.startDate, 28) }));

  it('keeps axial hinges off light and deload days, variety slots included (§4.1, §4.8)', () => {
    for (const g of blocks) {
      for (const w of lifts(g.workouts).filter((w) => w.zone === 'L' || w.isDeload)) {
        for (const pe of w.exercises) {
          const ex = byId.get(pe.exerciseId)!;
          expect(ex.movementPattern === 'hinge' && ex.axialLoad, `block ${g.block.index}: ${ex.id} on ${w.focus}`).toBe(false);
        }
      }
    }
  });

  it('rotates at most one main-lift slot per day at a boundary (§4.3)', () => {
    for (let i = 1; i < blocks.length; i++) {
      for (const [type, day] of Object.entries(STRANGE_PERIODIZATION.days)) {
        if (day.kind !== 'lift') continue;
        const changed = day.base.filter((s) => (s.role === 'P' || s.role === 'C') && !s.alternateLaterality
          && blocks[i - 1].block.baseSlots[`${type}|${s.key}`] !== blocks[i].block.baseSlots[`${type}|${s.key}`]);
        expect(changed.length, `block ${i + 1} ${type}: ${changed.map((s) => s.key)}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it('rotates a stalled lift away from the families later slots ran, so they keep theirs (§4.3)', () => {
    // The stalled Smith bench would take the machine press from the third chest press, which would then rotate too.
    const b2 = gen({ previousBlock: blocks[0].block, startDate: blocks[1].block.startDate, stalled: ['smith-bench-press'] });
    expect(b2.block.baseSlots['chest-biceps|chest:flat-press']).toBe('dumbbell-bench-press');
    expect(b2.block.baseSlots['chest-biceps|chest:v:press-variant']).toBe(blocks[0].block.baseSlots['chest-biceps|chest:v:press-variant']);
  });
});
