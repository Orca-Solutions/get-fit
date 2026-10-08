# get-fit: Product spec and technical approach

Milestone 1 (research and plan). Status: **draft for jason's review**. No code yet.
Sibling docs in this folder, written by other threads: the exercise database and the periodization logic. This doc defines the app around them and the seams where they plug in.

---

## 1. What we're building

A personal, single-user workout app for one iPhone at the gym. Three jobs, nothing else:

1. **Tell me what to do today:** a generated plan in the spirit of AnatolyFit's "strange periodization".
2. **Let me log what I actually did:** reps and weight per set, with the plan pre-filled and easy to override.
3. **Show me my history for the movement I'm on right now.**

Out of scope: meal planning, running (jason's daily morning run stays as it is), social features, accounts, coaching chat, multiple users.

### Product principles (the anti-AnatolyFit list)

- **Never lose a set.** Every tap saves immediately on the phone. There is no "Save workout" button that can fail.
- **Works with no signal.** Gyms have bad reception; the app never needs the network to log.
- **The plan is a suggestion, the log is the truth.** Logging never edits the plan. Deviating is normal and recorded, not an error.
- **Small and tested.** Few features, with automated tests on the generator and the logging flow so regressions get caught before they reach the phone.
- **My data is mine.** One-tap export to a plain JSON file, always.

### Weekly schedule and session size (from jason)

| Day | Session | Notes |
|---|---|---|
| Mon | Legs | |
| Tue | Rest | |
| Wed | Upper A | Wed and Fri hit largely non-overlapping parts of the upper body. AnatolyFit split arms across these two days. |
| Thu | Rest | |
| Fri | Upper B | |
| Sat or Sun | Core (at home) | Either weekend day counts; it isn't "missed" until Sunday ends. Done at home with resistance bands, bodyweight and kettlebells only. |

- A session is **6–8 movements and 12–22 working sets**, typically about 17. The screens below are designed for the 8-movement, 22-set case.
- What goes into each day (the split itself) belongs to the periodization thread. The app stores the schedule as a weekday → session-type map so it can be edited later in Settings.

---

## 2. Screens and flows

### 2.1 Today (home)

```
┌──────────────────────────────┐
│ Wed Oct 14        Week 2 / 4 │
│ Upper A · 7 moves · 18 sets  │
│ "Low reps on presses, high   │
│  reps on curls today"        │  ← generator's one-line rationale
│ ▓▓▓▓▓▓░░░░░░░░  6 / 18 sets  │
├──────────────────────────────┤
│ 1 Bench Press      3×5      ✓│
│ 2 Chest-Supp. Row  3×12     ◐│  ← partial
│ 3 DB Shoulder Prs  3×8       │
│ 4 EZ-Bar Curl      3×10      │
│ 5 Hammer Curl      2×12      │
│ 6 Cable Pushdown   3×15      │
│ 7 Face Pull        2×15      │
├──────────────────────────────┤
│        [ Resume workout ]    │
│  Calendar ▸  History ▸   ⚙   │
└──────────────────────────────┘
```

- Shows today's planned workout with a sets-done progress bar. On a rest day it shows "Rest day" with the next session ("Fri · Upper B") and a button to pull it forward to today.
- Each row: movement, planned sets × reps (or seconds) and status (not started, partial, done). Eight rows fit on an iPhone screen without scrolling.
- Tapping a row jumps straight to that movement's logging screen. "Start/Resume" goes to the first unfinished one.
- Can log on a different day than planned (do Wednesday's legs on Thursday); the session records the real date and the calendar shows it as done late, not missed.

### 2.2 Movement logging screen (the core screen)

```
┌──────────────────────────────┐
│ ‹ Today   2 of 7  Swap  ⋯    │
│ ●◐○○○○○          6 / 18 sets │  ← movement strip: tap a dot to jump
│ Chest-Supported Row          │
│ Plan: 3 × 12 reps            │
│ Last time at 12: 40 lb each  │  ← weight hint from history
├──────────────────────────────┤
│ Set   Weight    Reps         │
│  1   [ 40 ]    [ 12 ]   (✓)  │  ← logged: dark text
│  2   [ 35 ]    [ 11 ]   (✓)  │  ← changed weight, missed a rep
│  3   [ 35 ]    [ 12 ]   ( )  │  ← grey: 35 carried from set 2,
│          + Add set           │     12 from the plan
├──────────────────────────────┤
│ History                      │
│ Oct 7   40×12, 40×12, 40×10  │
│ Sep 30  35×12, 35×12, 35×12  │
│ Sep 23  35×10, 35×10, 30×12  │
│ Best: 40×12  ·  ▁▂▃▅▆ e1RM   │
│ See all ▸                    │
├──────────────────────────────┤
│ ‹ Prev                Next › │
└──────────────────────────────┘
```

**Placeholder behaviour** (the grey pre-fill is HTML `placeholder` text):

- **Reps** show the planned reps in grey. Typing anything replaces them instantly.
- **Weight** starts blank, because the right weight depends on the rep target, which keeps changing. Above the sets, a hint line shows what you lifted last time at a similar rep count ("Last time at 12: 40 lb each"), and the history panel sits right below.
- **Carry-forward:** once you log a weight on a set, the remaining sets of that movement show it in grey. So you type the weight once on set 1, and if you drop to 35 on set 2, later sets follow.
- Tapping ✓ logs whatever is in grey for any empty field, so after set 1 "same again" is one tap. If a weighted set has no weight yet, ✓ puts the cursor in the weight field instead of logging.
- Logged sets stay editable (tap a value to fix it). Un-ticking a set removes that log.
- Number keypad: decimal pad for weight, number pad for reps. Fields use 16px+ text so iOS doesn't zoom.
- **Band movements** (Pallof press, woodchop, band crunch) replace the weight field with two inputs: a **band** picker (chips from your band list, lightest to heaviest) and a **stance** stepper (steps from the anchor). Both carry forward like weight, and the hint line reads "Last time at 12: Green, 3 steps".
- Timed movements (plank) show a seconds field instead of reps. Bodyweight movements hide weight but allow added load. Assisted machines allow negative or "assist" weight. (The exercise DB says which applies.)

**Getting through 6–8 movements and up to 22 sets:**

- **Movement strip** at the top: one dot per movement (done, partial, not started). Tap to jump; swipe left/right on the screen to go to the next or previous movement.
- **Auto-advance:** ticking the last set of a movement turns "Next ›" into a large "Next: Hammer Curl ›" button. Unfinished movements are never skipped silently; the finish summary lists any that were.
- **Always-visible progress:** "6 / 18 sets" in the header, so you know where you are in a long session.
- **The next set is always in reach:** a movement rarely has more than 4–5 sets, so the set table sits above the fold; the history panel shrinks to 2 sessions if a movement has 5 or more sets.
- **Supersets:** if the generator pairs two movements, they share a screen with alternating set rows (A1, B1, A2, B2).
- A 22-set session is only 22 small on-device writes, so speed is not a concern.

**Other controls:**

- **Swap:** replace the movement for today with an alternative from the same category (same movement pattern and primary muscles, limited to the equipment where that session happens, so a core-day swap only offers band, bodyweight or kettlebell moves). The log records what you actually did and links it to what was planned.
- **⋯ menu:** add a note, skip movement, view form cues/instructions.
- **Add set / delete set.**
- **History panel** (always visible on this screen): the last 3 sessions of *this* movement as compact "weight×reps" lists, best set ever, and an estimated-1RM sparkline. Band movements show "band · stance × reps" instead and skip the 1RM chart, since band tension isn't a weight. "See all" opens full history for the movement.
- **Rest timer (M4):** ticking a set starts a countdown bar at the bottom of the screen using the plan's rest time; tap to add or remove 30 seconds, and starting the next set dismisses it. Background alerts on iPhone are best-effort for web apps.
- The screen stays awake during a session (Screen Wake Lock).

### 2.3 Finish summary

Shown after the last movement or via "Finish". Duration, sets done vs planned, total volume, any personal bests, and a free-text note plus optional "how hard was today" (1–5). Leaving the app mid-workout is fine; the session stays open and resumes later.

### 2.4 Calendar

```
┌──────────────────────────────┐
│  ‹      October 2026      ›  │
│       [ Month | Week ]       │
│ Mo  Tu  We  Th  Fr  Sa  Su   │
│             1   2   3   4    │
│                 U✓      C✓   │
│ 5   6   7   8   9   10  11   │
│ L✓      U✓      U✕  C✓       │
│ 12  13  14* 15  16  17  18   │
│ L✓      U◐      U·  C·       │
│ 19  20  21  22  23  24  25   │
│ L·      U·      U·  C·       │
├──────────────────────────────┤
│ L legs  U upper  C core      │
│ ✓ done  ◐ partial  ✕ missed  │
│ · planned   14* = today      │
├──────────────────────────────┤
│ Fri Oct 9 · Upper B · missed │
│ 7 moves · 17 sets            │
│ [ Do it today ]  [ Preview ] │
└──────────────────────────────┘
```

- **Month view** (default) shows past and upcoming sessions at a glance; **Week view** lists the seven days with each session's focus line ("Legs, high reps") and set counts.
- Each session day shows its type (L, U, C) and state: **planned**, **done**, **partial** (some sets logged), **missed** (date passed, nothing logged), or **done late** (logged on a different day, drawn on the day it was actually done with a small arrow back to its slot).
- States are worked out from the plan and the logs, never stored, so they can't get out of sync.
- **Tap a day:** a past day opens that session's log (editable); a future day previews the planned workout; a missed day offers "Do it today".
- **Missed sessions:** the app marks them and offers the make-up. Whether later sessions shift to make room is the generator's rule (the periodization doc currently treats the plan as a queue); the calendar just draws whatever dates the plan holds.
- Deload weeks and block boundaries are shaded, so the 4-week rhythm is visible.
- A "Regenerate upcoming" action re-runs the generator for future days (never touches logged days).

### 2.5 History

- **By movement:** searchable list of movements you've done; each opens the full history (table of sessions, best sets, e1RM chart over time).
- **By session:** list of past workouts; tap to see everything logged that day, editable.

### 2.6 Exercise library

Browse and search the exercise DB by muscle group, movement pattern, and equipment. Mark movements as "favourite", "avoid" (generator skips them) or "can't do here" (equipment missing). Add a custom movement.

### 2.7 Settings

Profile (height, current bodyweight, units: lb default), weekly schedule (Mon upper A, Wed legs, Fri upper B, weekend core; editable), equipment by location (gym: everything; home: resistance bands, bodyweight, kettlebells), **my bands** (set up once: name or colour of each band, ordered lightest to heaviest; the first band movement prompts for this if the list is empty), other training preferences the generator needs (owned by the periodization thread: session length), rest timer on/off, export/import JSON backup, sync token and "last synced" time (see §4).

---

## 3. Data model

All records carry `id` (UUID), `createdAt`, `updatedAt`, `deletedAt` (soft delete). This costs nothing now and makes adding backup/sync later a non-migration.

```
Exercise            ← supplied by the exercise DB thread (read-only seed) + user custom
  id (stable slug, e.g. "barbell-bench-press")   ← logs reference this forever
  name, aliases[]
  primaryMuscles[], secondaryMuscles[]
  movementPattern   (squat | hinge | lunge | push-horizontal | push-vertical |
                     pull-horizontal | pull-vertical | carry | core | isolation …)
  equipment[]
  mechanic          (compound | isolation)
  laterality        (bilateral | unilateral)
  metric            (reps | time | distance)          ← drives which fields the logger shows
  loadType          (barbell | dumbbell | kettlebell | machine | cable | bodyweight | assisted | band)
  weightConvention  (total | per-hand | per-side | added | band)  ← how to read "40 lb"; band = log band + stance
  instructions?, mediaUrl?, source, license
  userFlags         (favourite | avoid | unavailable)  ← app-owned, not from the DB

Profile (singleton)
  heightIn, units, bodyweightLog[{date, lb}], trainingPrefs{…}  ← prefs shape owned by periodization
  schedule: [{ weekdays: [mon], type: "legs" }, { weekdays: [wed], type: "upper-a" },
             { weekdays: [fri], type: "upper-b" }, { weekdays: [sat, sun], type: "core", location: "home" }]
             ← a multi-day entry is a window: either day counts
  equipmentByLocation: { gym: [all], home: [band, bodyweight, kettlebell] }
  bands: [{ id, name, order }]   ← user's resistance bands, order 1 = lightest

Block (mesocycle)
  id, startDate, weeks, generatorVersion, generatorParams, rationale

PlannedWorkout
  id, blockId, date, windowEnd? (e.g. Sunday for the core day), sessionType,
  weekIndex, isDeload, focus label, rationale

PlannedExercise
  id, plannedWorkoutId, exerciseId, order, supersetGroup?, notes

PlannedSet
  id, plannedExerciseId, setIndex, setType (warmup | working | amrap | drop)
  targetReps | targetRepRange{min,max} | targetSeconds
  targetWeight (nullable = "find your weight")
  targetRIR?, restSec?

Session (what actually happened)
  id, plannedWorkoutId (nullable for ad-hoc), startedAt, endedAt?, notes, effort 1–5?,
  beatUp? (the periodization thread's early-deload trigger)

SessionExercise (optional per-movement extras)
  id, sessionId, exerciseId, plannedExerciseId?, effortTap?, skipped?

LoggedSet
  id, sessionId, exerciseId (actual), plannedSetId (nullable), plannedExerciseId (nullable)
  setIndex, weight?, bandId?, stanceSteps?, reps?, seconds?, distance?, rir?, isWarmup, note?, loggedAt
```

Plan and log are separate tables joined by `plannedSetId`. That makes "planned vs actual" a simple comparison, which is exactly what the generator needs for progression.

---

## 4. Technical approach

### 4.1 Platform: installable web app (PWA) vs native iOS

| | PWA (recommended) | Native iOS (SwiftUI) |
|---|---|---|
| Install | "Add to Home Screen", opens full-screen like an app | Xcode build; free Apple account re-signs every 7 days, or $99/yr for TestFlight |
| Updates | Instant: push to repo, app refreshes | Rebuild and reinstall each time |
| Can it be built and tested in the cloud? | Yes, fully (including mobile-viewport browser tests) | Only via a session on jason's Mac with Xcode |
| Offline | Yes (service worker + on-device database) | Yes |
| Nice-to-haves lost | Apple Health, Watch app, home-screen widgets, reliable background rest-timer alerts | — |
| Laptop access to history | Same URL in any browser | No |

The things a PWA gives up are all milestone-5-and-beyond extras. If they ever matter, the data model and generator (plain TypeScript) carry over and a native shell can be added later.

### 4.2 Storage: on the phone, synced to a small Railway service (decided)

jason chose a small backend, on Railway like his personal treasury app. The phone stays the source of truth while you train, and the backend is the durable copy:

```
 iPhone (PWA)                                 Railway (one service)
 ┌──────────────────────┐   HTTPS, when online   ┌─────────────────────────┐
 │ IndexedDB (Dexie)    │ ── push changes ─────▶ │ Node API  /api/sync     │
 │ every tap saves here │ ◀── pull changes ───── │ SQLite on a volume      │
 └──────────────────────┘                        │ also serves the app     │
                                                 └─────────────────────────┘
```

- **Logging never waits on the network.** Sets save on the phone instantly; sync runs in the background on app open, after each ticked set when there's signal, and at "Finish". At the gym with no signal, nothing changes until you're back online.
- **Sync protocol:** every record already has `id`, `updatedAt` and `deletedAt` (§3). The phone pushes records changed since its last sync and pulls records the server has that are newer. Last write wins per record, which is fine for one person. A laptop browser opening the same URL gets the full history.
- **Auth:** one long secret token, entered once on each device and stored there; the API rejects anything without it. No accounts or passwords.
- **Database:** SQLite on a Railway volume, inside the same service as the API. One service, one bill line, and the database is a single file that's easy to back up. (Railway's Postgres works too, but it's a second always-on service for no benefit at this size.)
- **Cost:** Railway bills by usage. The Hobby plan is $5/month and includes $5 of usage, which a one-user service fits inside. The Free plan ($1/month of credit, 0.5 GB RAM after the trial) is probably tight for an always-on service. If jason's treasury app is already on Hobby, this adds little or nothing. ([Railway pricing](https://railway.com/pricing), checked 2026-10-07.)
- **Safety net:** three copies: the phone, the Railway volume, and the one-tap JSON export in Settings.
- Notes on iOS storage: a home-screen web app keeps its own storage and is exempt from Safari's 7-day cleanup of website data. The app also calls `navigator.storage.persist()`.

### 4.3 Stack

- **Vite + React + TypeScript.** The most common, best-documented combination, which matters for a project built and maintained with coding agents.
- **Dexie** (IndexedDB wrapper) with live queries, so screens update the moment a set is saved.
- **vite-plugin-pwa** for the manifest, service worker and offline caching.
- **React Router** for the handful of screens; plain CSS (or Tailwind if preferred during build) with a dark, high-contrast, large-tap-target gym UI.
- Charts: a hand-rolled SVG sparkline/line chart. No chart library needed.
- **Vitest** for unit tests (generator, progression, placeholder/carry-forward logic); **Playwright** at iPhone viewport for the logging flow end to end. CI on GitHub Actions runs both on every push.
- **Backend: Hono** (a small Node web framework) + **better-sqlite3**, in the same repo under `server/`. One Railway service builds the app, serves it, and handles `/api/sync`, so the app and API share one address and need no cross-origin setup.
- **Hosting: Railway**, deploying automatically from the public GitHub repo on every merge to main. Workout data is never in the repo; it lives on the phone and on the Railway volume.

### 4.4 Code layout (proposed)

```
get-fit/
  README.md  LICENSE (MIT)  docs/ (this spec, periodization, exercise DB notes)
  data/exercises.json            ← built by the exercise DB thread's script
  scripts/build-exercises.ts     ← fetch/clean/categorize source data → data/exercises.json
  src/
    generator/                   ← pure TS, no UI, no DB: the periodization engine
    db/                          ← Dexie schema, queries (getExerciseHistory, etc.)
    features/today | logging | history | library | settings
    lib/ (units, e1RM, ids, sync)
  server/                        ← Hono API + SQLite, serves the built app
  tests/ (unit + e2e)
```

---

## 5. Integration points for the sibling threads

### Exercise database thread

- **Delivers** `data/exercises.json`: an array of `Exercise` objects matching §3, plus the script that produces it, plus source attribution and license notes for the README.
- **App needs, at minimum**, per exercise: stable `id`, `name`, `primaryMuscles`, `movementPattern`, `equipment`, `metric`, `loadType`, `weightConvention`. Everything else is a bonus. Field names and enums in §3 are a proposal; the DB thread can rename, and the app adapts at import.
- **IDs are forever.** Logged sets point at exercise IDs, so renaming a movement must not change its ID. Merges of duplicates need an alias map.
- The app bundles the file and seeds IndexedDB on first launch and on version change; user flags and custom exercises survive reseeding.

### Periodization thread

The generator is a pure function the app calls; it never touches the database or UI.

```ts
generateBlock(input: {
  profile: Profile;                 // height, bodyweight, schedule (Mon/Wed/Fri + weekend core), prefs
  exercises: Exercise[];            // with userFlags applied (skip "avoid"/"unavailable")
  history: ExerciseHistory;         // planned vs actual per exercise, recent sessions
  startDate: string;
  previousBlock?: Block;            // for rotation/variety across blocks
}): Block                           // PlannedWorkouts → PlannedExercises → PlannedSets

resolveLoads(week: PlannedWorkout[], history: ExerciseHistory): PlannedWorkout[]
// fills targetWeight just before a week (or session) starts, from what was actually lifted

substitutes(exerciseId, exercises, context): Exercise[]   // powers the Swap button
```

- Suggested split (for that thread to confirm): `generateBlock` decides the *structure* up front (which muscles, patterns, rep schemes on which days); `resolveLoads` picks *weights* a week at a time from real logs, so the plan adapts when you lift more or less than planned.
- **Weights aren't shown as targets.** jason wants the weight field blank because the right weight depends on the rep target. The generator can still compute `targetWeight` for its own progression logic, but the UI shows only a "last time at this rep count" hint from the logs. With no history the hint is simply absent and the first logged sets become the baseline.
- Each `Block` and `PlannedWorkout` carries a one-line `rationale` that the Today screen shows, so the "strange" variation is explained rather than mysterious.
- jason has set the schedule: legs Wednesday (moved from Monday on 2026-10-08 so a Sunday long run doesn't precede it), two largely non-overlapping upper days Monday and Friday (arms split across them, as AnatolyFit did), core on the weekend, 6–8 movements and 12–22 sets per session. The generator fills those slots and stamps each `PlannedWorkout` with its date and `sessionType`; the calendar renders them. Core day is at home, so the generator must pick its movements from `equipmentByLocation.home` only.
- Other prefs (session length, how the daily 2-mile run affects leg work) are that thread's questions to ask; the app just stores the answers.

---

## 6. Milestone fit

Milestones are the project's review checkpoints, and each one waits for jason's feedback before the next starts. M1 is this research and planning round.

- **M2 Skeleton:** repo, README, LICENSE, CI, Railway service deployed; `exercises.json` loaded; generator produces a sample block rendered on a read-only Today screen and Calendar.
- **M3 Logging:** movement screen with placeholders, carry-forward, swap, movement strip, history panel, finish summary, calendar states (done, partial, missed, make-up), sync to Railway, JSON export. Deployed and installable on jason's phone. Sync lands here, not later, so real logs are backed up from the first workout.
- **M4 Polish:** rest timer, progression tuning on real data, PR highlights.

---

## 7. README founding story (draft)

> # get-fit
>
> A personal workout planner and logger. One user (me), one phone, no accounts, no meal plans.
>
> ## Why this exists
>
> I liked AnatolyFit. Specifically, I liked its "strange periodization": the idea that you don't hit the same muscles the same way every week, but keep changing the angle, the rep range and the load so your body never settles into a rut. It made training feel less like a spreadsheet and more like a plan with a point of view.
>
> What I didn't like was losing workouts to bugs. After enough sessions where the app got in the way of the training, I decided to build my own version that does the one thing I need, reliably: tell me what to do today, let me log what I actually did (which is often not what the plan said), and show me how that movement has gone before.
>
> This project is not affiliated with AnatolyFit. It's an independent, from-scratch take on the training ideas that drew me to it, built for an audience of one.
>
> ## Principles
>
> - Never lose a logged set. Everything saves the moment you tap it.
> - Works offline. The gym's Wi-Fi is not a dependency.
> - The plan is a suggestion; the log is the truth.
> - Small, tested, and boring in the best way.
> - Your data is plain JSON you can take anywhere.
>
> ## License
>
> MIT.

---

## 8. Decisions

Settled by jason on 2026-10-07:

1. **Platform:** PWA.
2. **Data:** a small backend on Railway, with the phone as the offline source of truth (§4.2).
3. **Repo:** public.
4. **Placeholders:** reps show the planned reps; weight stays blank (weight hint and carry-forward instead, §2.2).
5. **Runs:** out of the app; the morning run stays as is.
6. **Core day:** at home, with resistance bands, bodyweight and kettlebells only.

7. **Rest timer:** M4.

Nothing is open.

Defaults assumed unless jason says otherwise: pounds, dumbbell weights entered per hand, dark theme.
