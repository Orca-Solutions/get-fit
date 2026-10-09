import { describe, expect, it } from 'vitest';
import { adjustRest, formatRest, isStale, progress, secondsLeft, startRest, STALE_AFTER_MS } from '../src/lib/restTimer';
import { restFor } from '@orca-solutions/get-fit-core';

describe('rest timer', () => {
  it('counts from wall-clock time, so a locked screen or a backgrounded app keeps time', () => {
    const r = startRest(1_000_000, 150, 'Smith squat');
    expect(secondsLeft(r, 1_000_000)).toBe(150);
    // No ticks in between (the phone was locked): coming back 100 s later shows 50 s left.
    expect(secondsLeft(r, 1_100_000)).toBe(50);
    expect(secondsLeft(r, 1_170_000)).toBe(-20);
    expect(formatRest(secondsLeft(r, 1_170_000))).toBe('0:20');
    expect(progress(r, 1_075_000)).toBeCloseTo(0.5);
  });

  it('adds and removes 30 seconds, never ending before now', () => {
    const r = startRest(0, 60, 'Curl');
    expect(secondsLeft(adjustRest(r, 30, 0), 0)).toBe(90);
    expect(secondsLeft(adjustRest(r, -30, 0), 0)).toBe(30);
    expect(secondsLeft(adjustRest(r, -90, 10_000), 10_000)).toBe(0);
  });

  it('clears a timer whose rest ended long ago', () => {
    const r = startRest(0, 60, 'Row');
    expect(isStale(r, 60_000 + STALE_AFTER_MS - 1)).toBe(false);
    expect(isStale(r, 60_000 + STALE_AFTER_MS + 1)).toBe(true);
  });

  it('rests longest after heavy compounds and shortest after isolation, grip and core', () => {
    expect(restFor('P', 'H')).toBeGreaterThan(restFor('P', 'M'));
    expect(restFor('P', 'M')).toBeGreaterThan(restFor('P', 'L'));
    expect(restFor('P', 'H')).toBeGreaterThan(restFor('I', 'H'));
    expect(restFor('G', 'H')).toBeLessThan(restFor('I', 'H'));
  });
});
