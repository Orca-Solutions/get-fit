# @orca-solutions/get-fit-core

The get-fit training engine as a library: domain types, the curated exercise catalog, training programs as data, the block generator, progression and coverage helpers, the sync protocol, an IndexedDB client and a SQLite sync store.

Version documented: `0.2.0` (the version on `main`; the latest release may be older). See [README.md](README.md#stability) for the stability policy, [../periodization.md](../periodization.md) for the training rules behind the generator, and [../SPEC.md](../SPEC.md) for the product.

- [Install](#install)
- [Entry points](#entry-points)
- [Conventions](#conventions)
- [Domain types](#domain-types)
- [Catalog and profiles](#catalog-and-profiles)
- [Programs](#programs)
- [Generating a block](#generating-a-block)
- [Program numbers (templates)](#program-numbers-templates)
- [Coverage](#coverage)
- [Progression](#progression)
- [Sessions](#sessions)
- [Record validation](#record-validation)
- [Sync protocol and `SyncStore`](#sync-protocol-and-syncstore)
- [Utilities](#utilities)
- [`/client`](#client)
- [`/sqlite`](#sqlite)

## Install

The package is distributed as a tarball attached to each `core-v<version>` GitHub release. It is not published to the npm registry.

```sh
npm install https://github.com/Orca-Solutions/get-fit/releases/download/core-v0.2.0/orca-solutions-get-fit-core-0.2.0.tgz
```

| Requirement | Needed for |
|---|---|
| Node.js `>= 22` (`engines`) | Everything. The root entry point also runs in browsers. |
| `dexie` `^4` (optional peer dependency) | `@orca-solutions/get-fit-core/client` |
| `better-sqlite3` `>=11` (optional peer dependency) | `@orca-solutions/get-fit-core/sqlite` |

Install only the peer dependency for the entry point in use. The package is ESM only (`"type": "module"`) and ships both compiled JavaScript with declarations (`dist`) and the TypeScript sources (`src`, exposed through a `source` export condition).

## Entry points

| Import | Contents | Runs in |
|---|---|---|
| `@orca-solutions/get-fit-core` | Types, `CATALOG`, profiles, `Program` and `STRANGE_PERIODIZATION`, `generateBlock`, program numbers, coverage, progression, session merge, `validRow`, the sync protocol and `SyncStore`, dates, ids, formatting. No I/O. | Anywhere |
| `@orca-solutions/get-fit-core/client` | `GetFitDB` (Dexie/IndexedDB), the plan horizon (`ensurePlan`), logging, backup and restore, and the sync engine. | Browsers (or Node with an IndexedDB shim such as `fake-indexeddb`) |
| `@orca-solutions/get-fit-core/sqlite` | `openSqliteStore`: a `SyncStore` on SQLite for a single-user server. | Node |

The root entry point re-exports `types.ts` (types only), `protocol.ts`, `program.ts`, `profiles.ts`, `catalog.ts`, `data/muscleGroups.ts`, `dates.ts`, `ids.ts`, `format.ts`, `kettlebells.ts`, `session.ts`, `validate.ts` and `generator/{generateBlock,templates,coverage,progression}.ts`.

## Conventions

- **Records.** Every stored record carries `SyncFields`: `id`, `createdAt`, `updatedAt` (ISO 8601 timestamps) and an optional `deletedAt`. Deletes are soft: a record with `deletedAt` set is kept and synced like any other write. Sync is last-write-wins per record by `updatedAt`, except for sessions, which merge per field (see [Sessions](#sessions)).
- **Calendar dates** are `YYYY-MM-DD` strings in the user's local time. **Weekdays** are numbers with `0` = Sunday, as in `Date#getDay`.
- **Units.** Weights are pounds (`Profile.units` is always `'lb'`). Time-based sets are in seconds.
- **Deterministic ids.** Ids derived from dates (`block-<startDate>`, `w-<date>-<type>`, `s-<plannedWorkoutId>`, and logged-set ids for planned sets) make two offline devices that do the same thing produce the same record, so sync merges them instead of duplicating.

## Domain types

All types below are exported from the root entry point (`import type { ... } from '@orca-solutions/get-fit-core'`).

### `SyncFields`

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | |
| `createdAt` | `string` | ISO timestamp. |
| `updatedAt` | `string` | ISO timestamp; decides last-write-wins. |
| `deletedAt` | `string \| null` (optional) | Set for a soft delete. |

### `Exercise`

A catalog entry or a custom movement. The catalog schema and tagging rules are described in [../exercise-database.md](../exercise-database.md).

| Field | Type | Notes |
|---|---|---|
| `id`, `name` | `string` | `id` is a slug, e.g. `smith-machine-squat`. |
| `aliases` | `string[]` | |
| `family` | `string` | Movement family; the generator avoids two of a family in one day where it can. |
| `movementPattern` | `MovementPattern` | `squat`, `hinge`, `push-horizontal`, `pull-vertical`, `carry`, `anti-rotation`, `grip`, ... |
| `primaryMuscles`, `secondaryMuscles` | `Muscle[]` | Primary counts 1 set toward coverage, secondary 0.5. |
| `mechanic` | `'compound' \| 'isolation'` | |
| `angle`, `grip`, `stance`, `lengthBias` | optional enums | Descriptive tags. |
| `laterality` | `'bilateral' \| 'unilateral' \| 'alternating'` | |
| `stability` | `'machine' \| 'supported' \| 'free'` | |
| `equipment` | `Equipment[]` | All must be available at a location for the movement to be usable there. |
| `metric` | `'reps' \| 'time'` | |
| `loadType` | `LoadType` | `smith`, `dumbbell`, `kettlebell`, `machine`, `cable`, `bodyweight`, `assisted`, `band`, `plate`. |
| `weightConvention` | `WeightConvention` | What the logged weight means: `total`, `per-hand`, `added`, `assist`, `band`, `none`. |
| `loadIncrementLb` | `number` (optional) | Step used by `nextLoad`; defaults to 5. |
| `repRange` | `{ min, max }` | Sane bounds; seconds when `metric` is `'time'`. |
| `perSide` | `boolean` | |
| `fatigueCost` | `1 \| 2 \| 3` | |
| `axialLoad` | `boolean` | Axial hinges are kept out of light days. |
| `runImpact` | `'none' \| 'low' \| 'high'` | |
| `level` | `'beginner' \| 'intermediate' \| 'advanced'` | Filtered by `SelectionRules.allowedLevels`. |
| `difficultyRank` | `number` | Rank inside its family (1 = easiest); drives core variant progression. |
| `starter` | `boolean` | Preferred in block 1. |
| `regressions`, `progressions` | `string[]` | Exercise ids. |
| `slots` | `SlotKey[]` | Generator slots the movement may fill (see `CatalogSlot`). |
| `coreDynamic`, `gripType` | optional | For core and grip movements. |
| `tags`, `cues`, `instructions`, `images` | `string[]` | |
| `source` | `{ name: 'free-exercise-db' \| 'get-fit'; sourceId?: string }` | |
| `license` | `'Unlicense' \| 'FSL-1.1-MIT'` | `Unlicense` for entries drawn from free-exercise-db, `FSL-1.1-MIT` for the project's own. |

Related enumerations: `MovementPattern`, `Muscle` (20 muscles), `Equipment` (13 values), `LoadType`, `WeightConvention`, `CoreDynamic` (the 8 dynamics the core day covers), `GripType` (7 grip finishers), and `CatalogSlot`, the slot tags the curated catalog uses (`'legs:squat'`, `'chest:v:press-variant'`, `` `core:${CoreDynamic}` ``, `` `grip:${GripType}` ``, ...). `SlotKey` is `string`, so a custom program can define its own slots.

### `Profile`

`Profile = SyncFields & {...}`. There is one profile per database, with id `PROFILE_ID` (`'me'`).

| Field | Type | Notes |
|---|---|---|
| `heightIn`, `bodyweightLb` | `number` | `bodyweightLb` feeds assisted-lift loads. |
| `units` | `'lb'` | |
| `schedule` | `ScheduleEntry[]` | One entry per weekly session. |
| `equipmentByLocation` | `Record<Location, Equipment[]>` | `Location` is `'gym' \| 'home'`. |
| `bands` | `Band[]` | `{ id, name, order }`; `order` ranks them light to heavy. |
| `kettlebells` | `{ lb: number; count: number }[]` | Weight and how many are owned; a pair (`count >= 2`) unlocks double-bell (`per-hand`) movements. |
| `smithBarLb` | `number` | Added to `added`-convention Smith lifts by `effectiveLoad`. |
| `coreWave` | `'wave' \| 'flat'` | `'flat'` keeps the core day moderate every week. |

`ScheduleEntry` is `{ weekdays: Weekday[]; type: SessionType; location: Location }`. One weekday fixes the day; several (e.g. `[6, 0]`) make a window where either day counts. `SessionType` is a `string` naming a day type of the program (`'legs'`, `'chest-biceps'`, `'back-tri-shoulders'`, `'core'` in the original program).

### `Block`

`Block = SyncFields & {...}`: one four-week mesocycle (three loading weeks and a deload).

| Field | Type | Notes |
|---|---|---|
| `startDate` | `string` | A Monday. `id` is `block-<startDate>`. |
| `weeks` | `number` | Always `BLOCK_WEEKS` (4). |
| `index` | `number` | 1-based block number; the previous block's index + 1. |
| `generatorVersion` | `string` | `GENERATOR_VERSION` at planning time. |
| `programId`, `programVersion` | `string` (optional) | The `Program` that planned it; absent on blocks planned before programs existed. |
| `rationale` | `string` | Human-readable summary, including any notices about flagged slots. |
| `baseSlots` | `Record<string, string>` | `"<sessionType>\|<slotKey>"` → exercise id chosen for the block. The next block reads it to rotate movements. |
| `plannedAhead` | `boolean` (optional) | Set by `/client` on a block built before it started; its unlogged workouts are rebuilt once when it becomes current. |

### `PlannedWorkout`, `PlannedExercise`, `PlannedSet`

`PlannedWorkout = SyncFields & {...}`: one session on the calendar.

| Field | Type | Notes |
|---|---|---|
| `blockId` | `string` | |
| `date` | `string` | First day of its schedule entry in that week. `id` is `w-<date>-<sessionType>`. |
| `windowEnd` | `string` (optional) | Last day of a multi-day window. |
| `sessionType` | `SessionType` | |
| `location` | `Location` | |
| `weekIndex` | `number` | 0-based within the block; `3` is the deload. |
| `zone` | `Zone \| 'deload'` | `Zone` is `'H' \| 'M' \| 'L'` (heavy, moderate, light). |
| `isDeload` | `boolean` | |
| `focus` | `string` | e.g. `"Legs · Heavy"`. |
| `rationale` | `string` | Why the session looks the way it does. |
| `exercises` | `PlannedExercise[]` | In session order. |

`PlannedExercise`:

| Field | Type | Notes |
|---|---|---|
| `id` | `string` | `<workoutId>-<n>`. |
| `exerciseId` | `string` | |
| `slot` | `SlotKey` | The slot it fills. |
| `role` | `SlotRole` | `'P'` primary, `'C'` compound, `'I'` isolation, `'V'` variety, `'G'` grip, `'K'` core. |
| `order` | `number` | |
| `supersetGroup` | `string` (optional) | Core supersets: `'A'`, `'B'`, ... |
| `note` | `string` (optional) | e.g. a first-time calibration note, a stand-in explanation. |
| `sets` | `PlannedSet[]` | |

`PlannedSet`:

| Field | Type | Notes |
|---|---|---|
| `setIndex` | `number` | 0-based. |
| `targetReps` | `{ min, max }` (optional) | For `metric: 'reps'`. |
| `targetSeconds` | `{ min, max }` (optional) | For `metric: 'time'`. |
| `rir` | `number` | Reps in reserve to stop at. |
| `restSec` | `number` | Rest after the set. |

### `Session`

`Session = SyncFields & {...}`: a workout actually started. `/client` gives it the id `s-<plannedWorkoutId>`.

| Field | Type | Notes |
|---|---|---|
| `plannedWorkoutId` | `string \| null` | |
| `date` | `string` | The day it was done (moved to the day the first set is logged). |
| `startedAt` | `string` | |
| `endedAt` | `string \| null` (optional) | |
| `notes` | `string` (optional) | |
| `effort` | `number \| null` (optional) | |
| `beatUp` | `boolean` (optional) | Any beat-up session in a block skips the next block's volume ramp. |
| `swaps` | `Record<string, string>` (optional) | `plannedExerciseId` → exercise id done instead. |
| `swapReasons` | `Record<string, string>` (optional) | `plannedExerciseId` → reason (e.g. `"busy"`, `"pain"`). |
| `skipped` | `string[]` (optional) | `plannedExerciseId`s skipped on purpose. |
| `extras` | `{ id, exerciseId }[]` (optional) | Movements added on the fly. |
| `fieldAt` | `Record<string, string>` (optional) | When each field was last changed (`"notes"`, `"swaps.<plannedExerciseId>"`, `"skipped.<id>"`, ...), for per-field merging. |

### `LoggedSet`

`LoggedSet = SyncFields & {...}`.

| Field | Type | Notes |
|---|---|---|
| `sessionId` | `string` | |
| `exerciseId` | `string` | The movement actually done. |
| `plannedExerciseId` | `string \| null` | `null` for an extra movement. |
| `setIndex` | `number` | |
| `weight` | `number \| null` (optional) | Meaning depends on the exercise's `weightConvention`. |
| `bandId` | `string \| null` (optional) | For band movements. |
| `stanceSteps` | `number \| null` (optional) | Distance from the band anchor. |
| `reps`, `seconds` | `number \| null` (optional) | |
| `effort` | `'easy' \| 'right' \| 'hard' \| null` (optional) | Read as RIR 4, 2 and 0.5 by `setE1rm`. |
| `date` | `string` | |
| `loggedAt` | `string` | ISO timestamp. |

### `ExerciseFlag`

`ExerciseFlag = SyncFields & {...}`, with `id` equal to the exercise id.

| Field | Type | Notes |
|---|---|---|
| `favourite` | `boolean` (optional) | Raises the movement's selection score. |
| `avoid` | `boolean` (optional) | Never picked, anywhere. |
| `unavailable` | `boolean` (optional) | Older flag: not possible anywhere. New flags use `unavailableAt`. |
| `unavailableAt` | `Location[]` (optional) | Not possible at these locations. |

## Catalog and profiles

| Export | Signature | Description |
|---|---|---|
| `CATALOG` | `Exercise[]` | The curated library, built by `packages/core/scripts/build-exercises.ts`. |
| `PROFILE_ID` | `'me'` | Id of the single profile record. |
| `EPOCH` | `string` | `new Date(0).toISOString()`. |
| `neutralProfile` | `(t?: string) => Profile` | A starting profile with nothing personal: a typical commercial gym, bands at home, 69 in, 170 lb, the default four-day schedule. |
| `referenceProfile` | `(t?: string) => Profile` | The profile the project was tuned on (Smith machine gym, bands, ab wheel and 25 lb ×2 and 35 lb kettlebells at home). The golden tests pin its plans. |

Both profile factories set `createdAt` to `t` (default: now) and `updatedAt` to `EPOCH`, so a fresh device's defaults never win a sync or an import against a profile someone edited. The default schedule is chest and biceps Monday, legs Wednesday, back, triceps and shoulders Friday (gym), and core on Saturday or Sunday (home).

## Programs

A `Program` is the training method as data: day templates, zone rotation, and every number the generator uses. The generator holds the method (rotation, balancing, fallbacks); the program holds the choices. `STRANGE_PERIODIZATION` is the original program, described in [../periodization.md](../periodization.md).

```ts
type Program = {
  id: string;
  version: string;                         // recorded on every block
  days: Record<SessionType, DayTemplate>;  // keyed by day type
  params: TrainingParams;
  selection: SelectionRules;
};
type DayTemplate = LiftDay | CoreDay;
```

`LiftDay`:

| Field | Type | Notes |
|---|---|---|
| `kind` | `'lift'` | |
| `label` | `string` | Display name. |
| `base` | `BaseSlot[]` | Base movements, picked once per block, in session order. `BaseSlot` is `{ key: SlotKey; role: 'P' \| 'C' \| 'I'; distinctFamily?: boolean }`; `distinctFamily` asks for a different movement family than the day's other base slots. |
| `varietyPool` | `SlotKey[]` | Pools the variety slots draw from on moderate and light days. |
| `zones` | `Zone[]` | Zone for weeks 1 to 3 (exactly three); week 4 is the deload. |

`CoreDay`:

| Field | Type | Notes |
|---|---|---|
| `kind` | `'core'` | At most one core day per program. |
| `label` | `string` | |
| `supersets` | `[group: string, CoreDynamic, CoreDynamic][]` | Pairs of dynamics; each slot is `core:<dynamic>`. |

### `TrainingParams`

| Field | Description | Original program |
|---|---|---|
| `reps.compound` | Rep range per zone for P and C slots. | H 5–8, M 8–12, L 12–20 |
| `reps.compoundBlock1` | Block 1 overrides while weights are found. | H 6–8, L 12–15 |
| `reps.isolation` | Range per zone for I and V slots (grip finishers use the movement's own `repRange`). | H/M 10–15, L 12–20 |
| `sets.byRole` | Sets per role (`P`, `C`, `I`, `V`, `G`) and zone. | P 4/3/2, C 3/3/2, I 3/2/2 (H/M/L) |
| `sets.block1` | Block 1 overrides. | P heavy: 3 |
| `sets.deload` | Sets per movement in the deload. | 2 |
| `rir` | `{ compound: number[3]; other: number[3]; deload }`: RIR for weeks 1 to 3, then deload. | compound 3, 2, 2; other 3, 2, 1; deload 4 |
| `rest` | Seconds after each set: `compound` and `other` per zone and deload, `grip`, `core`. | compound H 150, M 105, L 75; other H 90, M/L 75; grip 60; core 45 |
| `varietySlots` | Variety movements per session by zone. | H 0, M 1, L 2 |
| `bands` | Target weekly sets `[min, max]` per `CoverageGroup`; groups without a band are not balanced. | e.g. quads 9–11, side delts 6–8 |
| `floors` | Below this a week gets a coverage warning. | 4 for major groups, 2 for calves, rear delts, forearms |
| `heavyExtra` | Slot that takes an extra set on a heavy day when its group is under its band. | e.g. quads → `legs:knee-extension` |
| `lightDayStandIns` | Slots searched for a stand-in when a base movement doesn't suit a light day. | hip extension, hinge variant |
| `topSet` | `{ fromBlock, reps, rir } \| null`: one heavy opening set on the primary lift on heavy days. | from block 3, 3–5 reps, RIR 2 |
| `volumeRamp` | `{ fromBlock, maxExtraSets } \| null`: extra heavy-day isolation sets, one more per block. | from block 3, up to 3 |
| `sessionCap` | `{ sets, movements }` a lifting session may hold (grip finisher aside for movements). | 22 sets, 8 movements |
| `grip` | `{ rotation: GripType[]; zones: Zone[] } \| null`: grip finishers, last, on these zones. | all 7 grip types, M and L |
| `core` | `{ wave: Zone[3]; targets: Record<Zone, { reps, seconds }>; sets; deloadSets; rir; deloadRir }` | wave M, H, L; 2 sets; deload 1 set |

### `SelectionRules`

| Field | Type | Description |
|---|---|---|
| `allowedLevels` | `Exercise['level'][]` | Levels the generator may pick (original: beginner, intermediate). |
| `starterBonus` | `number` | Added in block 1 for movements marked `starter`. |
| `levelBonus` | `Partial<Record<level, number>>` | Added per level; negative discourages. |
| `favouriteBonus` | `number` | Added for movements flagged `favourite`. |
| `primaryLoadTypeBonus` | `Partial<Record<LoadType, number>>` | Added on primary (P) slots by load type. |
| `fatigueStackPenalty` | `number` | Subtracted for a second fatigue-3 compound in one session. |
| `highRunImpactPenalty` | `number` | Subtracted for movements with `runImpact: 'high'`. |

### Program functions

| Export | Signature | Description |
|---|---|---|
| `STRANGE_PERIODIZATION` | `Program` | The original program: id `strange-periodization`, version `1.0.0`. |
| `liftDays` | `(p: Program) => [string, LiftDay][]` | The program's lifting days with their day types. |
| `coreDayType` | `(p: Program) => string \| undefined` | The day type of its core day, if any. |
| `validateProgram` | `(program: Program, catalog: Pick<Exercise, 'slots'>[], scheduleTypes?: string[]) => string[]` | Problems that would stop `program` planning against `catalog`. Empty when fine. |

`validateProgram` reports: schedule day types the program lacks; more than one core day; a lift day whose `zones` isn't three long or that has no P slot; any base, variety, core, grip or light-day stand-in slot that no movement in `catalog` is tagged for; a `heavyExtra` group with no band; `rir` or `core.wave` lists that aren't three long.

```ts
import { CATALOG, STRANGE_PERIODIZATION, validateProgram, type Program } from '@orca-solutions/get-fit-core';

// A variant of the original program with shorter sessions.
const shorter: Program = {
  ...STRANGE_PERIODIZATION,
  id: 'strange-periodization-short',
  version: '0.1.0',
  params: { ...STRANGE_PERIODIZATION.params, sessionCap: { sets: 18, movements: 7 } },
};

const problems = validateProgram(shorter, CATALOG, ['legs', 'chest-biceps', 'back-tri-shoulders', 'core']);
if (problems.length) throw new Error(problems.join('\n'));
```

## Generating a block

```ts
function generateBlock(input: GeneratorInput): GeneratedBlock;
```

A pure function from a profile, a catalog and the previous block to one four-week block. Given the same input (including `now`), it returns the same output: tie-breaks use a hash of the exercise id and block index, not randomness.

### `GeneratorInput`

| Field | Type | Required | Description |
|---|---|---|---|
| `profile` | `Profile` | yes | Schedule, equipment, kettlebells and core wave. |
| `program` | `Program` | no | Defaults to `STRANGE_PERIODIZATION`. |
| `exercises` | `Exercise[]` | yes | Candidates: usually `CATALOG` plus custom movements. |
| `flags` | `ExerciseFlags` | no | `Record<exerciseId, { avoid?, unavailable?, unavailableAt?, favourite? }>`. `ExerciseFlag` records fit this shape. |
| `startDate` | `string` | yes | The Monday the block starts on. Not checked: workout dates are laid out as if it were a Monday. |
| `previousBlock` | `Block` | no | Chains blocks: sets `index`, keeps or rotates base movements, enables the top set and volume ramp from their `fromBlock`. |
| `stalled` | `string[]` | no | Exercise ids to rotate out at this boundary (no e1RM gain over three exposures; see `isStalled`). |
| `known` | `string[]` | no | Exercise ids with any logged history. Others get a first-time calibration note. |
| `recoveryOk` | `boolean` | no | `false` skips the volume ramp (e.g. after a beat-up week in the last block). |
| `now` | `string` | no | ISO timestamp for `createdAt`/`updatedAt`. Defaults to the current time. |

### `GeneratedBlock`

```ts
type GeneratedBlock = { block: Block; workouts: PlannedWorkout[]; coverage: CoverageReport };
```

| Field | Description |
|---|---|
| `block` | The `Block`, with `id` `block-<startDate>`, `index`, `generatorVersion`, `programId`, `programVersion`, `baseSlots` and `rationale`. `plannedAhead` is not set. |
| `workouts` | Every session of the four weeks, sorted by date: one per schedule entry per week, with ids `w-<date>-<sessionType>`. |
| `coverage` | The `CoverageReport` of the final plan for the three loading weeks (see [Coverage](#coverage)). |

There is no separate notices field. When no candidate for a slot is usable (every one is flagged, or none fits the equipment), the slot takes a related movement for the same main muscle, or else keeps a flagged one, or else is left out of the block. Each fallback appends a sentence to `block.rationale`.

### What the generator does

1. Picks each lifting day's base movements once for the block, from the slot pools filtered by flags, `allowedLevels` and the profile's **gym** equipment. A movement from `previousBlock.baseSlots` is kept unless its slot rotates this block (one isolation slot at each boundary, and one compound slot on even blocks, secondary compounds before the primary) or it is listed in `stalled`.
2. Picks one core movement per dynamic for the block, using the equipment of the location the core day's schedule entry names, and steps variants along their family ladder from block to block.
3. Lays out the weeks: zones follow each day's `zones` (week 4 is the deload), sets, reps, RIR and rest come from `params`, light days swap axial hinges for a stand-in, heavy days add an extra set where a group is under its band, moderate and light days get variety movements and a grip finisher, and sessions are trimmed to `sessionCap.sets`.
4. Balances coverage week by week: removes sets from groups over their band, then adds sets (or a two-set variety movement) to groups under it.

### Errors

`generateBlock` throws an `Error` only when the profile's schedule names a day type the program doesn't define. Thin equipment never throws: a slot nothing fits is left out (see above). Run `validateProgram` first to catch schedule mismatches and slots no movement is tagged for.

### Other generator exports

| Export | Signature | Description |
|---|---|---|
| `GENERATOR_VERSION` | `'1.2.0'` | Recorded on every block. |
| `BLOCK_WEEKS` | `4` | |
| `blockIdFor` | `(startDate: string) => string` | `block-<startDate>`. |
| `workoutIdFor` | `(date: string, type: SessionType) => string` | `w-<date>-<type>`. |
| `flaggedOut` | `(flags: ExerciseFlags[string] \| undefined, location: Location) => boolean` | True when the flags rule the movement out at `location` (`avoid`, `unavailable`, or `unavailableAt` includes it). |
| `kbWeights` | `(profile: Profile, ex: Pick<Exercise, 'weightConvention'>) => number[]` | Kettlebell weights usable for a movement (pairs only for `per-hand`); `[0]` when none. |

### Example

```ts
import { CATALOG, generateBlock, neutralProfile } from '@orca-solutions/get-fit-core';

const profile = neutralProfile();
const first = generateBlock({ profile, exercises: CATALOG, startDate: '2026-10-12' });
// first.block.id === 'block-2026-10-12', first.workouts.length === 16 with the default schedule

const second = generateBlock({
  profile,
  exercises: CATALOG,
  startDate: '2026-11-09', // the Monday after the first block ends
  previousBlock: first.block,
  known: ['smith-machine-squat'],
  stalled: [],
});
console.log(second.block.index, second.block.rationale, second.coverage.warnings);
```

## Program numbers (templates)

Functions that read a program's `TrainingParams`. Each `p` parameter defaults to `STRANGE_PERIODIZATION.params`.

| Export | Signature | Description |
|---|---|---|
| `compoundReps` | `(zone: Zone, blockIndex: number, p?) => RepRange` | Compound range; block 1 uses `compoundBlock1` when set. |
| `isolationReps` | `(zone: Zone, p?) => RepRange` | |
| `setsFor` | `(role: SlotRole, zone: Zone \| 'deload', blockIndex: number, p?) => number` | Role `K` reads as `V`; block 1 overrides apply. |
| `rirFor` | `(weekIndex: number, role: SlotRole, p?) => number` | `weekIndex >= 3` returns the deload RIR. |
| `restFor` | `(role: SlotRole, zone: Zone \| 'deload', p?) => number` | Seconds. |
| `coreTargets` | `(zone: Zone, p?) => { reps: RepRange; seconds: RepRange }` | |
| `ZONE_NAME` | `Record<Zone \| 'deload', string>` | `Heavy`, `Moderate`, `Light`, `Deload`. |
| `SESSION_LABEL` | `Record<SessionType, string>` | Day labels of the original program. |
| `LIFT_TEMPLATES` | `Record<SessionType, LiftDay>` | Lifting days of the original program (kept for callers that predate `Program`). |
| `ZONE_ROTATION` | `Record<SessionType, Zone[]>` | Zones per lifting day of the original program. |

`RepRange` is `{ min: number; max: number }`; `LiftRole` is `SlotRole` without `'K'`.

## Coverage

Weekly sets per muscle group across the three loading weeks. A set counts 1 toward each primary muscle's group and 0.5 toward each secondary muscle's group. Core (`K`) work isn't counted.

| Export | Signature | Description |
|---|---|---|
| `COVERAGE_GROUPS` | `readonly CoverageGroup[]` | `quads`, `glutes-hamstrings`, `chest`, `back`, `side-delts`, `biceps`, `triceps`, `calves`, `rear-delts`, `forearms`. |
| `GROUP_LABEL` | `Record<CoverageGroup, string>` | Lower-case labels for prose. |
| `BANDS` | `Partial<Record<CoverageGroup, readonly [number, number]>>` | The original program's bands. |
| `groupOf` | `(m: string) => CoverageGroup \| undefined` | Muscle → group (`lats` and `upper-back` → `back`; `glutes` and `hamstrings` → `glutes-hamstrings`). |
| `creditOf` | `(ex: Pick<Exercise, 'primaryMuscles' \| 'secondaryMuscles'>) => Map<CoverageGroup, number>` | Credit per set. |
| `weeklySets` | `(workouts: PlannedWorkout[], byId: Map<string, Exercise>) => Record<CoverageGroup, number>[]` | Three entries, one per loading week. |
| `coverageReport` | `(workouts, byId, params?: Pick<TrainingParams, 'bands' \| 'floors'>) => CoverageReport` | |
| `isMajor` | `(g: CoverageGroup) => boolean` | True for the seven major groups. |

`CoverageReport`:

| Field | Type | Description |
|---|---|---|
| `weeks` | `Record<CoverageGroup, number>[]` | Sets per group for weeks 1 to 3. |
| `average` | `Record<CoverageGroup, number>` | Mean over the three weeks, rounded to 0.1. |
| `under`, `over` | `WeekGroup[]` | `{ week, group }` (0-based week) where a group sits below or above its band. |
| `warnings` | `string[]` | e.g. `"Week 2: calves has 1.5 sets (floor 2)."` |

## Progression

Loads and progression from logged sets ([../periodization.md](../periodization.md) §4.4). Functions that take a profile need only `bodyweightLb` and `smithBarLb`.

| Export | Signature | Description |
|---|---|---|
| `e1rm` | `(load: number, reps: number, rir?: number) => number` | Epley with reps in reserve: `load × (1 + (reps + rir) / 30)`. |
| `effectiveLoad` | `(ex, weight: number \| null \| undefined, profile) => number \| null` | The load the muscles moved (see below). |
| `setE1rm` | `(ex: Exercise, s: LoggedSet, profile) => number \| null` | e1RM of one set; `null` for time movements, sets without reps, or no positive load. `effort` maps to RIR `easy` 4, `right` 2, `hard` 0.5; no effort reads as 2. |
| `summarizeHistory` | `(ex: Exercise, sets: LoggedSet[], profile) => SessionSummary[]` | Groups a movement's non-deleted sets by session, newest first. `SessionSummary` is `{ sessionId, date, sets, bestE1rm }`. |
| `lastTimeHint` | `(ex, history: SessionSummary[], target: { min, max } \| undefined, bandName?: (id) => string, excludeSessionId?: string) => WeightHint \| null` | The newest session with a set within the target range (±1 rep), or else the newest session. |
| `nextLoad` | `(ex: Exercise, weight: number) => number` | One `loadIncrementLb` (default 5) up; down for `assist` movements, never below 0. |
| `describeLoad` | `(ex, s: Pick<LoggedSet, 'weight' \| 'bandId' \| 'stanceSteps'>, bandName?) => string` | e.g. `"40 lb each"`, `"+10 lb"`, `"90 lb plates"`, `"30 lb assist"`, `"Medium, 2 steps"`, `"bodyweight"`. |
| `fmtNum` | `(n: number) => string` | Integer as is, otherwise one decimal. |
| `bestSet` | `(ex, history, profile) => { set: LoggedSet; date: string } \| null` | Best set by e1RM, or by reps/seconds for movements without a load. |
| `isStalled` | `(history: SessionSummary[]) => boolean` | True when the best e1RM of the three newest sessions is no higher than the best before them. Needs at least four sessions with an e1RM. |

`effectiveLoad` by `weightConvention`:

| Convention | Result |
|---|---|
| `total`, `per-hand` | `weight`, or `null` when missing (`per-hand` is not doubled). |
| `added` | `weight` (0 when missing) plus `profile.smithBarLb` when `loadType` is `smith`. |
| `assist` | `max(0, bodyweightLb − weight)`. |
| `band`, `none` | `null`. |

`WeightHint` is `{ text, date, weight?, bandId?, stanceSteps?, suggest? }`. `suggest` is set when every set of the matched session reached the top of the target range and the movement has a `loadIncrementLb` (double progression); it is `nextLoad` of the heaviest matching set.

```ts
import { CATALOG, e1rm, effectiveLoad, isStalled, lastTimeHint, neutralProfile, summarizeHistory, type LoggedSet } from '@orca-solutions/get-fit-core';

declare const sets: LoggedSet[]; // e.g. historyFor('smith-machine-squat') from /client
const profile = neutralProfile();
const squat = CATALOG.find((e) => e.id === 'smith-machine-squat')!;

const load = effectiveLoad(squat, 90, profile); // 110: 90 lb of plates plus the 20 lb bar
const estimate = load == null ? null : e1rm(load, 8, 2);

const history = summarizeHistory(squat, sets, profile);
const hint = lastTimeHint(squat, history, { min: 8, max: 12 });
console.log(estimate, hint?.text, hint?.suggest, isStalled(history));
```

## Sessions

How a workout slot is displayed and how two devices' copies of one session merge.

| Export | Signature | Description |
|---|---|---|
| `movementFor` | `(pe: PlannedExercise, session: Pick<Session, 'swaps'> \| undefined, sets: LoggedSet[]) => string` | The exercise id a slot shows: the swap if any; else, if sets were logged in the slot and none with the planned movement, the most recently logged movement; else the planned one. |
| `changedFields` | `(before: Session, patch: Partial<Session>) => string[]` | The `fieldAt` keys a patch changes: `"<field>.<id>"` per changed entry of an object field (`swaps`, `swapReasons`, ...), `"skipped.<id>"` per slot added to or removed from `skipped`, and `"notes"`, `"effort"`, `"beatUp"`, `"endedAt"`, `"extras"` when changed. |
| `mergeSession` | `(a: Session, b: Session) => { session: Session; changed: boolean }` | Field-by-field merge: the copy with the later `updatedAt` is the base, and every `fieldAt` key the other copy changed more recently is taken from it. `changed` is true when the result differs from the newer copy and needs pushing again. |

Only fields tracked in `fieldAt` merge; other fields come from the newer copy. `/client`'s `updateSession` stamps `fieldAt` automatically.

## Record validation

```ts
function validRow(table: SyncTable, row: unknown): boolean;
```

True when `row` has the fields its table's screens rely on. Every row needs a non-empty string `id` and a parseable `updatedAt`. A row with `deletedAt` set needs only a parseable `deletedAt`. Otherwise:

| Table | Required |
|---|---|
| `profile` | `schedule`, `bands`, `kettlebells` arrays; `equipmentByLocation` object |
| `blocks` | `startDate` string; `weeks`, `index` numbers; `baseSlots` object |
| `plannedWorkouts` | `blockId`, `date`, `sessionType`, `location` strings; `weekIndex` number; `exercises` array whose items have `id`, `exerciseId` strings and `sets` with numeric `setIndex` |
| `sessions` | `date` string; `swaps` an object and `skipped` an array when present |
| `loggedSets` | `sessionId`, `exerciseId`, `date`, `loggedAt` strings; `setIndex` number |
| `exerciseFlags` | nothing beyond the common fields |
| `customExercises` | `name` string; `slots`, `primaryMuscles`, `secondaryMuscles`, `equipment` arrays; `repRange` object |

`/client` uses it as both the upload gate (a local row that fails is never pushed and is counted in `SyncStatus.heldBack`) and the import and pull filter. The sync server does not call it; it checks only the record envelope (see [sync-server.md](sync-server.md#validation)). A field added later should not be made required here unless every existing row is migrated, or older rows stop syncing.

## Sync protocol and `SyncStore`

Defined in `protocol.ts` and shared by the client sync engine, every server store and the server's request checks. The HTTP exchange built on these types is documented in [sync-server.md](sync-server.md).

```ts
const SYNC_TABLES = ['profile', 'blocks', 'plannedWorkouts', 'sessions', 'loggedSets', 'exerciseFlags', 'customExercises'] as const;
type SyncTable = (typeof SYNC_TABLES)[number];

type SyncRecord = { id: string; updatedAt: string; deletedAt?: string | null; [key: string]: unknown };
type Change = { table: SyncTable; record: SyncRecord };
type CursorKey = { table: string; id: string; updatedAt: string }; // the last record a client pulled
type PulledRow = { table: SyncTable; record: SyncRecord; seq: number };
```

### `SyncStore`

Where a server keeps synced records. `/sqlite` implements it for one person; a multi-user server can implement it per account. Every method may return a value or a promise (`MaybePromise<T>` below).

| Member | Signature | Contract |
|---|---|---|
| `epoch` | `readonly string` | A random id for this database. A new value tells every device to pull and push everything. |
| `rotateEpoch` | `() => MaybePromise<string>` | Start a new epoch and return it. |
| `hasSeen` | `(key: CursorKey) => MaybePromise<boolean>` | False when the store no longer has the version of the record a client last pulled (it went back in time, e.g. restored from an older backup). True when it has that record at the same or a newer `updatedAt`. |
| `applyChanges` | `(changes: Change[]) => MaybePromise<Map<string, number>>` | Last write wins: store each change whose record is new or has a strictly newer `updatedAt`; skip the rest. Each stored change gets the next sequence number. Returns `"table/id"` → `seq` for the changes written. |
| `maxSeq` | `() => MaybePromise<number>` | The highest sequence number stored (0 when empty). |
| `pull` | `(cursor: number, limit: number) => MaybePromise<{ rows: PulledRow[]; more: boolean; lastKey?: CursorKey }>` | Records with `seq > cursor`, oldest first, at most `limit`; `more` when others remain; `lastKey` identifies the last row returned. A record rewritten later moves to its new `seq`, so each record appears at most once. |
| `exportAll` | `() => MaybePromise<Record<SyncTable, SyncRecord[]>>` | All non-deleted records grouped by table (every table present). |
| `close` | `() => MaybePromise<void>` | Release resources. |

A minimal in-memory implementation, as a starting point for another backend:

```ts
import { SYNC_TABLES, type PulledRow, type SyncRecord, type SyncStore, type SyncTable } from '@orca-solutions/get-fit-core';

export function memoryStore(): SyncStore {
  const rows = new Map<string, PulledRow>(); // "table/id" -> latest version
  let seq = 0;
  let epoch = crypto.randomUUID();
  const inOrder = () => [...rows.values()].sort((a, b) => a.seq - b.seq);
  return {
    get epoch() {
      return epoch;
    },
    rotateEpoch: () => (epoch = crypto.randomUUID()),
    hasSeen(key) {
      const row = rows.get(`${key.table}/${key.id}`);
      return !!row && Date.parse(row.record.updatedAt) >= Date.parse(key.updatedAt);
    },
    applyChanges(changes) {
      const written = new Map<string, number>();
      for (const { table, record } of changes) {
        const key = `${table}/${record.id}`;
        const stored = rows.get(key);
        if (stored && Date.parse(record.updatedAt) <= Date.parse(stored.record.updatedAt)) continue;
        rows.set(key, { table, record, seq: ++seq });
        written.set(key, seq);
      }
      return written;
    },
    maxSeq: () => seq,
    pull(cursor, limit) {
      const after = inOrder().filter((r) => r.seq > cursor);
      const page = after.slice(0, limit);
      const last = page[page.length - 1];
      return {
        rows: page,
        more: after.length > limit,
        lastKey: last && { table: last.table, id: last.record.id, updatedAt: last.record.updatedAt },
      };
    },
    exportAll() {
      const out = Object.fromEntries(SYNC_TABLES.map((t) => [t, [] as SyncRecord[]])) as Record<SyncTable, SyncRecord[]>;
      for (const r of inOrder()) if (!r.record.deletedAt) out[r.table].push(r.record);
      return out;
    },
    close() {},
  };
}
```

The bundled server (`server/app.ts`) is typed against `SqliteStore`, whose methods are synchronous. A server built on an asynchronous store awaits each call but otherwise follows the same request handling.

## Utilities

### Dates (`dates.ts`)

All take and return `YYYY-MM-DD` strings in local time unless noted.

| Export | Signature |
|---|---|
| `toISODate` | `(d: Date) => string` |
| `parseISODate` | `(s: string) => Date` (local midnight) |
| `addDays` | `(s: string, n: number) => string` |
| `today` | `() => string` |
| `weekday` | `(s: string) => number` (0 = Sunday) |
| `mondayOf` | `(s: string) => string` (the Monday on or before) |
| `daysBetween` | `(a: string, b: string) => number` (`b − a`, rounded) |
| `formatShort` | `(s: string) => string` (`"Mon Oct 12"`) |
| `formatMonthDay` | `(s: string) => string` (`"Oct 12"`) |
| `monthName` | `(month: number) => string` (0-based, `"January"`) |

### Ids (`ids.ts`)

| Export | Signature | Description |
|---|---|---|
| `uuid` | `() => string` | `crypto.randomUUID()` when available, else a v4-style random id. |
| `hash` | `(s: string) => number` | 32-bit FNV-1a; used for stable tie-breaks. |

### Formatting (`format.ts`)

| Export | Signature | Description |
|---|---|---|
| `rangeText` | `(r: { min, max } \| undefined) => string` | `"8–12"`, `"10"`, or `""`. |
| `setTarget` | `(s: PlannedSet) => string` | `"8–12"` or `"30–40 s"`. |
| `prescription` | `(pe: PlannedExercise, ex?: Exercise) => string` | `"3 × 8–12"`, `"2 × 30–40 s/side"`, `"1 × 3–5 + 3 × 5–8"`. |
| `plannedValue` | `(s: PlannedSet \| undefined) => number \| undefined` | Top of the planned range (placeholder value). |
| `WEEKDAYS` | `string[]` | `['Sun', ..., 'Sat']`. |
| `sessionLetter` | `(type: string) => string` | `L` for `legs`, `C` for `core`, `U` otherwise (original program's day types). |

### Kettlebells and muscle groups

| Export | Signature | Description |
|---|---|---|
| `parseKettlebells` | `(v: string) => Profile['kettlebells']` | `"25x2, 35"` → `[{ lb: 25, count: 2 }, { lb: 35, count: 1 }]`, sorted, duplicates summed. Accepts `x`, `×` or `*` and an optional `lb`. |
| `MuscleGroup` | type | `'chest' \| 'back' \| 'shoulders' \| 'arms' \| 'core' \| 'legs'`: the six library filter groups. |
| `MUSCLE_GROUPS` | `readonly MuscleGroup[]` | In display order. |
| `MUSCLE_GROUP_LABELS`, `MUSCLE_LABELS` | `Record<..., string>` | Display names. |
| `muscleGroupOf` | `Record<Muscle, MuscleGroup>` | |
| `musclesInGroup` | `(group: MuscleGroup) => Muscle[]` | |
| `groupsForMuscles` | `(muscles: readonly Muscle[]) => MuscleGroup[]` | In `MUSCLE_GROUPS` order. |

## `/client`

```ts
import { ... } from '@orca-solutions/get-fit-core/client';
```

The device side: an IndexedDB copy of every record (Dexie), the plan horizon, logging, backup and restore, and the sync engine. Requires `dexie`. Functions that touch storage take an optional `GetFitDB` as their last parameter and otherwise use the default database (exceptions: `setFlagIn` takes it first, `setFlag` has none, and the sync functions take it as `SyncOptions.db` or a trailing `db`). Writes save immediately and schedule a background sync.

`/client` also re-exports `CATALOG`, `PROFILE_ID`, `SYNC_TABLES` and `SyncTable`.

### Database

```ts
class GetFitDB extends Dexie {
  constructor(name?: string); // default 'get-fit'
  profile: Table<Profile, string>;
  blocks: Table<Block, string>;
  plannedWorkouts: Table<PlannedWorkout, string>;
  sessions: Table<Session, string>;
  loggedSets: Table<LoggedSet, string>;
  exerciseFlags: Table<ExerciseFlag, string>;
  customExercises: Table<CustomExercise, string>;
  meta: Table<Meta, string>; // local bookkeeping, never synced
}
```

| Export | Signature | Description |
|---|---|---|
| `db` | `GetFitDB` | The default database (a live binding; read it after `setDefaultDb` to get the current one). |
| `setDefaultDb` | `(d: GetFitDB) => void` | Use another database by default, e.g. one per signed-in account: `new GetFitDB('get-fit:<userId>')`. |
| `CustomExercise` | type | `Exercise & SyncFields`. |
| `Meta` | type | `{ key: string; value: unknown }`. |

Indexes (Dexie schema version 1): `blocks` by `startDate`; `plannedWorkouts` by `date` and `blockId`; `sessions` by `plannedWorkoutId` and `date`; `loggedSets` by `sessionId`, `exerciseId`, `[exerciseId+date]` and `date`; every synced table by `updatedAt`.

Keys the client keeps in `meta`:

| Key | Value |
|---|---|
| `syncToken` | Bearer token set with `setSyncToken`. |
| `syncCursor`, `syncCursorKey` | Last pull position (`cursor` and `cursorKey` from the server). |
| `serverEpoch` | The server epoch last seen. |
| `lastPushedAt` | Push watermark: records with a later `updatedAt` are pushed. |
| `joined` | The device has completed its first sync. |
| `lastSyncedAt`, `lastError` | Shown by `getSyncStatus`. |

### Profile, catalog and flags

| Export | Signature | Description |
|---|---|---|
| `setDefaultProfile` | `(make: (t?: string) => Profile) => void` | The profile a device starts with before anything is set up or synced (default `neutralProfile`). Call once at startup. |
| `defaultProfile` | `(t?: string) => Profile` | Calls the configured factory. |
| `getProfile` | `(d?) => Promise<Profile>` | The stored profile, creating the default one if missing. |
| `put` | `<T extends { id; createdAt; updatedAt }>(table: SyncTable, rec: T, d?) => Promise<T>` | Stamp `updatedAt` with the current time, save, and schedule a sync. Use it for every synced write, soft deletes included. |
| `allExercises` | `(d?) => Promise<Exercise[]>` | `CATALOG` plus non-deleted custom exercises. |
| `flagMap` | `(d?) => Promise<ExerciseFlags>` | Non-deleted flags keyed by exercise id, ready for `GeneratorInput.flags`. |
| `setFlag` | `(exerciseId: string, patch: FlagPatch) => Promise<void>` | Merge `favourite`, `avoid`, `unavailable` or `unavailableAt` into the exercise's flag record in the default database. |
| `setFlagIn` | `(d: GetFitDB, exerciseId: string, patch: FlagPatch) => Promise<void>` | The same against a given database. |

### Plan horizon

| Export | Signature | Description |
|---|---|---|
| `ensurePlan` | `(date?: string, d?) => Promise<Block>` | Make sure a block covers `date` (default today) and the next block is planned. Returns the current block. |
| `planAfterSync` | `(sync: Promise<unknown>, date: string, waitMs: number, d?) => Promise<void>` | Run `ensurePlan` once `sync` settles. If `sync` takes longer than `waitMs`, plan early only when no block covers `date`, then plan again after the sync. |
| `regenerateUpcoming` | `(date?: string, d?) => Promise<void>` | Rebuild the rest of the current block from `date` and every later block, e.g. after a profile or flag change. Workouts with logged sets are kept. |
| `liveBlocks` | `(d?) => Promise<Block[]>` | Non-deleted blocks by `startDate`. |
| `blockEnd` | `(b: Block) => string` | Last day of a block. |

`ensurePlan` details:

- The first block starts on the Monday of `date`'s week. A later block starts the day after the previous block ends, or on this week's Monday after a gap.
- If the block covering `date` has no successor, the next block is generated and stored with `plannedAhead: true`. It was built before the current block's logs existed, so on the day it becomes current, its workouts without logged sets are rebuilt once from the latest logs (and `plannedAhead` is cleared) before the following block is planned.
- If the only block found starts after `date` (a clock or timezone change), it is returned and nothing new is planned.
- The generator input is built from the device: profile, `allExercises`, `flagMap`, `known` (every exercise with a logged set), `stalled` (known exercises for which `isStalled` holds) and `recoveryOk` (false when any session since the previous block's start is marked `beatUp`).

A rebuild (`plannedAhead` or `regenerateUpcoming`) updates the block's `baseSlots`, `rationale` and `generatorVersion`, and replaces each existing, unlogged workout on or after the start date with the newly generated workout of the same date and session type, keeping its id and `createdAt`. Workouts with logged sets, and dates before `date`, are not touched.

`planAfterSync` exists for app start: planning before the first pull lands could regenerate a block another device has already rebuilt from its logs, and the newer timestamp would replace that block everywhere.

### Sessions and logging

| Export | Signature | Description |
|---|---|---|
| `sessionIdFor` | `(plannedWorkoutId: string) => string` | `s-<plannedWorkoutId>`. |
| `startSession` | `(plannedWorkoutId: string, date?: string, d?) => Promise<Session>` | Return the existing live session for the workout, or create one with id `sessionIdFor(plannedWorkoutId)`. |
| `sessionFor` | `(plannedWorkoutId: string, d?) => Promise<Session \| undefined>` | The live session of a planned workout. |
| `updateSession` | `(id: string, patch: Partial<Session>, d?) => Promise<void>` | Apply `patch`, stamping `fieldAt` for every changed field (`changedFields`). No-op when the session doesn't exist. |
| `logSet` | `(session: Pick<Session, 'id' \| 'date'>, exerciseId: string, plannedExerciseId: string \| null, setIndex: number, values: SetInput, d?) => Promise<LoggedSet>` | Create or update one set. |
| `unlogSet` | `(id: string, d?) => Promise<void>` | Soft-delete a logged set. |
| `historyFor` | `(exerciseId: string, d?) => Promise<LoggedSet[]>` | Non-deleted sets of a movement. |
| `workoutsWithLogs` | `(d?) => Promise<Set<string>>` | Planned workout ids with at least one logged set. |
| `SetInput` | type | `Pick<LoggedSet, 'weight' \| 'reps' \| 'seconds' \| 'bandId' \| 'stanceSteps'> & { effort? }`. |

`logSet` behaviour:

- A set of a planned slot gets the id `<sessionId>|<plannedExerciseId>|<exerciseId>|<setIndex>`, so the same set logged on two devices before they sync is one record. A set with `plannedExerciseId: null` gets a random id.
- If a live set with the same exercise, slot and index exists, `values` are merged into it, so a partial update (e.g. only `effort`) keeps the other fields.
- The first set logged in a session moves the session's `date` (and the set's `date`) to today and resets `startedAt`, so a workout opened early but done later counts on the day it was done.

### Derived state

| Export | Signature | Description |
|---|---|---|
| `DayState` | type | `'planned' \| 'done' \| 'partial' \| 'missed' \| 'done-late' \| 'today' \| 'not-tracked'`. |
| `workoutState` | `(w: PlannedWorkout, session: Session \| undefined, loggedCount: number, plannedCount: number, date: string, trackedFrom: string) => DayState` | With logged sets: `done` once every planned set is logged or the session has ended, else `partial`; `done-late` instead of `done` when the session's date is after the workout's window, or differs from the date of a single-day workout. Without: `missed` (or `not-tracked` before `trackedFrom`) after its day or window, `today` within it, `planned` before. |
| `plannedSetCount` | `(w: PlannedWorkout, session?: Session) => number` | Planned sets, excluding skipped slots. |
| `daysSince` | `(dateStr: string, ref?: string) => number` | `daysBetween(dateStr, ref)`; `ref` defaults to today. |

### Backup and restore

| Export | Signature | Description |
|---|---|---|
| `exportAll` | `(d?) => Promise<{ app: string; version: number; exportedAt: string; tables: Record<string, unknown[]> }>` | Every row of the seven synced tables, soft-deleted rows included, as `{ app: 'get-fit', version: 1, exportedAt, tables }`. `meta` (and so the sync token) is not exported. |
| `exportSetsCsv` | `(d?) => Promise<string>` | Every non-deleted logged set as CSV, oldest first. Columns: `date, exercise, set, weight_lb, reps, seconds, band, stance_steps, effort, logged_at`. `set` is 1-based; exercise and band ids are replaced by names. |
| `importAll` | `(data: { app?: string; tables: Record<string, unknown> }, d?) => Promise<{ imported: number; skipped: number }>` | Restore a backup in one transaction. |

`importAll` semantics:

- Throws `Error('Not a get-fit backup.')` when `tables` is missing, `app` is present and not `'get-fit'`, or a table's value is not an array. Tables absent from the file are left alone; unknown tables are ignored. The sync server's `/api/export` output (which has no `app` field) is accepted.
- Rows that fail `validRow` are skipped and counted in `skipped`.
- Normally rows merge by id: a row is written only when it is new or its `updatedAt` is strictly newer than the local copy. Nothing local is removed, so logged sets on the device are kept.
- When the device has no live logged sets and isn't connected to sync (`isSyncConnected` is false), the backup's plan replaces the device's own: `profile`, `blocks` and `plannedWorkouts` rows from the file are written with `updatedAt` set to now, so they win everywhere, and the device's own blocks and workouts not in the file are soft-deleted (so the deletion syncs too).
- Clears `lastPushedAt`, so the next sync pushes every record; then calls `getProfile`, `ensurePlan(today())` and schedules a sync.

### Sync engine

The engine pushes every local record whose `updatedAt` is past the push watermark and pulls everything the server stored since the device's cursor, using the protocol in [sync-server.md](sync-server.md). It never throws into the UI: failures resolve as `{ ok: false, error }`.

| Export | Signature | Description |
|---|---|---|
| `configureSync` | `(opts: SyncOptions) => void` | Options every sync uses unless a call overrides them, including the background syncs that writes schedule. Replaces earlier defaults. |
| `syncNow` | `(callOpts?: SyncOptions) => Promise<SyncResult>` | Run one sync, or join the one already running for the same database. `callOpts` are merged over the configured defaults. |
| `scheduleSync` | `(opts?: SyncOptions) => void` | Debounced sync (2 s after the last call), waiting for a running sync to finish first. Called by every write. |
| `startAutoSync` | `(opts?: SyncOptions) => void` | Browser only. Syncs on the window's `online` and `focus` events, on `visibilitychange` to visible, and every 60 s while the document is visible. The listeners and interval are not removable. |
| `setSyncToken` | `(token: string \| null, db?) => Promise<void>` | Store the bearer token (trimmed), or clear it with `null` or a blank string. |
| `getSyncStatus` | `(db?) => Promise<SyncStatus>` | |
| `isSyncConnected` | `(db?) => Promise<boolean>` | True when the device syncs with a server: it has a stored token, the configured `headers` return a value (cookie or account sign-in), or it has synced before. |

`SyncOptions`:

| Field | Type | Description |
|---|---|---|
| `db` | `GetFitDB` | Database to sync; default the default database. |
| `baseUrl` | `string` | Prefix for `/api/sync`; default `''` (same origin). |
| `headers` | `() => HeadersInit \| undefined \| Promise<HeadersInit \| undefined>` | Request headers for the server. When given, they replace the stored sync token (e.g. a server that signs in with cookies). Returning `undefined` skips the sync as `no-token`. |
| `credentials` | `RequestCredentials` | Passed to `fetch` (e.g. `'include'` for cookies on another origin). |
| `onUnauthorized` | `() => void` | Called when the server answers 401. |
| `fetch` | `typeof fetch` | Custom fetch implementation (tests, other runtimes). |

`SyncResult`:

```ts
type SyncResult =
  | { ok: true; pushed: number; pulled: number }
  | { ok: false; error: string; skipped?: 'no-token' | 'offline' };
```

`pushed` counts records the server accepted; `pulled` counts records stored locally. `skipped: 'no-token'` means neither `headers` nor a stored token supplied credentials; `skipped: 'offline'` means `navigator.onLine` is `false`. Other failures carry a message: `"The server rejected the sync token."` or `"Not signed in."` on 401 (with and without a stored token), the server's `error` field for other HTTP errors, `"Sync failed (HTTP <status>)."` when there is none, or the network error. Requests time out after 30 s.

`SyncStatus`:

| Field | Type | Description |
|---|---|---|
| `configured` | `boolean` | A sync token is stored. (Not set by `headers`-based auth.) |
| `syncing` | `boolean` | A sync is running for this database. |
| `lastSyncedAt` | `string \| null` | Last successful sync. |
| `lastError` | `string \| null` | Last failure message; cleared by a successful sync. Skipped syncs don't record one. |
| `heldBack` | `number` | Local records that fail `validRow` and so are never uploaded. |

One sync, in order:

1. **First sync (join).** On a device that has never pushed and never joined, pull every page from cursor 0 before pushing anything. Server blocks and planned workouts replace local ones regardless of timestamps. If the server has any block, local blocks and unlogged planned workouts the server doesn't have are deleted locally, so two devices never keep overlapping plans. Sessions and logged sets are kept and pushed in the next step.
2. **Push and pull.** Collect local records (soft-deleted included) with `updatedAt` after the watermark that pass `validRow`, and post them in batches of 500 with the stored cursor, cursor key and epoch. Apply each response's `changes`, store the new cursor, and repeat until nothing is left to push and `more` is false.
3. **Epoch change or reset.** If a response's `epoch` differs from the stored one, store it, discard that response, and start over once from cursor 0 with every local record queued for push. If `reset` is true while the epoch matches (possible only when no epoch was stored), apply the response and queue every local record for push. Either happens at most once per sync.
4. **Watermark.** On success, set `lastPushedAt` to the sync's start time minus 30 s, so a write racing the sync is pushed next time (re-pushing is harmless).

Pulled records are applied with these rules:

- Rows that fail `validRow` or name an unknown table are ignored. A local copy that fails `validRow` always gives way to the server's.
- Otherwise last write wins: a pulled record replaces the local one only when its `updatedAt` is strictly newer.
- A planned workout with logged sets on this device keeps its local copy, so a plan rebuilt elsewhere never reshuffles a workout in progress.
- Sessions merge per field with `mergeSession`; a merged result is stamped just after both copies and pushed back.
- The profile keeps the earliest `createdAt` of the two copies.

### Example

```ts
import { neutralProfile, today } from '@orca-solutions/get-fit-core';
import {
  configureSync, db, ensurePlan, exportAll, GetFitDB, importAll, logSet, planAfterSync,
  setDefaultDb, setDefaultProfile, startAutoSync, startSession, syncNow, unlogSet, updateSession,
} from '@orca-solutions/get-fit-core/client';

// Startup: one database per account, a starting profile, and cookie-based auth against another origin.
setDefaultDb(new GetFitDB('get-fit:account-42'));
setDefaultProfile(neutralProfile);
configureSync({
  baseUrl: 'https://sync.example.com',
  credentials: 'include',
  headers: () => ({}), // send cookies only; return undefined while signed out
  onUnauthorized: () => location.assign('/sign-in'),
});
await planAfterSync(syncNow(), today(), 3000);
startAutoSync();

// Log a workout.
const block = await ensurePlan();
const [workout] = await db.plannedWorkouts.where('blockId').equals(block.id).sortBy('date');
const session = await startSession(workout.id, workout.date);
const first = workout.exercises[0];
const set = await logSet(session, first.exerciseId, first.id, 0, { weight: 95, reps: 8, effort: 'right' });
await updateSession(session.id, { notes: 'Felt strong', swaps: { [workout.exercises[1].id]: 'goblet-squat' } });
await unlogSet(set.id);

// Back up and restore.
const backup = JSON.stringify(await exportAll());
const { imported, skipped } = await importAll(JSON.parse(backup));
console.log(imported, skipped);
```

With the bundled single-user server, store its token instead of passing `headers`:

```ts
import { setSyncToken, syncNow } from '@orca-solutions/get-fit-core/client';

await setSyncToken('the-SYNC_TOKEN-value');
const result = await syncNow();
if (!result.ok) console.warn(result.error);
```

## `/sqlite`

```ts
import { openSqliteStore } from '@orca-solutions/get-fit-core/sqlite';
```

A `SyncStore` on SQLite for a single-user server. Requires `better-sqlite3` and Node. It also re-exports every protocol type and `TABLES` (the same array as `SYNC_TABLES`).

| Export | Signature | Description |
|---|---|---|
| `openSqliteStore` | `(file: string) => SqliteStore` | Open or create the database at `file` (`':memory:'` for tests). There are no other options. |
| `SqliteStore` | interface | `SyncStore` with synchronous return types, plus `resetEpochOnce`. |
| `TABLES` | `readonly SyncTable[]` | |

`SqliteStore` methods behave as described for [`SyncStore`](#syncstore), synchronously:

| Method | Notes |
|---|---|
| `epoch` | Generated (random UUID) the first time the file is opened and stored in the `meta` table. |
| `rotateEpoch()` | Stores and returns a new random UUID. |
| `hasSeen(key)` | Compares against the stored `updated_at`, normalised to ISO UTC. |
| `applyChanges(changes)` | Runs in one transaction. `updatedAt` is normalised with `new Date(...).toISOString()` before comparing; an equal or older version is skipped. The record is stored as JSON exactly as sent. |
| `maxSeq()` | `MAX(seq)`, or 0. |
| `pull(cursor, limit)` | `lastKey.updatedAt` is the normalised timestamp. |
| `exportAll()` | Non-deleted records, ordered by table and id. |
| `close()` | Closes the database handle. |
| `resetEpochOnce(marker: string \| undefined): boolean` | Rotate the epoch once per new `marker` value. Returns `false` for `undefined`/empty or a marker already applied; otherwise rotates, remembers the marker, and returns `true`. The server passes the `SYNC_EPOCH_RESET` environment variable, so changing it after a restore makes every device re-sync fully. |

Storage: the database runs in WAL mode with two tables, `records (tbl, id, updated_at, deleted_at, data, seq)` keyed by `(tbl, id)` with a unique index on `seq`, and `meta (key, value)` holding `epoch` and `epochResetMarker`. Records are never hard-deleted.

```ts
import { openSqliteStore } from '@orca-solutions/get-fit-core/sqlite';

const store = openSqliteStore('./data/get-fit.sqlite');
store.resetEpochOnce(process.env.SYNC_EPOCH_RESET?.trim() || undefined);

const at = new Date().toISOString();
const written = store.applyChanges([
  { table: 'exerciseFlags', record: { id: 'leg-press', createdAt: at, updatedAt: at, deletedAt: null, favourite: true } },
]);
const { rows, more, lastKey } = store.pull(0, 2000);
console.log(written.get('exerciseFlags/leg-press'), rows.length, more, lastKey, store.epoch);
store.close();
```
