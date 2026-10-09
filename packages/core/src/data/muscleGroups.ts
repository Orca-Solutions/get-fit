// Maps each fine-grained Muscle to one of the six UI groups used by the library filter.
// The generator still counts muscles individually (side delts separately from front delts, etc.).

import type { Muscle } from '../types.js';

export type MuscleGroup = 'chest' | 'back' | 'shoulders' | 'arms' | 'core' | 'legs';

export const MUSCLE_GROUPS: readonly MuscleGroup[] = ['chest', 'back', 'shoulders', 'arms', 'core', 'legs'];

export const MUSCLE_GROUP_LABELS: Record<MuscleGroup, string> = {
  chest: 'Chest',
  back: 'Back',
  shoulders: 'Shoulders',
  arms: 'Arms',
  core: 'Core',
  legs: 'Legs',
};

export const muscleGroupOf: Record<Muscle, MuscleGroup> = {
  chest: 'chest',
  'front-delts': 'shoulders',
  'side-delts': 'shoulders',
  'rear-delts': 'shoulders',
  lats: 'back',
  'upper-back': 'back',
  traps: 'back',
  'lower-back': 'back',
  biceps: 'arms',
  triceps: 'arms',
  forearms: 'arms',
  abs: 'core',
  obliques: 'core',
  'hip-flexors': 'core',
  quads: 'legs',
  hamstrings: 'legs',
  glutes: 'legs',
  'glute-med': 'legs',
  adductors: 'legs',
  calves: 'legs',
};

export const MUSCLE_LABELS: Record<Muscle, string> = {
  chest: 'Chest',
  'front-delts': 'Front delts',
  'side-delts': 'Side delts',
  'rear-delts': 'Rear delts',
  lats: 'Lats',
  'upper-back': 'Upper back',
  traps: 'Traps',
  'lower-back': 'Lower back',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  abs: 'Abs',
  obliques: 'Obliques',
  'hip-flexors': 'Hip flexors',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  'glute-med': 'Glute med',
  adductors: 'Adductors',
  calves: 'Calves',
};

/** All muscles that belong to a UI group. */
export function musclesInGroup(group: MuscleGroup): Muscle[] {
  return (Object.keys(muscleGroupOf) as Muscle[]).filter((m) => muscleGroupOf[m] === group);
}

/** The UI groups an exercise touches through its primary muscles (in MUSCLE_GROUPS order). */
export function groupsForMuscles(muscles: readonly Muscle[]): MuscleGroup[] {
  const set = new Set(muscles.map((m) => muscleGroupOf[m]));
  return MUSCLE_GROUPS.filter((g) => set.has(g));
}
