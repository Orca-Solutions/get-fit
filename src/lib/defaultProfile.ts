import type { Profile } from '../types';

export const PROFILE_ID = 'me';
export const EPOCH = new Date(0).toISOString();

/** Jason's setup: Planet Fitness gym, bands and 25/35 lb kettlebells at home. All editable in Settings. */
/**
 * updatedAt is the epoch on purpose: a fresh device's defaults must never win a sync or an import
 * against a profile you actually edited. Any change made in Settings gets a real timestamp.
 */
export function defaultProfile(t = new Date().toISOString()): Profile {
  return {
    id: PROFILE_ID,
    createdAt: t,
    updatedAt: EPOCH,
    deletedAt: null,
    heightIn: 72,
    bodyweightLb: 168,
    units: 'lb',
    schedule: [
      // Legs midweek, so a Sunday long run doesn't land the day before leg day.
      { weekdays: [1], type: 'chest-biceps', location: 'gym' },
      { weekdays: [3], type: 'legs', location: 'gym' },
      { weekdays: [5], type: 'back-tri-shoulders', location: 'gym' },
      { weekdays: [6, 0], type: 'core', location: 'home' },
    ],
    equipmentByLocation: {
      gym: ['dumbbell', 'kettlebell', 'cable', 'machine', 'smith-machine', 'bench', 'pull-up-bar', 'back-extension-bench', 'plate', 'mat', 'none'],
      home: ['band', 'kettlebell', 'ab-wheel', 'mat', 'none'],
    },
    bands: [
      { id: 'band-light', name: 'Light', order: 1 },
      { id: 'band-medium', name: 'Medium', order: 2 },
      { id: 'band-heavy', name: 'Heavy', order: 3 },
    ],
    kettlebells: [{ lb: 25, count: 2 }, { lb: 35, count: 1 }],
    smithBarLb: 20,
    coreWave: 'wave',
  };
}

