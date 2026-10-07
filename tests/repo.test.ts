import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { GetFitDB } from '../src/db/db';
import { ensurePlan, getProfile, importAll, logSet, startSession, workoutsWithLogs } from '../src/db/repo';
import { addDays, mondayOf, today } from '../src/lib/dates';

let n = 0;
async function fresh() {
  const d = new GetFitDB(`repo-${++n}`);
  await d.open();
  return d;
}

describe('repo', () => {
  it('creates one block covering today, and never stacks blocks when one starts later', async () => {
    const d = await fresh();
    const b = await ensurePlan(today(), d);
    expect(b.startDate).toBe(mondayOf(today()));
    expect(b.id).toBe(`block-${b.startDate}`);
    await ensurePlan(today(), d);
    expect(await d.blocks.count()).toBe(1);
    // Clock moved backwards a week: the existing (later) block is reused.
    await ensurePlan(addDays(b.startDate, -7), d);
    expect(await d.blocks.count()).toBe(1);
    // After the block ends, the next one starts the following Monday.
    const next = await ensurePlan(addDays(b.startDate, 28), d);
    expect(next.startDate).toBe(addDays(b.startDate, 28));
    expect(next.index).toBe(2);
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
    expect(await phone.blocks.count()).toBe(1);
    expect(await phone.meta.get('lastPushedAt')).toBeUndefined();
  });

  it('keeps default profile timestamps at the epoch so real settings always win', async () => {
    const d = await fresh();
    expect((await getProfile(d)).updatedAt).toBe(new Date(0).toISOString());
  });
});
