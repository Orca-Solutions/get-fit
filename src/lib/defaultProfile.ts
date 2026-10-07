import type { Profile } from '../types';

export const PROFILE_ID = 'me';

/** Jason's setup: Planet Fitness gym, bands and 25/35 lb kettlebells at home. All editable in Settings. */
export function defaultProfile(t = new Date().toISOString()): Profile {
  return {
    id: PROFILE_ID,
    createdAt: t,
    updatedAt: t,
    deletedAt: null,
    heightIn: 72,
    bodyweightLb: 168,
    units: 'lb',
    schedule: [
      { weekdays: [1], type: 'legs', location: 'gym' },
      { weekdays: [3], type: 'chest-biceps', location: 'gym' },
      { weekdays: [5], type: 'back-tri-shoulders', location: 'gym' },
      { weekdays: [6, 0], type: 'core', location: 'home' },
    ],
    equipmentByLocation: {
      gym: ['dumbbell', 'kettlebell', 'cable', 'machine', 'smith-machine', 'bench', 'pull-up-bar', 'back-extension-bench', 'plate', 'mat', 'none'],
      home: ['band', 'kettlebell', 'mat', 'none'],
    },
    bands: [
      { id: 'band-light', name: 'Light', order: 1 },
      { id: 'band-medium', name: 'Medium', order: 2 },
      { id: 'band-heavy', name: 'Heavy', order: 3 },
    ],
    kettlebellsLb: [25, 35],
    smithBarLb: 20,
    coreWave: 'wave',
  };
}

