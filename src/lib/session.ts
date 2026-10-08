// Which movement a workout slot shows, and how two devices' copies of one session merge.
import type { LoggedSet, PlannedExercise, Session } from '../types';

/**
 * The movement a slot shows: the swap if one was chosen, else whatever was logged in the slot (so
 * sets survive a plan rebuilt on another device, or a swap lost in a sync), else the planned movement.
 */
export function movementFor(pe: PlannedExercise, session: Pick<Session, 'swaps'> | undefined, sets: LoggedSet[]): string {
  const swapped = session?.swaps?.[pe.id];
  if (swapped) return swapped;
  const logged = sets.filter((s) => s.plannedExerciseId === pe.id && !s.deletedAt);
  if (logged.length && !logged.some((s) => s.exerciseId === pe.exerciseId)) {
    return [...logged].sort((a, b) => a.loggedAt.localeCompare(b.loggedAt))[logged.length - 1].exerciseId;
  }
  return pe.exerciseId;
}

/** Session fields edited one at a time; each change is stamped in `fieldAt` so devices merge per field. */
const FIELDS = ['notes', 'effort', 'beatUp', 'endedAt', 'extras'] as const;

/** The `fieldAt` keys a patch changes: one per swapped or skipped slot, one per other field. */
export function changedFields(before: Session, patch: Partial<Session>): string[] {
  const keys: string[] = [];
  if (patch.swaps) {
    const old = before.swaps ?? {};
    for (const id of new Set([...Object.keys(old), ...Object.keys(patch.swaps)])) if (old[id] !== patch.swaps[id]) keys.push(`swaps.${id}`);
  }
  if (patch.skipped) {
    const old = new Set(before.skipped ?? []);
    const now = new Set(patch.skipped);
    for (const id of new Set([...old, ...now])) if (old.has(id) !== now.has(id)) keys.push(`skipped.${id}`);
  }
  for (const f of FIELDS) if (f in patch && JSON.stringify(patch[f]) !== JSON.stringify(before[f])) keys.push(f);
  return keys;
}

/**
 * Merge two copies of one session field by field: the newer record is the base, and any field the
 * other copy changed more recently (per `fieldAt`) is taken from it. `changed` says whether the result
 * differs from the newer copy, i.e. whether it needs pushing again.
 */
export function mergeSession(a: Session, b: Session): { session: Session; changed: boolean } {
  const [base, other] = Date.parse(b.updatedAt) > Date.parse(a.updatedAt) ? [b, a] : [a, b];
  const out: Session = { ...base, swaps: { ...(base.swaps ?? {}) }, skipped: [...(base.skipped ?? [])], fieldAt: { ...(base.fieldAt ?? {}) } };
  let changed = false;
  for (const [key, at] of Object.entries(other.fieldAt ?? {})) {
    if ((base.fieldAt?.[key] ?? '') >= at) continue;
    changed = true;
    out.fieldAt![key] = at;
    if (key.startsWith('swaps.')) {
      const id = key.slice('swaps.'.length);
      if (other.swaps?.[id] !== undefined) out.swaps![id] = other.swaps[id];
      else delete out.swaps![id];
    } else if (key.startsWith('skipped.')) {
      const id = key.slice('skipped.'.length);
      out.skipped = out.skipped!.filter((x) => x !== id);
      if (other.skipped?.includes(id)) out.skipped.push(id);
    } else if ((FIELDS as readonly string[]).includes(key)) {
      (out as Record<string, unknown>)[key] = (other as Record<string, unknown>)[key];
    }
  }
  return { session: out, changed };
}
