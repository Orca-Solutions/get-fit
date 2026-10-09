// The program's numbers, as the generator reads them: reps, sets, effort and rest per role and zone.
// Each takes the program's params and defaults to the original program (docs/periodization.md §4).
import type { SessionType, SlotRole, Zone } from '../types.js';
import { STRANGE_PERIODIZATION, type LiftDay, type RepRange, type TrainingParams } from '../program.js';

const DEFAULT = STRANGE_PERIODIZATION.params;

/** Display names for the original program's day types. */
export const SESSION_LABEL: Record<SessionType, string> = Object.fromEntries(Object.entries(STRANGE_PERIODIZATION.days).map(([k, d]) => [k, d.label]));

/** Lifting days of the original program (kept for callers that predate Program). */
export const LIFT_TEMPLATES: Record<SessionType, LiftDay> = Object.fromEntries(
  Object.entries(STRANGE_PERIODIZATION.days).filter((e): e is [string, LiftDay] => e[1].kind === 'lift'),
);

/** Zone per lifting day for weeks 1–3; week 4 is the deload (§4.2 zone rotation). */
export const ZONE_ROTATION: Record<SessionType, Zone[]> = Object.fromEntries(Object.entries(LIFT_TEMPLATES).map(([k, d]) => [k, d.zones]));

export const ZONE_NAME: Record<Zone | 'deload', string> = { H: 'Heavy', M: 'Moderate', L: 'Light', deload: 'Deload' };

/** Compound rep range per zone. Block 1 can be narrower. */
export function compoundReps(zone: Zone, blockIndex: number, p: TrainingParams = DEFAULT): RepRange {
  return (blockIndex === 1 && p.reps.compoundBlock1[zone]) || p.reps.compound[zone];
}

/** Isolation and variety slots ignore the zone's compound range. */
export function isolationReps(zone: Zone, p: TrainingParams = DEFAULT): RepRange {
  return p.reps.isolation[zone];
}

export function setsFor(role: SlotRole, zone: Zone | 'deload', blockIndex: number, p: TrainingParams = DEFAULT): number {
  if (zone === 'deload') return p.sets.deload;
  const r = role === 'K' ? 'V' : role;
  return (blockIndex === 1 ? p.sets.block1[r]?.[zone] : undefined) ?? p.sets.byRole[r][zone];
}

const isCompound = (role: SlotRole) => role === 'P' || role === 'C';

/** Effort ramp across the block: RIR per week, then the deload. */
export function rirFor(weekIndex: number, role: SlotRole, p: TrainingParams = DEFAULT): number {
  if (weekIndex >= 3) return p.rir.deload;
  return (isCompound(role) ? p.rir.compound : p.rir.other)[weekIndex];
}

export function restFor(role: SlotRole, zone: Zone | 'deload', p: TrainingParams = DEFAULT): number {
  if (isCompound(role)) return p.rest.compound[zone];
  if (role === 'G') return p.rest.grip;
  return p.rest.other[zone];
}

export function coreTargets(zone: Zone, p: TrainingParams = DEFAULT): { reps: RepRange; seconds: RepRange } {
  return p.core.targets[zone];
}
