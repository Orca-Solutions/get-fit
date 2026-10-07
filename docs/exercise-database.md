# get-fit: Exercise database

Milestone 1 (research and plan). Status: **reviewed; jason answered the decisions in §9 on 2026-10-07**. No code yet.
Sibling docs: [SPEC.md](SPEC.md) (the `Exercise` record in §3 and the integration notes in §5 are what this doc fills in) and the periodization doc.

---

## 1. Recommendation in one paragraph

Build **our own curated catalog of about 130 movements**, seeded from **free-exercise-db** (public domain, 876 entries, ships as one static JSON file plus photos). No existing source has the tags the plan generator needs (movement pattern, angle, grip, unilateral, sensible rep range, how much it will hurt tomorrow's run), and the ones it does have are noisy, so we keep free-exercise-db's names, instructions and photos and add a hand-written tag layer on top. Movements it's missing (Bulgarian split squat, Nordic curl, bird dog, suitcase carry and a few more) we write ourselves. Everything is vendored into the repo as static data: no live API, nothing that can break at the gym. wger is used only as a checklist of what's commonly done, never copied, so our data stays MIT/public-domain clean.

---

## 2. Sources compared

All counts below come from downloading the data on 2026-10-07, except where noted.

| Source | Size | What's tagged | License | Static? | Verdict |
|---|---|---|---|---|---|
| **[free-exercise-db](https://github.com/yuhonas/free-exercise-db)** (fork of [wrkout/exercises.json](https://github.com/wrkout/exercises.json)) | 876 (584 strength, 123 stretching, 61 plyo, 108 other) | primary + secondary muscles (17 names), equipment, compound/isolation, push/pull/static, level, step-by-step instructions, 2 photos each (~45 KB) | **Unlicense** (public domain) | One JSON file + JPGs | **Use as the seed.** |
| **[wger](https://github.com/wger-project/wger)** | 872 | muscles (16 anatomical, front/back), equipment, 8 body-region categories, variation groups | Code **AGPL-3.0**. Exercise data per entry: 719 CC-BY-SA 4.0, 133 CC-BY-SA 3.0, 20 CC0 | JSON fixtures in the repo; also a REST API | **Reference only.** Share-alike would spread to our data file. |
| [exercemus/exercises](https://github.com/exercemus/exercises) | 872 | muscles, muscle groups, equipment, category | Labelled MIT, but it's merged from wger (CC-BY-SA) and exercises.json | One JSON file | **Avoid.** The MIT label can't override wger's share-alike terms. |
| [ExerciseDB / AscendAPI](https://exercisedb.dev/) | 1,500 free (v1), 11,000+ paid | body part, target, equipment, GIFs | Commercial API; the open-source server is AGPL; GIFs © Gym visual; caching/redistribution terms not published | Live API | **Avoid.** A live API is the AnatolyFit failure mode, and the media isn't ours to ship. |
| [hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset) (ExerciseDB-style data) | 1,324 | body part, target, equipment, muscle group (no difficulty or compound/isolation) | Text MIT; GIFs © Gym visual and explicitly **not** licensed | One JSON file | **Avoid.** Thin tags; the media is the attraction and we can't use it. |
| [RepDB free tier](https://github.com/sergei-argutin/exercise-dataset) | 609 | best schema of the lot: difficulty, compound/isolation, unilateral flag, bodyweight flag, goals, MET, AI-drawn illustrations | Free with attribution, but **no redistribution as a dataset** | One JSON file + WebP | **Avoid for a public repo.** Committing it to a public repo is redistribution. Usable only if the repo is private. |
| Paid APIs (API Ninjas, MuscleWiki, etc.) | n/a | n/a | Paid, live | No | Not evaluated; ruled out on the no-live-API principle. |

wger numbers come from the fixture files in its GitHub repo (`exercise-base-data.json`, `translations.json`), because wger.de itself was unreachable from this sandbox.

### What the data actually looks like

**free-exercise-db** is clean and consistent, but it shows its age:
- Covers the classic gym staples well: goblet squat, leg press, RDL, trap-bar deadlift, hip thrust, every bench/press/row/pulldown variant, face pull, Pallof press, dead bug, farmer's walk.
- **Missing modern staples:** Bulgarian split squat, Nordic curl, Copenhagen plank, suitcase carry, bird dog, hollow hold, dumbbell RDL, landmine press, machine-assisted pull-up.
- **"shoulders" is one muscle.** Front, side and rear delts aren't separated, which matters a lot for variety (presses hit front delts; lateral raises side; face pulls rear).
- **Difficulty labels are unreliable:** barbell deadlift is "intermediate" while barbell squat and pull-ups are "beginner"; face pull is "intermediate"; hanging leg raise is "expert". We re-rate everything.
- 87 entries have no compound/isolation tag and 77 no equipment.

**wger** has better modern coverage (it has every movement in the missing list above) but is messier: 185 of 872 have no muscles, 303 have no equipment, 110 have English descriptions under 50 characters, 23 names are duplicated, and naming is inconsistent ("Bulgarian split squats left" and "...right" as separate exercises, Italian names in the English field). Its **variation group** idea (linking variants of the same lift) is worth copying; its data isn't.

---

## 3. Why curate instead of importing everything

1. **The generator needs tags no source has.** Movement pattern, angle, grip, laterality, a sensible rep range, fatigue cost and run impact are the levers "strange periodization" pulls (§5). Every source would need these added by hand anyway.
2. **Fewer, better movements make a better plan.** 876 entries include Car Deadlift, Rickshaw Carry and 69 curls. The generator should pick from a set where every entry is something jason can do in his gym and that we've checked. A beginner rotating through ~90 well-chosen movements gets plenty of variety.
3. **Data quality is ours to own.** Logs reference exercise IDs forever (product spec §5), so IDs, names and tags should be deliberate, not inherited from a scrape.

The catalog can grow: "add custom movement" in the app covers one-offs, and adding to the curated file is a one-line change.

---

## 4. Schema

This extends the `Exercise` record in product-spec §3, keeping its field names. **New fields are marked ★.** Field names are camelCase; enums are kebab-case strings.

```ts
type Exercise = {
  id: string;                 // stable kebab slug, e.g. "dumbbell-romanian-deadlift". Never changes.
  name: string;
  aliases: string[];          // "DB RDL", "Stiff-leg deadlift" — powers search
  family: string;             // ★ variation group: all bench presses share "bench-press"

  // What it trains
  movementPattern: MovementPattern;
  primaryMuscles: Muscle[];
  secondaryMuscles: Muscle[];
  mechanic: 'compound' | 'isolation';

  // Variety axes (what the generator rotates)
  angle?: 'flat' | 'incline' | 'decline' | 'overhead' | 'low' | 'high';   // ★ presses, rows, flyes, cable work
  grip?: 'pronated' | 'supinated' | 'neutral' | 'mixed';                  // ★
  laterality: 'bilateral' | 'unilateral' | 'alternating';
  stance?: 'standing' | 'seated' | 'lying' | 'split' | 'single-leg' | 'kneeling' | 'hanging'; // ★
  lengthBias?: 'lengthened' | 'mid' | 'shortened';  // ★ where the move is hardest (incline curl = lengthened)
  stability: 'machine' | 'supported' | 'free';      // ★ machine/cable, bench-supported free weight, fully free

  // Equipment and logging
  equipment: Equipment[];     // everything needed, e.g. ["dumbbell", "bench"]
  metric: 'reps' | 'time' | 'distance';
  loadType: 'barbell' | 'dumbbell' | 'kettlebell' | 'machine' | 'cable' | 'bodyweight' | 'assisted' | 'band';
  weightConvention: 'total' | 'per-hand' | 'per-side' | 'added' | 'band';   // 'band' = log which band, not pounds
  loadIncrementLb?: number;   // ★ smallest sensible jump: 5 for barbell and most DBs, stack step for machines

  // Programming hints for the generator
  repRange: { min: number; max: number };   // ★ sane bounds: deadlift 3–10, lateral raise 10–25; seconds when metric = time
  fatigueCost: 1 | 2 | 3;     // ★ systemic cost: 3 = heavy barbell squat/deadlift, 1 = curls, calf raises
  axialLoad: boolean;         // ★ loads the spine (back squat, deadlift, standing OHP, farmer's walk)
  runImpact: 'none' | 'low' | 'high';   // ★ leg soreness risk for tomorrow's run (high = Bulgarian split squat, walking lunge, heavy RDL, Nordic)
  level: 'beginner' | 'intermediate' | 'advanced';   // our rating, not the source's
  starter: boolean;           // ★ in the recommended set for jason's first block
  regressions: string[];      // ★ easier IDs (push-up → incline push-up)
  progressions: string[];     // ★ harder IDs (goblet squat → front squat)
  contraction: 'isometric' | 'dynamic';   // ★ holds vs moving reps, so a core day can mix both
  tags: string[];             // ★ free-form: "runner-support", "grip", "anti-rotation"

  // Content
  cues: string[];             // ★ 2–4 short form cues for the logging screen
  instructions: string[];
  images: string[];           // relative paths, vendored
  source: { name: 'free-exercise-db' | 'get-fit'; sourceId?: string };
  license: 'Unlicense' | 'MIT';
};

type MovementPattern =
  // compound
  | 'squat' | 'lunge' | 'hinge' | 'hip-extension'
  | 'push-horizontal' | 'push-vertical' | 'pull-horizontal' | 'pull-vertical'
  | 'carry'
  // core
  | 'anti-extension' | 'anti-rotation' | 'anti-lateral-flexion' | 'trunk-flexion' | 'rotation'
  // isolation
  | 'elbow-flexion' | 'elbow-extension' | 'shoulder-raise' | 'rear-delt' | 'chest-fly'
  | 'knee-extension' | 'knee-flexion' | 'hip-abduction' | 'hip-adduction' | 'calf' | 'shrug';

type Muscle =
  | 'chest' | 'front-delts' | 'side-delts' | 'rear-delts'
  | 'lats' | 'upper-back' | 'traps' | 'lower-back'
  | 'biceps' | 'triceps' | 'forearms'
  | 'abs' | 'obliques'
  | 'quads' | 'hamstrings' | 'glutes' | 'glute-med' | 'adductors' | 'calves' | 'hip-flexors';

type Equipment =
  | 'barbell' | 'ez-bar' | 'trap-bar' | 'dumbbell' | 'kettlebell' | 'cable' | 'machine'
  | 'smith-machine' | 'bench' | 'rack' | 'pull-up-bar' | 'dip-bars' | 'landmine'
  | 'band' | 'ab-wheel' | 'back-extension-bench' | 'box' | 'none';
```

A separate lookup maps muscles to the six UI groups (chest, back, shoulders, arms, core, legs), so the library can filter by "Shoulders" while the generator still counts side delts separately.

**Home vs gym.** Rather than hand-tagging movements, the app keeps an equipment list per location (gym: everything; home: resistance bands with a door anchor, kettlebells, an ab wheel, bodyweight and a mat) and each planned day has a location (the weekend core day is home). A movement is offered for a day only when all of its `equipment` is at that day's location. Adding a pull-up bar or another kettlebell at home then unlocks movements automatically, and the Swap button only suggests what you can actually do where you are.

**Bands.** Home "cable" work is done with resistance bands (jason, 2026-10-07). Band movements are separate entries (`loadType: band`, `weightConvention: band`) so their history never mixes with gym cable numbers. The logger records which band was used from jason's own named list (for example by color, lightest to heaviest) plus reps, and progression moves up a band or adds reps.

### Example entry

```json
{
  "id": "dumbbell-romanian-deadlift",
  "name": "Dumbbell Romanian Deadlift",
  "aliases": ["DB RDL"],
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
  "repRange": { "min": 6, "max": 15 },
  "fatigueCost": 2,
  "axialLoad": true,
  "runImpact": "high",
  "level": "beginner",
  "starter": true,
  "regressions": ["back-extension"],
  "progressions": ["barbell-romanian-deadlift", "single-leg-romanian-deadlift"],
  "tags": ["runner-support"],
  "cues": ["Push hips back, soft knees", "Dumbbells slide down the thighs", "Stop when hamstrings are tight, not when the back rounds"],
  "instructions": ["…"],
  "images": [],
  "source": { "name": "get-fit" },
  "license": "MIT"
}
```

---

## 5. How the periodization rules can use these tags

The periodization thread owns the rules; this is what the schema makes possible.

- **Fill slots by pattern, not by name.** A day asks for "one pull-horizontal, one hinge, one shoulder-raise…", and the generator picks a movement for each slot. This keeps every day balanced however much the specifics vary.
- **Rotate variants within a family or pattern.** Week to week, change `angle` (flat → incline press), `grip` (pronated → neutral row), `laterality` (barbell → single-arm), `stance` (squat → split squat) or `loadType` (barbell → cable). Same muscles, different stimulus: this looks like the core of what AnatolyFit's "strange" variation was doing.
- **Vary rep ranges within each movement's `repRange`.** A "low-rep day" never prescribes 4-rep lateral raises, and a "high-rep day" never prescribes 20-rep deadlifts.
- **Match stability to intensity.** Heavy, low-rep, close-to-failure work goes to `machine` and `supported` movements, which are safer for a beginner; `free` and single-leg movements suit moderate loads.
- **Lengthened vs shortened bias** gives a second variety lever for isolation work (incline curl one week, preacher curl the next).
- **Budget fatigue.** Cap total `fatigueCost` per session and avoid stacking `axialLoad` movements.
- **Protect the daily run.** The morning run stays as it is; the plan works around it by placing `runImpact: high` leg work where next-day soreness matters least, or limiting it per week.
- **Count volume per muscle** from `primaryMuscles` (and part-credit `secondaryMuscles`) to keep weekly sets per muscle in range.
- **Swap button** = same `movementPattern` + overlapping `primaryMuscles` + available `equipment`, sorted by family first.
- **Progress a beginner** via `progressions`: once goblet squat stalls at the top of its range, the next block offers front squat.

---

## 6. Draft catalog (about 130 movements)

★ = starter set for jason's first block (dumbbell, cable and machine heavy, with low skill demand and good form feedback). + = not in free-exercise-db; we write it. Everything else maps to an existing free-exercise-db entry.

**Gym is a Planet Fitness** (jason, 2026-10-07): no free barbells, racks, EZ bars, trap bar or landmine, so squats, deadlifts, bench and overhead presses are **Smith machine** versions, and jason already does all three. It has assisted pull-up and dip, hack squat, hip abduction and adduction, and the usual machines. Free-barbell variants stay out of the catalog; if the gym ever changes, they're easy to add. Planet Fitness dumbbells usually top out around 60–75 lb (inferred, not checked for his club), which caps DB progressions; past that, a movement moves to its Smith or machine sibling.

| Pattern | Movements |
|---|---|
| **Squat** | Smith machine squat ★, Goblet squat ★, Leg press ★, Hack squat machine ★, Smith front squat + |
| **Lunge / single-leg** | DB split squat ★, DB reverse lunge ★, DB step-up ★, Smith split squat, Bulgarian split squat +, Walking lunge, Lateral lunge + |
| **Hinge** | Smith deadlift + ★, Smith Romanian deadlift ★, DB Romanian deadlift ★ +, DB deadlift +, Single-leg DB RDL, Kettlebell swing, Smith good morning + |
| **Hip extension** | Back extension (45°) ★, Glute bridge ★, Smith hip thrust +, DB hip thrust +, Single-leg glute bridge |
| **Push, horizontal** | Smith bench press ★, DB bench press ★, Incline DB bench press ★, Machine chest press ★, Push-up ★ (regression: incline push-up), Smith incline bench, Smith close-grip bench, Assisted dip ★ |
| **Push, vertical** | Smith overhead press ★, Seated DB shoulder press ★, Machine shoulder press ★, Half-kneeling single-arm DB press +, Arnold press |
| **Pull, horizontal** | Seated cable row ★, One-arm DB row ★, Chest-supported DB row ★, Smith bent-over row, Row machine, Inverted row (Smith bar) |
| **Pull, vertical** | Lat pulldown (wide / close / underhand) ★, Assisted pull-up machine ★ +, Single-arm cable pulldown, Chin-up, Pull-up |
| **Chest fly** | Cable fly (low / mid / high) ★, Pec deck, DB fly |
| **Shoulder raise / rear delt** | DB lateral raise ★, Cable lateral raise, Face pull ★, Reverse pec deck ★, Bent-over rear-delt raise |
| **Biceps** | DB curl ★, Hammer curl ★, Incline DB curl ★, Cable curl ★, Preacher curl machine ★, DB preacher curl, Straight-bar cable curl, Spider curl, Concentration curl, Cross-body hammer curl, Rope hammer curl, Bayesian (behind-the-body) cable curl +, Reverse-grip cable curl, Zottman curl |
| **Triceps** | Rope pushdown ★, Bar or V-bar pushdown ★, Overhead cable extension ★, Seated two-hand DB overhead extension ★, Reverse-grip pushdown, Single-arm cable pushdown +, Single-arm DB overhead extension, Lying DB extension (DB skull crusher), DB kickback, Cable kickback +, Bench dip, Close-grip push-up, Triceps dip machine |
| **Forearms / grip** | Wrist curl (DB, cable or band), Reverse wrist curl, Finger curl, Wrist roller, Plate pinch, Dead hang + (pull-up bar), Kettlebell bottoms-up hold or carry +, Farmer's and suitcase carries, plus the grip-heavy curls above (hammer, reverse, Zottman). Home options: band wrist curls, kettlebell carries and bottoms-up holds. |
| **Legs, isolation** | Leg extension ★, Seated or lying leg curl ★, Standing calf raise ★, Seated calf raise ★, Hip abduction machine ★, Hip adduction machine, Nordic curl + (advanced) |

Core is done at home, so each core row lists **home options** (bands, kettlebells, bodyweight) first, then gym or extra-kit options.

| Pattern | Home | Gym or extra kit |
|---|---|---|
| **Core: anti-extension** | Plank ★, Dead bug ★ (bodyweight or holding a kettlebell), Hollow hold +, Long-lever plank +, Bear plank hold +, Plank with kettlebell pull-through +, Ab-wheel rollout (kneeling, progressing to standing) | Stability-ball pull-in |
| **Core: flexion** | Kneeling band crunch ★, Reverse crunch ★, Lying leg raise, Jackknife sit-up, Oblique crunch, Flutter kicks, Bicycle crunch | Captain's-chair knee raise, Hanging knee or leg raise (or a doorway pull-up bar at home), Decline crunch, Ab crunch machine |
| **Core: rotation** | Band woodchop, high to low ★, Band lift, low to high ★, Band rotation (standing), Kettlebell Russian twist, Kettlebell halo, Kettlebell figure-8 | Landmine 180s, any of the band movements done on a cable |
| **Core: anti-rotation** | Band Pallof press ★ (standing, half-kneeling +), Bird dog ★ +, Plank shoulder tap +, Kettlebell renegade row (advanced) | |
| **Core: anti-lateral flexion** | Side plank ★, Suitcase carry with a kettlebell + ★, Kettlebell side bend, Single-arm band side bend, Kettlebell windmill, Overhead kettlebell carry +, Turkish get-up (advanced), Copenhagen plank + (needs a bench or couch edge) | |
| **Core: lower back** | Prone back extension ("superman") +, Bird dog (shared with anti-rotation), Kettlebell swing (listed under hinge) | 45° back extension |

| Pattern | Movements |
|---|---|
| **Carry** | Farmer's carry ★ (suitcase and overhead carries are listed under core) |

**Fit with the weekly schedule** (jason, 2026-10-07): Monday legs, Wednesday and Friday upper body with mostly non-overlapping muscles and a heavy arm emphasis (as AnatolyFit did), and a core day on the weekend. Workouts are 6–8 movements, usually about 17 sets (range 12–22). With 3–4 arm slots on each upper day, a week uses 6–8 arm movements. The biceps and triceps rows above have 14 options each, spread across grips, angles and stretched vs shortened positions, so each block can use a fresh mix for about three blocks before repeating a combination. The core day (at home) has six patterns with 3–8 home options each, so every session can hit all six and mix the dynamics: holds (`contraction: isometric`), slow loaded reps, rotations and carries. Varying which option fills each slot and its rep or time range is a light version of the strange periodization, kept only if it helps. `family` and `primaryMuscles` let the generator keep Wednesday and Friday from repeating the same movement or muscle focus. Grip and forearm work fits in as a small add-on slot (1–2 sets) on an upper day or after a carry.

**Runner-support picks** (tagged `runner-support`): single-leg work, RDLs, back extension, glute bridge, hip abduction, calf raises (straight and bent knee), Copenhagen plank, side plank, suitcase carry. These build the hip, hamstring and calf resilience that daily running uses.

Stretching, plyometrics, Olympic lifts and strongman are left out of the first version. Plyometrics in particular overlaps with the daily run's impact load.

---

## 7. How it gets built (milestone 2)

1. `scripts/build-exercises.ts` downloads free-exercise-db at a **pinned commit** (so the seed never changes underneath us).
2. A hand-maintained curation file (`data/curation/exercises.yaml`) lists each of our ~130 movements: our ID and name, the `sourceId` to pull instructions and photos from (or none, for the + entries), and all the ★ tags.
3. The script joins them, validates every entry against the schema (enums, ID uniqueness, regressions/progressions point at real IDs, every starter movement has cues), and writes `data/exercises.json`.
4. Photos for the curated set only (~260 JPGs, about 12 MB) are copied into the app so they work offline.
5. Tagging the ~130 entries is a one-pass drafting job, with jason reviewing the starter set.

An alias map (`oldId → newId`) is in place from day one, so merging or renaming movements later never orphans a logged set.

---

## 8. Licensing notes

- **Our catalog file is MIT** (it's our own work: names, tags, cues). Entries that copy free-exercise-db text or photos are public domain under the Unlicense, which can sit in an MIT repo with no conditions. A short credit in the README is courteous, not required.
- **Provenance caveat (inferred, not confirmed):** free-exercise-db's instructions and photos read like they came from an older commercial site's exercise library, and the repo doesn't say where they came from. The Unlicense is the repo author's statement. For a personal app the risk is negligible. If you want zero doubt in a public repo, we ship our own short cues and no photos. jason chose photos (§9), so this only matters if the provenance is ever questioned.
- **wger** is never copied, only consulted for which movements are common. Names of exercises aren't copyrightable, so writing our own entries for movements wger also lists is fine.
- **Nothing in the app calls an exercise API at runtime.**

---

## 9. Decisions (answered by jason, 2026-10-07)

1. **Catalog:** about 130 curated movements, seeded from free-exercise-db. Keep it to what he'll realistically use.
2. **Photos:** yes, bundle them. free-exercise-db has two photos per movement (start and end), and the app can flip between them as a simple looping demo. Real video is out of scope.
3. **Gym:** Planet Fitness. Smith machine for squat, deadlift, bench and overhead press; assisted pull-up and dip, hack squat, hip adduction and most typical machines.
4. **Smith lifts from block 1** (blocks are 4 weeks: 3 loading weeks and a deload, per periodization.md). jason already did all three with AnatolyFit.
5. **Nothing to avoid** for now.
6. **Home core kit:** resistance bands with a door anchor, and three fixed kettlebells: two 25 lb and one 35 lb (competition style), plus an ab wheel. The pair of 25s allows two-bell carries (farmer's, front-rack) and two-bell holds on the core day; single-bell work progresses 25 → 35, then by reps, time and harder variations. Band set assumed light/medium/heavy until jason lists them.
