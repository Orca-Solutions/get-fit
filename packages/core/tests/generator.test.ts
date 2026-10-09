import { describe, expect, it } from 'vitest';
import catalog from '../src/data/exercises.json';
import { BANDS, creditOf, groupOf, weeklySets, type CoverageGroup } from '../src/generator/coverage';
import { generateBlock, type GeneratorInput } from '../src/generator/generateBlock';
import { e1rm, e1rmLoadHint, effectiveLoad, isOutgrown, isStalled, lastTimeHint, summarizeHistory } from '../src/generator/progression';
import { referenceProfile } from '../src/profiles';
import { STRANGE_PERIODIZATION, type LiftDay, type Program } from '../src/program';
import { addDays } from '../src/dates';
import { parseKettlebells } from '../src/kettlebells';
import type { Equipment, Exercise, LoggedSet, PlannedWorkout, Profile } from '../src/types';

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

  it('adds the Anatoly-style top set from block 3', () => {
    const heavy = b3.workouts.find((w) => w.zone === 'H' && w.sessionType === 'legs')!;
    expect(heavy.exercises[0].sets[0].targetReps).toEqual({ min: 3, max: 5 });
    const heavy1 = b1.workouts.find((w) => w.zone === 'H' && w.sessionType === 'legs')!;
    expect(heavy1.exercises[0].sets[0].targetReps).toEqual({ min: 6, max: 8 });
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
      expect(g.coverage.weeks[w.weekIndex].back, w.date).toBeGreaterThanOrEqual(9);
      expect(g.coverage.weeks[w.weekIndex]['glutes-hamstrings'], w.date).toBeLessThanOrEqual(12);
    }
    expect(moderate).toBeGreaterThan(0);
    // On the reference gym back sits too close to 9 for the swap: the moderate Friday keeps its row.
    expect(deadlift(day(reference[0], 'back-tri-shoulders', 'M'))).toBeUndefined();
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

  it('suggests a deadlift load from the latest e1RM: one increment at most, about 95% after 3 weeks off', () => {
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
    // More than 3 weeks off: 95% of 61.6 is 58.5, rounded down to 55.
    expect(e1rmLoadHint(dl, hist(dl, log(dl, '2026-09-01', 60, 6, 'right')), { min: 5, max: 8 }, 2, '2026-10-16', profile)!.suggest).toBe(55);
    // Smith plates: 100 + the 20 lb bar × 6 at Right is an e1RM of 152; 123.2 at 5–8, less the bar, is 100.
    expect(e1rmLoadHint(smith, hist(smith, log(smith, '2026-10-02', 100, 6, 'right')), { min: 5, max: 8 }, 2, '2026-10-16', profile)!.suggest).toBe(100);
    expect(e1rmLoadHint(dl, [], { min: 5, max: 8 }, 2, '2026-10-16', profile)).toBeNull();
  });

  it('flags a movement as stalled after 3 exposures without a gain', () => {
    const mk = (vals: number[]) => vals.map((v, i) => ({ sessionId: `${i}`, date: `2026-10-0${9 - i}`, sets: [], bestE1rm: v }));
    expect(isStalled(mk([100, 100, 99, 101]))).toBe(true);
    expect(isStalled(mk([105, 100, 99, 101]))).toBe(false);
    expect(isStalled(mk([100, 100, 100]))).toBe(false);
  });
});

