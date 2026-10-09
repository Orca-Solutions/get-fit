# get-fit: Product spec and technical approach

What the app does, how its screens behave, the records it stores, and how it is built. The training rules live in [periodization.md](periodization.md) and the exercise catalog in [exercise-database.md](exercise-database.md); this document defines the app around them. Code comments cite it by section number (§3 data model, §4.2 sync), so keep the numbering stable.

---

## 1. What get-fit is

A single-user workout app for the gym, used mainly on a phone and also from a desktop browser. Three jobs, nothing else:

1. **Say what to do today:** a generated plan in the spirit of AnatolyFit's "strange periodization".
2. **Record what was actually done:** reps and weight per set, with the plan pre-filled and easy to override.
3. **Show the history of the movement in hand,** right where it's being logged.

Out of scope: meal planning, running (runs stay outside the app), social features, accounts, coaching chat, multiple users.

### Product principles

- **Never lose a set.** Every tap saves immediately on the device. There is no "Save workout" button that can fail.
- **Works with no signal.** Gyms have bad reception; the app never needs the network to log.
- **The plan is a suggestion, the log is the truth.** Logging never edits the plan. Deviating is normal and recorded, not an error.
- **Small and tested.** Few features, with automated tests on the generator, sync and the logging flow, so regressions are caught before they reach a phone.
- **The data belongs to the user.** Export to plain JSON or CSV at any time.

### Weekly schedule and session size

| Day | Session | Notes |
|---|---|---|
| Mon | Chest & biceps (gym) | |
| Tue | Rest | |
| Wed | Legs (gym) | Midweek, so a weekend long run doesn't land the day before it. |
| Thu | Rest | |
| Fri | Back, triceps & shoulders (gym) | Monday and Friday hit largely non-overlapping parts of the upper body. |
| Sat or Sun | Core (home) | Either weekend day counts; it isn't missed until Sunday ends. Done at home with resistance bands, bodyweight and kettlebells. |

- A session is **6–8 movements and 12–22 working sets**, typically about 17. The screens are designed for the 8-movement, 22-set case.
- The schedule is stored in the profile as weekday → session-type entries, each with a location (gym or home). The app doesn't edit it yet; the default is in `packages/core/src/profiles.ts`.

---

## 2. Screens and flows

Five tabs (Today, Calendar, History, Library, Settings), plus a full-screen workout view and a plan preview. The navigation sits at the bottom on a phone and on the left on screens 960 px and wider.

### 2.1 Today (home)

```
┌──────────────────────────────┐
│ Wed Oct 14        Week 1 / 4 │
│ Legs · Heavy                 │
│ 6 moves · 18 sets            │
│ "Heavy day: fewer movements, │
│  more sets, 6–8 reps on the  │  ← generator's one-line rationale
│  big lifts."                 │
│ ▓▓▓▓▓▓░░░░░░░░  6 / 18 sets  │
│ 1 Smith Machine Squat  3×6–8 ✓│
│ 2 Dumbbell RDL         3×6–8 ◐│  ← partial
│ 3 DB Reverse Lunge    3×8–10  │
│ 4 Leg Extension       3×10–15 │
│ 5 Seated Leg Curl     3×10–15 │
│ 6 Seated Calf Raise   3×10–15 │
│       [ Resume workout ]     │
├──────────────────────────────┤
│ Today Calendar History …     │
└──────────────────────────────┘
```

- Shows today's planned workout with its rationale, a sets-done progress bar and the movement list (planned sets × reps or seconds, and status). Tapping a row opens that movement; the main button reads Start, Resume or Review.
- On a rest day it shows "Rest day" with the next session, a **Preview** and a **Do it today** button that pulls it forward.
- Missed sessions from the current week are listed with **Do it today**, so a session can be made up on another day. The session records the real date and the calendar shows it as done late, not missed.
- The block's rationale sits at the bottom.

### 2.2 Movement logging screen (the core screen)

```
┌──────────────────────────────┐
│ ‹ Today   2 of 6   Swap  ⋯   │
│ ①②③④⑤⑥           6 / 18 sets │  ← movement strip: tap to jump
│ Dumbbell Romanian Deadlift   │
│ Plan: 3 × 6–8                │
│ Last time at 6–8: 40 lb each │  ← weight hint from history
├──────────────────────────────┤
│ Set   Weight    Reps         │
│  1   [ 40 ]    [ 8 ]    (✓)  │  ← logged: dark text
│  2   [ 35 ]    [ 7 ]    (✓)  │  ← changed weight, missed a rep
│  3   [ 35 ]    [ 6–8 ]  ( )  │  ← grey: 35 carried from set 2,
│          + Add set           │     reps from the plan
│ Effort  [Easy][Right][Hard]  │
├──────────────────────────────┤
│ History                      │
│ Oct 7   40×8, 40×8, 40×7     │
│ Sep 30  35×8, 35×8, 35×8     │
│ Best: 40×8  ·  ▁▂▃▅▆ e1RM    │
├──────────────────────────────┤
│        Rest  1:42  ▔▔▔▔      │  ← rest timer
│ ‹ Prev     Next: Lunge ›     │
└──────────────────────────────┘
```

**Placeholder behaviour** (the grey pre-fill is HTML `placeholder` text):

- **Reps** show the planned reps in grey. Typing anything replaces them.
- **Weight** starts blank, because the right weight depends on the rep target, which keeps changing. Above the sets, a hint line shows what was lifted last time at a similar rep count ("Last time at 6–8: 40 lb each"), and suggests one increment more when every set of that session reached the top of the range.
- **Carry-forward:** once a weight is logged on a set, the remaining sets of that movement show it in grey. The weight is typed once on set 1; a drop to 35 on set 2 carries to later sets.
- Tapping ✓ logs whatever is in grey for any empty field, so "same again" is one tap. If a weighted set has no weight yet, ✓ puts the cursor in the weight field instead of logging.
- Logged sets stay editable (tap a value to fix it). Un-ticking a set removes that log.
- Decimal pad for weight, number pad for reps. Fields use 16 px+ text so iOS doesn't zoom.
- **Band movements** (Pallof press, woodchop, band crunch) replace the weight field with a **band** picker (the user's bands, lightest to heaviest) and a **stance** stepper (steps from the anchor). Both carry forward like weight, and the hint reads "Last time at 10–15: Green, 3 steps".
- Timed movements (plank) show a seconds field instead of reps. Bodyweight movements hide weight or allow added load; assisted machines log the assistance; Smith machine lifts log the plates added. The catalog's weight convention says which applies.
- **Effort:** an optional Easy / Right / Hard tap per movement feeds the progression math ([periodization.md §4.4](periodization.md#44-loads-and-progression-the-feedback-loop)).

**Getting through 6–8 movements and up to 22 sets:**

- **Movement strip** at the top: one marker per movement (done, partial, not started; grip finishers and core supersets are labelled). Tap to jump, or swipe left and right.
- **Next button:** "Next: Reverse Lunge ›" names the next movement. The last movement shows **Finish**, and the finish summary lists any movement left unfinished.
- **Always-visible progress:** "6 / 18 sets" in the header.
- **Core day supersets** are labelled A–D in the strip; each movement still has its own screen.
- The screen stays awake during a session (Screen Wake Lock).

**Other controls:**

- **Swap:** replace the movement for today. Movements tagged for the same slot come first, then ones with the same movement pattern and primary muscles, all limited to the equipment at that day's location and excluding movements marked Avoid or Can't do there. Swapping back to the plan is one tap. The log records what was actually done and links it to what was planned.
- **⋯ menu:** form cues and instructions, a workout note, skip or un-skip the movement, and Finish workout.
- **Add set / remove set.**
- **History panel:** the last sessions of *this* movement as compact weight × reps lists, the best set ever, and an estimated-1RM sparkline. Band movements show band · stance × reps and skip the 1RM chart, since band tension isn't a weight.
- **Rest timer:** ticking a set starts a countdown in the thumb zone above Prev / Next (a small "Rest" label, a large count, a thin bar) using the plan's rest for that set (heavy-day compounds 2.5 min, moderate 1.75, light 1.25; isolation 1.25 to 1.5; grip 1; core 0.75). −30 / +30 adjust it, tapping it dismisses it, and logging the next set starts a new one. It keeps time from the clock, so a locked phone shows the right time on return. At zero it buzzes once where the phone allows (not iPhone) and plays a soft tone only if sound is on, then shows how long ago rest ended. On/off and sound live in Settings, per device. Alerts while the app is in the background aren't possible for a web app on iPhone.

### 2.3 Finish summary

Shown from the last movement's **Finish** button or the ⋯ menu: sets done vs planned, duration, total volume, new personal bests (by e1RM), any unfinished movements, an optional "how hard was today" rating (1–5), a "beat up" checkbox and a note. Leaving the app mid-workout is fine; the session stays open and resumes later.

### 2.4 Calendar

```
┌──────────────────────────────┐
│  ‹      October 2026      ›  │
│       [ Month | Week ]       │
│ Mo  Tu  We  Th  Fr  Sa  Su   │
│                     10  11   │
│                     C·       │
│ 12  13  14* 15  16  17  18   │
│ U✓      L◐      U·  C·       │
│ 19  20  21  22  23  24  25   │
│ U·      L·      U·  C·       │
├──────────────────────────────┤
│ ✓ done  ◐ partial  ✕ missed  │
│ · planned   14* = today      │
├──────────────────────────────┤
│ Fri Oct 16 · Back, triceps & │
│ shoulders · Light · planned  │
│ [ Preview ]  [ Do it today ] │
└──────────────────────────────┘
```

- **Month view** (default) shows past and upcoming sessions at a glance; **Week view** lists the seven days with each session's focus and set count.
- Each session day shows its state: **planned**, **done**, **partial** (some sets logged), **missed** (date passed, nothing logged), or **done late** (logged on a different day). Days before the app was first used show as not tracked rather than missed.
- States are worked out from the plan and the logs, never stored, so they can't get out of sync.
- **Tap a day:** a logged session opens its log (editable); a missed or upcoming session offers **Preview** and **Do it today**.
- Deload weeks are shaded, so the 4-week rhythm is visible.

### 2.5 History

- **By movement:** a searchable list of movements that have been logged; each opens its full history (sessions, best set, e1RM chart over time).
- **By workout:** past workouts, newest first; tap one to open everything logged in it, editable.

### 2.6 Exercise library

Browse and search the catalog by name, alias or equipment, filtered by muscle group (chest, back, shoulders, arms, legs, core). Each movement shows its photos, cues, instructions, muscles and equipment, and can be marked:

- **Favourite:** picked more often.
- **Avoid:** left out of new plans and swaps everywhere.
- **Can't do at the gym / at home:** left out only at that place (the gym might lack a machine that exists at home, or the other way round).

### 2.7 Settings

- **You:** bodyweight (used for assisted machines), Smith machine bar weight (added to the plates logged), home kettlebells (for example "25x2, 35"), and the core day's light wave or flat scheme.
- **My bands:** name each band and order them lightest to heaviest.
- **Plan:** the weekly schedule (read-only for now) and **Regenerate upcoming workouts**, which rebuilds the rest of the current block and the next one; logged workouts are kept.
- **Export my data:** a full JSON backup, the logged sets as CSV, and restore from a backup (§4.2).
- **Rest timer:** on or off, and sound or no sound, per device.
- **Sync:** paste the server's sync token to connect, see the last sync time and any records held back, sync now, or disconnect.

Units are pounds throughout, and dumbbell weights are entered per hand.

---

## 3. Data model

Every stored record carries `id`, `createdAt`, `updatedAt` and `deletedAt` (soft delete), so sync is last-write-wins per record. Types are in [`packages/core/src/types.ts`](../packages/core/src/types.ts); the exercise record is described in [exercise-database.md §4](exercise-database.md#4-schema).

```
Exercise            ← the curated catalog (bundled, read-only) plus custom movements
  id (stable slug, e.g. "dumbbell-romanian-deadlift")   ← logs reference this forever
  name, aliases[], family, movementPattern, primary/secondaryMuscles, equipment[]
  metric (reps | time), loadType, weightConvention, repRange, slots[] …

ExerciseFlag        (id = exerciseId)
  favourite?, avoid?, unavailableAt? (gym | home)[]

Profile (one record, id "me")
  heightIn, bodyweightLb, units ("lb"), smithBarLb, coreWave (wave | flat)
  schedule: [{ weekdays: [1], type: "chest-biceps", location: "gym" }, …,
             { weekdays: [6, 0], type: "core", location: "home" }]
             ← a multi-day entry is a window: either day counts
  equipmentByLocation: { gym: [...], home: [...] }
  bands: [{ id, name, order }]          ← order 1 = lightest
  kettlebells: [{ lb, count }]

Block (4 weeks)
  startDate, weeks, index, generatorVersion, programId, programVersion,
  rationale, baseSlots (exercise per base slot, used to rotate the next block), plannedAhead?

PlannedWorkout
  blockId, date, windowEnd? (e.g. Sunday for the core day), sessionType, location,
  weekIndex, zone (H | M | L | deload), isDeload, focus ("Legs · Heavy"), rationale,
  exercises: PlannedExercise[]

PlannedExercise     (embedded in PlannedWorkout)
  id, exerciseId, slot, role (P | C | I | V | G | K), order, supersetGroup?, note?,
  sets: [{ setIndex, targetReps? {min,max} | targetSeconds? {min,max}, rir, restSec }]

Session (what actually happened)
  plannedWorkoutId, date (the real date), startedAt, endedAt?, notes?, effort (1–5)?, beatUp?,
  swaps { plannedExerciseId → exerciseId }, swapReasons?, skipped[], extras[],
  fieldAt { field → when it last changed }   ← lets devices merge per field

LoggedSet
  sessionId, exerciseId (actual), plannedExerciseId?, setIndex, date, loggedAt,
  weight?, bandId?, stanceSteps?, reps?, seconds?, effort (easy | right | hard)?
```

Plan and log are separate records joined by the planned exercise and set index, which makes "planned vs actual" a simple comparison. Ids are derived wherever two devices could create the same thing offline: a block's id comes from its start date, a planned workout's from its date and day type, a session's from its planned workout, and a planned set's log from its session, slot, movement and index. Two devices that plan the same block or log the same set before syncing therefore write the same record instead of a duplicate.

---

## 4. Technical approach

### 4.1 Platform: installable web app (PWA)

| | PWA (chosen) | Native iOS |
|---|---|---|
| Install | "Add to Home Screen", opens full-screen like an app | Xcode build; a free Apple account re-signs every 7 days, or $99/yr for TestFlight |
| Updates | Deploy, and the app updates on next launch | Rebuild and reinstall each time |
| Build and test in CI | Yes, fully (including phone-size browser tests) | Needs macOS with Xcode |
| Offline | Yes (service worker and on-device database) | Yes |
| Given up | Apple Health, Watch app, home-screen widgets, reliable background rest-timer alerts | — |
| Desktop access | Same URL in any browser | No |

The engine is plain TypeScript in its own package, so a native shell could be added later without rewriting the plan or the data model.

### 4.2 Storage and sync

Each device keeps a full copy of everything in IndexedDB and is the source of truth while training. A small server is the meeting point between devices and the off-device backup:

```
 Phone / desktop (PWA)                          Server (one Node process)
 ┌──────────────────────┐   HTTPS, when online   ┌─────────────────────────┐
 │ IndexedDB (Dexie)    │ ── push changes ─────▶ │ POST /api/sync          │
 │ every tap saves here │ ◀── pull changes ───── │ SQLite on a volume      │
 └──────────────────────┘                        │ also serves the app     │
                                                 └─────────────────────────┘
```

- **Logging never waits on the network.** Sets save on the device instantly. Sync runs in the background shortly after each write, on app open, when the app regains focus or visibility, when the network returns, and every minute while it's open. It also pulls before planning, so a device doesn't plan from stale data. Polling is enough for one person's devices; no websockets or queues.
- **Protocol:** the device pushes records changed since its last push and pulls everything the server stored since its cursor. Last write wins per record, by `updatedAt`; sessions merge per field. A device's first sync pulls before it pushes: if the server already has a plan, it replaces the plan that device generated on its own, so devices never end up with overlapping blocks, while that device's logged sets are kept and pushed. The full protocol is in [api/sync-server.md](api/sync-server.md).
- **Epochs:** the server's database has a random id (epoch). If the server is restored from a backup or its data is lost, it starts a new epoch, and every device pulls everything and re-uploads everything it has, so nothing written since the backup is lost while a device still holds it.
- **Validation:** malformed records are never uploaded or stored. Settings › Sync shows how many local records are held back.
- **Auth:** one long secret token, entered once on each device. No accounts or passwords.
- **Database:** SQLite in the same process as the API, storing records as JSON rows keyed by table and id, so there's no server-side schema to migrate.
- **Backup and restore:** Settings › Export my data saves every table as JSON, or the logged sets as CSV. Restoring merges by id and only replaces older copies, so it never removes logged sets. On a device with nothing logged yet, the backup's profile and plan replace the ones the device made for itself.
- **Safety net:** three copies: each device, the server's volume, and the user's exports.
- **iOS storage:** a home-screen web app keeps its own storage and is exempt from Safari's 7-day cleanup of website data.

### 4.3 Stack

- **Vite, React 19 and TypeScript**, with React Router for the handful of screens and plain CSS with a dark, high-contrast, large-tap-target UI.
- **Dexie** (IndexedDB) with live queries, so screens update the moment a set is saved or a sync lands.
- **vite-plugin-pwa** for the manifest, service worker and offline precache. A new version installs in the background and takes over on the next launch or on the **Update** button; the app never reloads an open screen by itself.
- Charts are hand-rolled SVG sparklines; no chart library.
- **Vitest** for unit tests (golden plans, property tests over random setups, generator, progression, sync, server, catalog); **Playwright** at iPhone size against the production build for logging, the rest timer and updates. GitHub Actions runs both on every push.
- **Server: Hono** with **better-sqlite3**. It serves the built app and the API from one origin, so there's no CORS and one service-worker scope.

### 4.4 Code layout

An npm workspace. The engine is a package of its own, so other apps can build on it.

```
get-fit/
  README.md  LICENSE (FSL-1.1-MIT)  docs/
  packages/core/                 ← @orca-solutions/get-fit-core
    scripts/                     ← curation.ts and build-exercises.ts → src/data/exercises.json
    src/program.ts               ← the training program as data (STRANGE_PERIODIZATION)
    src/generator/               ← pure TS, no UI, no DB: the plan generator, coverage, progression
    src/client/                  ← Dexie database, plan horizon, logging, backup, sync engine ("/client")
    src/server/sqlite.ts         ← SQLite sync store ("/sqlite")
    tests/                       ← golden plans, property tests, generator, catalog, client
  apps/web/                      ← the PWA: features/today | workout | plan | calendar | history | library | settings
  server/                        ← Hono API and static hosting; server and sync round-trip tests
  e2e/                           ← Playwright against the production build
```

Builds land in `dist/` (the app) and `dist-server/` (the server) at the repo root.

---

## 5. How the engine plugs in

The app calls the core; the core never touches the UI.

- **Catalog:** `CATALOG` is the curated list in `src/data/exercises.json`, bundled with the app. Custom movements live in their own table and merge with it. Exercise ids never change, because logged sets reference them forever.
- **Generator:** `generateBlock` is a pure function from the profile, catalog, flags, start date, previous block and a few facts from the logs (which movements have history, which have stalled, whether the last block had a "beat up" session) to a block of planned workouts. It follows a `Program`, which defaults to `STRANGE_PERIODIZATION`.
- **Plan horizon:** `ensurePlan` keeps the current block and the next one planned, and rebuilds a planned-ahead block's unlogged workouts from the latest logs on its first day.
- **Weights aren't targets.** The generator prescribes reps, effort and rest; the UI shows a "last time at this rep count" hint from the logs instead of a target weight. With no history the hint is absent and the first logged sets become the baseline.
- Each block and planned workout carries a one-line `rationale` that the app shows, so the "strange" variation is explained rather than mysterious.

The full API is in [api/core.md](api/core.md).

---

## 6. Status and open items

Built and in use: planning, logging, swap and skip, history, calendar, library, settings, export and restore, multi-device sync, the rest timer, in-app updates, and a responsive desktop layout.

Open:

- **Supersets on one screen:** the core day's supersets are labelled, but each movement still has its own screen rather than alternating rows (A1, B1, A2, B2).
- **Training rules not yet implemented:** early deload, the 10-day-gap load drop and the finer progression rules ([periodization.md §4.8](periodization.md#48-not-yet-implemented)).
- **Progression tuning** on real logs.
- **Weekly targets from block 6:** Friday runs out of room, so back can dip to 8 sets in one week, triceps reach 10.5 in one week, and from block 8 rear delts sit at 1.5–2 (target 3–5). Blocks 1 to 5 stay inside every target.
- **Server-side record checks:** the server validates only the sync fields of each record; field-level checks happen on the devices.
- **Editable schedule and units:** the schedule and lb units are fixed for now, though the profile already stores both.
- **Custom movements:** supported in the data model and sync, with no screen to add one yet.

---

## 7. Decisions

1. **Platform:** PWA (§4.1).
2. **Data:** a full offline copy on each device, synced to one small self-hosted server (§4.2).
3. **Repo:** public source under FSL-1.1-MIT: no competing commercial use, and each release becomes MIT two years after it is published.
4. **Placeholders:** reps show the planned reps; weight stays blank, with a weight hint and carry-forward instead (§2.2).
5. **Runs:** outside the app.
6. **Core day:** at home, with resistance bands, bodyweight and kettlebells only.
7. **Rest timer:** in the workout screen, from the plan's rest per set (§2.2).
8. **Defaults:** pounds, dumbbell weights entered per hand, dark theme.
