import type { Exercise, PlannedExercise, PlannedSet } from '../types';

export function rangeText(r: { min: number; max: number } | undefined): string {
  if (!r) return '';
  return r.min === r.max ? `${r.min}` : `${r.min}–${r.max}`;
}

export function setTarget(s: PlannedSet): string {
  if (s.targetSeconds) return `${rangeText(s.targetSeconds)} s`;
  return rangeText(s.targetReps);
}

/** "3 × 8–12" or "2 × 30–40 s/side"; mixed sets (a top set) read "1 × 3–5 + 3 × 6–8". */
export function prescription(pe: PlannedExercise, ex?: Exercise): string {
  const groups: { n: number; t: string }[] = [];
  for (const s of pe.sets) {
    const t = setTarget(s);
    const last = groups[groups.length - 1];
    if (last && last.t === t) last.n++;
    else groups.push({ n: 1, t });
  }
  const side = ex?.perSide ? '/side' : '';
  return groups.map((g) => `${g.n} × ${g.t}${side}`).join(' + ');
}

/** The grey placeholder for reps or seconds: the top of the planned range. */
export function plannedValue(s: PlannedSet | undefined): number | undefined {
  if (!s) return undefined;
  return s.targetSeconds?.max ?? s.targetReps?.max;
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function sessionLetter(type: string): string {
  return type === 'legs' ? 'L' : type === 'core' ? 'C' : 'U';
}
