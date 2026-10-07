// Day templates, zone tables and rotations from docs/periodization.md §4.
import type { CoreDynamic, FocusMuscle, GripType, SessionType, SlotKey, SlotRole, Zone } from '../types';

export type BaseSlot = { key: SlotKey; role: Exclude<SlotRole, 'V' | 'G' | 'K'> };

export const LIFT_TEMPLATES: Record<Exclude<SessionType, 'core'>, { base: BaseSlot[]; vPool: SlotKey[]; label: string }> = {
  legs: {
    label: 'Legs',
    base: [
      { key: 'legs:squat', role: 'P' },
      { key: 'legs:hinge', role: 'C' },
      { key: 'legs:single-leg', role: 'C' },
      { key: 'legs:knee-extension', role: 'I' },
      { key: 'legs:knee-flexion', role: 'I' },
      { key: 'legs:calf', role: 'I' },
    ],
    vPool: ['legs:v:hip-extension', 'legs:v:squat-machine', 'legs:v:adduction', 'legs:v:abduction', 'legs:v:hinge-variant'],
  },
  'chest-biceps': {
    label: 'Chest & biceps',
    base: [
      { key: 'chest:flat-press', role: 'P' },
      { key: 'chest:incline-press', role: 'C' },
      { key: 'chest:fly', role: 'I' },
      { key: 'biceps:supinated', role: 'I' },
      { key: 'biceps:neutral', role: 'I' },
      { key: 'biceps:stretch', role: 'I' },
    ],
    vPool: ['chest:v:press-variant', 'biceps:v:curl-variant'],
  },
  'back-tri-shoulders': {
    label: 'Back, triceps & shoulders',
    base: [
      { key: 'back:vertical-pull', role: 'P' },
      { key: 'back:horizontal-pull', role: 'C' },
      { key: 'shoulders:vertical-press', role: 'C' },
      { key: 'shoulders:side-delt', role: 'I' },
      { key: 'triceps:overhead', role: 'I' },
      { key: 'triceps:pushdown', role: 'I' },
    ],
    vPool: ['shoulders:v:rear-delt', 'back:v:row-variant', 'back:v:shrug'],
  },
};

export const SESSION_LABEL: Record<SessionType, string> = {
  legs: 'Legs',
  'chest-biceps': 'Chest & biceps',
  'back-tri-shoulders': 'Back, triceps & shoulders',
  core: 'Core (home)',
};

/** Zone per lifting day for weeks 1–3; week 4 is the deload (§4.2 zone rotation). */
export const ZONE_ROTATION: Record<Exclude<SessionType, 'core'>, Zone[]> = {
  legs: ['H', 'M', 'L'],
  'chest-biceps': ['M', 'L', 'H'],
  'back-tri-shoulders': ['L', 'H', 'M'],
};

export const ZONE_NAME: Record<Zone | 'deload', string> = { H: 'Heavy', M: 'Moderate', L: 'Light', deload: 'Deload' };

/** Compound rep range per zone. Block 1 is narrower at both ends. */
export function compoundReps(zone: Zone, blockIndex: number): { min: number; max: number } {
  if (zone === 'H') return blockIndex === 1 ? { min: 6, max: 8 } : { min: 5, max: 8 };
  if (zone === 'M') return { min: 8, max: 12 };
  return blockIndex === 1 ? { min: 12, max: 15 } : { min: 12, max: 20 };
}

/** Isolation and variety slots ignore the zone's compound range. */
export function isolationReps(zone: Zone): { min: number; max: number } {
  return zone === 'L' ? { min: 12, max: 20 } : { min: 10, max: 15 };
}

export function setsFor(role: SlotRole, zone: Zone | 'deload', blockIndex: number): number {
  if (zone === 'deload') return 2;
  if (role === 'P') return zone === 'H' ? (blockIndex === 1 ? 3 : 4) : zone === 'M' ? 3 : 2;
  if (role === 'C') return zone === 'H' || zone === 'M' ? 3 : 2;
  if (role === 'I') return zone === 'H' ? 3 : 2;
  return 2; // V and grip
}

/** Effort ramp across the block: RIR per week, compounds never below 1. */
export function rirFor(weekIndex: number, role: SlotRole): number {
  if (weekIndex >= 3) return 4;
  if (weekIndex === 0) return 3;
  if (weekIndex === 1) return 2;
  return role === 'P' || role === 'C' ? 2 : 1;
}

export function restFor(role: SlotRole, zone: Zone | 'deload'): number {
  if (role === 'P' || role === 'C') return zone === 'H' ? 150 : zone === 'M' ? 105 : 75;
  if (role === 'G') return 60;
  return zone === 'H' ? 90 : 75;
}

/** Variety slots per zone (Anatoly's "wider variety when the bar gets lighter"). */
export const V_SLOTS: Record<Zone, number> = { H: 0, M: 1, L: 2 };

export const FOCUS_ROTATION: FocusMuscle[] = ['side-delts', 'chest', 'arms', 'upper-back', 'glutes-hamstrings'];

export const FOCUS_LABEL: Record<FocusMuscle, string> = {
  'side-delts': 'side delts',
  chest: 'chest',
  arms: 'arms',
  'upper-back': 'upper back',
  'glutes-hamstrings': 'glutes and hamstrings',
};

/**
 * Where the focus muscle lands per session: the V slot it claims on M/L days,
 * and the base slot that gets +1 set on an H day.
 */
export const FOCUS_SLOTS: Record<FocusMuscle, Partial<Record<SessionType, { v: SlotKey[]; heavyExtra: SlotKey }>>> = {
  'side-delts': { 'back-tri-shoulders': { v: ['shoulders:side-delt'], heavyExtra: 'shoulders:side-delt' } },
  chest: { 'chest-biceps': { v: ['chest:v:press-variant', 'chest:fly'], heavyExtra: 'chest:fly' } },
  arms: {
    'chest-biceps': { v: ['biceps:v:curl-variant'], heavyExtra: 'biceps:supinated' },
    'back-tri-shoulders': { v: ['triceps:pushdown', 'triceps:overhead'], heavyExtra: 'triceps:pushdown' },
  },
  'upper-back': { 'back-tri-shoulders': { v: ['back:v:row-variant'], heavyExtra: 'back:horizontal-pull' } },
  'glutes-hamstrings': { legs: { v: ['legs:v:hip-extension', 'legs:v:hinge-variant'], heavyExtra: 'legs:knee-flexion' } },
};

export const GRIP_ROTATION: GripType[] = ['support', 'crush', 'pinch', 'wrist-flexion', 'wrist-extension', 'rotation', 'reverse-curl'];

/** Core day: 4 supersets pairing opposing dynamics (§4.2 core day). */
export const CORE_SUPERSETS: [string, CoreDynamic, CoreDynamic][] = [
  ['A', 'anti-extension', 'hip-extension'],
  ['B', 'trunk-flexion', 'anti-rotation'],
  ['C', 'rotation', 'anti-lateral-flexion'],
  ['D', 'hip-flexion', 'lateral-flexion'],
];

/** Core wave: week 1 Moderate, week 2 Heavy, week 3 Light, week 4 deload. */
export const CORE_WAVE: Zone[] = ['M', 'H', 'L'];

export function coreTargets(zone: Zone): { reps: { min: number; max: number }; seconds: { min: number; max: number } } {
  if (zone === 'H') return { reps: { min: 6, max: 10 }, seconds: { min: 15, max: 25 } };
  if (zone === 'L') return { reps: { min: 15, max: 25 }, seconds: { min: 45, max: 60 } };
  return { reps: { min: 10, max: 15 }, seconds: { min: 30, max: 40 } };
}

/** Major muscles get a 4-set weekly floor and a 6-set block average (§4.2 coverage check). */
export const MAJOR_MUSCLES = ['quads', 'hamstrings', 'glutes', 'chest', 'lats', 'upper-back', 'side-delts', 'biceps', 'triceps'] as const;
export const MINOR_MUSCLES = ['calves', 'rear-delts', 'forearms'] as const;
