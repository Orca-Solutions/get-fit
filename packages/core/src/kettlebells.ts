import type { Profile } from './types.js';

const KG_TO_LB = 2.20462;
// "35", "35 lb", "35lbs", "16kg", "25x2", "2 x 25", "25 lb × 2"
const PART = /^(\d+(?:\.\d+)?)\s*(lbs?|pounds?|kgs?|kilos?)?\s*(?:[x×*]\s*(\d+(?:\.\d+)?)\s*(lbs?|pounds?|kgs?|kilos?)?)?$/i;

/**
 * Reads the home kettlebell list as typed in Settings. "25x2" and "2 x 25" are both a pair of 25s:
 * a number with a unit is the weight, otherwise the larger number is. kg is converted to the nearest lb.
 * Parts it can't read come back in `skipped` so the caller can refuse to save rather than drop them.
 */
export function readKettlebells(v: string): { kettlebells: Profile['kettlebells']; skipped: string[] } {
  const out = new Map<number, number>();
  const skipped: string[] = [];
  for (const raw of v.split(/[,;]/)) {
    const part = raw.trim();
    if (!part) continue;
    const m = part.match(PART);
    const [a, b] = m ? [Number(m[1]), m[3] == null ? 1 : Number(m[3])] : [0, 0];
    // Which number is the weight: the one with a unit, else the larger one.
    const firstIsWeight = !m || m[2] ? true : m[4] ? false : a >= b;
    const [weight, count, unit] = firstIsWeight ? [a, b, m?.[2]] : [b, a, m?.[4]];
    const lb = /^k/i.test(unit ?? '') ? Math.round(weight * KG_TO_LB) : weight;
    if (!m || !(lb > 0) || !Number.isInteger(count) || count < 1) {
      skipped.push(part);
      continue;
    }
    out.set(lb, (out.get(lb) ?? 0) + count);
  }
  return { kettlebells: [...out].map(([lb, count]) => ({ lb, count })).sort((x, y) => x.lb - y.lb), skipped };
}

/** "25x2, 35" → [{lb:25,count:2},{lb:35,count:1}]. Parts it can't read are dropped; see readKettlebells. */
export function parseKettlebells(v: string): Profile['kettlebells'] {
  return readKettlebells(v).kettlebells;
}
