// Weekly sets per muscle group across the 3 loading weeks (docs/periodization.md §4.2 balance targets).
import type { Exercise, PlannedWorkout } from '../types.js';
import { STRANGE_PERIODIZATION, type TrainingParams } from '../program.js';

export const COVERAGE_GROUPS = [
  'quads', 'glutes-hamstrings', 'chest', 'back', 'side-delts', 'biceps', 'triceps',
  'calves', 'rear-delts', 'forearms',
] as const;
export type CoverageGroup = (typeof COVERAGE_GROUPS)[number];

export const GROUP_LABEL: Record<CoverageGroup, string> = {
  quads: 'quads',
  'glutes-hamstrings': 'glutes and hamstrings',
  chest: 'chest',
  back: 'back',
  'side-delts': 'side delts',
  biceps: 'biceps',
  triceps: 'triceps',
  calves: 'calves',
  'rear-delts': 'rear delts',
  forearms: 'forearms',
};

/** The original program's weekly set bands (Program.params.bands). */
export const BANDS: Partial<Record<CoverageGroup, readonly [number, number]>> = STRANGE_PERIODIZATION.params.bands;

const MAJOR: CoverageGroup[] = ['quads', 'glutes-hamstrings', 'chest', 'back', 'side-delts', 'biceps', 'triceps'];

export function groupOf(m: string): CoverageGroup | undefined {
  if (m === 'lats' || m === 'upper-back') return 'back';
  if (m === 'glutes' || m === 'hamstrings') return 'glutes-hamstrings';
  return (COVERAGE_GROUPS as readonly string[]).includes(m) ? (m as CoverageGroup) : undefined;
}

/** Sets credited per set of `ex`: 1 for a primary muscle, 0.5 for a secondary one. */
export function creditOf(ex: Pick<Exercise, 'primaryMuscles' | 'secondaryMuscles'>): Map<CoverageGroup, number> {
  const credit = new Map<CoverageGroup, number>();
  for (const m of ex.secondaryMuscles) {
    const g = groupOf(m);
    if (g) credit.set(g, 0.5);
  }
  for (const m of ex.primaryMuscles) {
    const g = groupOf(m);
    if (g) credit.set(g, 1);
  }
  return credit;
}

export type WeekGroup = { week: number; group: CoverageGroup };

export type CoverageReport = {
  /** weeks[w][group] = sets that week (direct 1, indirect 0.5). */
  weeks: Record<CoverageGroup, number>[];
  average: Record<CoverageGroup, number>;
  /** Loading weeks where a muscle sits under or over its band. */
  under: WeekGroup[];
  over: WeekGroup[];
  warnings: string[];
};

export function weeklySets(workouts: PlannedWorkout[], byId: Map<string, Exercise>): Record<CoverageGroup, number>[] {
  const weeks: Record<CoverageGroup, number>[] = [0, 1, 2].map(() => Object.fromEntries(COVERAGE_GROUPS.map((g) => [g, 0])) as Record<CoverageGroup, number>);
  for (const w of workouts) {
    if (w.weekIndex > 2) continue;
    for (const pe of w.exercises) {
      // Core work isn't balanced against the lifting bands.
      if (pe.role === 'K') continue;
      const ex = byId.get(pe.exerciseId);
      if (!ex) continue;
      for (const [g, c] of creditOf(ex)) weeks[w.weekIndex][g] += c * pe.sets.length;
    }
  }
  return weeks;
}

export function coverageReport(workouts: PlannedWorkout[], byId: Map<string, Exercise>, params: Pick<TrainingParams, 'bands' | 'floors'> = STRANGE_PERIODIZATION.params): CoverageReport {
  const weeks = weeklySets(workouts, byId);
  const average = Object.fromEntries(COVERAGE_GROUPS.map((g) => [g, Math.round((weeks.reduce((n, wk) => n + wk[g], 0) / 3) * 10) / 10])) as Record<CoverageGroup, number>;
  const under: WeekGroup[] = [];
  const over: WeekGroup[] = [];
  const warnings: string[] = [];
  weeks.forEach((wk, week) => {
    for (const g of COVERAGE_GROUPS) {
      const band = params.bands[g];
      if (band && wk[g] < band[0]) under.push({ week, group: g });
      if (band && wk[g] > band[1]) over.push({ week, group: g });
      if (wk[g] < params.floors[g]) warnings.push(`Week ${week + 1}: ${g} has ${wk[g]} sets (floor ${params.floors[g]}).`);
    }
  });
  return { weeks, average, under, over, warnings };
}

export const isMajor = (g: CoverageGroup) => MAJOR.includes(g);
