// Shared domain types for the app, the generator and the sync server.
// See docs/product-spec.md §3 and docs/exercise-database.md §4.

export type MovementPattern =
  | 'squat' | 'lunge' | 'hinge' | 'hip-extension'
  | 'push-horizontal' | 'push-vertical' | 'pull-horizontal' | 'pull-vertical'
  | 'carry'
  | 'anti-extension' | 'anti-rotation' | 'anti-lateral-flexion' | 'trunk-flexion' | 'rotation'
  | 'hip-flexion' | 'lateral-flexion'
  | 'elbow-flexion' | 'elbow-extension' | 'shoulder-raise' | 'rear-delt' | 'chest-fly'
  | 'knee-extension' | 'knee-flexion' | 'hip-abduction' | 'hip-adduction' | 'calf' | 'shrug'
  | 'grip';

export type Muscle =
  | 'chest' | 'front-delts' | 'side-delts' | 'rear-delts'
  | 'lats' | 'upper-back' | 'traps' | 'lower-back'
  | 'biceps' | 'triceps' | 'forearms'
  | 'abs' | 'obliques'
  | 'quads' | 'hamstrings' | 'glutes' | 'glute-med' | 'adductors' | 'calves' | 'hip-flexors';

export type Equipment =
  | 'dumbbell' | 'kettlebell' | 'cable' | 'machine' | 'smith-machine' | 'bench'
  | 'pull-up-bar' | 'back-extension-bench' | 'plate' | 'band' | 'ab-wheel' | 'mat' | 'none';

export type LoadType = 'smith' | 'dumbbell' | 'kettlebell' | 'machine' | 'cable' | 'bodyweight' | 'assisted' | 'band' | 'plate';
export type WeightConvention = 'total' | 'per-hand' | 'added' | 'assist' | 'band' | 'none';

/** The 8 core dynamics the weekend core day always covers (periodization §4.2). */
export type CoreDynamic =
  | 'anti-extension' | 'hip-extension' | 'trunk-flexion' | 'anti-rotation'
  | 'rotation' | 'anti-lateral-flexion' | 'hip-flexion' | 'lateral-flexion';

export type GripType = 'support' | 'crush' | 'pinch' | 'wrist-flexion' | 'wrist-extension' | 'rotation' | 'reverse-curl';

/**
 * Slot keys: which generator slots an exercise may fill. Base slots are fixed per block;
 * "v:" slots are the variety pools that only appear on moderate and light days.
 */
export type SlotKey =
  // Wednesday: legs
  | 'legs:squat' | 'legs:hinge' | 'legs:single-leg' | 'legs:knee-extension' | 'legs:knee-flexion' | 'legs:calf'
  | 'legs:v:hip-extension' | 'legs:v:squat-machine' | 'legs:v:adduction' | 'legs:v:abduction' | 'legs:v:hinge-variant'
  // Monday: chest and biceps
  | 'chest:flat-press' | 'chest:incline-press' | 'chest:fly'
  | 'biceps:supinated' | 'biceps:neutral' | 'biceps:stretch'
  | 'chest:v:press-variant' | 'biceps:v:curl-variant'
  // Friday: back, triceps, shoulders
  | 'back:vertical-pull' | 'back:horizontal-pull' | 'shoulders:vertical-press'
  | 'shoulders:side-delt' | 'triceps:overhead' | 'triceps:pushdown'
  | 'shoulders:v:rear-delt' | 'back:v:row-variant' | 'back:v:shrug'
  // Core day (home)
  | `core:${CoreDynamic}`
  // Grip finishers
  | `grip:${GripType}`;

export type Exercise = {
  id: string;
  name: string;
  aliases: string[];
  family: string;
  movementPattern: MovementPattern;
  primaryMuscles: Muscle[];
  secondaryMuscles: Muscle[];
  mechanic: 'compound' | 'isolation';
  angle?: 'flat' | 'incline' | 'decline' | 'overhead' | 'low' | 'high';
  grip?: 'pronated' | 'supinated' | 'neutral' | 'mixed';
  laterality: 'bilateral' | 'unilateral' | 'alternating';
  stance?: 'standing' | 'seated' | 'lying' | 'split' | 'single-leg' | 'kneeling' | 'hanging' | 'prone' | 'supine';
  lengthBias?: 'lengthened' | 'mid' | 'shortened';
  stability: 'machine' | 'supported' | 'free';
  equipment: Equipment[];
  metric: 'reps' | 'time';
  loadType: LoadType;
  weightConvention: WeightConvention;
  loadIncrementLb?: number;
  /** Sane bounds; seconds when metric = 'time'. */
  repRange: { min: number; max: number };
  perSide: boolean;
  fatigueCost: 1 | 2 | 3;
  axialLoad: boolean;
  runImpact: 'none' | 'low' | 'high';
  level: 'beginner' | 'intermediate' | 'advanced';
  /** Rank inside its family for bodyweight/core ladders (1 = easiest). */
  difficultyRank: number;
  starter: boolean;
  regressions: string[];
  progressions: string[];
  slots: SlotKey[];
  coreDynamic?: CoreDynamic;
  gripType?: GripType;
  tags: string[];
  cues: string[];
  instructions: string[];
  images: string[];
  source: { name: 'free-exercise-db' | 'get-fit'; sourceId?: string };
  license: 'Unlicense' | 'MIT';
};

export type Location = 'gym' | 'home';
export type SessionType = 'legs' | 'chest-biceps' | 'back-tri-shoulders' | 'core';
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday, like Date#getDay
export type Zone = 'H' | 'M' | 'L';
export type SlotRole = 'P' | 'C' | 'I' | 'V' | 'G' | 'K'; // primary, compound, isolation, variety, grip, core

/** Fields every stored record carries, so sync is last-write-wins per record. */
export type SyncFields = {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

export type Band = { id: string; name: string; order: number };

export type ScheduleEntry = {
  /** One weekday, or a window (e.g. Sat+Sun) where either day counts. */
  weekdays: Weekday[];
  type: SessionType;
  location: Location;
};

export type Profile = SyncFields & {
  heightIn: number;
  bodyweightLb: number;
  units: 'lb';
  schedule: ScheduleEntry[];
  equipmentByLocation: Record<Location, Equipment[]>;
  bands: Band[];
  /** Home kettlebells as weight × how many you own (a matched pair unlocks double-bell moves). */
  kettlebells: { lb: number; count: number }[];
  smithBarLb: number;
  coreWave: 'wave' | 'flat';
};

export type PlannedSet = {
  setIndex: number;
  targetReps?: { min: number; max: number };
  targetSeconds?: { min: number; max: number };
  rir: number;
  restSec: number;
};

export type PlannedExercise = {
  id: string;
  exerciseId: string;
  slot: SlotKey;
  role: SlotRole;
  order: number;
  supersetGroup?: string;
  note?: string;
  sets: PlannedSet[];
};

export type PlannedWorkout = SyncFields & {
  blockId: string;
  date: string; // YYYY-MM-DD
  windowEnd?: string;
  sessionType: SessionType;
  location: Location;
  weekIndex: number; // 0-based within the block
  zone: Zone | 'deload';
  isDeload: boolean;
  focus: string; // "Legs · Heavy"
  rationale: string;
  exercises: PlannedExercise[];
};

export type Block = SyncFields & {
  startDate: string;
  weeks: number;
  index: number; // 1-based block number
  focusMuscle: FocusMuscle;
  generatorVersion: string;
  rationale: string;
  /** exerciseId chosen per base slot, by session type. Used to rotate next block. */
  baseSlots: Record<string, string>;
  /** Built before it started; its unlogged workouts are rebuilt from the latest logs when it becomes current. */
  plannedAhead?: boolean;
};

export type FocusMuscle = 'side-delts' | 'chest' | 'arms' | 'upper-back' | 'glutes-hamstrings';

export type Session = SyncFields & {
  plannedWorkoutId: string | null;
  date: string;
  startedAt: string;
  endedAt?: string | null;
  notes?: string;
  effort?: number | null;
  beatUp?: boolean;
  /** plannedExerciseId → exerciseId actually done. */
  swaps?: Record<string, string>;
  /** plannedExerciseIds skipped on purpose. */
  skipped?: string[];
  /** Movements added on the fly. */
  extras?: { id: string; exerciseId: string }[];
};

export type LoggedSet = SyncFields & {
  sessionId: string;
  exerciseId: string;
  plannedExerciseId: string | null;
  setIndex: number;
  weight?: number | null;
  bandId?: string | null;
  stanceSteps?: number | null;
  reps?: number | null;
  seconds?: number | null;
  effort?: 'easy' | 'right' | 'hard' | null;
  date: string;
  loggedAt: string;
};

export type ExerciseFlag = SyncFields & {
  // id = exerciseId
  favourite?: boolean;
  avoid?: boolean;
  unavailable?: boolean;
};
