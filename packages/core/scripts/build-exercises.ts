// Builds src/data/exercises.json and the web app's public/exercises/<id>/{0,1}.jpg from
// scripts/curation.ts joined with free-exercise-db at a pinned commit.
//
//   npx tsx scripts/build-exercises.ts
//
// Downloads are cached in .cache/free-exercise-db/ (gitignored). Exits non-zero
// when the catalog fails validation. The validation helpers are exported so the
// test suite can run the same checks against the generated JSON.

import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type {
  CoreDynamic, Equipment, Exercise, GripType, LoadType, MovementPattern, Muscle, CatalogSlot, WeightConvention,
} from '../src/types.js';
import type { CuratedEntry } from './curation';
import { INSTRUCTIONS } from './instructions';

// ───────────────────────────── constants ─────────────────────────────

export const FREE_EXERCISE_DB_COMMIT = 'f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5';
const RAW_BASE = `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${FREE_EXERCISE_DB_COMMIT}`;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '..', '..', '.cache', 'free-exercise-db', FREE_EXERCISE_DB_COMMIT);
const OUT_JSON = join(ROOT, 'src', 'data', 'exercises.json');
const OUT_IMAGES = join(ROOT, '..', '..', 'apps', 'web', 'public', 'exercises');

/** Equipment available at each location (mirrors the default profile). */
export const GYM_EQUIPMENT: readonly Equipment[] = [
  'dumbbell', 'kettlebell', 'cable', 'machine', 'smith-machine', 'bench', 'pull-up-bar',
  'back-extension-bench', 'plate', 'mat', 'none',
];
export const HOME_EQUIPMENT: readonly Equipment[] = ['band', 'kettlebell', 'ab-wheel', 'mat', 'none'];
/** Optional gear: barbell-pack movements are planned only for a kit that lists it. */
export const BARBELL_EQUIPMENT: readonly Equipment[] = ['barbell', 'ez-bar', 'rack'];

export const usableWith = (ex: Pick<Exercise, 'equipment'>, available: readonly Equipment[]): boolean =>
  ex.equipment.every((e) => available.includes(e));

// Runtime copies of the enums in src/types.ts. The `Exact` checks below make tsc fail
// if a value is added to or removed from a type without updating these lists.
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const exact = <T extends true>(_: T) => undefined;

export const MOVEMENT_PATTERNS = [
  'squat', 'lunge', 'hinge', 'hip-extension', 'push-horizontal', 'push-vertical', 'pull-horizontal', 'pull-vertical',
  'carry', 'anti-extension', 'anti-rotation', 'anti-lateral-flexion', 'trunk-flexion', 'rotation', 'hip-flexion',
  'lateral-flexion', 'elbow-flexion', 'elbow-extension', 'shoulder-raise', 'rear-delt', 'chest-fly', 'knee-extension',
  'knee-flexion', 'hip-abduction', 'hip-adduction', 'calf', 'shrug', 'grip',
] as const;
export const MUSCLES = [
  'chest', 'front-delts', 'side-delts', 'rear-delts', 'lats', 'upper-back', 'traps', 'lower-back', 'biceps', 'triceps',
  'forearms', 'abs', 'obliques', 'quads', 'hamstrings', 'glutes', 'glute-med', 'adductors', 'calves', 'hip-flexors',
] as const;
export const EQUIPMENT = [
  'dumbbell', 'kettlebell', 'cable', 'machine', 'smith-machine', 'bench', 'pull-up-bar', 'back-extension-bench',
  'plate', 'band', 'ab-wheel', 'mat', 'none', 'barbell', 'ez-bar', 'rack',
] as const;
export const LOAD_TYPES = ['smith', 'barbell', 'ez-bar', 'dumbbell', 'kettlebell', 'machine', 'cable', 'bodyweight', 'assisted', 'band', 'plate'] as const;
export const WEIGHT_CONVENTIONS = ['total', 'per-hand', 'added', 'assist', 'band', 'none'] as const;
export const CORE_DYNAMICS = [
  'anti-extension', 'hip-extension', 'trunk-flexion', 'anti-rotation', 'rotation', 'anti-lateral-flexion',
  'hip-flexion', 'lateral-flexion',
] as const;
export const GRIP_TYPES = ['support', 'crush', 'pinch', 'wrist-flexion', 'wrist-extension', 'rotation', 'reverse-curl'] as const;
export const BASE_SLOTS = [
  'legs:squat', 'legs:hinge', 'legs:single-leg', 'legs:knee-extension', 'legs:knee-flexion', 'legs:calf',
  'chest:flat-press', 'chest:incline-press', 'chest:fly', 'biceps:supinated', 'biceps:neutral', 'biceps:stretch',
  'back:vertical-pull', 'back:horizontal-pull', 'shoulders:vertical-press', 'shoulders:side-delt', 'triceps:overhead',
  'triceps:pushdown',
] as const;
export const VARIETY_SLOTS = [
  'legs:v:hip-extension', 'legs:v:squat-machine', 'legs:v:adduction', 'legs:v:abduction', 'legs:v:hinge-variant',
  'chest:v:press-variant', 'biceps:v:curl-variant', 'shoulders:v:rear-delt', 'back:v:row-variant', 'back:v:shrug',
] as const;
export const CORE_SLOTS = CORE_DYNAMICS.map((d) => `core:${d}` as const);
export const GRIP_SLOTS = GRIP_TYPES.map((g) => `grip:${g}` as const);
export const ALL_SLOTS: readonly CatalogSlot[] = [...BASE_SLOTS, ...VARIETY_SLOTS, ...CORE_SLOTS, ...GRIP_SLOTS];

exact<Exact<(typeof MOVEMENT_PATTERNS)[number], MovementPattern>>(true);
exact<Exact<(typeof MUSCLES)[number], Muscle>>(true);
exact<Exact<(typeof EQUIPMENT)[number], Equipment>>(true);
exact<Exact<(typeof LOAD_TYPES)[number], LoadType>>(true);
exact<Exact<(typeof WEIGHT_CONVENTIONS)[number], WeightConvention>>(true);
exact<Exact<(typeof CORE_DYNAMICS)[number], CoreDynamic>>(true);
exact<Exact<(typeof GRIP_TYPES)[number], GripType>>(true);
exact<
  Exact<(typeof BASE_SLOTS)[number] | (typeof VARIETY_SLOTS)[number] | `core:${CoreDynamic}` | `grip:${GripType}`, CatalogSlot>
>(true);

const MECHANICS = ['compound', 'isolation'];
const ANGLES = ['flat', 'incline', 'decline', 'overhead', 'low', 'high'];
const GRIPS = ['pronated', 'supinated', 'neutral', 'mixed'];
const LATERALITIES = ['bilateral', 'unilateral', 'alternating'];
const STANCES = ['standing', 'seated', 'lying', 'split', 'single-leg', 'kneeling', 'hanging', 'prone', 'supine'];
const LENGTH_BIASES = ['lengthened', 'mid', 'shortened'];
const STABILITIES = ['machine', 'supported', 'free'];
const METRICS = ['reps', 'time'];
const RUN_IMPACTS = ['none', 'low', 'high'];
const LEVELS = ['beginner', 'intermediate', 'advanced'];
/** Specialty bars the catalog doesn't use. */
export const FORBIDDEN_EQUIPMENT = ['trap-bar', 'landmine'];

/** Which weight conventions make sense for each load type. */
const CONVENTIONS_BY_LOAD: Record<LoadType, WeightConvention[]> = {
  smith: ['added'],
  barbell: ['total'],
  'ez-bar': ['total'],
  dumbbell: ['per-hand', 'total'],
  kettlebell: ['total', 'per-hand'],
  machine: ['total'],
  cable: ['total'],
  bodyweight: ['none', 'added'],
  assisted: ['assist'],
  band: ['band'],
  plate: ['total'],
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ───────────────────────────── validation ─────────────────────────────

/** Per-entry and cross-entry checks. Returns a list of human-readable errors (empty = valid). */
export function validateCatalog(exercises: readonly Exercise[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const err = (id: string, msg: string) => errors.push(`${id}: ${msg}`);
  const oneOf = (id: string, field: string, value: unknown, allowed: readonly unknown[], optional = false) => {
    if (optional && value === undefined) return;
    if (!allowed.includes(value)) err(id, `${field} "${String(value)}" is not one of ${allowed.join(', ')}`);
  };
  const listOf = (id: string, field: string, values: unknown, allowed: readonly unknown[], minLen = 0) => {
    if (!Array.isArray(values)) return err(id, `${field} must be an array`);
    if (values.length < minLen) err(id, `${field} needs at least ${minLen} value(s)`);
    for (const v of values) oneOf(id, field, v, allowed);
    if (new Set(values).size !== values.length) err(id, `${field} has duplicates`);
  };

  for (const ex of exercises) {
    const id = ex.id ?? '<missing id>';
    if (!SLUG.test(id)) err(id, 'id must be a kebab-case slug');
    if (ids.has(id)) err(id, 'duplicate id');
    ids.add(id);
    if (!ex.name?.trim()) err(id, 'missing name');
    if (!SLUG.test(ex.family ?? '')) err(id, `family "${ex.family}" must be a kebab-case slug`);

    oneOf(id, 'movementPattern', ex.movementPattern, MOVEMENT_PATTERNS);
    listOf(id, 'primaryMuscles', ex.primaryMuscles, MUSCLES, 1);
    listOf(id, 'secondaryMuscles', ex.secondaryMuscles, MUSCLES);
    for (const m of ex.secondaryMuscles ?? []) {
      if (ex.primaryMuscles?.includes(m)) err(id, `muscle "${m}" is both primary and secondary`);
    }
    oneOf(id, 'mechanic', ex.mechanic, MECHANICS);
    oneOf(id, 'angle', ex.angle, ANGLES, true);
    oneOf(id, 'grip', ex.grip, GRIPS, true);
    oneOf(id, 'laterality', ex.laterality, LATERALITIES);
    oneOf(id, 'stance', ex.stance, STANCES, true);
    oneOf(id, 'lengthBias', ex.lengthBias, LENGTH_BIASES, true);
    oneOf(id, 'stability', ex.stability, STABILITIES);
    for (const e of ex.equipment ?? []) {
      if (FORBIDDEN_EQUIPMENT.includes(e)) err(id, `forbidden equipment "${e}"`);
    }
    listOf(id, 'equipment', ex.equipment, EQUIPMENT, 1);
    if (ex.equipment?.includes('none') && ex.equipment.length > 1) err(id, '"none" must be the only equipment');
    oneOf(id, 'metric', ex.metric, METRICS);
    oneOf(id, 'loadType', ex.loadType, LOAD_TYPES);
    oneOf(id, 'weightConvention', ex.weightConvention, WEIGHT_CONVENTIONS);
    const allowedConventions = CONVENTIONS_BY_LOAD[ex.loadType];
    if (allowedConventions && !allowedConventions.includes(ex.weightConvention)) {
      err(id, `weightConvention "${ex.weightConvention}" does not fit loadType "${ex.loadType}"`);
    }
    if (ex.loadIncrementLb !== undefined && !(ex.loadIncrementLb > 0)) err(id, 'loadIncrementLb must be positive');
    if (['smith', 'barbell', 'ez-bar', 'dumbbell', 'machine', 'cable', 'assisted'].includes(ex.loadType) && ex.loadIncrementLb === undefined) {
      err(id, `loadType "${ex.loadType}" needs a loadIncrementLb`);
    }

    const r = ex.repRange;
    if (!r || !Number.isInteger(r.min) || !Number.isInteger(r.max) || r.min < 1) err(id, 'repRange must hold positive integers');
    else if (r.min > r.max) err(id, `repRange min ${r.min} > max ${r.max}`);
    else if (ex.metric === 'time' && (r.min < 5 || r.max > 180)) err(id, 'time repRange must be seconds (5–180)');
    else if (ex.metric === 'reps' && r.max > 30) err(id, `reps repRange max ${r.max} looks like seconds`);

    if (typeof ex.perSide !== 'boolean') err(id, 'perSide must be boolean');
    if (ex.perSide && ex.laterality === 'bilateral') err(id, 'perSide but laterality is bilateral');
    oneOf(id, 'fatigueCost', ex.fatigueCost, [1, 2, 3]);
    if (typeof ex.axialLoad !== 'boolean') err(id, 'axialLoad must be boolean');
    oneOf(id, 'runImpact', ex.runImpact, RUN_IMPACTS);
    oneOf(id, 'level', ex.level, LEVELS);
    if (!Number.isInteger(ex.difficultyRank) || ex.difficultyRank < 1) err(id, 'difficultyRank must be a positive integer');
    if (typeof ex.starter !== 'boolean') err(id, 'starter must be boolean');

    listOf(id, 'slots', ex.slots, ALL_SLOTS, 1);
    const coreSlots = (ex.slots ?? []).filter((s) => s.startsWith('core:'));
    const gripSlots = (ex.slots ?? []).filter((s) => s.startsWith('grip:'));
    if (coreSlots.length > 0 || ex.coreDynamic !== undefined) {
      oneOf(id, 'coreDynamic', ex.coreDynamic, CORE_DYNAMICS);
      if (coreSlots.length !== 1 || coreSlots[0] !== `core:${ex.coreDynamic}`) {
        err(id, `coreDynamic "${ex.coreDynamic}" must match exactly one core slot (has ${coreSlots.join(', ') || 'none'})`);
      }
      if (coreSlots.length > 0 && !usableWith(ex, HOME_EQUIPMENT)) err(id, 'core slot but not usable with home equipment');
    }
    if (gripSlots.length > 0 || ex.gripType !== undefined) {
      oneOf(id, 'gripType', ex.gripType, GRIP_TYPES);
      if (gripSlots.length !== 1 || gripSlots[0] !== `grip:${ex.gripType}`) {
        err(id, `gripType "${ex.gripType}" must match exactly one grip slot (has ${gripSlots.join(', ') || 'none'})`);
      }
      if (gripSlots.length > 0 && !usableWith(ex, GYM_EQUIPMENT)) err(id, 'grip slot but not usable with gym equipment');
    }
    const liftingSlots = (ex.slots ?? []).filter((s) => !s.startsWith('core:'));
    if (liftingSlots.length > 0 && !usableWith(ex, [...GYM_EQUIPMENT, ...BARBELL_EQUIPMENT, ...HOME_EQUIPMENT])) err(id, 'lifting slot but not usable with gym, barbell or home equipment');
    if ((ex.loadType === 'barbell' || ex.loadType === 'ez-bar') && !ex.equipment.includes(ex.loadType)) err(id, `${ex.loadType} load needs ${ex.loadType} equipment`);
    if (ex.starter && !(ex.slots ?? []).some((s) => (BASE_SLOTS as readonly string[]).includes(s) || s.startsWith('core:'))) {
      err(id, 'starter must fill a base slot or a core slot');
    }

    if (!Array.isArray(ex.cues) || ex.cues.length < 2 || ex.cues.length > 4) err(id, 'needs 2–4 cues');
    if (ex.cues?.some((c) => !c.trim())) err(id, 'empty cue');
    if (!Array.isArray(ex.instructions) || ex.instructions.length === 0) err(id, 'needs instructions');
    if (ex.instructions?.some((c) => !c.trim())) err(id, 'empty instruction step');
    if (!Array.isArray(ex.aliases)) err(id, 'aliases must be an array');
    if (!Array.isArray(ex.tags)) err(id, 'tags must be an array');
    if (ex.license !== 'FSL-1.1-MIT') err(id, 'entries are FSL-1.1-MIT');

    if (ex.source?.name === 'free-exercise-db') {
      if (!ex.source.sourceId) err(id, 'free-exercise-db source without sourceId');
      if (ex.imageLicense !== 'unverified') err(id, 'entries with free-exercise-db photos mark them unverified');
      const expected = [`exercises/${id}/0.jpg`, `exercises/${id}/1.jpg`];
      if (JSON.stringify(ex.images) !== JSON.stringify(expected)) err(id, `images must be ${expected.join(', ')}`);
    } else if (ex.source?.name === 'get-fit') {
      if (ex.images?.length !== 0) err(id, 'own entries have no images');
      if (ex.imageLicense !== undefined) err(id, 'entries without photos have no imageLicense');
    } else {
      err(id, 'unknown source');
    }
  }

  for (const ex of exercises) {
    for (const field of ['regressions', 'progressions'] as const) {
      const refs = ex[field];
      if (!Array.isArray(refs)) {
        err(ex.id, `${field} must be an array`);
        continue;
      }
      for (const ref of refs) {
        if (ref === ex.id) err(ex.id, `${field} references itself`);
        else if (!ids.has(ref)) err(ex.id, `${field} references unknown id "${ref}"`);
      }
    }
  }

  errors.push(...checkCoverage(exercises));
  return errors;
}

/** Slot coverage rules (see periodization §4.2): enough usable candidates in every slot. */
export function checkCoverage(exercises: readonly Exercise[]): string[] {
  const errors: string[] = [];
  const inSlot = (slot: CatalogSlot, available: readonly Equipment[]) =>
    exercises.filter((e) => e.slots.includes(slot) && usableWith(e, available));

  for (const slot of BASE_SLOTS) {
    const c = inSlot(slot, GYM_EQUIPMENT);
    if (c.length < 3) errors.push(`${slot}: only ${c.length} gym-usable candidate(s), need 3`);
    if (!c.some((e) => e.starter)) errors.push(`${slot}: no starter`);
  }
  for (const slot of VARIETY_SLOTS) {
    const c = inSlot(slot, GYM_EQUIPMENT);
    if (c.length < 2) errors.push(`${slot}: only ${c.length} gym-usable candidate(s), need 2`);
  }
  for (const slot of CORE_SLOTS) {
    const c = inSlot(slot, HOME_EQUIPMENT);
    if (c.length < 3) errors.push(`${slot}: only ${c.length} home-usable candidate(s), need 3`);
    if (new Set(c.map((e) => e.difficultyRank)).size < 2) errors.push(`${slot}: needs at least two difficulty ranks`);
  }
  for (const slot of GRIP_SLOTS) {
    const c = inSlot(slot, GYM_EQUIPMENT);
    if (c.length < 1) errors.push(`${slot}: no gym-usable candidate`);
  }
  return errors;
}

// ───────────────────────────── build ─────────────────────────────

type SourceExercise = { id: string; name: string; instructions: string[]; images: string[] };

async function download(url: string): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      if (attempt >= 3) throw new Error(`download failed: ${url}: ${(e as Error).message}`);
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
}

async function cached(relPath: string, url: string): Promise<Buffer> {
  const file = join(CACHE_DIR, relPath);
  if (existsSync(file)) return readFile(file);
  const data = await download(url);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, data);
  return data;
}

/** Turn a curated entry plus its (optional) source into a full Exercise with a fixed key order. */
export function toExercise(c: CuratedEntry): Exercise {
  // Always our own text: free-exercise-db's instructions are copied from a commercial site, so they're never used.
  const instructions = (c.instructions ?? INSTRUCTIONS[c.id] ?? []).map((s) => s.trim()).filter(Boolean);
  const ex: Exercise = {
    id: c.id,
    name: c.name,
    aliases: c.aliases,
    family: c.family,
    movementPattern: c.movementPattern,
    primaryMuscles: c.primaryMuscles,
    secondaryMuscles: c.secondaryMuscles,
    mechanic: c.mechanic,
    angle: c.angle,
    grip: c.grip,
    laterality: c.laterality,
    stance: c.stance,
    lengthBias: c.lengthBias,
    stability: c.stability,
    equipment: c.equipment,
    metric: c.metric,
    loadType: c.loadType,
    weightConvention: c.weightConvention,
    loadIncrementLb: c.loadIncrementLb,
    repRange: { min: c.repRange.min, max: c.repRange.max },
    perSide: c.perSide,
    fatigueCost: c.fatigueCost,
    axialLoad: c.axialLoad,
    runImpact: c.runImpact,
    level: c.level,
    difficultyRank: c.difficultyRank,
    starter: c.starter,
    regressions: c.regressions,
    progressions: c.progressions,
    slots: c.slots,
    coreDynamic: c.coreDynamic,
    gripType: c.gripType,
    tags: c.tags,
    cues: c.cues,
    instructions,
    images: c.sourceId ? [`exercises/${c.id}/0.jpg`, `exercises/${c.id}/1.jpg`] : [],
    source: c.sourceId ? { name: 'free-exercise-db', sourceId: c.sourceId } : { name: 'get-fit' },
    license: 'FSL-1.1-MIT',
    imageLicense: c.sourceId ? 'unverified' : undefined,
  };
  // Drop undefined optional keys so the JSON stays tidy.
  for (const k of Object.keys(ex) as (keyof Exercise)[]) if (ex[k] === undefined) delete ex[k];
  return ex;
}

async function main(): Promise<void> {
  const { curation } = await import('./curation');
  const errors: string[] = [];

  const sourceJson = await cached('exercises.json', `${RAW_BASE}/dist/exercises.json`);
  const sources = new Map<string, SourceExercise>(
    (JSON.parse(sourceJson.toString('utf8')) as SourceExercise[]).map((s) => [s.id, s]),
  );
  console.log(`free-exercise-db @ ${FREE_EXERCISE_DB_COMMIT.slice(0, 7)}: ${sources.size} entries`);

  // free-exercise-db's sentences, normalised, so a copied step can't slip back in.
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const sourceSentences = new Set([...sources.values()].flatMap((s) => s.instructions.map(norm)).filter((t) => t.length > 20));
  for (const id of Object.keys(INSTRUCTIONS)) if (!curation.some((c) => c.id === id)) errors.push(`instructions.ts: ${id} is not in the curation`);
  for (const c of curation) {
    const own = c.instructions ?? INSTRUCTIONS[c.id];
    if (!own?.length) errors.push(`${c.id}: needs its own instructions (curation.ts or instructions.ts)`);
    if (c.instructions && INSTRUCTIONS[c.id]) errors.push(`${c.id}: instructions in both curation.ts and instructions.ts`);
    for (const step of own ?? []) if (sourceSentences.has(norm(step))) errors.push(`${c.id}: an instruction step matches free-exercise-db text`);
    if (!c.sourceId) continue;
    const src = sources.get(c.sourceId);
    if (!src) errors.push(`${c.id}: sourceId "${c.sourceId}" not found in free-exercise-db`);
    else if (src.images.length < 2) errors.push(`${c.id}: sourceId "${c.sourceId}" has ${src.images.length} image(s), need 2`);
  }

  const exercises = curation.map((c) => toExercise(c));
  errors.push(...validateCatalog(exercises));

  if (errors.length > 0) {
    console.error(`\n${errors.length} validation error(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }

  // Photos: copy the two source images per sourced entry to public/exercises/<id>/,
  // shrunk to 480 px wide so the whole set precaches quickly for offline use.
  let downloaded = 0;
  const sourced = curation.filter((c) => c.sourceId);
  const queue = [...sourced];
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      const src = sources.get(c.sourceId!)!;
      const outDir = join(OUT_IMAGES, c.id);
      await mkdir(outDir, { recursive: true });
      for (const [i, imagePath] of src.images.slice(0, 2).entries()) {
        const rel = join('images', imagePath);
        if (!existsSync(join(CACHE_DIR, rel))) downloaded++;
        await cached(rel, `${RAW_BASE}/exercises/${imagePath}`);
        await copyFile(join(CACHE_DIR, rel), join(outDir, `${i}.jpg`));
        shrink(join(outDir, `${i}.jpg`));
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));

  // Remove photo folders for ids that no longer have a source.
  const keep = new Set(sourced.map((c) => c.id));
  if (existsSync(OUT_IMAGES)) {
    for (const dir of await readdir(OUT_IMAGES)) {
      if (!keep.has(dir)) await rm(join(OUT_IMAGES, dir), { recursive: true, force: true });
    }
  }

  await mkdir(dirname(OUT_JSON), { recursive: true });
  await writeFile(OUT_JSON, `${JSON.stringify(exercises, null, 2)}\n`);

  console.log(
    `wrote ${exercises.length} exercises (${sourced.length} with photos, ${exercises.length - sourced.length} own) ` +
      `to ${OUT_JSON.replace(`${ROOT}/`, '')}; ${downloaded} image(s) downloaded, rest from cache`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}

/** Resize in place with ImageMagick when it's installed; otherwise keep the original. */
function shrink(file: string) {
  try {
    execFileSync('convert', [file, '-resize', '480x>', '-strip', '-quality', '72', file], { stdio: 'ignore' });
  } catch {
    if (!warnedNoConvert) console.warn('ImageMagick `convert` not found: photos copied at full size.');
    warnedNoConvert = true;
  }
}
let warnedNoConvert = false;
