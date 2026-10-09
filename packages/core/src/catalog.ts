import catalogJson from './data/exercises.json' with { type: 'json' };
import type { Exercise } from './types.js';

/** The curated exercise library (built by scripts/build-exercises.ts). */
export const CATALOG = catalogJson as unknown as Exercise[];
