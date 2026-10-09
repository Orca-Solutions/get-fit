import { describe, expect, it } from 'vitest';
import { CATALOG } from '../src/catalog';
import { generateBlock } from '../src/generator/generateBlock';
import { referenceProfile } from '../src/profiles';
import { STRANGE_PERIODIZATION, validateProgram, type LiftDay, type Program } from '../src/program';

const NOW = '2026-10-07T00:00:00Z';
const profile = referenceProfile(NOW);
const gen = (program?: Program, p = profile) => generateBlock({ profile: p, program, exercises: CATALOG, startDate: '2026-10-12', now: NOW });

describe('Program', () => {
  it('the original program fits the catalog and the reference schedule', () => {
    expect(validateProgram(STRANGE_PERIODIZATION, CATALOG, profile.schedule.map((s) => s.type))).toEqual([]);
  });

  it('is the default, and every block records which program planned it', () => {
    const { block } = gen();
    expect(block).toMatchObject({ programId: 'strange-periodization', programVersion: STRANGE_PERIODIZATION.version });
    expect(gen(STRANGE_PERIODIZATION).workouts).toEqual(gen().workouts);
  });

  it('reports what would stop a program from planning', () => {
    const broken: Program = {
      ...STRANGE_PERIODIZATION,
      days: { ...STRANGE_PERIODIZATION.days, legs: { kind: 'lift', label: 'Legs', base: [{ key: 'legs:nothing', role: 'C' }], varietyPool: [], zones: ['H', 'M'] } },
    };
    expect(validateProgram(broken, CATALOG, ['legs', 'full-body'])).toEqual([
      'schedule: day type "full-body" is not in program strange-periodization',
      'legs: zones must list weeks 1 to 3',
      'legs: needs a primary (P) slot',
      'legs base: no movement is tagged for slot "legs:nothing"',
    ]);
  });

  it('plans from the numbers in the program, not constants', () => {
    const p = STRANGE_PERIODIZATION.params;
    const lighter: Program = { ...STRANGE_PERIODIZATION, id: 'test', params: { ...p, rest: { ...p.rest, core: 30 }, varietySlots: { H: 0, M: 0, L: 0 }, grip: null } };
    const { workouts } = gen(lighter);
    expect(workouts.filter((w) => w.sessionType === 'core').every((w) => w.exercises.every((e) => e.sets.every((s) => s.restSec === 30)))).toBe(true);
    expect(workouts.some((w) => w.exercises.some((e) => e.role === 'G'))).toBe(false);
  });

  it('lets a program name its own day types', () => {
    const { core, ...lifts } = STRANGE_PERIODIZATION.days;
    const renamed: Program = { ...STRANGE_PERIODIZATION, days: { ...lifts, trunk: core } };
    const schedule = profile.schedule.map((s) => (s.type === 'core' ? { ...s, type: 'trunk' } : s));
    const { workouts } = gen(renamed, { ...profile, schedule });
    const trunk = workouts.filter((w) => w.sessionType === 'trunk');
    expect(trunk).toHaveLength(4);
    expect(trunk[0].exercises).toHaveLength(8);
    expect(trunk[0].id).toBe(`w-${trunk[0].date}-trunk`);
  });

  it('says which day type is missing instead of planning around it', () => {
    const { core: _, ...lifts } = STRANGE_PERIODIZATION.days;
    expect(() => gen({ ...STRANGE_PERIODIZATION, days: lifts })).toThrow('schedule: day type "core" is not in program strange-periodization');
  });

  it('checks a program passed in, and names the slot no movement is tagged for', () => {
    const legs = STRANGE_PERIODIZATION.days.legs as LiftDay;
    const days = { ...STRANGE_PERIODIZATION.days, legs: { ...legs, base: [...legs.base, { key: 'legs:sled-push', role: 'I' as const }] } };
    expect(() => gen({ ...STRANGE_PERIODIZATION, days })).toThrow('legs base: no movement is tagged for slot "legs:sled-push"');
  });
});
