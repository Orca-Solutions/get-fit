import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { GetFitDB } from '../src/db/db';
import { ensurePlan, exportAll, exportSetsCsv, getProfile, importAll, logSet, startSession, workoutsWithLogs } from '../src/db/repo';
import { addDays, mondayOf, today } from '../src/lib/dates';

let n = 0;
async function fresh() {
  const d = new GetFitDB(`repo-${++n}`);
  await d.open();
  return d;
}

describe('repo', () => {
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

  it('keeps default profile timestamps at the epoch so real settings always win', async () => {
    const d = await fresh();
    expect((await getProfile(d)).updatedAt).toBe(new Date(0).toISOString());
  });
});
