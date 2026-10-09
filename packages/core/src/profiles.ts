import type { Profile } from './types.js';

export const PROFILE_ID = 'me';
export const EPOCH = new Date(0).toISOString();

/**
 * updatedAt is the epoch on purpose: a fresh device's defaults must never win a sync or an import
 * against a profile someone actually edited. Any change made in Settings gets a real timestamp.
 */
function base(t: string): Pick<Profile, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'units' | 'schedule' | 'bands' | 'coreWave'> {
  return {
    id: PROFILE_ID,
    createdAt: t,
    updatedAt: EPOCH,
    deletedAt: null,
    units: 'lb',
    schedule: [
      // Legs midweek, so a weekend long run doesn't land the day before leg day.
      { weekdays: [1], type: 'chest-biceps', location: 'gym' },
      { weekdays: [3], type: 'legs', location: 'gym' },
      { weekdays: [5], type: 'back-tri-shoulders', location: 'gym' },
      { weekdays: [6, 0], type: 'core', location: 'home' },
    ],
    bands: [
      { id: 'band-light', name: 'Light', order: 1 },
      { id: 'band-medium', name: 'Medium', order: 2 },
      { id: 'band-heavy', name: 'Heavy', order: 3 },
    ],
    coreWave: 'wave',
  };
}

/**
 * A starting point with nothing personal in it: a typical commercial gym, bands at home, average
 * height and weight. Setup (or Settings) replaces it.
 */
export function neutralProfile(t = new Date().toISOString()): Profile {
  return {
    ...base(t),
    heightIn: 69,
    bodyweightLb: 170,
    equipmentByLocation: {
      gym: ['dumbbell', 'kettlebell', 'cable', 'machine', 'smith-machine', 'bench', 'pull-up-bar', 'back-extension-bench', 'plate', 'mat', 'none'],
      home: ['band', 'mat', 'none'],
    },
    kettlebells: [],
    smithBarLb: 20,
  };
}

/**
 * The profile the project was built and tuned on: a Planet Fitness-style gym (Smith machine, no free
 * barbell), bands, an ab wheel and 25 and 35 lb kettlebells at home. The golden test pins the plans it gets.
 */
export function referenceProfile(t = new Date().toISOString()): Profile {
  return {
    ...base(t),
    heightIn: 72,
    bodyweightLb: 168,
    equipmentByLocation: {
      gym: ['dumbbell', 'kettlebell', 'cable', 'machine', 'smith-machine', 'bench', 'pull-up-bar', 'back-extension-bench', 'plate', 'mat', 'none'],
      home: ['band', 'kettlebell', 'ab-wheel', 'mat', 'none'],
    },
    kettlebells: [{ lb: 25, count: 2 }, { lb: 35, count: 1 }],
    smithBarLb: 20,
  };
}
