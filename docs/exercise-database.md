# get-fit: Exercise catalog

Where the exercise catalog comes from, the schema each movement follows, what's in it, and how it's built. The catalog is generated into [`packages/core/src/data/exercises.json`](../packages/core/src/data/exercises.json) from the hand-written [`packages/core/scripts/curation.ts`](../packages/core/scripts/curation.ts). Code comments cite this document by section number (§4 schema, §6 catalog), so keep the numbering stable.

---

## 1. Summary

get-fit ships **its own curated catalog of 220 movements**. 139 are seeded from **free-exercise-db** (876 entries, one static JSON file plus photos) and use its start and end photos (see §8 for their license status); 81 that it lacks (Bulgarian split squat, sumo squats, decline presses, bird dog, suitcase carry, Pendlay row, the home pack, band movements and others) are written for this project and have no photos. Every movement's instructions are written for this project; none are copied from free-exercise-db. Every entry carries a hand-written tag layer that no source provides: movement pattern, angle, grip, laterality, the generator slots it can fill, a sensible rep range, fatigue cost and running impact. Everything is vendored into the repo as static data: no live API, nothing that can break at the gym. wger was consulted only as a checklist of commonly done movements and is never copied, so the data carries no share-alike terms.

---

## 2. Sources compared

All counts below come from downloading the data on 2026-10-07, except where noted.

| Source | Size | What's tagged | License | Static? | Verdict |
|---|---|---|---|---|---|
| **[free-exercise-db](https://github.com/yuhonas/free-exercise-db)** (fork of [wrkout/exercises.json](https://github.com/wrkout/exercises.json)) | 876 (584 strength, 123 stretching, 61 plyo, 108 other) | primary + secondary muscles (17 names), equipment, compound/isolation, push/pull/static, level, step-by-step instructions, 2 photos each (~45 KB) | **Unlicense** for the data; the photos and instruction text have no known license (§8) | One JSON file + JPGs | **Used as the seed.** |
| **[wger](https://github.com/wger-project/wger)** | 872 | muscles (16 anatomical, front/back), equipment, 8 body-region categories, variation groups | Code **AGPL-3.0**. Exercise data per entry: 719 CC-BY-SA 4.0, 133 CC-BY-SA 3.0, 20 CC0 | JSON fixtures in the repo; also a REST API | **Reference only.** Share-alike would spread to the data file. |
| [exercemus/exercises](https://github.com/exercemus/exercises) | 872 | muscles, muscle groups, equipment, category | Labelled MIT, but merged from wger (CC-BY-SA) and exercises.json | One JSON file | **Avoided.** The MIT label can't override wger's share-alike terms. |
| [ExerciseDB / AscendAPI](https://exercisedb.dev/) | 1,500 free (v1), 11,000+ paid | body part, target, equipment, GIFs | Commercial API; the open-source server is AGPL; GIFs © Gym visual; caching and redistribution terms not published | Live API | **Avoided.** A live API is a failure mode at the gym, and the media isn't redistributable. |
| [hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset) (ExerciseDB-style data) | 1,324 | body part, target, equipment, muscle group (no difficulty or compound/isolation) | Text MIT; GIFs © Gym visual and explicitly **not** licensed | One JSON file | **Avoided.** Thin tags, and the media can't be used. |
| [RepDB free tier](https://github.com/sergei-argutin/exercise-dataset) | 609 | difficulty, compound/isolation, unilateral flag, bodyweight flag, goals, MET, illustrations | Free with attribution, but **no redistribution as a dataset** | One JSON file + WebP | **Avoided.** Committing it to a public repo is redistribution. |
| Paid APIs (API Ninjas, MuscleWiki, etc.) | n/a | n/a | Paid, live | No | Not evaluated; ruled out by the no-live-API principle. |

wger numbers come from the fixture files in its GitHub repo (`exercise-base-data.json`, `translations.json`), because wger.de itself was unreachable at the time.

### What the data looks like

**free-exercise-db** is clean and consistent, but shows its age:
- It covers the classic gym staples well: goblet squat, leg press, RDL, hip thrust, every bench, press, row and pulldown variant, face pull, Pallof press, dead bug, farmer's walk.
- **Missing modern staples:** Bulgarian split squat, Copenhagen plank, suitcase carry, bird dog, hollow hold, machine-assisted pull-up.
- **"shoulders" is one muscle.** Front, side and rear delts aren't separated, which matters a lot for variety (presses hit front delts, lateral raises side, face pulls rear).
- **Difficulty labels are unreliable:** barbell deadlift is "intermediate" while barbell squat and pull-ups are "beginner"; face pull is "intermediate"; hanging leg raise is "expert". get-fit re-rates everything.
- 87 entries have no compound/isolation tag and 77 no equipment.

**wger** has better modern coverage (it has every movement in the missing list above) but is messier: 185 of 872 have no muscles, 303 have no equipment, 110 have English descriptions under 50 characters, 23 names are duplicated, and naming is inconsistent ("Bulgarian split squats left" and "...right" as separate exercises, Italian names in the English field). Its **variation group** idea, linking variants of the same lift, is what `family` copies; its data isn't used.

---

## 3. Why curate instead of importing everything

1. **The generator needs tags no source has.** Movement pattern, angle, grip, laterality, a sensible rep range, fatigue cost and running impact are the levers the training rules pull ([periodization.md §4](periodization.md#4-the-generator-as-rules)). Every source would need these added by hand anyway.
2. **Fewer, better movements make a better plan.** 876 entries include Car Deadlift, Rickshaw Carry and 69 curls. The generator picks from a set where every entry is something doable at the target gym or at home and has been checked. A beginner rotating through ~150 well-chosen movements gets plenty of variety.
3. **Data quality is the project's to own.** Logged sets reference exercise ids forever, so ids, names and tags should be deliberate, not inherited from a scrape.

The catalog can grow: adding a movement is one entry in `curation.ts`, and the data model also supports custom movements per user.

---

## 4. Schema

The `Exercise` type in [`packages/core/src/types.ts`](../packages/core/src/types.ts). Field names are camelCase; enums are kebab-case strings.

```ts
type Exercise = {
  id: string;                 // stable kebab slug, e.g. "dumbbell-romanian-deadlift". Never changes.
  name: string;
  aliases: string[];          // "DB RDL", "Stiff-leg deadlift": powers search
  family: string;             // variation group: all Smith bench presses share a family

  // What it trains
  movementPattern: MovementPattern;
  primaryMuscles: Muscle[];
  secondaryMuscles: Muscle[];
  mechanic: 'compound' | 'isolation';

  // Variety axes (what the generator rotates)
  angle?: 'flat' | 'incline' | 'decline' | 'overhead' | 'low' | 'high';
  grip?: 'pronated' | 'supinated' | 'neutral' | 'mixed';
  laterality: 'bilateral' | 'unilateral' | 'alternating';
  stance?: 'standing' | 'seated' | 'lying' | 'split' | 'single-leg' | 'kneeling' | 'hanging' | 'prone' | 'supine';
  lengthBias?: 'lengthened' | 'mid' | 'shortened';  // where the move is hardest (incline curl = lengthened)
  stability: 'machine' | 'supported' | 'free';      // machine or cable, bench-supported free weight, fully free

  // Equipment and logging
  equipment: Equipment[];     // everything needed, e.g. ["dumbbell", "bench"]
  metric: 'reps' | 'time';
  loadType: 'smith' | 'barbell' | 'ez-bar' | 'dumbbell' | 'kettlebell' | 'machine' | 'cable' | 'bodyweight' | 'assisted' | 'band' | 'plate';
  weightConvention: 'total' | 'per-hand' | 'added' | 'assist' | 'band' | 'none';
  loadIncrementLb?: number;   // smallest sensible jump: 5 for the Smith machine and most dumbbells, a stack step for machines

  // Programming hints for the generator
  repRange: { min: number; max: number };   // sane bounds; seconds when metric = 'time'
  perSide: boolean;           // reps or seconds are per side
  fatigueCost: 1 | 2 | 3;     // systemic cost: 3 = heavy squat or deadlift, 1 = curls, calf raises
  axialLoad: boolean;         // loads the spine (squat, deadlift, standing press, farmer's carry)
  runImpact: 'none' | 'low' | 'high';   // leg soreness risk for a next-day run
  level: 'beginner' | 'intermediate' | 'advanced';   // this project's rating, not the source's
  difficultyRank: number;     // rank inside its family for core and bodyweight ladders (1 = easiest)
  starter: boolean;           // preferred in block 1
  regressions: string[];      // easier ids (push-up → incline push-up)
  progressions: string[];     // harder ids (dead bug → kettlebell dead bug)
  slots: SlotKey[];           // the generator slots it can fill, e.g. "legs:hinge", "core:anti-rotation"
  coreDynamic?: CoreDynamic;  // for core movements: one of the 8 dynamics
  gripType?: GripType;        // for grip finishers: support, crush, pinch, wrist flexion or extension, rotation, reverse curl
  tags: string[];             // free-form: "runner-support", "grip", …

  // Content
  cues: string[];             // 2–4 short form cues for the logging screen
  instructions: string[];     // step-by-step text, always the project's own
  images: string[];           // relative paths, vendored
  source: { name: 'free-exercise-db' | 'get-fit'; sourceId?: string };  // where the photos come from
  license: 'FSL-1.1-MIT';     // the entry's text and tags
  imageLicense?: 'unverified';  // set on entries with free-exercise-db photos (§8)
};
```

The muscle, equipment and movement-pattern enums are in `types.ts`. A separate lookup (`data/muscleGroups.ts`) maps muscles to the six library groups (chest, back, shoulders, arms, legs, core), so the library filters by "Shoulders" while the generator still counts side delts separately.

**Weight conventions** tell the logger what "40 lb" means and the progression math how to compare loads:

| Convention | Logged as | Example |
|---|---|---|
| `total` | the whole load, bar included for a barbell or EZ bar | machine, cable, barbell bench press |
| `per-hand` | one dumbbell or kettlebell | dumbbell curl |
| `added` | plates on top of the bar or body (the Smith bar weight from Settings is added back) | Smith squat, weighted push-up |
| `assist` | the assistance; effective load is bodyweight minus assistance | assisted pull-up |
| `band` | which band, plus steps from the anchor | band Pallof press |
| `none` | no load | plank |

**Slots.** Each movement lists the generator slots it may fill, such as `chest:flat-press`, `legs:v:hip-extension` (a variety pool), `back:deadlift` (a swap slot that takes a base slot's place on some weeks), `core:anti-rotation` or `grip:pinch`. The program's day templates name slots, and `validateProgram` checks that every slot a program uses has at least one movement tagged for it.

**Home vs gym.** Rather than hand-tagging movements by place, the profile keeps an equipment list per location, and each planned day has a location (the weekend core day is at home). A movement is offered for a day only when all of its `equipment` is available there. Adding a pull-up bar or another kettlebell at home unlocks movements automatically, and Swap only suggests what can be done where the user is.

**Bands.** Band movements are separate entries (`loadType: band`, `weightConvention: band`), so their history never mixes with cable numbers. The logger records which band was used, from the user's own list ordered lightest to heaviest, plus stance and reps.

### Example entry

```json
{
  "id": "dumbbell-romanian-deadlift",
  "name": "Dumbbell Romanian Deadlift",
  "aliases": ["DB RDL", "Stiff-leg deadlift"],
  "family": "romanian-deadlift",
  "movementPattern": "hinge",
  "primaryMuscles": ["hamstrings", "glutes"],
  "secondaryMuscles": ["lower-back", "forearms"],
  "mechanic": "compound",
  "grip": "neutral",
  "laterality": "bilateral",
  "stance": "standing",
  "lengthBias": "lengthened",
  "stability": "free",
  "equipment": ["dumbbell"],
  "metric": "reps",
  "loadType": "dumbbell",
  "weightConvention": "per-hand",
  "loadIncrementLb": 5,
  "repRange": {"min": 6, "max": 15},
  "perSide": false,
  "fatigueCost": 2,
  "axialLoad": true,
  "runImpact": "high",
  "level": "beginner",
  "difficultyRank": 1,
  "starter": true,
  "regressions": ["back-extension"],
  "progressions": ["smith-romanian-deadlift", "single-leg-dumbbell-romanian-deadlift"],
  "slots": ["legs:hinge"],
  "tags": ["runner-support"],
  "cues": ["Push hips back, soft knees", "Dumbbells slide down the thighs", "Stop when hamstrings are tight, not when the back rounds"],
  "instructions": ["Stand tall holding a dumbbell in each hand in front of your thighs, feet hip width, knees softly bent.", "…"],
  "images": ["exercises/dumbbell-romanian-deadlift/0.jpg", "exercises/dumbbell-romanian-deadlift/1.jpg"],
  "source": {"name": "free-exercise-db", "sourceId": "Stiff-Legged_Dumbbell_Deadlift"},
  "license": "FSL-1.1-MIT",
  "imageLicense": "unverified"
}
```

This entry is from the generated `exercises.json` (instructions shortened). It maps to free-exercise-db's "Stiff-Legged Dumbbell Deadlift", which supplies its photos; the instructions are the project's own.

---

## 5. How the training rules use these tags

[periodization.md](periodization.md) owns the rules; this is what the schema makes possible.

- **Fill slots, not names.** A day asks for one flat press, one incline press, a fly and so on, and the generator picks a movement tagged for each slot. Every day stays balanced however much the specifics vary.
- **Rotate within a family or pattern.** Block to block, change `angle` (flat → incline press), `grip` (pronated → neutral row), `laterality` (two arms → one), `stance` (squat → split squat) or `loadType` (Smith → cable). Same muscles, different stimulus.
- **Respect each movement's `repRange`.** A low-rep day never prescribes 4-rep lateral raises, and a high-rep day never prescribes 20-rep deadlifts.
- **Budget fatigue.** Avoid stacking two `fatigueCost: 3` lifts in one session, and penalise `runImpact: high` movements for a lifter who runs daily.
- **Count volume per muscle** from `primaryMuscles` (1 set) and `secondaryMuscles` (0.5) to keep weekly sets per muscle in range. Squat and lunge compounds list glutes as secondary, never primary (the build enforces it), so they count half toward glutes/hamstrings; hinges and hip extensions list glutes as primary. Lower back is primary on direct work (back extensions, good mornings, deadlifts, bird dogs, supermen) and secondary on Romanian deadlifts and swings.
- **Swap** = same slot first, then same `movementPattern` and overlapping `primaryMuscles`, with the `equipment` available at that location.
- **Core ladders:** `difficultyRank` and `progressions` give the next-harder variant for heavy core weeks.

---

## 6. The catalog

220 movements: 188 beginner, 31 intermediate, 1 advanced (the generator picks only beginner and intermediate). ★ = starter, preferred in block 1. + = written for this project (no free-exercise-db entry, so no photos). Everything else maps to a free-exercise-db entry and has its start and end photos.

The catalog's base targets a **Planet Fitness-style gym**: no free barbells, racks, EZ bars, trap bar or landmine, so the starter squat, bench and overhead press are **Smith machine** versions, and the Friday deadlift moves to the Smith machine once the dumbbell deadlift is outgrown. It has assisted pull-up and dip machines, a hack squat, hip abduction and adduction, and the usual machines. For a gym with free bars, an optional **barbell pack** (listed after the main tables) adds 28 movements. They need the `barbell`, `ez-bar` or `rack` equipment, so the generator plans them only at a location whose equipment lists that gear, and the lifts that start from a rack (marked in the table) only when a rack is listed too. Trap bar and landmine movements are still left out. Planet Fitness dumbbells usually top out around 60–75 lb (inferred, not checked), which caps dumbbell progressions; past that, a movement moves to its Smith or machine sibling.

**Legs**

| Pattern | Movements |
|---|---|
| Squat | Smith Machine Squat ★, Smith Machine Front Squat, Dumbbell Goblet Squat, Leg Press ★, Hack Squat Machine |
| Lunge / single-leg | Bodyweight Split Squat +, Dumbbell Split Squat ★, Smith Machine Split Squat +, Dumbbell Bulgarian Split Squat +, Dumbbell Reverse Lunge ★, Dumbbell Walking Lunge, Dumbbell Lateral Lunge +, Dumbbell Step-Up |
| Sumo squat (leg day slot 3 in even blocks) | Dumbbell Sumo Squat +, Smith Machine Sumo Squat + |
| Hinge | Smith Machine Romanian Deadlift, Dumbbell Romanian Deadlift ★, Single-Leg Dumbbell Romanian Deadlift, Smith Machine Good Morning, Cable Pull-Through, Kettlebell Swing, Band Pull-Through + |
| Deadlift (Friday, in place of the second row on some weeks) | Dumbbell Deadlift +, Smith Machine Deadlift |
| Hip extension | 45° Back Extension, Glute Bridge ★, Single-Leg Glute Bridge, Smith Machine Hip Thrust, Bird Dog ★ +, Superman Hold |
| Knee extension | Leg Extension ★, Single-Leg Extension, Reverse Nordic + |
| Knee flexion | Seated Leg Curl ★, Lying Leg Curl ★, Nordic Curl |
| Calf | Standing Calf Raise Machine ★, Seated Calf Raise ★, Smith Machine Calf Raise, Single-Leg Calf Raise +, Single-Leg Dumbbell Calf Raise |
| Hip adduction | Hip Adduction Machine, Cable Hip Adduction, Copenhagen Plank + |
| Hip abduction | Hip Abduction Machine, Cable Hip Abduction +, Side-Lying Hip Abduction + |

**Upper body**

| Pattern | Movements |
|---|---|
| Push, horizontal | Smith Machine Bench Press ★, Dumbbell Bench Press ★, Machine Chest Press, Smith Machine Close-Grip Bench Press, Incline Dumbbell Press ★, Smith Machine Incline Bench Press, Incline Neutral-Grip Dumbbell Press, Assisted Dip Machine +, Incline Push-Up, Push-Up, Decline Push-Up, Smith Machine Decline Press + (decline bench), Dumbbell Decline Press + (decline bench) |
| Chest fly | Cable Crossover (High to Low) ★, Low-to-High Cable Fly, Pec Deck ★, Dumbbell Fly |
| Push, vertical | Smith Machine Overhead Press ★, Seated Dumbbell Shoulder Press ★, Machine Shoulder Press, Arnold Press, Half-Kneeling Single-Arm Dumbbell Press + |
| Pull, vertical | Wide-Grip Lat Pulldown ★, Close-Grip Lat Pulldown, Underhand Lat Pulldown, Single-Arm Cable Pulldown, Assisted Pull-Up Machine ★ +, Chin-Up, Pull-Up, Straight-Arm Cable Pulldown, Dumbbell Pullover |
| Pull, horizontal | Seated Cable Row ★, One-Arm Dumbbell Row ★, Chest-Supported Dumbbell Row, Smith Machine Bent-Over Row, Seated Row Machine, Inverted Row (Smith Bar) |
| Shrug | Dumbbell Shrug, Smith Machine Behind-the-Back Shrug, Cable Shrug |
| Side delt | Dumbbell Lateral Raise ★, Cable Lateral Raise ★, Incline Side-Lying Lateral Raise |
| Rear delt | Face Pull, Reverse Pec Deck, Bent-Over Dumbbell Rear-Delt Raise |
| Biceps | Dumbbell Curl ★, Cable Curl, Machine Preacher Curl ★, Single-Arm Dumbbell Preacher Curl, Dumbbell Spider Curl, Concentration Curl, Incline Dumbbell Curl ★, Bayesian Cable Curl +, Dumbbell Hammer Curl ★, Cross-Body Hammer Curl, Cable Rope Hammer Curl, Incline Hammer Curl, Reverse-Grip Cable Curl, Reverse Dumbbell Curl, Zottman Curl |
| Triceps | Overhead Cable Triceps Extension ★, Seated Dumbbell Overhead Extension ★, Single-Arm Dumbbell Overhead Extension, Dumbbell Skull Crusher, Rope Triceps Pushdown ★, V-Bar Triceps Pushdown ★, Reverse-Grip Triceps Pushdown, Single-Arm Cable Pushdown +, Dumbbell Triceps Kickback, Seated Triceps Dip Machine, Bench Dip |

**Grip and carries**

| Pattern | Movements |
|---|---|
| Grip | Dumbbell Farmer's Hold +, Dead Hang +, Towel-Grip Dumbbell Hold +, Dumbbell Finger Curl +, Kettlebell Bottoms-Up Hold +, Plate Pinch, Dumbbell Wrist Curl, Cable Wrist Curl, Dumbbell Reverse Wrist Curl, Dumbbell Pronation–Supination + |
| Carry | Farmer's Carry, Kettlebell Suitcase Carry ★ +, Double Kettlebell Front-Rack Carry +, Overhead Kettlebell Carry + |

The grip-heavy curls (hammer, reverse, Zottman) also serve the reverse-curl grip finisher.

**Barbell pack** (planned only where the profile lists `barbell`, `ez-bar` or `rack`; with a barbell and rack, the four ★ starters replace the Smith and dumbbell squat, bench, overhead press and row from block 1; the barbell Romanian deadlift and the deadlifts are planned only when marked Favourite)

| Pattern | Movements |
|---|---|
| Squat | Barbell Back Squat ★, Barbell Front Squat (rack) |
| Lunge / single-leg | Barbell Walking Lunge, Barbell Step-Up (rack) |
| Hinge | Barbell Romanian Deadlift, Barbell Good Morning (rack) |
| Deadlift | Barbell Deadlift, Sumo Deadlift |
| Hip extension | Barbell Hip Thrust, Barbell Glute Bridge |
| Calf | Barbell Calf Raise (rack) |
| Push, horizontal | Barbell Bench Press ★, Incline Barbell Bench Press, Close-Grip Barbell Bench Press, Decline Barbell Bench Press (rack and decline bench) |
| Push, vertical | Barbell Overhead Press ★ (rack) |
| Pull, horizontal | Barbell Bent-Over Row ★, Reverse-Grip Barbell Row, Pendlay Row + |
| Shrug | Barbell Shrug |
| Side delt | Barbell Upright Row |
| Rear delt | Barbell Rear Delt Row |
| Biceps | Barbell Curl, Reverse Barbell Curl, EZ-Bar Curl, EZ-Bar Preacher Curl |
| Triceps | EZ-Bar Skull Crusher, Barbell Overhead Triceps Extension |

**Decline bench.** The decline presses list `decline-bench` as equipment, so they are planned only where a location lists one. It is optional gear like the barbell pack's.

Barbell and EZ-bar weights are logged as the total on the bar, bar included (`weightConvention: total`), with 5 lb steps.

**Home pack** (30 movements, all +, tagged `home-pack`: kettlebells, bands with a door anchor and bodyweight, so a kit of only those fills every lifting slot)

| Pattern | Movements |
|---|---|
| Squat | Kettlebell Goblet Squat |
| Sumo squat | Kettlebell Sumo Squat |
| Lunge / single-leg | Kettlebell Reverse Lunge |
| Hinge | Kettlebell Romanian Deadlift |
| Knee extension | Sissy Squat |
| Knee flexion | Band Lying Leg Curl |
| Push, horizontal | Kettlebell Floor Press, Band Incline Press, Band Chest Press |
| Chest fly | Band Chest Fly |
| Push, vertical | Kettlebell Overhead Press, Band Overhead Press |
| Pull, vertical | Band Lat Pulldown, Band Single-Arm Pulldown |
| Pull, horizontal | Kettlebell One-Arm Row, Band Seated Row, Kettlebell Gorilla Row |
| Shrug | Kettlebell Shrug |
| Side delt | Band Lateral Raise, Band Upright Row |
| Rear delt | Band Face Pull, Band Pull-Apart |
| Biceps | Kettlebell Curl, Kettlebell Hammer Curl, Band Curl, Band Hammer Curl, Band Behind-the-Back Curl |
| Triceps | Kettlebell Overhead Triceps Extension, Band Overhead Triceps Extension, Band Triceps Pushdown |

The generator picks a home-pack movement for a slot only when nothing else that fits the slot at that location needs gym equipment (anything beyond bands, kettlebells, an ab wheel, a mat or bodyweight). In a gym the machines, cables, dumbbells and barbells keep their slots, so gym plans don't change; at home the pack fills the gaps.

**Core** (done at home with bands, kettlebells, an ab wheel and bodyweight)

| Dynamic | Movements |
|---|---|
| Anti-extension | Plank ★, Ab Wheel Rollout (Kneeling), Long-Lever Plank +, Body Saw +, Dead Bug ★, Kettlebell Dead Bug +, Hollow Hold + |
| Hip extension | Bird Dog, Superman Hold, Glute Bridge and Kettlebell Swing (listed above) |
| Trunk flexion | Crunch, Kneeling Band Crunch ★ +, Jackknife Sit-Up |
| Anti-rotation | Band Pallof Press ★ +, Half-Kneeling Band Pallof Press +, Plank Shoulder Tap +, Kettlebell Plank Pull-Through + |
| Rotation | Band Woodchop (High to Low) ★ +, Band Lift (Low to High) +, Russian Twist, Kettlebell Russian Twist +, Kettlebell Halo + |
| Anti-lateral flexion | Side Plank ★, Side Plank with Leg Raise +, Kettlebell Suitcase Hold + |
| Hip flexion | Reverse Crunch ★, Flutter Kicks +, Lying Leg Raise + |
| Lateral flexion | Kettlebell Side Bend ★ +, Band Side Bend +, Side Plank Hip Dip +, Kettlebell Windmill |

**Runner-support picks** (tagged `runner-support`): single-leg work, RDLs, back extension, glute bridge, hip abduction, calf raises, Copenhagen plank, side plank, suitcase carry. These build the hip, hamstring and calf resilience that daily running uses.

Stretching, plyometrics, Olympic lifts and strongman are left out. Plyometrics in particular overlaps with a daily run's impact load.

---

## 7. How it's built

1. [`packages/core/scripts/curation.ts`](../packages/core/scripts/curation.ts) lists every movement: its id, name and tags, plus a `sourceId` pointing at the free-exercise-db entry whose photos it uses. Instructions for entries with photos are in [`instructions.ts`](../packages/core/scripts/instructions.ts); entries written for this project keep theirs in `curation.ts`.
2. `npm run build:exercises` runs [`build-exercises.ts`](../packages/core/scripts/build-exercises.ts), which downloads free-exercise-db at a **pinned commit** (so the seed never changes underneath the catalog; downloads are cached in `.cache/`), joins it with the curation file and validates every entry: enum values, unique kebab-case ids, regressions and progressions that point at real ids, 2–4 cues, rep ranges in sensible bounds, slots usable with the equipment at their location, one core slot per core dynamic, one grip slot per grip type, squat and lunge compounds listing glutes as secondary, `license` and `imageLicense` set to match the source, and own instructions for every entry. It never reads free-exercise-db's instruction text, and the build fails if any step matches one of its sentences.
3. It writes `packages/core/src/data/exercises.json` and copies the photos for the sourced entries (two per movement, about 8 MB in all) into `apps/web/public/exercises/<id>/`, so they work offline.
4. `packages/core/tests/exercises.test.ts` runs the same validation against the committed JSON in CI.

Ids are permanent: rename a movement's `name`, never its `id`, because logged sets reference ids forever.

---

## 8. Licensing notes

- **The catalog's own work** (every entry's tags, cues and instructions, the curated selection, and the 81 entries written here) is under the project license, FSL-1.1-MIT.
- **free-exercise-db's photos and instruction text have no known license.** The catalog uses only the photos; the instruction text is not used. free-exercise-db applies the Unlicense to its repository, but it is a restructured copy of [wrkout/exercises.json](https://github.com/wrkout/exercises.json), whose [CONTRIBUTING.md](https://github.com/wrkout/exercises.json/blob/master/CONTRIBUTING.md) says the images were scraped from the internet, that its author does not own their copyright, and advises against using them in commercial projects. The Unlicense can only cover what its author owns, which is the data structure, not the photos. The instruction text appears to come from a commercial fitness site: one entry checked matches that site's page word for word, and the rest are inferred to share its origin. Questions about the images' license and source are open upstream ([#305](https://github.com/wrkout/exercises.json/issues/305), [#308](https://github.com/wrkout/exercises.json/issues/308)).
- The per-entry `license` field is `FSL-1.1-MIT` for every entry and covers its text and tags. Entries with free-exercise-db photos also carry `imageLicense: 'unverified'`, so an app can decide where showing them is acceptable.
- To reuse the catalog without this question, keep everything except `images` and leave out the photos in `apps/web/public/exercises/`.
- **wger** is never copied, only consulted for which movements are common. Exercise names aren't copyrightable, so writing entries for movements wger also lists is fine.
- **Nothing in the app calls an exercise API at runtime.**

---

## 9. Choices made

1. **Catalog size:** about 160 curated movements, seeded from free-exercise-db, limited to what fits the target gym and home kit, plus the 28-movement barbell pack and the 30-movement home pack.
2. **Photos:** bundled, with the licensing caveat in §8. free-exercise-db has two photos per movement (start and end), and the app shows them as a simple looping demo. Video is out of scope.
3. **Gym:** a Planet Fitness-style gym: Smith machine for squat, deadlift, bench and overhead press; assisted pull-up and dip, hack squat, hip adduction and abduction, and most typical machines. Free barbells, EZ bars and racks are an optional pack for gyms that have them.
4. **Smith lifts from block 1** (blocks are 4 weeks: 3 loading weeks and a deload; see [periodization.md](periodization.md)).
5. **Home core kit** in the reference profile: resistance bands with a door anchor, two 25 lb kettlebells and one 35 lb, and an ab wheel. The pair of 25s allows two-bell carries and holds; single-bell work progresses 25 → 35, then by reps, time and harder variants. Bands default to light, medium and heavy until the user names their own.
