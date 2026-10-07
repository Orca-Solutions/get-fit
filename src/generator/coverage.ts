// Weekly sets per muscle group across the 3 loading weeks (docs/periodization.md §4.2 coverage check).
import type { Exercise, PlannedWorkout } from '../types';

export const COVERAGE_GROUPS = [
  'quads', 'glutes-hamstrings', 'chest', 'back', 'side-delts', 'biceps', 'triceps',
  'calves', 'rear-delts', 'forearms',
] as const;
export type CoverageGroup = (typeof COVERAGE_GROUPS)[number];

const MAJOR: CoverageGroup[] = ['quads', 'glutes-hamstrings', 'chest', 'back', 'side-delts', 'biceps', 'triceps'];
const FLOOR: Record<CoverageGroup, number> = {
  quads: 4, 'glutes-hamstrings': 4, chest: 4, back: 4, 'side-delts': 4, biceps: 4, triceps: 4,
  calves: 2, 'rear-delts': 2, forearms: 2,
};
const BLOCK_TARGET = 6;

function groupOf(m: string): CoverageGroup | undefined {
  if (m === 'lats' || m === 'upper-back') return 'back';
  if (m === 'glutes' || m === 'hamstrings') return 'glutes-hamstrings';
  return (COVERAGE_GROUPS as readonly string[]).includes(m) ? (m as CoverageGroup) : undefined;
}

export type CoverageReport = {
  /** weeks[w][group] = sets that week (direct 1, indirect 0.5). */
  weeks: Record<CoverageGroup, number>[];
  average: Record<CoverageGroup, number>;
  underTarget: CoverageGroup[];
  warnings: string[];
};

export function coverageReport(workouts: PlannedWorkout[], byId: Map<string, Exercise>): CoverageReport {
  const weeks: Record<CoverageGroup, number>[] = [0, 1, 2].map(() => Object.fromEntries(COVERAGE_GROUPS.map((g) => [g, 0])) as Record<CoverageGroup, number>);
  for (const w of workouts) {
    if (w.weekIndex > 2 || w.sessionType === 'core') continue;
    for (const pe of w.exercises) {
      const ex = byId.get(pe.exerciseId);
      if (!ex) continue;
      const credit = new Map<CoverageGroup, number>();
      for (const m of ex.secondaryMuscles) {
        const g = groupOf(m);
        if (g) credit.set(g, 0.5);
      }
      for (const m of ex.primaryMuscles) {
        const g = groupOf(m);
        if (g) credit.set(g, 1);
      }
      for (const [g, c] of credit) weeks[w.weekIndex][g] += c * pe.sets.length;
    }
  }
  const average = Object.fromEntries(COVERAGE_GROUPS.map((g) => [g, Math.round((weeks.reduce((n, wk) => n + wk[g], 0) / 3) * 10) / 10])) as Record<CoverageGroup, number>;
  const underTarget = MAJOR.filter((g) => average[g] < BLOCK_TARGET);
  const warnings: string[] = [];
  weeks.forEach((wk, i) => {
    for (const g of COVERAGE_GROUPS) if (wk[g] < FLOOR[g]) warnings.push(`Week ${i + 1}: ${g} has ${wk[g]} sets (floor ${FLOOR[g]}).`);
  });
  return { weeks, average, underTarget, warnings };
}
