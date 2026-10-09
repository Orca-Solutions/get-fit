// Property tests: the generator over a few hundred random setups (training days, gym and home kit,
// kettlebells, core wave, flags), not just the reference profile. Lifting days are at the gym until
// a day can be set to train at home, so home-only lifting isn't covered here (see generator.test.ts for thin kits).
import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/catalog';
import { addDays } from '../src/dates';
import { generateBlock, type ExerciseFlags, type GeneratedBlock } from '../src/generator/generateBlock';
import { neutralProfile } from '../src/profiles';
import type { Equipment, Profile, Weekday } from '../src/types';

/** Small seeded PRNG (mulberry32), so a failure names a seed that reproduces it. */
function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    pick: <T,>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)],
    chance: (p: number) => next() < p,
    shuffle: <T,>(xs: readonly T[]) => [...xs].map((x) => [next(), x] as const).sort((p, q) => p[0] - q[0]).map(([, x]) => x),
  };
}

const GYM: Equipment[] = ['dumbbell', 'kettlebell', 'cable', 'machine', 'smith-machine', 'bench', 'pull-up-bar', 'back-extension-bench', 'plate', 'mat', 'none'];
const HOME_EXTRAS: Equipment[] = ['band', 'kettlebell', 'ab-wheel', 'dumbbell', 'pull-up-bar'];
const NOW = '2026-10-07T00:00:00Z';

function randomProfile(seed: number): { profile: Profile; flags: ExerciseFlags } {
  const r = rng(seed);
  const days = r.shuffle([1, 2, 3, 4, 5, 6, 0] as Weekday[]);
  const [a, b, c] = days;
  const core: Weekday[] = r.chance(0.5) ? [days[3]] : [days[3], days[4]];
  const homeKit = [...new Set<Equipment>(['mat', 'none', ...HOME_EXTRAS.filter(() => r.chance(0.5))])];
  const kettlebells = homeKit.includes('kettlebell') ? r.pick([[{ lb: 25, count: 2 }], [{ lb: 35, count: 1 }], [{ lb: 25, count: 2 }, { lb: 35, count: 1 }], [{ lb: 20, count: 1 }, { lb: 30, count: 1 }]]) : [];
  const profile: Profile = {
    ...neutralProfile(NOW),
    schedule: [
      { weekdays: [a], type: 'chest-biceps', location: 'gym' },
      { weekdays: [b], type: 'legs', location: 'gym' },
      { weekdays: [c], type: 'back-tri-shoulders', location: 'gym' },
      { weekdays: core, type: 'core', location: r.chance(0.8) ? 'home' : 'gym' },
    ],
    // Gyms vary too: a few drop one non-essential piece of kit.
    equipmentByLocation: { gym: r.chance(0.3) ? GYM.filter((e) => e !== r.pick(['kettlebell', 'back-extension-bench', 'plate', 'pull-up-bar'])) : GYM, home: homeKit },
    kettlebells,
    smithBarLb: r.pick([15, 20, 25]),
    coreWave: r.chance(0.7) ? 'wave' : 'flat',
  };
  const flags: ExerciseFlags = {};
  for (let i = 0; i < r.pick([0, 0, 3, 8]); i++) flags[r.pick(CATALOG).id] = r.chance(0.5) ? { avoid: true } : { unavailableAt: [r.pick(['gym', 'home'] as const)] };
  return { profile, flags };
}

function chain(profile: Profile, flags: ExerciseFlags, n: number): GeneratedBlock[] {
  const out: GeneratedBlock[] = [];
  for (let i = 0; i < n; i++) {
    const prev = out[i - 1];
    out.push(generateBlock({ profile, flags, exercises: CATALOG, startDate: prev ? addDays(prev.block.startDate, 28) : '2026-10-12', previousBlock: prev?.block, now: NOW }));
  }
  return out;
}

const byId = new Map(CATALOG.map((e) => [e.id, e]));
const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

describe('generator over random setups', () => {
  it.each(SEEDS)('seed %i: a full, valid plan for 3 blocks', (seed) => {
    const { profile, flags } = randomProfile(seed);
    for (const { workouts } of chain(profile, flags, 3)) {
      expect(workouts).toHaveLength(16);
      for (const w of workouts) {
        const ids = w.exercises.map((e) => e.exerciseId);
        expect(new Set(ids).size, `${w.id}: repeats a movement`).toBe(ids.length);
        const kit = profile.equipmentByLocation[w.location];
        for (const id of ids) expect(byId.get(id)!.equipment.every((q) => kit.includes(q)), `${w.id}: ${id} needs kit not at ${w.location}`).toBe(true);
        const sets = w.exercises.reduce((n, e) => n + e.sets.length, 0);
        if (w.sessionType === 'core') expect(w.exercises).toHaveLength(8);
        else {
          expect(w.exercises.length, w.id).toBeGreaterThanOrEqual(6);
          expect(w.exercises.length, w.id).toBeLessThanOrEqual(9);
          expect(sets, w.id).toBeLessThanOrEqual(22);
          if (!w.isDeload) expect(sets, w.id).toBeGreaterThanOrEqual(12);
        }
      }
    }
  });
});
