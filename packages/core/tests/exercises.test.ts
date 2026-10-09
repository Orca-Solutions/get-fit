import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  BARBELL_EQUIPMENT, BASE_SLOTS, CORE_DYNAMICS, FORBIDDEN_EQUIPMENT, GRIP_TYPES, GYM_EQUIPMENT, HOME_EQUIPMENT, MUSCLES, VARIETY_SLOTS,
  usableWith, validateCatalog,
} from '../scripts/build-exercises';
import { curation } from '../scripts/curation';
import rawExercises from '../src/data/exercises.json';
import { MUSCLE_GROUPS, muscleGroupOf } from '../src/data/muscleGroups';
import type { Equipment, Exercise, SlotKey } from '../src/types';

const exercises = rawExercises as unknown as Exercise[];
const byId = new Map(exercises.map((e) => [e.id, e]));
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Photos ship with the web app, not the package.
const PHOTOS = join(ROOT, '..', '..', 'apps', 'web', 'public');

const candidates = (slot: SlotKey, equipment: readonly Equipment[]) =>
  exercises.filter((e) => e.slots.includes(slot) && usableWith(e, equipment));

describe('exercise catalog', () => {
  it('passes the build validator with no errors', () => {
    expect(validateCatalog(exercises)).toEqual([]);
  });

  it('is in sync with scripts/curation.ts (re-run build-exercises after editing)', () => {
    expect(exercises.map((e) => e.id)).toEqual(curation.map((c) => c.id));
  });

  it('has about 215 curated movements (core plus the barbell and home packs)', () => {
    expect(exercises.length).toBeGreaterThanOrEqual(110);
    expect(exercises.length).toBeLessThanOrEqual(230);
  });

  it('has unique kebab-case ids', () => {
    expect(new Set(exercises.map((e) => e.id)).size).toBe(exercises.length);
    for (const e of exercises) expect(e.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('keeps barbell work in the barbell pack, out of reach of a Planet Fitness kit', () => {
    for (const e of exercises) {
      for (const eq of e.equipment) expect(FORBIDDEN_EQUIPMENT).not.toContain(eq);
      const pack = e.loadType === 'barbell' || e.loadType === 'ez-bar';
      expect(e.equipment.some((q) => q === 'barbell' || q === 'ez-bar'), e.id).toBe(pack);
      if (pack) expect(usableWith(e, GYM_EQUIPMENT), e.id).toBe(false);
    }
    expect(exercises.map((e) => e.id).join(' ')).not.toMatch(/trap-bar|landmine/);
  });

  it('gives a barbell kit a barbell option in the main squat, hinge, press, row and curl slots', () => {
    const kit = [...GYM_EQUIPMENT, ...BARBELL_EQUIPMENT];
    for (const slot of ['legs:squat', 'legs:hinge', 'chest:flat-press', 'chest:incline-press', 'shoulders:vertical-press', 'back:horizontal-pull', 'biceps:supinated'] as SlotKey[]) {
      expect(candidates(slot, kit).some((e) => e.loadType === 'barbell'), slot).toBe(true);
    }
  });

  it('resolves every regression and progression', () => {
    for (const e of exercises) {
      for (const ref of [...e.regressions, ...e.progressions]) {
        expect(byId.has(ref), `${e.id} → ${ref}`).toBe(true);
        expect(ref).not.toBe(e.id);
      }
    }
  });

  it('gives every movement 2–4 cues and some instructions', () => {
    for (const e of exercises) {
      expect(e.cues.length, e.id).toBeGreaterThanOrEqual(2);
      expect(e.cues.length, e.id).toBeLessThanOrEqual(4);
      expect(e.instructions.length, e.id).toBeGreaterThan(0);
    }
  });

  it('has sane rep ranges (seconds for timed holds)', () => {
    for (const e of exercises) {
      expect(e.repRange.min, e.id).toBeLessThanOrEqual(e.repRange.max);
      expect(e.repRange.min, e.id).toBeGreaterThan(0);
      if (e.metric === 'time') expect(e.repRange.min, e.id).toBeGreaterThanOrEqual(5);
      else expect(e.repRange.max, e.id).toBeLessThanOrEqual(30);
    }
    for (const id of ['plank', 'side-plank', 'dead-hang', 'dumbbell-farmers-hold', 'hollow-hold', 'kettlebell-suitcase-hold']) {
      expect(byId.get(id)?.metric, id).toBe('time');
    }
  });

  it('logs loads with the right convention per load type', () => {
    for (const e of exercises) {
      if (e.loadType === 'smith') {
        expect(e.weightConvention, e.id).toBe('added');
        expect(e.loadIncrementLb, e.id).toBe(5);
      }
      if (e.loadType === 'assisted') expect(e.weightConvention, e.id).toBe('assist');
      if (e.loadType === 'band') expect(e.weightConvention, e.id).toBe('band');
      if (e.weightConvention === 'band') expect(e.loadType, e.id).toBe('band');
      if (e.loadType === 'dumbbell') expect(['per-hand', 'total'], e.id).toContain(e.weightConvention);
    }
  });

  it('marks unilateral work perSide consistently', () => {
    for (const e of exercises) if (e.perSide) expect(e.laterality, e.id).not.toBe('bilateral');
  });

  it('has photos on disk for every sourced entry and none for our own', () => {
    for (const e of exercises) {
      if (e.source.name === 'free-exercise-db') {
        expect(e.images).toEqual([`exercises/${e.id}/0.jpg`, `exercises/${e.id}/1.jpg`]);
        for (const img of e.images) expect(existsSync(join(PHOTOS, img)), img).toBe(true);
        expect(e.imageLicense, e.id).toBe('unverified');
      } else {
        expect(e.images).toEqual([]);
        expect(e.imageLicense, e.id).toBeUndefined();
      }
      expect(e.license, e.id).toBe('FSL-1.1-MIT');
    }
  });

  it('has our own instructions for every entry', () => {
    for (const e of exercises) {
      expect(e.instructions.length, e.id).toBeGreaterThanOrEqual(2);
      for (const step of e.instructions) expect(step, e.id).toMatch(/^[A-Z].*[.!]$/);
    }
  });
});

describe('slot coverage', () => {
  it.each(BASE_SLOTS)('base slot %s has ≥3 gym-usable candidates including a starter', (slot) => {
    const c = candidates(slot, GYM_EQUIPMENT);
    expect(c.length).toBeGreaterThanOrEqual(3);
    expect(c.filter((e) => e.starter).length).toBeGreaterThanOrEqual(1);
    expect(c.filter((e) => e.starter).length).toBeLessThanOrEqual(2);
  });

  it.each(VARIETY_SLOTS)('variety pool %s has ≥2 gym-usable candidates', (slot) => {
    expect(candidates(slot, GYM_EQUIPMENT).length).toBeGreaterThanOrEqual(2);
  });

  it.each(CORE_DYNAMICS)('core:%s has ≥3 home-usable candidates across ≥2 difficulty ranks', (dynamic) => {
    const c = candidates(`core:${dynamic}`, HOME_EQUIPMENT);
    expect(c.length).toBeGreaterThanOrEqual(3);
    expect(new Set(c.map((e) => e.difficultyRank)).size).toBeGreaterThanOrEqual(2);
    expect(c.some((e) => e.starter)).toBe(true);
  });

  it.each(GRIP_TYPES)('grip:%s has a gym-usable finisher', (type) => {
    expect(candidates(`grip:${type}`, GYM_EQUIPMENT).length).toBeGreaterThanOrEqual(1);
  });

  it('only offers home-usable movements in core slots, with a matching coreDynamic', () => {
    for (const e of exercises) {
      const core = e.slots.filter((s) => s.startsWith('core:'));
      if (core.length === 0) {
        expect(e.coreDynamic, e.id).toBeUndefined();
        continue;
      }
      expect(usableWith(e, HOME_EQUIPMENT), e.id).toBe(true);
      expect(core, e.id).toEqual([`core:${e.coreDynamic}`]);
    }
  });

  it('only offers gym-usable movements (or barbell- or home-pack ones) in lifting and grip slots, with a matching gripType', () => {
    for (const e of exercises) {
      if (e.slots.some((s) => !s.startsWith('core:'))) expect(usableWith(e, [...GYM_EQUIPMENT, ...BARBELL_EQUIPMENT, ...HOME_EQUIPMENT]), e.id).toBe(true);
      if (e.slots.some((s) => s.startsWith('grip:'))) expect(usableWith(e, GYM_EQUIPMENT), e.id).toBe(true);
      const grip = e.slots.filter((s) => s.startsWith('grip:'));
      if (grip.length === 0) expect(e.gripType, e.id).toBeUndefined();
      else expect(grip, e.id).toEqual([`grip:${e.gripType}`]);
    }
  });

  it.each(BASE_SLOTS.filter((s) => !s.startsWith('core:')))('base slot %s has a home-kit candidate', (slot) => {
    expect(candidates(slot, HOME_EQUIPMENT).length).toBeGreaterThanOrEqual(1);
  });

  it('tags only own, photo-free movements as the home pack', () => {
    for (const e of exercises.filter((x) => x.tags.includes('home-pack'))) {
      expect(e.source.name, e.id).toBe('get-fit');
      expect(usableWith(e, HOME_EQUIPMENT), e.id).toBe(true);
      expect(e.starter, e.id).toBe(false);
    }
  });

  it('keeps the core ladders in order', () => {
    const rank = (id: string) => byId.get(id)?.difficultyRank;
    expect([rank('plank'), rank('long-lever-plank'), rank('body-saw')]).toEqual([1, 2, 3]);
    expect([rank('dead-bug'), rank('kettlebell-dead-bug')]).toEqual([1, 2]);
    expect(rank('side-plank')!).toBeLessThan(rank('side-plank-with-leg-raise')!);
  });

  it('uses Smith machine versions of the big lifts', () => {
    for (const id of ['smith-machine-squat', 'smith-deadlift', 'smith-bench-press', 'smith-overhead-press']) {
      expect(byId.get(id)?.loadType, id).toBe('smith');
      expect(byId.get(id)?.equipment, id).toContain('smith-machine');
    }
  });
});

describe('muscle groups', () => {
  it('maps every muscle to one of the six UI groups', () => {
    for (const m of MUSCLES) expect(MUSCLE_GROUPS).toContain(muscleGroupOf[m]);
    expect(Object.keys(muscleGroupOf).sort()).toEqual([...MUSCLES].sort());
  });

  it('has exercises for every UI group', () => {
    for (const g of MUSCLE_GROUPS) {
      expect(exercises.some((e) => e.primaryMuscles.some((m) => muscleGroupOf[m] === g)), g).toBe(true);
    }
  });
});
