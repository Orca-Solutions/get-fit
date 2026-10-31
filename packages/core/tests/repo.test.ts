import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GetFitDB } from '../src/client/db';
import { configureSync } from '../src/client/sync';
import { blockEnd, deloadSessionIds, ensurePlan, hintContext, exportAll, exportSetsCsv, getProfile, importAll, liveBlocks, logSet, planAfterSync, regenerateUpcoming, startSession, unlogSet, workoutState, workoutsWithLogs } from '../src/client/repo';
import { validRow } from '../src/validate';
import { CATALOG } from '../src/catalog';
import { addDays, mondayOf, today } from '../src/dates';

let n = 0;
async function fresh() {
  const d = new GetFitDB(`repo-${++n}`);
  await d.open();
  return d;
}

describe('repo', () => {
  afterEach(() => vi.useRealTimers());
  it('plans the current block plus the next one, and never stacks blocks when one starts later', async () => {
    const d = await fresh();
    const b = await ensurePlan(today(), d);
    expect(b.startDate).toBe(mondayOf(today()));
    expect(b.id).toBe(`block-${b.startDate}`);
    const starts = async () => (await d.blocks.orderBy('startDate').toArray()).map((x) => x.startDate);
    expect(await starts()).toEqual([b.startDate, addDays(b.startDate, 28)]);
    expect(await d.plannedWorkouts.where('blockId').equals(`block-${addDays(b.startDate, 28)}`).count()).toBeGreaterThan(0);
    await ensurePlan(today(), d);
    expect(await d.blocks.count()).toBe(2);
    // Clock moved backwards a week: the existing (later) blocks are reused.
    await ensurePlan(addDays(b.startDate, -7), d);
    expect(await d.blocks.count()).toBe(2);
    // On the next block's first day it becomes current and the one after it is planned.
    const next = await ensurePlan(addDays(b.startDate, 28), d);
    expect(next.startDate).toBe(addDays(b.startDate, 28));
    expect(next.index).toBe(2);
    expect(await starts()).toEqual([b.startDate, addDays(b.startDate, 28), addDays(b.startDate, 56)]);
  });

  it('rebuilds a block planned ahead from the latest logs when it starts, once', async () => {
    const d = await fresh();
    const first = await ensurePlan(today(), d);
    const nextStart = addDays(first.startDate, 28);
    expect((await d.blocks.get(`block-${nextStart}`))!.plannedAhead).toBe(true);
    // A movement in the next block gets logged in this block, so it is no longer new when the next block starts.
    const nextWorkouts = await d.plannedWorkouts.where('blockId').equals(`block-${nextStart}`).toArray();
    const firstTimer = nextWorkouts.flatMap((w) => w.exercises).find((e) => e.note?.includes('First time'))!;
    const w = (await d.plannedWorkouts.where('blockId').equals(first.id).toArray())[0];
    const s = await startSession(w.id, today(), d);
    await logSet(s, firstTimer.exerciseId, null, 0, { weight: 20, reps: 10 }, d);
    await ensurePlan(nextStart, d);
    const rebuilt = await d.blocks.get(`block-${nextStart}`);
    expect(rebuilt!.plannedAhead).toBe(false);
    const after = (await d.plannedWorkouts.where('blockId').equals(`block-${nextStart}`).toArray()).flatMap((x) => x.exercises);
    expect(after.filter((e) => e.exerciseId === firstTimer.exerciseId).every((e) => !e.note?.includes('First time'))).toBe(true);
    const stamp = rebuilt!.updatedAt;
    await ensurePlan(nextStart, d);
    expect((await d.blocks.get(`block-${nextStart}`))!.updatedAt).toBe(stamp);
  });

  describe('stalls at block boundaries', () => {
    /** Log the squat on every leg day of blocks 1 and 2 (heavy, moderate, light, deload weights), then start block 3. */
    async function liveTwoBlocks(block2: number[]) {
      const d = await fresh();
      vi.useFakeTimers({ toFake: ['Date'] });
      const start = mondayOf('2026-10-12');
      vi.setSystemTime(new Date(`${start}T12:00:00Z`));
      const b1 = await ensurePlan(start, d);
      const squat = b1.baseSlots['legs|legs:squat'];
      for (const [k, weights] of [[80, 65, 55, 55], block2].entries()) {
        const blockStart = addDays(start, 28 * k);
        vi.setSystemTime(new Date(`${blockStart}T12:00:00Z`));
        await ensurePlan(blockStart, d);
        const legs = (await d.plannedWorkouts.where('blockId').equals(`block-${blockStart}`).toArray()).filter((w) => w.sessionType === 'legs' && !w.deletedAt).sort((a, b) => a.date.localeCompare(b.date));
        for (const [week, w] of legs.entries()) {
          vi.setSystemTime(new Date(`${w.date}T17:00:00Z`));
          const pe = w.exercises.find((e) => e.slot === 'legs:squat')!;
          expect(pe.exerciseId).toBe(squat);
          const session = await startSession(w.id, w.date, d);
          for (const set of pe.sets) await logSet(session, pe.exerciseId, pe.id, set.setIndex, { weight: weights[week], reps: set.targetReps!.min }, d);
        }
      }
      const third = addDays(start, 56);
      vi.setSystemTime(new Date(`${third}T12:00:00Z`));
      const { id } = await ensurePlan(third, d);
      // Read it back: the block planned ahead is rebuilt from the logs when it starts.
      const b3 = (await d.blocks.get(id))!;
      expect(b3.plannedAhead).toBe(false);
      return { squat, b3 };
    }

    it('keeps a main lift that gained weight block on block, though its light week and deload came in lower', async () => {
      const { squat, b3 } = await liveTwoBlocks([90, 70, 60, 60]);
      expect(b3.index).toBe(3);
      expect(b3.baseSlots['legs|legs:squat']).toBe(squat);
    });

    it('rotates a main lift whose best was no better than the block before', async () => {
      const { squat, b3 } = await liveTwoBlocks([80, 65, 55, 55]);
      expect(b3.baseSlots['legs|legs:squat']).not.toBe(squat);
    });
  });

  it('dates an opened-but-empty session from its first logged set', async () => {
    const d = await fresh();
    await ensurePlan(today(), d);
    const w = (await d.plannedWorkouts.toArray())[0];
    const s = await startSession(w.id, '2020-01-01', d);
    expect(await workoutsWithLogs(d)).toEqual(new Set());
    const set = await logSet(s, w.exercises[0].exerciseId, w.exercises[0].id, 0, { weight: 50, reps: 8 }, d);
    expect(set.date).toBe(today());
    expect((await d.sessions.get(s.id))!.date).toBe(today());
    expect(await workoutsWithLogs(d)).toEqual(new Set([w.id]));
  });

  it("keeps a session's day when its only set is deleted and logged again", async () => {
    const d = await fresh();
    await ensurePlan(today(), d);
    const w = (await d.plannedWorkouts.toArray())[0];
    const pe = w.exercises[0];
    const s = await startSession(w.id, today(), d);
    const first = await logSet(s, pe.exerciseId, pe.id, 0, { weight: 50, reps: 8 }, d);
    const old = addDays(today(), -9);
    await d.sessions.update(s.id, { date: old });
    await d.loggedSets.update(first.id, { date: old });
    await unlogSet(first.id, d);
    const again = await logSet({ id: s.id, date: old }, pe.exerciseId, pe.id, 0, { weight: 55, reps: 8 }, d);
    expect(again.date).toBe(old);
    expect((await d.sessions.get(s.id))!.date).toBe(old);
  });

  it('calls a workout done a day early done, and one after its window done late', () => {
    const w = { date: '2026-10-21', exercises: [] } as unknown as Parameters<typeof workoutState>[0];
    const on = (date: string) => ({ date }) as Parameters<typeof workoutState>[1];
    expect(workoutState(w, on('2026-10-20'), 8, 8, '2026-10-20', '2026-01-01')).toBe('done');
    expect(workoutState(w, on('2026-10-21'), 8, 8, '2026-10-21', '2026-01-01')).toBe('done');
    expect(workoutState(w, on('2026-10-22'), 8, 8, '2026-10-22', '2026-01-01')).toBe('done-late');
    expect(workoutState({ ...w, windowEnd: '2026-10-22' }, on('2026-10-22'), 8, 8, '2026-10-22', '2026-01-01')).toBe('done');
  });

  it('refuses a logged set whose weight, reps or time is not a usable number', () => {
    const t = '2026-10-18T10:00:00.000Z';
    const ok = { id: 'x', updatedAt: t, sessionId: 's', exerciseId: 'goblet-squat', setIndex: 0, date: '2026-10-18', loggedAt: t, weight: 50, reps: 8, effort: 'right' };
    expect(validRow('loggedSets', ok)).toBe(true);
    expect(validRow('loggedSets', { ...ok, weight: null, reps: undefined, seconds: 30, effort: null })).toBe(true);
    for (const bad of [{ weight: '135' }, { reps: '8' }, { weight: NaN }, { weight: -5 }, { reps: Infinity }, { seconds: '30' }, { effort: 'max' }]) {
      expect(validRow('loggedSets', { ...ok, ...bad })).toBe(false);
    }
  });

  it('lists the sessions logged against a deload workout', async () => {
    const d = await fresh();
    await ensurePlan(today(), d);
    const planned = await d.plannedWorkouts.toArray();
    const deload = planned.find((w) => w.isDeload)!;
    const loading = planned.find((w) => !w.isDeload)!;
    const a = await startSession(deload.id, deload.date, d);
    await startSession(loading.id, loading.date, d);
    expect(await deloadSessionIds(d)).toEqual(new Set([a.id]));
  });

  it('gives the weight hint the deload sessions and each logged set\'s planned reps', async () => {
    const d = await fresh();
    await ensurePlan(today(), d);
    const planned = await d.plannedWorkouts.toArray();
    const deload = planned.find((w) => w.isDeload)!;
    const loading = planned.find((w) => !w.isDeload && w.exercises[0].sets[0].targetReps)!;
    const pe = loading.exercises[0];
    const a = await startSession(deload.id, deload.date, d);
    const b = await startSession(loading.id, loading.date, d);
    await logSet(b, pe.exerciseId, pe.id, 1, { weight: 50, reps: 10 }, d);
    const ctx = await hintContext(d);
    expect(ctx.isDeload({ sessionId: a.id, date: deload.date, sets: [], bestE1rm: null })).toBe(true);
    expect(ctx.isDeload({ sessionId: b.id, date: loading.date, sets: [], bestE1rm: null })).toBe(false);
    const set = (await d.loggedSets.toArray())[0];
    expect(ctx.targetOf(set)).toEqual(pe.sets[1].targetReps);
    expect(ctx.targetOf({ ...set, plannedExerciseId: null })).toBeUndefined();
  });

  it('numbers on from the last block with logs after the app sat unopened past the plan, dropping the untrained block', async () => {
    const d = await fresh();
    const start = mondayOf(today());
    const b1 = await ensurePlan(start, d);
    const w = (await d.plannedWorkouts.where('blockId').equals(b1.id).toArray()).find((x) => x.sessionType === 'legs')!;
    const s = await startSession(w.id, w.date, d);
    await logSet(s, w.exercises[0].exerciseId, w.exercises[0].id, 0, { weight: 50, reps: 8 }, d);
    // Block 2 was planned ahead and never trained; the lifter comes back 9 weeks after block 1 ended.
    const back = await ensurePlan(addDays(blockEnd(b1), 65), d);
    expect(back.index).toBe(2);
    expect(back.startDate).toBe(mondayOf(addDays(blockEnd(b1), 65)));
    const blocks = await liveBlocks(d);
    expect(blocks.map((b) => b.index)).toEqual([1, 2, 3]);
    expect(blocks.some((b) => b.startDate === addDays(blockEnd(b1), 1))).toBe(false);
    // The dropped block's workouts go with it.
    expect((await d.plannedWorkouts.where('blockId').equals(`block-${addDays(blockEnd(b1), 1)}`).toArray()).every((x) => x.deletedAt)).toBe(true);
  });

  it('tells the hint when a movement\'s time off began, from logged work only', async () => {
    const d = await fresh();
    // A set is dated the day it's logged, so the clock is set to each workout's day (and the test doesn't depend on today's).
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-12T12:00:00Z') });
    await ensurePlan('2026-10-12', d);
    const legs = (await d.plannedWorkouts.toArray()).filter((x) => x.sessionType === 'legs' && !x.isDeload).sort((a, b) => a.date.localeCompare(b.date));
    const [wk1, wk2, wk3] = legs;
    const squat = wk1.exercises[0].exerciseId;
    const log = async (w: typeof wk1, i = 0) => {
      vi.setSystemTime(new Date(`${w.date}T17:00:00Z`));
      return logSet(await startSession(w.id, w.date, d), w.exercises[i].exerciseId, w.exercises[i].id, 0, { weight: 50, reps: 8 }, d);
    };
    await log(wk1);
    // Week 2's legs day was opened but nothing was logged: time off from the last log, though the app was in use.
    await startSession(wk2.id, wk2.date, d);
    expect((await hintContext(d)).timeOffFrom(squat, wk1.date, wk3.date)).toBe(wk1.date);
    // Week 2's other movement logged, the squat not: off from a week before its unlogged day, which is week 1.
    await log(wk2, 1);
    expect((await hintContext(d)).timeOffFrom(squat, wk1.date, addDays(wk3.date, 1))).toBe(wk1.date);
    // Logged in week 2: no time off, and none for a movement that wasn't planned.
    await log(wk2);
    const ctx = await hintContext(d);
    expect(ctx.timeOffFrom(squat, wk1.date, wk3.date)).toBeUndefined();
    expect(ctx.timeOffFrom('barbell-deadlift', wk1.date, wk3.date)).toBeUndefined();
    // Nothing logged at all in between: the whole gap, whatever the plan said.
    expect(ctx.timeOffFrom('barbell-deadlift', wk2.date, addDays(wk2.date, 30))).toBe(wk2.date);
    // Other work logged, then 10+ days with nothing at all: time off from then, though the plan had it off.
    expect(ctx.timeOffFrom('barbell-deadlift', wk1.date, addDays(wk2.date, 12))).toBe(wk2.date);
    expect(ctx.timeOffFrom('barbell-deadlift', wk1.date, addDays(wk2.date, 9))).toBeUndefined();
    // A whole block planned without a movement: rotated out. One it's in, or a span that misses part of the block: not.
    const days = (await d.plannedWorkouts.toArray()).filter((x) => x.blockId === wk1.blockId).map((x) => x.date).sort();
    const [before, after] = [addDays(days[0], -1), addDays(days[days.length - 1], 1)];
    expect(ctx.rotatedOut('barbell-deadlift', before, after)).toBe(true);
    expect(ctx.rotatedOut(squat, before, after)).toBe(false);
    expect(ctx.rotatedOut('barbell-deadlift', days[0], after)).toBe(false);
  });

  it("dates every set of a session by the day its first set was logged, even from the caller's older copy", async () => {
    const d = await fresh();
    await ensurePlan('2026-10-12', d);
    const w = (await d.plannedWorkouts.toArray()).find((x) => x.sessionType === 'legs')!;
    // Opened on its planned day, logged later: the screen still holds the session as it was opened.
    const opened = await startSession(w.id, w.date, d);
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${addDays(w.date, 2)}T17:00:00Z`) });
    const first = await logSet(opened, w.exercises[0].exerciseId, w.exercises[0].id, 0, { weight: 50, reps: 8 }, d);
    const second = await logSet(opened, w.exercises[0].exerciseId, w.exercises[0].id, 1, { weight: 50, reps: 8 }, d);
    expect(first.date).toBe(addDays(w.date, 2));
    expect(second.date).toBe(first.date);
    expect((await d.sessions.get(opened.id))!.date).toBe(first.date);
  });

  it('merges a partial update into the stored set instead of reverting other fields', async () => {
    const d = await fresh();
    await ensurePlan(today(), d);
    const w = (await d.plannedWorkouts.toArray())[0];
    const pe = w.exercises[0];
    const s = await startSession(w.id, today(), d);
    await logSet(s, pe.exerciseId, pe.id, 0, { weight: 50, reps: 10 }, d);
    await logSet(s, pe.exerciseId, pe.id, 0, { reps: 8 }, d);
    await logSet(s, pe.exerciseId, pe.id, 0, { effort: 'hard' }, d);
    const sets = (await d.loggedSets.toArray()).filter((x) => !x.deletedAt);
    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ weight: 50, reps: 8, effort: 'hard' });
  });

  it('a backup restored on a fresh device replaces its defaults and is re-pushed on the next sync', async () => {
    const source = await fresh();
    const profile = await getProfile(source);
    await source.profile.put({ ...profile, bodyweightLb: 181, updatedAt: '2026-10-01T00:00:00.000Z' });
    await ensurePlan(today(), source);
    const tables: Record<string, { id: string; updatedAt: string }[]> = {};
    for (const t of ['profile', 'blocks', 'plannedWorkouts']) tables[t] = await source.table(t).toArray();

    const phone = await fresh();
    await getProfile(phone);
    await ensurePlan(today(), phone);
    await phone.meta.put({ key: 'lastPushedAt', value: new Date().toISOString() });
    await importAll({ tables }, phone);
    expect((await getProfile(phone)).bodyweightLb).toBe(181);
    expect(await phone.blocks.count()).toBe(2); // the backup's current and next block, no duplicates
    expect(await phone.meta.get('lastPushedAt')).toBeUndefined();
  });

  it('restores a backup without removing sets logged since, and exports sets as CSV', async () => {
    const phone = await fresh();
    const block = await ensurePlan(today(), phone);
    const w = (await phone.plannedWorkouts.where('blockId').equals(block.id).toArray()).find((x) => x.sessionType !== 'core')!;
    const s = await startSession(w.id, w.date, phone);
    await logSet(s, w.exercises[0].exerciseId, w.exercises[0].id, 0, { weight: 95, reps: 8 }, phone);
    const backup = JSON.parse(JSON.stringify(await exportAll(phone)));

    // After the backup: one more set, and the first one deleted by mistake.
    await logSet(s, w.exercises[0].exerciseId, w.exercises[0].id, 1, { weight: 95, reps: 7 }, phone);
    await phone.loggedSets.clear();
    await logSet(s, w.exercises[0].exerciseId, w.exercises[0].id, 2, { weight: 90, reps: 9 }, phone);
    await importAll(backup, phone);
    expect((await phone.loggedSets.toArray()).map((x) => x.reps).sort()).toEqual([8, 9]);

    const csv = (await exportSetsCsv(phone)).trim().split('\n');
    expect(csv[0]).toBe('date,exercise,set,weight_lb,reps,seconds,band,stance_steps,effort,logged_at');
    expect(csv).toHaveLength(3);
    expect(csv[1]).toContain(',95,8,');

    await expect(importAll(JSON.parse('{"hello":1}'), phone)).rejects.toThrow('get-fit backup');
    await expect(importAll({ app: 'other', tables: {} }, phone)).rejects.toThrow('get-fit backup');
  });

  it('exports names that could read as formulas as text, from a restored backup too', async () => {
    const source = await fresh();
    const profile = await getProfile(source);
    const bands = [{ ...profile.bands[0], id: 'b-sum', name: '@SUM(1,1)' }, { ...profile.bands[0], id: 'b-neg', name: '-2 heavy, "red"' }];
    await source.profile.put({ ...profile, bands, updatedAt: '2026-10-01T00:00:00.000Z' });
    const t = '2026-10-01T00:00:00.000Z';
    await source.customExercises.put({ ...CATALOG[0], id: 'custom-eq', name: '=1+1', createdAt: t, updatedAt: t, deletedAt: null } as never);
    const set = { createdAt: t, updatedAt: t, deletedAt: null, sessionId: 's1', plannedExerciseId: null, date: '2026-10-01', loggedAt: t, reps: 10, seconds: null, weight: null, effort: null };
    await source.loggedSets.bulkPut([
      { ...set, id: 'l1', exerciseId: 'custom-eq', setIndex: 0, weight: 12.5 },
      { ...set, id: 'l2', exerciseId: CATALOG[0].id, setIndex: 0, bandId: 'b-sum', stanceSteps: -2 },
      { ...set, id: 'l3', exerciseId: CATALOG[0].id, setIndex: 1, bandId: 'b-neg', stanceSteps: 0 },
    ]);
    const phone = await fresh();
    await importAll(JSON.parse(JSON.stringify(await exportAll(source))), phone);
    expect((await exportSetsCsv(phone)).split('\n').slice(1)).toEqual([
      `2026-10-01,'=1+1,1,12.5,10,,,,,${t}`,
      `2026-10-01,${CATALOG[0].name},1,,10,,"'@SUM(1,1)",-2,,${t}`,
      `2026-10-01,${CATALOG[0].name},2,,10,,"'-2 heavy, ""red""",0,,${t}`,
      '',
    ]);
  });

  it('keeps the next block marked as planned ahead after a manual regenerate', async () => {
    const d = await fresh();
    const first = await ensurePlan(today(), d);
    await regenerateUpcoming(today(), d);
    expect((await d.blocks.get(`block-${addDays(first.startDate, 28)}`))!.plannedAhead).toBe(true);
  });

  it('skips backup rows that would crash a screen, and applies the rest', async () => {
    const source = await fresh();
    await ensurePlan(today(), source);
    const backup = JSON.parse(JSON.stringify(await exportAll(source)));
    const broken = { ...backup.tables.plannedWorkouts[0], id: 'w-broken', exercises: undefined };
    backup.tables.plannedWorkouts.push(broken, { id: 'w-junk' }, 'nonsense');

    const phone = await fresh();
    const { skipped } = await importAll(backup, phone);
    expect(skipped).toBe(3);
    expect(await phone.plannedWorkouts.get('w-broken')).toBeUndefined();
    expect(await phone.plannedWorkouts.count()).toBe(backup.tables.plannedWorkouts.length - 3);
    await expect(importAll({ app: 'get-fit', tables: { loggedSets: 'oops' } }, phone)).rejects.toThrow('get-fit backup');
  });

  it('restoring on a new device replaces the plan it made for itself, keeping the backup\'s timestamps', async () => {
    const source = await fresh();
    await ensurePlan('2026-10-14', source);
    const backup = JSON.parse(JSON.stringify(await exportAll(source)));

    // This device was opened weeks later and planned its own blocks, which never left it.
    const phone = await fresh();
    const own = await ensurePlan('2026-11-25', phone);
    await new Promise((r) => setTimeout(r, 5));
    await importAll(backup, phone);
    expect(await phone.blocks.get(own.id)).toBeUndefined();
    expect(await phone.plannedWorkouts.where('blockId').equals(own.id).count()).toBe(0);
    // Not re-stamped as newest, so whatever the account changed since the backup still wins when this device connects.
    const restored = backup.tables.blocks.find((b: { id: string }) => b.id === 'block-2026-10-12');
    expect((await phone.blocks.get('block-2026-10-12'))!.updatedAt).toBe(restored.updatedAt);
  });

  it('restoring on a device already connected to sync leaves the shared plan alone', async () => {
    const source = await fresh();
    await ensurePlan('2026-10-14', source);
    const backup = JSON.parse(JSON.stringify(await exportAll(source)));

    // The device joined the server's plan (rebuilt since), then restores an older backup.
    const phone = await fresh();
    await phone.meta.put({ key: 'syncToken', value: 'token' });
    await ensurePlan('2026-10-14', phone);
    const before = await phone.blocks.get('block-2026-10-12');
    await new Promise((r) => setTimeout(r, 5));
    await importAll(backup, phone);
    const after = await phone.blocks.get('block-2026-10-12');
    // Not re-stamped as newest, so it can't replace the server's copy on other devices.
    expect(after!.updatedAt).toBe(before!.updatedAt);
    expect((await phone.blocks.toArray()).every((b) => !b.deletedAt)).toBe(true);
  });

  it('counts a device signed in through headers, or one that has synced before, as connected', async () => {
    const source = await fresh();
    await ensurePlan('2026-10-14', source);
    const backup = JSON.parse(JSON.stringify(await exportAll(source)));
    const setups: [string, (d: GetFitDB) => Promise<unknown>][] = [
      ['cookie or account sign-in', async () => configureSync({ headers: () => ({}), credentials: 'include' })],
      ['synced before', (d) => d.meta.put({ key: 'joined', value: true })],
    ];
    for (const [, connect] of setups) {
      const phone = await fresh();
      await connect(phone);
      await ensurePlan('2026-10-14', phone);
      const before = await phone.blocks.get('block-2026-10-12');
      await new Promise((r) => setTimeout(r, 5));
      await importAll(backup, phone);
      expect((await phone.blocks.get('block-2026-10-12'))!.updatedAt).toBe(before!.updatedAt);
      configureSync({});
    }
  });

  it('on a slow pull, plans early only when there is nothing to show yet', async () => {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const slowSync = () => {
      let done!: () => void;
      return { promise: new Promise<void>((r) => (done = r)), done: () => done() };
    };

    // A device with no plan gets one straight away.
    const empty = await fresh();
    const s1 = slowSync();
    const run1 = planAfterSync(s1.promise, '2026-10-14', 10, empty);
    await wait(100);
    expect((await liveBlocks(empty)).length).toBeGreaterThan(0);
    s1.done();
    await run1;

    // So does a device whose plan ran out while it was put away.
    const away = await fresh();
    await ensurePlan('2026-08-03', away);
    const s3 = slowSync();
    const run3 = planAfterSync(s3.promise, '2026-10-14', 10, away);
    await wait(100);
    expect((await liveBlocks(away)).some((b) => b.startDate <= '2026-10-14' && '2026-10-14' < addDays(b.startDate, 28))).toBe(true);
    s3.done();
    await run3;

    // A device with a plan waits for the pull before planning the next block.
    const d = await fresh();
    const current = await ensurePlan('2026-10-14', d);
    const next = `block-${addDays(current.startDate, 28)}`;
    await d.blocks.delete(next);
    const s2 = slowSync();
    const run2 = planAfterSync(s2.promise, '2026-10-14', 10, d);
    await wait(100);
    expect(await d.blocks.get(next)).toBeUndefined();
    s2.done();
    await run2;
    expect(await d.blocks.get(next)).toBeDefined();
  });

  it('keeps default profile timestamps at the epoch so real settings always win', async () => {
    const d = await fresh();
    expect((await getProfile(d)).updatedAt).toBe(new Date(0).toISOString());
  });
});
