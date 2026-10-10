// A training program as data: the day templates, zone rotation and every number the generator uses
// to turn them into planned sets. The generator holds the method (rotation, balancing, fallbacks);
// the program holds the choices. STRANGE_PERIODIZATION is the original program (docs/periodization.md §4).
import type { CoverageGroup } from './generator/coverage.js';
import type { CoreDynamic, Equipment, Exercise, GripType, LoadType, SessionType, SlotKey, SlotRole, Zone } from './types.js';

export type RepRange = { min: number; max: number };
export type LiftRole = Exclude<SlotRole, 'K'>;

export type BaseSlot = {
  key: SlotKey;
  role: Exclude<SlotRole, 'V' | 'G' | 'K'>;
  /** Pick from a different movement family than the day's other base slots (a second row, a second press). */
  distinctFamily?: boolean;
  /**
   * Alternate block by block between the slot's single-leg movements (odd blocks) and its bilateral ones (even
   * blocks), e.g. split squats and lunges one block, sumo squats the next (§4.8). Falls back to whatever fits
   * the kit. In bilateral blocks the day's first variety slot offers `varietyFirst` (exercise ids) first.
   */
  alternateLaterality?: { varietyFirst?: string[] };
  /** Equipment ladder for the slot (in an alternating slot, its bilateral turn only); see StepUp. */
  stepUp?: StepUp;
  /**
   * Weeks this slot runs a movement from another slot instead, e.g. a deadlift in place of Friday's second
   * row (§4.8): on `always` zones every block, on `ifRoom` zones only while every banded muscle stays inside
   * its band after the swap. The swap keeps the slot's sets and never takes the heavy-day extra set. With no
   * usable movement for `key` (all flagged, or none fits the kit), the slot keeps its own movement every week.
   */
  swap?: { key: SlotKey; always: Zone[]; ifRoom: Zone[]; stepUp?: StepUp };
};

/**
 * Start on the lowest rung of each ladder (regressions and progressions), moving up only past movements the
 * lifter has outgrown: dumbbells first, then the Smith machine (§4.8). Load types in `optIn` (the barbell)
 * are planned only when the lifter marks one Favourite, and then ahead of the ladder.
 */
export type StepUp = { optIn?: LoadType[] };

export type LiftDay = {
  kind: 'lift';
  label: string;
  /** Base movements, picked once per block, in session order. */
  base: BaseSlot[];
  /** Pools the variety slots draw from on moderate and light days. */
  varietyPool: SlotKey[];
  /** Zone for weeks 1 to 3 (week 4 is the deload). */
  zones: Zone[];
};

export type CoreDay = {
  kind: 'core';
  label: string;
  /** Supersets as [group, first dynamic, second dynamic]; every dynamic once per session. */
  supersets: [string, CoreDynamic, CoreDynamic][];
};

export type DayTemplate = LiftDay | CoreDay;

export type TrainingParams = {
  reps: {
    /** Compound (P and C) rep range per zone. */
    compound: Record<Zone, RepRange>;
    /** Block 1 overrides: narrower ranges while weights are still being found. */
    compoundBlock1: Partial<Record<Zone, RepRange>>;
    /** Isolation and variety slots ignore the zone's compound range. */
    isolation: Record<Zone, RepRange>;
  };
  sets: {
    byRole: Record<LiftRole, Record<Zone, number>>;
    block1: Partial<Record<LiftRole, Partial<Record<Zone, number>>>>;
    deload: number;
  };
  /** Reps in reserve for weeks 1 to 3, then the deload. Compounds are P and C. */
  rir: { compound: number[]; other: number[]; deload: number };
  /** Rest after each set, in seconds. */
  rest: { compound: Record<Zone | 'deload', number>; other: Record<Zone | 'deload', number>; grip: number; core: number };
  /** Variety movements per lifting session, by zone. */
  varietySlots: Record<Zone, number>;
  /** Target sets per muscle per loading week: [min, max]. Muscles without a band are not balanced. */
  bands: Partial<Record<CoverageGroup, readonly [number, number]>>;
  /** Below this a week gets a warning. */
  floors: Record<CoverageGroup, number>;
  /** The slot that takes an extra set on a heavy day when its muscle is under its band. */
  heavyExtra: Partial<Record<CoverageGroup, SlotKey>>;
  /** Where a light day looks for a stand-in when a base movement doesn't suit high reps. */
  lightDayStandIns: SlotKey[];
  /** One heavy opening set on the primary lift on heavy days, from a given block. */
  topSet: { fromBlock: number; reps: RepRange; rir: number } | null;
  /** Extra heavy-day isolation sets, one more per block from `fromBlock`, up to `maxExtraSets`. */
  volumeRamp: { fromBlock: number; maxExtraSets: number } | null;
  /** Working sets and movements (grip finisher aside) a lifting session may hold. */
  sessionCap: { sets: number; movements: number };
  /** Grip finishers, last, on the given zones; null for none. */
  grip: { rotation: GripType[]; zones: Zone[] } | null;
  core: {
    /** Zones for weeks 1 to 3; a profile set to "flat" uses moderate every week. */
    wave: Zone[];
    targets: Record<Zone, { reps: RepRange; seconds: RepRange }>;
    sets: number;
    deloadSets: number;
    rir: number;
    deloadRir: number;
  };
};

export type SelectionRules = {
  /** Catalog levels the generator may pick. */
  allowedLevels: Exercise['level'][];
  /** Score added in block 1 for movements marked as starters. */
  starterBonus: number;
  /** Score added per level (negative to discourage). */
  levelBonus: Partial<Record<Exercise['level'], number>>;
  favouriteBonus: number;
  /** Score added on primary (P) slots by load type, e.g. Smith machine lifts leading from block 1. */
  primaryLoadTypeBonus: Partial<Record<LoadType, number>>;
  /** Score added on secondary compound (C) slots by load type, e.g. barbell presses and rows when the kit has a bar. */
  compoundLoadTypeBonus?: Partial<Record<LoadType, number>>;
  /** Penalty for a second fatigue-3 compound in one session (kept low for a daily runner). */
  fatigueStackPenalty: number;
  /** Penalty for movements with a high impact on running. */
  highRunImpactPenalty: number;
  /**
   * Movements tagged `tag` (stand-ins written for home kits) are picked for a slot only when no other movement
   * that fits it needs equipment outside `homeEquipment`, so they fill home kits without pushing machines,
   * cables, dumbbells and barbells out of a gym plan.
   */
  homePack?: { tag: string; homeEquipment: Equipment[] };
};

export type Program = {
  id: string;
  /** Recorded on every block, next to generatorVersion. */
  version: string;
  /** Day templates keyed by day type, in the order the generator picks them. */
  days: Record<SessionType, DayTemplate>;
  params: TrainingParams;
  selection: SelectionRules;
};

export const STRANGE_PERIODIZATION: Program = {
  id: 'strange-periodization',
  version: '1.4.0',
  days: {
    legs: {
      kind: 'lift',
      label: 'Legs',
      base: [
        { key: 'legs:squat', role: 'P' },
        // An RDL on heavy and moderate weeks; light and deload weeks swap it for a back extension or a
        // hamstring move (§4.8). Dumbbells first, Smith once outgrown, barbell only if marked Favourite.
        { key: 'legs:hinge', role: 'C', stepUp: { optIn: ['barbell'] } },
        // Knee-dominant: single-leg one block, a sumo squat the next (dumbbell first, Smith once the dumbbell is
        // outgrown), with the leg press, then the hack squat, first in line for the variety slot (§4.8).
        { key: 'legs:single-leg', role: 'C', alternateLaterality: { varietyFirst: ['leg-press', 'hack-squat'] }, stepUp: {} },
        { key: 'legs:knee-extension', role: 'I' },
        { key: 'legs:knee-flexion', role: 'I' },
        { key: 'legs:calf', role: 'I' },
      ],
      varietyPool: ['legs:v:hip-extension', 'legs:v:squat-machine', 'legs:v:adduction', 'legs:v:abduction', 'legs:v:hinge-variant'],
      zones: ['H', 'M', 'L'],
    },
    'chest-biceps': {
      kind: 'lift',
      label: 'Chest & biceps',
      base: [
        { key: 'chest:flat-press', role: 'P' },
        { key: 'chest:incline-press', role: 'C' },
        { key: 'chest:fly', role: 'I' },
        { key: 'biceps:supinated', role: 'I' },
        { key: 'biceps:neutral', role: 'I' },
        // A third chest press (machine press or assisted dip) keeps chest level with biceps (§4.2).
        { key: 'chest:v:press-variant', role: 'C', distinctFamily: true },
      ],
      varietyPool: ['biceps:stretch', 'biceps:v:curl-variant', 'chest:v:press-variant'],
      zones: ['M', 'L', 'H'],
    },
    'back-tri-shoulders': {
      kind: 'lift',
      label: 'Back, triceps & shoulders',
      base: [
        { key: 'back:vertical-pull', role: 'P' },
        { key: 'back:horizontal-pull', role: 'C' },
        { key: 'shoulders:vertical-press', role: 'C' },
        { key: 'shoulders:side-delt', role: 'I' },
        { key: 'triceps:overhead', role: 'I' },
        // A second row or pullover: back is the biggest upper-body muscle and was the least trained (§4.2).
        // A deadlift takes its place on the heavy week, and on the moderate week when the bands have room (§4.8).
        {
          key: 'back:v:row-variant', role: 'C', distinctFamily: true,
          swap: { key: 'back:deadlift', always: ['H'], ifRoom: ['M'], stepUp: { optIn: ['barbell'] } },
        },
      ],
      varietyPool: ['triceps:pushdown', 'shoulders:side-delt', 'back:v:row-variant', 'shoulders:v:rear-delt', 'back:v:shrug'],
      zones: ['L', 'H', 'M'],
    },
    core: {
      kind: 'core',
      label: 'Core (home)',
      // Opposing dynamics paired (§4.2 core day).
      supersets: [
        ['A', 'anti-extension', 'hip-extension'],
        ['B', 'trunk-flexion', 'anti-rotation'],
        ['C', 'rotation', 'anti-lateral-flexion'],
        ['D', 'hip-flexion', 'lateral-flexion'],
      ],
    },
  },
  params: {
    reps: {
      compound: { H: { min: 5, max: 8 }, M: { min: 8, max: 12 }, L: { min: 12, max: 20 } },
      compoundBlock1: { H: { min: 6, max: 8 }, L: { min: 12, max: 15 } },
      isolation: { H: { min: 10, max: 15 }, M: { min: 10, max: 15 }, L: { min: 12, max: 20 } },
    },
    sets: {
      byRole: {
        P: { H: 4, M: 3, L: 3 },
        C: { H: 3, M: 3, L: 3 },
        I: { H: 3, M: 2, L: 2 },
        V: { H: 2, M: 2, L: 2 },
        G: { H: 2, M: 2, L: 2 },
      },
      block1: { P: { H: 3 } },
      deload: 2,
    },
    // Effort ramp across the block: RIR 3 → 2 → 1–2 → deload; compounds never below 1.
    rir: { compound: [3, 2, 2], other: [3, 2, 1], deload: 4 },
    rest: {
      compound: { H: 150, M: 105, L: 75, deload: 75 },
      other: { H: 90, M: 75, L: 75, deload: 75 },
      grip: 60,
      core: 45,
    },
    // Anatoly's "wider variety when the bar gets lighter", trimmed to one variety slot on light days so
    // the main lifts keep 3 sets every session (more practice on the lifts that drive progress).
    varietySlots: { H: 0, M: 1, L: 1 },
    // The same every loading week, so every muscle grows at about the same rate. Forearms have no band:
    // the grip finishers and the pulling work cover them.
    bands: {
      quads: [9, 12],
      'glutes-hamstrings': [10, 12],
      chest: [9, 12],
      back: [9, 11],
      'side-delts': [6, 8],
      biceps: [7, 9],
      // Quads, chest and triceps get one more: main lifts keep 3 sets on every loading day (§4.2).
      triceps: [7, 10],
      calves: [3, 5],
      'rear-delts': [3, 5],
      // Hinges, back extensions and the core day's hip-extension move (§4.8).
      'lower-back': [3, 5],
    },
    floors: {
      quads: 4, 'glutes-hamstrings': 4, chest: 4, back: 4, 'side-delts': 4, biceps: 4, triceps: 4,
      calves: 2, 'rear-delts': 2, forearms: 2, 'lower-back': 2,
    },
    // On moderate and light days a short muscle claims the variety slots instead (§4.2 balance targets).
    heavyExtra: {
      quads: 'legs:knee-extension',
      'glutes-hamstrings': 'legs:knee-flexion',
      calves: 'legs:calf',
      chest: 'chest:fly',
      biceps: 'biceps:supinated',
      back: 'back:v:row-variant',
      'side-delts': 'shoulders:side-delt',
      triceps: 'triceps:overhead',
    },
    // E.g. a back extension instead of an RDL on a light day.
    lightDayStandIns: ['legs:v:hip-extension', 'legs:v:hinge-variant'],
    // Anatoly-style top set from block 3 (§4.1).
    topSet: { fromBlock: 3, reps: { min: 3, max: 5 }, rir: 2 },
    volumeRamp: { fromBlock: 3, maxExtraSets: 3 },
    sessionCap: { sets: 22, movements: 8 },
    grip: { rotation: ['support', 'crush', 'pinch', 'wrist-flexion', 'wrist-extension', 'rotation', 'reverse-curl'], zones: ['M', 'L'] },
    core: {
      // Week 1 moderate, week 2 heavy, week 3 light, week 4 deload.
      wave: ['M', 'H', 'L'],
      targets: {
        H: { reps: { min: 6, max: 10 }, seconds: { min: 15, max: 25 } },
        M: { reps: { min: 10, max: 15 }, seconds: { min: 30, max: 40 } },
        L: { reps: { min: 15, max: 25 }, seconds: { min: 45, max: 60 } },
      },
      sets: 2,
      deloadSets: 1,
      rir: 2,
      deloadRir: 4,
    },
  },
  selection: {
    allowedLevels: ['beginner', 'intermediate'],
    starterBonus: 10,
    // Intermediate movements only when nothing beginner-friendly offers variety.
    levelBonus: { beginner: 2, intermediate: -3 },
    favouriteBonus: 3,
    // The Smith squat, deadlift, bench and press lead from block 1 at a Planet Fitness-style gym; with a
    // barbell and rack, the barbell squat and bench (starters too) lead instead.
    primaryLoadTypeBonus: { smith: 3, barbell: 4 },
    // The barbell press and row beat their Smith and dumbbell starters too, so a kit with a bar and rack
    // runs the barbell main lifts from block 1.
    compoundLoadTypeBonus: { barbell: 4 },
    // Keeps heavy leg day recoverable for a daily run (§4.6).
    fatigueStackPenalty: 8,
    highRunImpactPenalty: 1,
    homePack: { tag: 'home-pack', homeEquipment: ['band', 'kettlebell', 'ab-wheel', 'mat', 'none'] },
  },
};

export const liftDays = (p: Program) => Object.entries(p.days).filter((e): e is [string, LiftDay] => e[1].kind === 'lift');
/** Slots that base slots swap into on some weeks (the Friday deadlift): their loads come from e1RM (§4.8). */
export const swapSlotKeys = (p: Program = STRANGE_PERIODIZATION): Set<SlotKey> =>
  new Set(liftDays(p).flatMap(([, d]) => d.base.flatMap((b) => (b.swap ? [b.swap.key] : []))));
export const coreDayType = (p: Program) => Object.entries(p.days).find(([, d]) => d.kind === 'core')?.[0];

/**
 * Problems that would stop `program` planning for `catalog`: day types the schedule names but the
 * program lacks, slots no movement is tagged for, zone lists of the wrong length. Empty when fine.
 */
export function validateProgram(program: Program, catalog: Pick<Exercise, 'slots'>[], scheduleTypes: string[] = []): string[] {
  const errors: string[] = [];
  const tagged = new Set(catalog.flatMap((e) => e.slots));
  const need = (slot: string, where: string) => {
    if (!tagged.has(slot)) errors.push(`${where}: no movement is tagged for slot "${slot}"`);
  };
  for (const t of scheduleTypes) if (!program.days[t]) errors.push(`schedule: day type "${t}" is not in program ${program.id}`);
  if (Object.values(program.days).filter((d) => d.kind === 'core').length > 1) errors.push('days: at most one core day');
  for (const [type, day] of Object.entries(program.days)) {
    if (day.kind === 'lift') {
      if (day.zones.length !== 3) errors.push(`${type}: zones must list weeks 1 to 3`);
      if (!day.base.some((s) => s.role === 'P')) errors.push(`${type}: needs a primary (P) slot`);
      day.base.forEach((s) => need(s.key, `${type} base`));
      day.varietyPool.forEach((s) => need(s, `${type} variety`));
    } else {
      day.supersets.forEach(([, a, b]) => [a, b].forEach((dyn) => need(`core:${dyn}`, `${type} superset`)));
    }
  }
  const { params } = program;
  for (const g of params.grip?.rotation ?? []) need(`grip:${g}`, 'grip rotation');
  params.lightDayStandIns.forEach((s) => need(s, 'light-day stand-ins'));
  for (const g of Object.keys(params.heavyExtra)) if (!params.bands[g as CoverageGroup]) errors.push(`heavyExtra: ${g} has no band`);
  if (params.rir.compound.length !== 3 || params.rir.other.length !== 3) errors.push('rir: list weeks 1 to 3');
  if (params.core.wave.length !== 3) errors.push('core.wave: list weeks 1 to 3');
  return errors;
}
