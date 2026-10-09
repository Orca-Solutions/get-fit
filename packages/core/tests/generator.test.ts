import { describe, expect, it } from 'vitest';
import catalog from '../src/data/exercises.json';
import { BANDS, groupOf, type CoverageGroup } from '../src/generator/coverage';
import { generateBlock, type GeneratorInput } from '../src/generator/generateBlock';
import { e1rm, effectiveLoad, isOutgrown, isStalled, lastTimeHint, summarizeHistory } from '../src/generator/progression';
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

  it('keeps every muscle inside its weekly band in every loading week', () => {
    expect(coverage.warnings).toEqual([]);
    expect(coverage.under).toEqual([]);
    expect(coverage.over).toEqual([]);
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
    const base = Object.values(block.baseSlots).map((id) => byId.get(id)!);
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

  it('starts sumo blocks on the dumbbell sumo squat and steps up to the Smith one once it is outgrown (§4.8)', () => {
    expect(b2.block.baseSlots['legs|legs:single-leg']).toBe('dumbbell-sumo-squat');
    const stepped = gen({ previousBlock: b1.block, startDate: '2026-11-09', outgrown: ['dumbbell-sumo-squat'] });
    expect(stepped.block.baseSlots['legs|legs:single-leg']).toBe('smith-sumo-squat');
  });

  it('puts the leg press on light days of sumo blocks, and leaves moderate days at squat plus sumo squat', () => {
    const legs = (zone: string) => b2.workouts.find((w) => w.sessionType === 'legs' && w.zone === zone)!;
    expect(legs('L').exercises.find((e) => e.role === 'V')?.exerciseId).toBe('leg-press');
    expect(legs('M').exercises.some((e) => e.role === 'V')).toBe(false);
  });

  it('gives the varietyFirst movements first claim on the variety slot in bilateral blocks only', () => {
    const legs = STRANGE_PERIODIZATION.days.legs as LiftDay;
    const program: Program = {
      ...STRANGE_PERIODIZATION,
      days: {
        ...STRANGE_PERIODIZATION.days,
        legs: { ...legs, base: legs.base.map((s) => (s.alternateLaterality ? { ...s, alternateLaterality: { varietyFirst: ['cable-hip-adduction'] } } : s)) },
      },
    };
    const one = gen({ program });
    const two = gen({ program, previousBlock: one.block, startDate: '2026-11-09' });
    const firstV = (g: typeof one) => g.workouts.filter((w) => w.sessionType === 'legs' && (w.zone === 'M' || w.zone === 'L')).map((w) => w.exercises.find((e) => e.role === 'V')?.exerciseId);
    expect(firstV(two)).toEqual(['cable-hip-adduction', 'cable-hip-adduction']);
    expect(firstV(one)).not.toContain('cable-hip-adduction');
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
    for (const b of [b2, b3]) {
      expect(b.coverage.under, `block ${b.block.index}`).toEqual([]);
      expect(b.coverage.over, `block ${b.block.index}`).toEqual([]);
    }
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

  it('flags a movement as stalled after 3 exposures without a gain', () => {
    const mk = (vals: number[]) => vals.map((v, i) => ({ sessionId: `${i}`, date: `2026-10-0${9 - i}`, sets: [], bestE1rm: v }));
    expect(isStalled(mk([100, 100, 99, 101]))).toBe(true);
    expect(isStalled(mk([105, 100, 99, 101]))).toBe(false);
    expect(isStalled(mk([100, 100, 100]))).toBe(false);
  });
});

