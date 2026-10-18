// All writes go through here: every record gets updatedAt stamped (for sync) and saves immediately.
import { CATALOG } from '../catalog.js';
import type { Block, Exercise, ExerciseFlag, LoggedSet, PlannedWorkout, Profile, Session } from '../types.js';
import { addDays, daysBetween, mondayOf, today } from '../dates.js';
import { uuid } from '../ids.js';
import { isSyncConnected, scheduleSync } from './sync.js';
import { generateBlock, type ExerciseFlags, type GeneratorInput } from '../generator/generateBlock.js';
import { effectiveLoad, isOutgrown, isStalled, isToppedOut, summarizeHistory, withoutDeloads, type HintContext, type SessionSummary } from '../generator/progression.js';
import { db, SYNC_TABLES, type GetFitDB, type SyncTable } from './db.js';
import { validRow } from '../validate.js';
import { PROFILE_ID, neutralProfile } from '../profiles.js';
import { changedFields } from '../session.js';
import { stampAfter } from '../protocol.js';

export { CATALOG, PROFILE_ID };

let makeDefaultProfile: (t?: string) => Profile = neutralProfile;

/** The profile a device starts with before anything is set up or synced. Call once at startup. */
export function setDefaultProfile(make: (t?: string) => Profile) {
  makeDefaultProfile = make;
}

export function defaultProfile(t?: string): Profile {
  return makeDefaultProfile(t);
}

const nowIso = () => new Date().toISOString();

/**
 * Stamp and save. Soft-deletes go through here too, so they sync. The stamp is later than the stored
 * copy's, so an edit wins over the version it changed even if that came from a device with a fast clock.
 */
export async function put<T extends { id: string; createdAt: string; updatedAt: string }>(table: SyncTable, rec: T, d: GetFitDB = db): Promise<T> {
  const stored = (await d.table(table).get(rec.id)) as { updatedAt?: string } | undefined;
  const stamped = { ...rec, updatedAt: stampAfter(stored?.updatedAt) };
  await (d.table(table) as unknown as { put(r: T): Promise<unknown> }).put(stamped);
  scheduleSync();
  return stamped;
}

export async function getProfile(d: GetFitDB = db): Promise<Profile> {
  const p = await d.profile.get(PROFILE_ID);
  if (p) return p;
  const fresh = defaultProfile();
  await d.profile.put(fresh);
  return fresh;
}

export async function allExercises(d: GetFitDB = db): Promise<Exercise[]> {
  const custom = (await d.customExercises.toArray()).filter((e) => !e.deletedAt);
  return [...CATALOG, ...custom];
}

export async function flagMap(d: GetFitDB = db): Promise<ExerciseFlags> {
  const flags = await d.exerciseFlags.toArray();
  return Object.fromEntries(flags.filter((f) => !f.deletedAt).map((f) => [f.id, f]));
}

type FlagPatch = Partial<Pick<ExerciseFlag, 'favourite' | 'avoid' | 'unavailable' | 'unavailableAt'>>;

export function setFlag(exerciseId: string, patch: FlagPatch) {
  return setFlagIn(db, exerciseId, patch);
}

export async function setFlagIn(d: GetFitDB, exerciseId: string, patch: FlagPatch) {
  const t = nowIso();
  const existing = (await d.exerciseFlags.get(exerciseId)) ?? { id: exerciseId, createdAt: t, updatedAt: t, deletedAt: null };
  await put('exerciseFlags', { ...existing, ...patch }, d);
}

export async function liveBlocks(d: GetFitDB = db): Promise<Block[]> {
  return (await d.blocks.orderBy('startDate').toArray()).filter((b) => !b.deletedAt);
}

export function blockEnd(b: Block): string {
  return addDays(b.startDate, b.weeks * 7 - 1);
}

/**
 * Make sure a block covers `date`, and that the block after it is already planned, so the calendar
 * always shows the current block plus the next one. The first block starts on this week's Monday;
 * each later block starts the Monday after the previous one ends (or this Monday, after a long gap).
 *
 * A block planned ahead is built before its predecessor's logs exist, so on the day it becomes
 * current its unlogged workouts are rebuilt once from the latest logs, then the next block is planned.
 */
export async function ensurePlan(date = today(), d: GetFitDB = db): Promise<Block> {
  const current = await blockCovering(date, d);
  // A block that starts later (clock or timezone change) means the plan is already ahead: don't stack another.
  if (current.startDate > date) return current;
  const following = (await liveBlocks(d)).find((b) => b.startDate > blockEnd(current));
  if (!following) {
    if (current.plannedAhead) await rebuildFrom(current, date, d);
    await createBlock(addDays(blockEnd(current), 1), current, d, true);
  }
  return current;
}

/**
 * Plan once the pull has landed. If it's slow, plan early only when there's nothing to show for today;
 * otherwise wait, so a block another device already rebuilt from its logs isn't regenerated here with a
 * newer timestamp that would replace it everywhere.
 */
export async function planAfterSync(sync: Promise<unknown>, date: string, waitMs: number, d: GetFitDB = db): Promise<void> {
  const done = sync.catch(() => undefined);
  const late = new Promise<'late'>((r) => setTimeout(() => r('late'), waitMs));
  if ((await Promise.race([done, late])) === 'late') {
    if (!(await liveBlocks(d)).some((blk) => blk.startDate <= date && date <= blockEnd(blk))) await ensurePlan(date, d);
    await done;
  }
  await ensurePlan(date, d);
}

async function blockCovering(date: string, d: GetFitDB): Promise<Block> {
  const blocks = await liveBlocks(d);
  const current = blocks.find((b) => b.startDate <= date && date <= blockEnd(b));
  if (current) return current;
  const ahead = blocks.find((b) => b.startDate > date);
  if (ahead) return ahead;
  const last = blocks[blocks.length - 1];
  const thisMonday = mondayOf(date);
  if (!last || blockEnd(last) >= addDays(thisMonday, -1)) return createBlock(last ? addDays(blockEnd(last), 1) : thisMonday, last, d);
  // Back after the app sat unopened past the end of the plan: blocks nobody logged in (the one planned ahead) are
  // dropped, and the new block follows the last block with logs, so it numbers on from there and plans top sets
  // only for lifts trained in it.
  const logged = await workoutsWithLogs(d);
  const trained = new Set((await d.plannedWorkouts.toArray()).filter((w) => logged.has(w.id)).map((w) => w.blockId));
  const lastTrained = blocks.filter((b) => trained.has(b.id)).pop();
  for (const b of blocks.filter((b) => !lastTrained || b.startDate > lastTrained.startDate)) await dropBlock(b, d);
  return createBlock(thisMonday, lastTrained, d);
}

/** Soft-delete a block nobody logged in, with its workouts, so every device drops it on sync. */
async function dropBlock(block: Block, d: GetFitDB): Promise<void> {
  const t = nowIso();
  const workouts = await d.plannedWorkouts.where('blockId').equals(block.id).toArray();
  await d.transaction('rw', d.blocks, d.plannedWorkouts, async () => {
    await d.blocks.put({ ...block, deletedAt: t, updatedAt: t });
    await d.plannedWorkouts.bulkPut(workouts.map((w) => ({ ...w, deletedAt: t, updatedAt: t })));
  });
}

/** Everything the generator needs from the device: profile, catalog, flags and what the logs say. */
async function generatorInput(startDate: string, previousBlock: Block | undefined, d: GetFitDB): Promise<GeneratorInput> {
  const [profile, exercises, flags, sets, planned, sessions] = await Promise.all([getProfile(d), allExercises(d), flagMap(d), d.loggedSets.toArray(), d.plannedWorkouts.toArray(), d.sessions.toArray()]);
  // Only what was logged before the block starts, so rebuilding a block part way through (a kit change, a new
  // Avoid) plans it as it was planned on its first day, rather than judging stalls on the block's own weeks.
  const live = sets.filter((s) => !s.deletedAt && s.date < startDate);
  const known = [...new Set(live.map((s) => s.exerciseId))];
  const history = (id: string) => {
    const ex = exercises.find((e) => e.id === id);
    return ex ? summarizeHistory(ex, live.filter((s) => s.exerciseId === id), profile) : [];
  };
  // Stalls compare block with block, leaving out deloads, so each session needs its place in the plan.
  const workoutById = new Map(planned.map((w) => [w.id, w]));
  const sessionWorkout = new Map(sessions.map((s) => [s.id, s.plannedWorkoutId ? workoutById.get(s.plannedWorkoutId) : undefined]));
  const placeOf = (h: SessionSummary) => {
    const w = sessionWorkout.get(h.sessionId);
    return w && !w.deletedAt ? { blockId: w.blockId, deload: w.isDeload, plannedDate: w.date } : undefined;
  };
  const plannedSets = new Map(planned.flatMap((w) => w.exercises.map((e) => [e.id, e.sets] as const)));
  const targetMax = (s: LoggedSet) => plannedSets.get(s.plannedExerciseId ?? '')?.find((p) => p.setIndex === s.setIndex)?.targetReps?.max;
  // A flat block that topped out is waiting on a weight step, not stuck (§4.3).
  const flat = known.filter((id) => isStalled(history(id), placeOf));
  const toppedOut = flat.filter((id) => {
    const ex = exercises.find((e) => e.id === id)!;
    return isToppedOut(history(id), placeOf, targetMax, (s) => effectiveLoad(ex, s.weight, profile) ?? 0);
  });
  const stalled = flat.filter((id) => !toppedOut.includes(id));
  const outgrown = known.filter((id) => isOutgrown(withoutDeloads(history(id), (h) => !!placeOf(h)?.deload), targetMax));
  // Top sets go only on lifts logged in the block before, so a block nobody trained doesn't count (§4.1).
  const trainedLastBlock = previousBlock ? [...new Set(live.filter((s) => { const w = sessionWorkout.get(s.sessionId); return w && !w.deletedAt && w.blockId === previousBlock.id; }).map((s) => s.exerciseId))] : [];
  const recoveryOk = previousBlock ? !sessions.some((s) => !s.deletedAt && s.beatUp && s.date >= previousBlock.startDate && s.date < startDate) : true;
  return { profile, exercises, flags, startDate, previousBlock, stalled, toppedOut, known, trainedLastBlock, outgrown, recoveryOk };
}

async function createBlock(startDate: string, previousBlock: Block | undefined, d: GetFitDB, plannedAhead = false): Promise<Block> {
  const { block, workouts } = generateBlock(await generatorInput(startDate, previousBlock, d));
  const stored = plannedAhead ? { ...block, plannedAhead: true } : block;
  await d.transaction('rw', d.blocks, d.plannedWorkouts, async () => {
    await d.blocks.put(stored);
    await d.plannedWorkouts.bulkPut(workouts);
  });
  scheduleSync();
  return stored;
}

/** Re-run the generator for `block`'s workouts from `from` on. Logged or started days are never touched. */
async function rebuildFrom(block: Block, from: string, d: GetFitDB, keepPlannedAhead = false): Promise<void> {
  const previous = (await liveBlocks(d)).filter((b) => b.startDate < block.startDate).pop();
  const { block: fresh, workouts } = generateBlock(await generatorInput(block.startDate, previous, d));
  const existing = (await d.plannedWorkouts.where('blockId').equals(block.id).toArray()).filter((w) => !w.deletedAt);
  const started = await workoutsWithLogs(d);
  const t = nowIso();
  await d.transaction('rw', d.blocks, d.plannedWorkouts, async () => {
    await d.blocks.put({ ...block, baseSlots: fresh.baseSlots, rationale: fresh.rationale, generatorVersion: fresh.generatorVersion, plannedAhead: keepPlannedAhead && !!block.plannedAhead, updatedAt: t });
    for (const old of existing) {
      if (old.date < from || started.has(old.id)) continue;
      const w = workouts.find((x) => x.date === old.date && x.sessionType === old.sessionType);
      if (w) await d.plannedWorkouts.put({ ...w, id: old.id, blockId: block.id, createdAt: old.createdAt, updatedAt: t });
    }
  });
  scheduleSync();
}

/** Rebuild the rest of the current block from `date`, and the block planned after it. Logged workouts are kept. */
export async function regenerateUpcoming(date = today(), d: GetFitDB = db): Promise<void> {
  const current = await ensurePlan(date, d);
  await rebuildFrom(current, date > current.startDate ? date : current.startDate, d);
  // A block planned ahead stays marked, so it's still refreshed from the latest logs on its first day.
  for (const later of (await liveBlocks(d)).filter((b) => b.startDate > blockEnd(current))) await rebuildFrom(later, later.startDate, d, true);
}

// ---------- sessions and logging ----------

/** Planned workouts that have at least one logged set (opening a workout without logging doesn't count). */
export async function workoutsWithLogs(d: GetFitDB = db): Promise<Set<string>> {
  const [sessions, sets] = await Promise.all([d.sessions.toArray(), d.loggedSets.toArray()]);
  const withSets = new Set(sets.filter((s) => !s.deletedAt).map((s) => s.sessionId));
  return new Set(sessions.filter((s) => !s.deletedAt && s.plannedWorkoutId && withSets.has(s.id)).map((s) => s.plannedWorkoutId!));
}

/** Sessions logged against a deload workout, which the weight hint leaves out (withoutDeloads). */
export async function deloadSessionIds(d: GetFitDB = db): Promise<Set<string>> {
  const [sessions, planned] = await Promise.all([d.sessions.toArray(), d.plannedWorkouts.toArray()]);
  const deloads = new Set(planned.filter((w) => w.isDeload && !w.deletedAt).map((w) => w.id));
  return new Set(sessions.filter((s) => !s.deletedAt && s.plannedWorkoutId && deloads.has(s.plannedWorkoutId)).map((s) => s.id));
}

/**
 * What the weight hint needs from the plan (workoutHint): which sessions were deloads, each logged set's planned rep
 * target and set count (a change of reps, a partly logged session), each session's block, and the planned days a
 * movement went unlogged (a long gap). All of it reads logged work and the plan, never when the app was opened.
 */
export async function hintContext(d: GetFitDB = db): Promise<Required<HintContext>> {
  const [sessions, planned, logged] = await Promise.all([d.sessions.toArray(), d.plannedWorkouts.toArray(), d.loggedSets.toArray()]);
  const live = new Map(planned.filter((w) => !w.deletedAt).map((w) => [w.id, w]));
  const workoutOf = new Map(sessions.filter((s) => !s.deletedAt && s.plannedWorkoutId).map((s) => [s.id, live.get(s.plannedWorkoutId!)]));
  const sets = new Map([...live.values()].flatMap((w) => w.exercises.map((e) => [e.id, e.sets] as const)));
  const kept = logged.filter((s) => !s.deletedAt);
  const done = new Set(kept.map((s) => s.plannedExerciseId));
  const trainedOn = [...new Set(kept.map((s) => s.date))].sort();
  // Each movement's planned days, and whether anything was logged for it there. Workouts of a block dropped after a
  // long gap count too: they were planned and missed.
  const days = new Map<string, { date: string; done: boolean }[]>();
  for (const w of planned) for (const e of w.exercises) days.set(e.exerciseId, [...(days.get(e.exerciseId) ?? []), { date: w.date, done: done.has(e.id) }]);
  return {
    isDeload: (h) => !!workoutOf.get(h.sessionId)?.isDeload,
    targetOf: (s) => sets.get(s.plannedExerciseId ?? '')?.find((p) => p.setIndex === s.setIndex)?.targetReps,
    setsPlanned: (s) => sets.get(s.plannedExerciseId ?? '')?.length,
    blockOf: (h) => workoutOf.get(h.sessionId)?.blockId,
    timeOffFrom: (id, from, to) => {
      if (!trainedOn.some((t) => t > from && t < to)) return from;
      const first = days.get(id)?.filter((p) => p.date > from && p.date < to && !p.done).map((p) => p.date).sort()[0];
      return first && [from, addDays(first, -7)].sort()[1];
    },
  };
}

export async function sessionFor(plannedWorkoutId: string, d: GetFitDB = db): Promise<Session | undefined> {
  const list = await d.sessions.where('plannedWorkoutId').equals(plannedWorkoutId).toArray();
  return list.find((s) => !s.deletedAt);
}

export const sessionIdFor = (plannedWorkoutId: string) => `s-${plannedWorkoutId}`;

export async function startSession(plannedWorkoutId: string, date = today(), d: GetFitDB = db): Promise<Session> {
  const existing = await sessionFor(plannedWorkoutId, d);
  if (existing) return existing;
  const t = nowIso();
  // One id per planned workout, so two devices that open the same workout before syncing share a session.
  return put('sessions', { id: sessionIdFor(plannedWorkoutId), createdAt: t, updatedAt: t, deletedAt: null, plannedWorkoutId, date, startedAt: t, endedAt: null }, d);
}

export async function updateSession(id: string, patch: Partial<Session>, d: GetFitDB = db): Promise<void> {
  const s = await d.sessions.get(id);
  if (!s) return;
  const t = nowIso();
  const fieldAt = { ...(s.fieldAt ?? {}) };
  for (const k of changedFields(s, patch)) fieldAt[k] = t;
  await put('sessions', { ...s, ...patch, fieldAt }, d);
}

export type SetInput = Pick<LoggedSet, 'weight' | 'reps' | 'seconds' | 'bandId' | 'stanceSteps'> & { effort?: LoggedSet['effort'] };

export async function logSet(
  session: Pick<Session, 'id' | 'date'>,
  exerciseId: string,
  plannedExerciseId: string | null,
  setIndex: number,
  values: SetInput,
  d: GetFitDB = db,
): Promise<LoggedSet> {
  const t = nowIso();
  const everLogged = await d.loggedSets.where('sessionId').equals(session.id).toArray();
  const inSession = everLogged.filter((s) => !s.deletedAt);
  const existing = inSession.find((s) => s.exerciseId === exerciseId && s.plannedExerciseId === plannedExerciseId && s.setIndex === setIndex);
  let date = session.date;
  if (!everLogged.length) {
    // A session opened earlier but never logged counts from the day its first set is logged. Once a set
    // has been logged (even if since deleted), the session keeps its day, so fixing an old one doesn't move it.
    date = today();
    const s = await d.sessions.get(session.id);
    if (s && (s.date !== date || !s.startedAt)) await put('sessions', { ...s, date, startedAt: t }, d);
  }
  // Merge into the stored record so a partial update (e.g. just the effort tap) never reverts other fields.
  // A planned set's id comes from its session, slot, movement and index, so the same set logged on two
  // devices before they sync is one record (the later write wins) rather than a doubled count.
  const id = plannedExerciseId ? `${session.id}|${plannedExerciseId}|${exerciseId}|${setIndex}` : uuid();
  const rec: LoggedSet = existing
    ? { ...existing, ...values }
    : { id, createdAt: t, updatedAt: t, deletedAt: null, sessionId: session.id, exerciseId, plannedExerciseId, setIndex, date, loggedAt: t, ...values };
  return put('loggedSets', rec, d);
}

export async function unlogSet(id: string, d: GetFitDB = db): Promise<void> {
  const s = await d.loggedSets.get(id);
  if (s) await put('loggedSets', { ...s, deletedAt: nowIso() }, d);
}

export async function historyFor(exerciseId: string, d: GetFitDB = db): Promise<LoggedSet[]> {
  return (await d.loggedSets.where('exerciseId').equals(exerciseId).toArray()).filter((s) => !s.deletedAt);
}

/** Which planned workouts are done/partial/missed; derived, never stored. */
export type DayState = 'planned' | 'done' | 'partial' | 'missed' | 'done-late' | 'today' | 'not-tracked';

export function workoutState(w: PlannedWorkout, session: Session | undefined, loggedCount: number, plannedCount: number, date: string, trackedFrom: string): DayState {
  if (session && loggedCount > 0) {
    const late = session.date > (w.windowEnd ?? w.date);
    if (loggedCount >= plannedCount || session.endedAt) return late ? 'done-late' : 'done';
    return 'partial';
  }
  const last = w.windowEnd ?? w.date;
  if (last < date) return w.date < trackedFrom ? 'not-tracked' : 'missed';
  if (w.date <= date && date <= last) return 'today';
  return 'planned';
}

export function plannedSetCount(w: PlannedWorkout, session?: Session): number {
  return w.exercises.filter((e) => !session?.skipped?.includes(e.id)).reduce((n, e) => n + e.sets.length, 0);
}

export async function exportAll(d: GetFitDB = db) {
  const out: Record<string, unknown[]> = {};
  for (const t of ['profile', 'blocks', 'plannedWorkouts', 'sessions', 'loggedSets', 'exerciseFlags', 'customExercises'] as const) {
    out[t] = await d.table(t).toArray();
  }
  return { app: 'get-fit', version: 1, exportedAt: nowIso(), tables: out };
}

/** Every logged set as CSV, oldest first, for opening in a spreadsheet. Weights are in lb. */
export async function exportSetsCsv(d: GetFitDB = db): Promise<string> {
  const [sets, exercises, profile] = await Promise.all([d.loggedSets.toArray(), allExercises(d), getProfile(d)]);
  const name = new Map(exercises.map((e) => [e.id, e.name]));
  const band = new Map(profile.bands.map((b) => [b.id, b.name]));
  const cell = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = sets
    .filter((s) => !s.deletedAt)
    .sort((a, b) => a.date.localeCompare(b.date) || a.loggedAt.localeCompare(b.loggedAt))
    .map((s) => [s.date, name.get(s.exerciseId) ?? s.exerciseId, s.setIndex + 1, s.weight, s.reps, s.seconds, s.bandId ? band.get(s.bandId) ?? s.bandId : null, s.stanceSteps, s.effort, s.loggedAt]);
  const header = ['date', 'exercise', 'set', 'weight_lb', 'reps', 'seconds', 'band', 'stance_steps', 'effort', 'logged_at'];
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n';
}

/**
 * Restore a backup made by exportAll, in one transaction. Rows merge by id and only replace older
 * copies, so logged sets already on this device are never removed; rows missing required fields are
 * skipped. On a device with no logged sets yet, the backup's profile and plan replace the ones this
 * device made for itself: they're re-stamped so they win everywhere, and the device's own blocks and
 * workouts are deleted through sync (not just locally), so other devices don't keep both plans.
 * Throws on a file that isn't a get-fit backup.
 */
export async function importAll(data: { app?: string; tables: Record<string, unknown> }, d: GetFitDB = db): Promise<{ imported: number; skipped: number }> {
  if (!data || typeof data.tables !== 'object' || data.tables === null || (data.app !== undefined && data.app !== 'get-fit')) throw new Error('Not a get-fit backup.');
  const t = nowIso();
  let imported = 0;
  let skipped = 0;
  // A device with nothing logged takes the backup's plan as its own, unless it's already connected to
  // sync: then its plan is everyone's, and a re-stamped old plan would replace it on every device.
  // Checked before the transaction, which can't wait on the app's sign-in headers.
  const connected = await isSyncConnected(d);
  await d.transaction('rw', [...SYNC_TABLES.map((name) => d.table(name)), d.meta], async () => {
    const replacePlan = !connected && !(await d.loggedSets.filter((s) => !s.deletedAt).count());
    const PLAN: SyncTable[] = ['profile', 'blocks', 'plannedWorkouts'];
    for (const name of SYNC_TABLES) {
      const rows = data.tables[name];
      if (rows === undefined) continue;
      if (!Array.isArray(rows)) throw new Error('Not a get-fit backup.');
      const table = d.table(name);
      const force = replacePlan && PLAN.includes(name);
      const kept = new Set<string>();
      for (const r of rows) {
        if (!validRow(name, r)) {
          skipped++;
          continue;
        }
        const row = r as { id: string; updatedAt: string };
        kept.add(row.id);
        const local = (await table.get(row.id)) as { updatedAt: string } | undefined;
        if (force) await table.put({ ...row, updatedAt: t });
        else if (!local || Date.parse(row.updatedAt) > Date.parse(local.updatedAt)) await table.put(row);
        else continue;
        imported++;
      }
      if (force && name !== 'profile') {
        const mine = (await table.toArray()) as { id: string; deletedAt?: string | null }[];
        for (const m of mine) if (!kept.has(m.id) && !m.deletedAt) await table.put({ ...m, deletedAt: t, updatedAt: t });
      }
    }
    // Imported rows keep their old timestamps: reset the push watermark so the next sync sends them all.
    await d.meta.delete('lastPushedAt');
  });
  await getProfile(d);
  await ensurePlan(today(), d);
  scheduleSync();
  return { imported, skipped };
}

export function daysSince(dateStr: string, ref = today()) {
  return daysBetween(dateStr, ref);
}
