import type { Profile } from './types.js';

/** "25x2, 35" → [{lb:25,count:2},{lb:35,count:1}] */
export function parseKettlebells(v: string): Profile['kettlebells'] {
  const out = new Map<number, number>();
  for (const part of v.split(',')) {
    const m = part.trim().match(/^(\d+(?:\.\d+)?)\s*(?:lb)?\s*(?:[x×*]\s*(\d+))?$/i);
    if (!m) continue;
    const lb = Number(m[1]);
    if (lb > 0) out.set(lb, (out.get(lb) ?? 0) + Number(m[2] ?? 1));
  }
  return [...out].map(([lb, count]) => ({ lb, count })).sort((a, b) => a.lb - b.lb);
}
