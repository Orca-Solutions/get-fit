// The plan generator: a pure function from (profile, catalog, previous block) to a 4-week block.
// Rules are docs/periodization.md §4; comments cite the section they implement.
import type {
  Block, CoreDynamic, Exercise, FocusMuscle, Location, PlannedExercise, PlannedSet, PlannedWorkout,
  Profile, SessionType, SlotKey, SlotRole, Weekday, Zone,
} from '../types';
import { addDays } from '../lib/dates';
import { hash, uuid } from '../lib/ids';
import {
  CORE_SUPERSETS, CORE_WAVE, FOCUS_LABEL, FOCUS_ROTATION, FOCUS_SLOTS, GRIP_ROTATION, LIFT_TEMPLATES,
  SESSION_LABEL, V_SLOTS, ZONE_NAME, ZONE_ROTATION, compoundReps, coreTargets, isolationReps, restFor,
  rirFor, setsFor, type BaseSlot,
} from './templates';
import { coverageReport, type CoverageReport } from './coverage';

export const GENERATOR_VERSION = '1.0.0';
export const BLOCK_WEEKS = 4;

export type ExerciseFlags = Record<string, { avoid?: boolean; unavailable?: boolean; favourite?: boolean }>;

export type GeneratorInput = {
  profile: Profile;
  exercises: Exercise[];
  flags?: ExerciseFlags;
  /** Monday the block starts on. */
  startDate: string;
  previousBlock?: Block;
  /** Exercises with no e1RM gain over 3 exposures, or rated down: rotated out at the boundary (§4.3). */
  stalled?: string[];
  /** Exercises with any logged history; others get a calibration note (§4.4.4). */
  known?: string[];
  /** False after an early deload in the last block: skip the volume ramp (§4.1). */
  recoveryOk?: boolean;
  now?: string;
  newId?: () => string;
};

export type GeneratedBlock = { block: Block; workouts: PlannedWorkout[]; coverage: CoverageReport };

type Ctx = {
  input: GeneratorInput;
  blockIndex: number;
  focus: FocusMuscle;
  byId: Map<string, Exercise>;
  newId: () => string;
  now: string;
  baseSlots: Record<string, string>;
  rotated: string[];
  stalled: Set<string>;
  known: Set<string>;
};

const WEEKDAY_OFFSET: Record<Weekday, number> = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: 6 };

export function generateBlock(input: GeneratorInput): GeneratedBlock {
  const prev = input.previousBlock;
  const blockIndex = prev ? prev.index + 1 : 1;
  const ctx: Ctx = {
    input,
    blockIndex,
    focus: FOCUS_ROTATION[(blockIndex - 1) % FOCUS_ROTATION.length],
    byId: new Map(input.exercises.map((e) => [e.id, e])),
    newId: input.newId ?? uuid,
    now: input.now ?? new Date().toISOString(),
    baseSlots: {},
    rotated: [],
    stalled: new Set(input.stalled ?? []),
    known: new Set(input.known ?? []),
  };
  const blockId = ctx.newId();

  // 1. Pick each day's base exercises once for the whole block (§4.3).
  const liftTypes = Object.keys(LIFT_TEMPLATES) as Exclude<SessionType, 'core'>[];
  const base: Record<string, Exercise[]> = {};
  for (const type of liftTypes) base[type] = pickBase(ctx, type);
  const coreBase = pickCoreBase(ctx);

  // 2. Lay out weeks: zones, sets, variety, grip, core wave (§4.2, §4.7).
  const workouts: PlannedWorkout[] = [];
  let gripCounter = 0;
  const usedV = new Map<string, Set<string>>();
  for (let week = 0; week < BLOCK_WEEKS; week++) {
    const weekStart = addDays(input.startDate, week * 7);
    for (const entry of input.profile.schedule) {
      const offsets = entry.weekdays.map((d) => WEEKDAY_OFFSET[d]).sort((a, b) => a - b);
      const date = addDays(weekStart, offsets[0]);
      const windowEnd = offsets.length > 1 ? addDays(weekStart, offsets[offsets.length - 1]) : undefined;
      const common = { blockId, date, windowEnd, weekIndex: week, location: entry.location };
      if (entry.type === 'core') {
        workouts.push(buildCore(ctx, common, coreBase));
      } else {
        const zone: Zone | 'deload' = week === 3 ? 'deload' : ZONE_ROTATION[entry.type][week];
        const used = usedV.get(entry.type) ?? new Set<string>();
        usedV.set(entry.type, used);
        const w = buildLift(ctx, common, entry.type, zone, base[entry.type], used, gripCounter);
        if (w.exercises.some((e) => e.role === 'G')) gripCounter++;
        workouts.push(w);
      }
    }
  }
  workouts.sort((a, b) => a.date.localeCompare(b.date));

  // 3. Coverage check: lift any major muscle averaging under 6 sets a week (§4.2).
  let coverage = coverageReport(workouts, ctx.byId);
  for (let guard = 0; guard < 12 && coverage.underTarget.length; guard++) {
    if (!addCoverageSet(workouts, ctx.byId, coverage.underTarget[0], coverage)) break;
    coverage = coverageReport(workouts, ctx.byId);
  }

  const focusName = FOCUS_LABEL[ctx.focus];
  const rotatedNames = ctx.rotated.map((id) => ctx.byId.get(id)?.name ?? id);
  const block: Block = {
    id: blockId,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    deletedAt: null,
    startDate: input.startDate,
    weeks: BLOCK_WEEKS,
    index: blockIndex,
    focusMuscle: ctx.focus,
    generatorVersion: GENERATOR_VERSION,
    baseSlots: ctx.baseSlots,
    rationale:
      `Block ${blockIndex}: 3 loading weeks and a deload. Each day rotates heavy, moderate and light, so every muscle gets all three. ` +
      `Focus this block: ${focusName}.` +
      (rotatedNames.length ? ` New this block: ${rotatedNames.join(', ')}; core variants rotate too.` : ''),
  };
  return { block, workouts, coverage };
}

// ---------- exercise selection ----------

function usable(ctx: Ctx, ex: Exercise, location: Location): boolean {
  const flags = ctx.input.flags?.[ex.id];
  if (flags?.avoid || flags?.unavailable) return false;
  if (ex.level === 'advanced') return false;
  const have = ctx.input.profile.equipmentByLocation[location];
  return ex.equipment.every((e) => have.includes(e));
}

function candidates(ctx: Ctx, slot: SlotKey, location: Location): Exercise[] {
  return ctx.input.exercises.filter((e) => e.slots.includes(slot) && usable(ctx, e, location));
}

/** Stable pseudo-random tie-break that changes from block to block. */
function jitter(ctx: Ctx, id: string, salt = ''): number {
  return (hash(`${id}|${ctx.blockIndex}|${salt}`) % 1000) / 1000;
}

function pickBase(ctx: Ctx, type: Exclude<SessionType, 'core'>): Exercise[] {
  const tpl = LIFT_TEMPLATES[type];
  const prev = ctx.input.previousBlock?.baseSlots ?? {};
  // At each boundary rotate one isolation slot, and on even blocks one compound slot too (§4.3).
  const rotate = new Set<number>();
  if (ctx.blockIndex > 1) {
    const iso = tpl.base.map((s, i) => (s.role === 'I' ? i : -1)).filter((i) => i >= 0);
    // Secondary compounds rotate before the primary lift, so the main lift sticks around longest.
    const comp = [...tpl.base.map((s, i) => (s.role === 'C' ? i : -1)), ...tpl.base.map((s, i) => (s.role === 'P' ? i : -1))].filter((i) => i >= 0);
    rotate.add(iso[(ctx.blockIndex - 2) % iso.length]);
    if (ctx.blockIndex % 2 === 0) rotate.add(comp[(ctx.blockIndex / 2 - 1) % comp.length]);
  }
  const chosen: Exercise[] = [];
  tpl.base.forEach((slot, i) => {
    const key = `${type}|${slot.key}`;
    const prevId = prev[key];
    const pool = candidates(ctx, slot.key, 'gym').filter((e) => !chosen.some((c) => c.id === e.id));
    const keep = prevId && !rotate.has(i) && !ctx.stalled.has(prevId) && pool.find((e) => e.id === prevId);
    let pick = keep || best(pool, (e) => scoreBase(ctx, e, slot, prevId, chosen));
    if (!pick) throw new Error(`No exercise available for slot ${slot.key}`);
    if (prevId && pick.id !== prevId) ctx.rotated.push(pick.id);
    ctx.baseSlots[key] = pick.id;
    chosen.push(pick);
  });
  return chosen;
}

function scoreBase(ctx: Ctx, e: Exercise, slot: BaseSlot, prevId: string | undefined, chosen: Exercise[]): number {
  const flags = ctx.input.flags?.[e.id];
  const prevFamily = prevId ? ctx.byId.get(prevId)?.family : undefined;
  let s = jitter(ctx, e.id, slot.key);
  if (ctx.blockIndex === 1 && e.starter) s += 10;
  // Jason already runs the Smith squat, deadlift, bench and press: they lead from block 1.
  if (slot.role === 'P' && e.loadType === 'smith') s += 3;
  if (e.level === 'beginner') s += 2;
  else s -= 3; // intermediate: only when nothing beginner-friendly offers variety
  if (flags?.favourite) s += 3;
  if (prevId) {
    if (e.id === prevId) s -= 20;
    else if (e.family !== prevFamily) s += 4;
  }
  if (chosen.some((c) => c.family === e.family)) s -= 6;
  // Keep heavy leg day recoverable for the daily run: don't stack two fatigue-3 lifts (§4.6).
  if (slot.role !== 'I' && e.fatigueCost === 3 && chosen.some((c) => c.fatigueCost === 3)) s -= 8;
  if (e.runImpact === 'high') s -= 1;
  return s;
}

function best<T>(items: T[], score: (t: T) => number): T | undefined {
  let top: T | undefined;
  let topScore = -Infinity;
  for (const it of items) {
    const s = score(it);
    if (s > topScore) {
      top = it;
      topScore = s;
    }
  }
  return top;
}

// ---------- lifting days ----------

type Common = { blockId: string; date: string; windowEnd?: string; weekIndex: number; location: Location };

function repsFor(ex: Exercise, want: { min: number; max: number }): { min: number; max: number } {
  const lo = ex.repRange.min;
  const hi = ex.repRange.max;
  // Clamp into the movement's own sensible range, keeping a usable window of at least 2 reps (§4.1).
  if (want.min < lo) return { min: lo, max: Math.min(hi, Math.max(want.max, lo + 2)) };
  if (want.max > hi) return { min: Math.max(lo, Math.min(want.min, hi - 2)), max: hi };
  return want;
}

/** RDLs and other axial hinges stay out of light (15+ rep) days (§4.1). */
function fitsZone(ex: Exercise, zone: Zone | 'deload', want: { min: number; max: number }): boolean {
  if (zone === 'L' && ex.movementPattern === 'hinge' && ex.axialLoad) return false;
  return want.min <= ex.repRange.max;
}

function makeSets(n: number, reps: { min: number; max: number }, metric: Exercise['metric'], rir: number, restSec: number): PlannedSet[] {
  return Array.from({ length: n }, (_, i) => ({
    setIndex: i,
    ...(metric === 'time' ? { targetSeconds: reps } : { targetReps: reps }),
    rir,
    restSec,
  }));
}

function buildLift(
  ctx: Ctx,
  common: Common,
  type: Exclude<SessionType, 'core'>,
  zone: Zone | 'deload',
  base: Exercise[],
  usedV: Set<string>,
  gripCounter: number,
): PlannedWorkout {
  const tpl = LIFT_TEMPLATES[type];
  const week = common.weekIndex;
  const effZone: Zone = zone === 'deload' ? 'M' : zone;
  const focusSlots = FOCUS_SLOTS[ctx.focus][type];
  const exercises: PlannedExercise[] = [];
  const notes: string[] = [];
  const inSession = new Set<string>();

  const add = (ex: Exercise, slot: SlotKey, role: SlotRole, nSets: number, want: { min: number; max: number }, note?: string) => {
    const reps = ex.metric === 'time' ? ex.repRange : repsFor(ex, want);
    const sets = makeSets(nSets, reps, ex.metric, rirFor(week, role), restFor(role, zone));
    const noteParts = [note];
    if (!ctx.known.has(ex.id) && role !== 'G') noteParts.push('First time: ramp up across sets to find a weight that leaves about 3 reps in the tank.');
    exercises.push({ id: ctx.newId(), exerciseId: ex.id, slot, role, order: exercises.length, sets, note: noteParts.filter(Boolean).join(' ') || undefined });
    inSession.add(ex.id);
  };

  tpl.base.forEach((slot, i) => {
    let ex = base[i];
    const want = slot.role === 'I' ? isolationReps(effZone) : compoundReps(effZone, ctx.blockIndex);
    let note: string | undefined;
    if (!fitsZone(ex, zone, want)) {
      // Weekly stand-in for this slot (e.g. back extension instead of an RDL on a light day).
      const pools: SlotKey[] = [slot.key, 'legs:v:hip-extension', 'legs:v:hinge-variant'];
      const alt = best(pools.flatMap((p) => candidates(ctx, p, 'gym')).filter((e) => !inSession.has(e.id) && !base.some((b) => b.id === e.id) && fitsZone(e, zone, want)), (e) => jitter(ctx, e.id, `alt${week}`) + (e.fatigueCost === 1 ? 1 : 0));
      if (alt) {
        note = `Stands in for ${ex.name} on the light day.`;
        ex = alt;
      }
    }
    let n = setsFor(slot.role, zone, ctx.blockIndex);
    if (zone === 'H' && focusSlots?.heavyExtra === slot.key) n += 1;
    add(ex, slot.key, slot.role, n, want, note);
  });

  // Anatoly-style top set from block 3: P slot on a heavy day opens with one 3–5 rep set (§4.1).
  if (zone === 'H' && ctx.blockIndex >= 3) {
    const p = exercises.find((e) => e.role === 'P');
    if (p && p.sets[0]?.targetReps) {
      p.sets[0] = { ...p.sets[0], targetReps: { min: 3, max: 5 }, rir: 2 };
      p.note = [p.note, 'Set 1 is a heavy top set; the rest are back-off sets about 10% lighter.'].filter(Boolean).join(' ');
    }
  }

  // Volume ramp across blocks: +1 set on heavy-day isolation slots per block from block 3 (§4.1).
  if (zone === 'H' && ctx.blockIndex >= 3 && ctx.input.recoveryOk !== false) {
    const extra = Math.min(ctx.blockIndex - 2, 3);
    exercises.filter((e) => e.role === 'I').slice(0, extra).forEach((e) => addSet(e));
  }

  // Variety slots on moderate and light days; the focus muscle claims one (§4.2, §4.3).
  if (zone !== 'deload') {
    const nV = V_SLOTS[zone];
    const baseFamilies = new Set(base.map((b) => b.family));
    for (let v = 0; v < nV; v++) {
      const claimFocus = v === 0 && focusSlots;
      const pools: SlotKey[] = claimFocus ? focusSlots.v : rotateList(tpl.vPool, week * 2 + v + ctx.blockIndex);
      let pick: Exercise | undefined;
      let pickSlot: SlotKey = pools[0];
      for (const pool of pools) {
        pick = best(candidates(ctx, pool, 'gym').filter((e) => !inSession.has(e.id)), (e) =>
          jitter(ctx, e.id, `v${week}${v}`) - (usedV.has(e.id) ? 2 : 0) - (baseFamilies.has(e.family) ? 1.5 : 0) + (ctx.input.flags?.[e.id]?.favourite ? 2 : 0));
        if (pick) {
          pickSlot = pool;
          break;
        }
      }
      if (!pick) continue;
      usedV.add(pick.id);
      add(pick, pickSlot, 'V', 2, isolationReps(zone), claimFocus ? `Focus: ${FOCUS_LABEL[ctx.focus]}.` : undefined);
    }
  }

  // Grip finisher, last, on moderate and light days only (§4.1).
  let gripName = '';
  if (zone === 'M' || zone === 'L') {
    for (let k = 0; k < GRIP_ROTATION.length; k++) {
      const g = GRIP_ROTATION[(gripCounter + k + (ctx.blockIndex - 1) * 3) % GRIP_ROTATION.length];
      const pick = best(candidates(ctx, `grip:${g}`, 'gym').filter((e) => !inSession.has(e.id)), (e) => jitter(ctx, e.id, `g${week}`));
      if (pick) {
        add(pick, `grip:${g}`, 'G', 2, pick.repRange, 'Grip finisher.');
        gripName = pick.name;
        break;
      }
    }
  }

  trimToCap(exercises, 22);

  const label = SESSION_LABEL[type];
  const reps = compoundReps(effZone, ctx.blockIndex);
  if (zone === 'deload') notes.push('Deload week: base movements only, 2 sets each, about 10% lighter, stop with 4 or more reps in reserve.');
  else if (zone === 'H') notes.push(`Heavy day: fewer movements, more sets, ${reps.min}–${reps.max} reps on the big lifts.`);
  else if (zone === 'M') notes.push(`Moderate day: ${reps.min}–${reps.max} reps on the big lifts, plus one variety movement.`);
  else notes.push(`Light day: ${reps.min}–${reps.max} reps on the big lifts and a wider mix of movements.`);
  if (focusSlots && zone !== 'deload') notes.push(`Extra ${FOCUS_LABEL[ctx.focus]} work (block focus).`);
  if (gripName) notes.push(`Finish with ${gripName.toLowerCase()} for grip.`);

  return {
    id: ctx.newId(),
    createdAt: ctx.now,
    updatedAt: ctx.now,
    deletedAt: null,
    ...common,
    sessionType: type,
    zone,
    isDeload: zone === 'deload',
    focus: `${label} · ${ZONE_NAME[zone]}`,
    rationale: notes.join(' '),
    exercises,
  };
}

function addSet(e: PlannedExercise) {
  const last = e.sets[e.sets.length - 1];
  e.sets.push({ ...last, setIndex: e.sets.length, targetReps: last.targetReps ?? e.sets[0].targetReps });
}

function rotateList<T>(list: T[], by: number): T[] {
  const k = ((by % list.length) + list.length) % list.length;
  return [...list.slice(k), ...list.slice(0, k)];
}

/** Keep sessions inside 12–22 working sets by trimming isolation/variety slots with 3+ sets. */
function trimToCap(exercises: PlannedExercise[], cap: number) {
  const total = () => exercises.reduce((n, e) => n + e.sets.length, 0);
  while (total() > cap) {
    const victim = [...exercises].reverse().find((e) => (e.role === 'I' || e.role === 'V') && e.sets.length > 2);
    if (!victim) break;
    victim.sets.pop();
  }
}

/**
 * Add one set for an under-covered muscle: isolation and variety slots first, then compounds,
 * never the primary lift, in a non-deload session with room under 22 sets.
 */
function addCoverageSet(workouts: PlannedWorkout[], byId: Map<string, Exercise>, muscle: string, coverage: CoverageReport): boolean {
  // Lift the thinnest week first, so the extra sets spread across the block.
  const weekSets = (w: PlannedWorkout) => (coverage.weeks[w.weekIndex] as Record<string, number> | undefined)?.[muscle] ?? 0;
  const ordered = [...workouts].sort((a, b) => weekSets(a) - weekSets(b));
  for (const roles of [['I', 'V'], ['C']]) {
    for (const w of ordered) {
      if (w.isDeload || w.sessionType === 'core' || w.weekIndex > 2) continue;
      const total = w.exercises.reduce((n, e) => n + e.sets.length, 0);
      if (total >= 22) continue;
      const target = w.exercises.find((e) => roles.includes(e.role) && e.sets.length < 4 && byId.get(e.exerciseId)?.primaryMuscles.some((m) => muscleGroupOf(m) === muscle));
      if (target) {
        addSet(target);
        return true;
      }
    }
  }
  return false;
}

export function muscleGroupOf(m: string): string {
  if (m === 'lats' || m === 'upper-back') return 'back';
  if (m === 'glutes' || m === 'hamstrings') return 'glutes-hamstrings';
  return m;
}

// ---------- core day (home) ----------

function pickCoreBase(ctx: Ctx): Record<CoreDynamic, Exercise> {
  const prev = ctx.input.previousBlock?.baseSlots ?? {};
  const out = {} as Record<CoreDynamic, Exercise>;
  const location = coreLocation(ctx);
  for (const [, a, b] of CORE_SUPERSETS) {
    for (const dyn of [a, b]) {
      const key = `core|core:${dyn}`;
      const prevId = prev[key];
      const prevEx = prevId ? ctx.byId.get(prevId) : undefined;
      const pool = candidates(ctx, `core:${dyn}`, location).filter((e) => !Object.values(out).some((o) => o.id === e.id));
      // Variants rotate every block within each dynamic, preferring one step up the ladder.
      const pick = best(pool, (e) => {
        let s = jitter(ctx, e.id, dyn);
        if (!prevEx) s += (e.starter ? 6 : 0) - e.difficultyRank;
        else {
          if (e.id === prevEx.id) s -= 10;
          if (e.family === prevEx.family && e.difficultyRank === prevEx.difficultyRank + 1) s += 4;
          if (e.family !== prevEx.family) s += 2;
          s -= Math.abs(e.difficultyRank - prevEx.difficultyRank - 0.5);
        }
        if (ctx.input.flags?.[e.id]?.favourite) s += 2;
        return s;
      });
      if (!pick) throw new Error(`No home exercise for core dynamic ${dyn}`);
      ctx.baseSlots[key] = pick.id;
      out[dyn] = pick;
    }
  }
  return out;
}

function coreLocation(ctx: Ctx): Location {
  return ctx.input.profile.schedule.find((s) => s.type === 'core')?.location ?? 'home';
}

function buildCore(ctx: Ctx, common: Common, base: Record<CoreDynamic, Exercise>): PlannedWorkout {
  const week = common.weekIndex;
  const deload = week === 3;
  const zone: Zone = ctx.input.profile.coreWave === 'flat' ? 'M' : CORE_WAVE[Math.min(week, 2)];
  const targets = coreTargets(deload ? 'M' : zone);
  const exercises: PlannedExercise[] = [];
  const location = coreLocation(ctx);
  for (const [group, a, b] of CORE_SUPERSETS) {
    for (const dyn of [a, b]) {
      let ex = base[dyn];
      let note: string | undefined;
      if (!deload && zone === 'H') {
        // Heavy core week: one step up each movement's ladder (§4.2 core day).
        const harder = ex.progressions.map((id) => ctx.byId.get(id)).find((p) => p && p.slots.includes(`core:${dyn}`) && usable(ctx, p, location));
        if (harder) {
          note = `Harder variant of ${ex.name}.`;
          ex = harder;
        } else note = heavyNote(ctx, ex);
      } else if (!deload && zone === 'L') {
        note = ex.loadType === 'kettlebell' ? `Light week: the ${Math.min(...ctx.input.profile.kettlebellsLb)} lb kettlebell, more reps.` : 'Light week: more reps or longer holds; slow 3-second lowering if it gets easy.';
      }
      const want = ex.metric === 'time' ? targets.seconds : targets.reps;
      const range = repsFor(ex, want);
      const sets = makeSets(deload ? 1 : 2, range, ex.metric, deload ? 4 : 2, 45);
      exercises.push({ id: ctx.newId(), exerciseId: ex.id, slot: `core:${dyn}`, role: 'K', order: exercises.length, supersetGroup: group, sets, note });
    }
  }
  const zoneName = deload ? 'Deload' : ZONE_NAME[zone];
  const rationale = deload
    ? 'Deload week: all 8 core dynamics, 1 set each.'
    : zone === 'H'
      ? 'Heavy core week: the harder variant, heavier kettlebell or next band, 6–10 reps or 15–25 s holds.'
      : zone === 'L'
        ? 'Light core week: 15–25 reps or 45–60 s holds.'
        : 'Moderate core week: 10–15 reps or 30–40 s holds. Four supersets, every core dynamic once.';
  return {
    id: ctx.newId(),
    createdAt: ctx.now,
    updatedAt: ctx.now,
    deletedAt: null,
    ...common,
    sessionType: 'core',
    zone: deload ? 'deload' : zone,
    isDeload: deload,
    focus: `Core · ${zoneName}`,
    rationale,
    exercises,
  };
}

function heavyNote(ctx: Ctx, ex: Exercise): string {
  if (ex.loadType === 'kettlebell') return `Heavy week: use the ${Math.max(...ctx.input.profile.kettlebellsLb)} lb kettlebell.`;
  if (ex.loadType === 'band') return 'Heavy week: next band up, or a step further from the anchor.';
  return 'Heavy week: add a pause at the hardest point, or hold a kettlebell.';
}
