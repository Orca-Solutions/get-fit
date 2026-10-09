// Golden test: the plan Jason's profile gets for blocks 1 to 8 is pinned, so moving the training rules
// around (into a package, into a Program) can't change a single planned set. Regenerate the fixture
// only for an intended rule change: GOLDEN_UPDATE=1 npx vitest run tests/golden.test.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import catalog from '../src/data/exercises.json';
import { generateBlock, type ExerciseFlags, type GeneratedBlock, type GeneratorInput } from '../src/generator/generateBlock';
import { referenceProfile } from '../src/profiles';
import { addDays } from '../src/dates';
import type { Exercise, Profile } from '../src/types';

const FIXTURE = new URL('./golden/blocks.json', import.meta.url);
const exercises = catalog as unknown as Exercise[];
const NOW = '2026-10-07T00:00:00Z';
const jason = referenceProfile(NOW);

type Lived = (prev: GeneratedBlock[]) => Partial<GeneratorInput>;

/** Blocks chained the way the app chains them: each starts the Monday after the last one ends. */
function chain(profile: Profile, count: number, lived: Lived = () => ({})): GeneratedBlock[] {
  const out: GeneratedBlock[] = [];
  for (let i = 0; i < count; i++) {
    const prev = out[i - 1];
    out.push(generateBlock({ profile, exercises, startDate: prev ? addDays(prev.block.startDate, 28) : '2026-10-12', previousBlock: prev?.block, now: NOW, ...lived(out) }));
  }
  return out;
}

const inSlot = (slot: string) => exercises.filter((e) => e.slots.includes(slot as never)).map((e) => e.id);

/** A plan that has been lived in: everything logged, some lifts stalled, flags, an early deload. */
const lived: Lived = (prev) => {
  if (!prev.length) return {};
  const last = prev[prev.length - 1].block;
  const first = prev[0].block.baseSlots;
  const flags: ExerciseFlags = {
    [first['back-tri-shoulders|shoulders:side-delt']]: { avoid: true },
    [first['core|core:anti-extension']]: { unavailableAt: ['home'] },
    [first['chest-biceps|chest:incline-press']]: { unavailableAt: ['gym'] },
    [first['legs|legs:calf']]: { favourite: true },
  };
  return {
    flags,
    known: [...new Set(prev.flatMap((g) => g.workouts.flatMap((w) => w.exercises.map((e) => e.exerciseId))))],
    stalled: last.index % 2 ? [last.baseSlots['chest-biceps|biceps:neutral'], last.baseSlots['legs|legs:squat']] : [],
    recoveryOk: last.index % 3 !== 0,
  };
};

const scenarios: Record<string, () => GeneratedBlock[]> = {
  'jason, blocks 1-8': () => chain(jason, 8),
  'jason, blocks 1-8, lived in': () => chain(jason, 8, lived),
  'jason, flat core': () => chain({ ...jason, coreWave: 'flat' }, 2),
  'jason, a whole slot avoided': () => chain(jason, 2, () => ({ flags: Object.fromEntries(inSlot('legs:knee-flexion').map((id) => [id, { avoid: true }])) })),
};

const digest = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');

/** One line per planned movement, so a failure shows what changed; the digest covers everything else. */
function summary(g: GeneratedBlock): string[] {
  return g.workouts.flatMap((w) => [
    `${w.date} ${w.sessionType} ${w.zone ?? ''} ${w.location}`,
    ...w.exercises.map((e) => {
      const s = e.sets[0];
      const target = s?.targetReps ? `${s.targetReps.min}-${s.targetReps.max}` : s?.targetSeconds ? `${s.targetSeconds.min}-${s.targetSeconds.max}s` : '';
      return `  ${e.role} ${e.exerciseId} ${e.sets.length}x${target} rir ${s?.rir} rest ${s?.restSec}${e.supersetGroup ? ` ${e.supersetGroup}` : ''}`;
    }),
  ]);
}

type Pinned = { digest: string; summary: string[] };
const pin = (g: GeneratedBlock): Pinned => ({ digest: digest(g), summary: summary(g) });

describe('golden plans', () => {
  const actual = Object.fromEntries(Object.entries(scenarios).map(([name, run]) => [name, run().map(pin)]));
  if (process.env.GOLDEN_UPDATE) writeFileSync(FIXTURE, JSON.stringify(actual, null, 1) + '\n');
  const expected = existsSync(FIXTURE) ? (JSON.parse(readFileSync(FIXTURE, 'utf8')) as Record<string, Pinned[]>) : {};

  for (const name of Object.keys(scenarios)) {
    it(`${name}: identical to the pinned plan`, () => {
      expect(expected[name], 'missing fixture: run with GOLDEN_UPDATE=1').toBeDefined();
      expect(actual[name].length).toBe(expected[name].length);
      actual[name].forEach((got, i) => {
        // Movements, sets, reps, effort and rest first, for a readable diff; then every other field.
        expect(got.summary, `block ${i + 1}`).toEqual(expected[name][i].summary);
        expect(got.digest, `block ${i + 1}: rationale, notes, ids or coverage changed`).toBe(expected[name][i].digest);
      });
    });
  }
});
