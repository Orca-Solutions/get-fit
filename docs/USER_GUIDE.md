# User guide

How to use get-fit day to day: setting it up on a phone, following the plan, logging a workout, and keeping the data safe. For how the plan is built, see [periodization.md](periodization.md); for running the server, see [DEPLOYMENT.md](DEPLOYMENT.md).

- [1. Getting started](#1-getting-started)
- [2. The plan](#2-the-plan)
- [3. Today](#3-today)
- [4. Logging a workout](#4-logging-a-workout)
- [5. Finishing a workout](#5-finishing-a-workout)
- [6. Calendar](#6-calendar)
- [7. History](#7-history)
- [8. Library](#8-library)
- [9. Settings](#9-settings)
- [10. Backups and more than one device](#10-backups-and-more-than-one-device)
- [11. Limits](#11-limits)

## 1. Getting started

1. **Open the app** at the address of your get-fit server (see [DEPLOYMENT.md](DEPLOYMENT.md) to run one).
2. **Install it.** On an iPhone, open the site in Safari and use Share › Add to Home Screen. On Android, use the browser's Install or Add to Home screen option. The installed app opens full screen and works with no signal.
3. **Connect sync.** In Settings › Sync, paste the server's sync token. Each device gets the same token; after that, every device shares one plan and one history.
4. **Fill in Settings › You** (bodyweight, Smith machine bar weight, kettlebells at home) and **My bands** if you train with resistance bands at home. These only change how weights are worked out and which home movements fit; see [§9](#9-settings).

On first launch the app shows "Setting up your plan…" while it builds the current block, which starts on the Monday of the current week.

## 2. The plan

The plan runs in **4-week blocks**: three loading weeks and a lighter deload week. The app always has the current block and the next one planned, and it refreshes a block planned ahead from the latest logs on the block's first day.

The default week:

| Day | Session |
|---|---|
| Monday | Chest & biceps (gym) |
| Wednesday | Legs (gym) |
| Friday | Back, triceps & shoulders (gym) |
| Saturday or Sunday | Core (home: bands, bodyweight, kettlebells) |

Each lifting day takes a turn at **heavy**, **moderate** and **light** across the three loading weeks, so every week has one of each. Heavy days have fewer movements, more sets and lower reps; light days have more movements and higher reps. A session is 6 to 8 movements and roughly 12 to 22 working sets. The core day can be done on Saturday or Sunday; it only counts as missed once Sunday ends.

Every workout shows a one-line reason for its shape ("Heavy day: fewer movements, more sets, 6–8 reps on the big lifts."), and every block has a short rationale at the bottom of Today.

The plan is a suggestion and the log is the truth: lifting something different from the plan is normal and is recorded as it happened.

## 3. Today

Today shows the day's workout: its focus and zone, the week of the block ("Week 1 / 4"), the number of movements and sets, the reason line, a progress bar, and the list of movements with their planned sets and reps. Tap a movement to open it, or use the main button: **Start**, **Resume** or **Review**, depending on how far the workout has got.

- **Rest day:** Today shows the next session with **Preview** and **Do it today**. Do it today pulls that session forward to today.
- **Missed sessions** from the current week are listed with **Do it today**, so a missed workout can be made up later in the week. It is recorded on the day it was actually done and shows on the calendar as done late.

## 4. Logging a workout

The workout opens one movement per screen. The header shows the movement's position ("2 of 6"), **Swap**, the **⋯** menu and the sets done so far ("6 / 18 sets"). The strip of markers under it shows each movement as done, partial or not started; tap a marker or swipe left and right to jump between movements. **Next** names the next movement, and the last movement shows **Finish**. The screen stays awake during a workout.

### Sets

Each set row has a weight and a reps field and a ✓.

- **Grey values are the plan.** Reps start as the planned range in grey; typing replaces them. Tapping ✓ logs whatever is grey in any empty field, so "same again" is a single tap.
- **Weight starts blank on set 1.** Once a weight is logged, the remaining sets show it in grey, so it is typed once. If set 2 drops to a lighter weight, that weight carries to the sets after it.
- If a weighted set has no weight yet, ✓ moves the cursor to the weight field instead of logging.
- Logged sets stay editable: tap a value to fix it. Un-ticking a set removes it. **+ Add set** adds an extra set, and an extra set can be removed again.
- Every tap saves on the phone straight away. There is no Save button and nothing to lose if the app is closed mid-workout.

**Units:** weights are pounds, and dumbbell weights are entered **per hand**. On the Smith machine, log the plates you added; the bar weight from Settings is added for you. On an assisted machine, log the assistance. Holds such as the plank log seconds instead of reps.

**Band movements** (Pallof press, woodchop, band crunch) replace the weight field with a **band** picker and a **stance** stepper (steps from the anchor). Both carry forward like weight.

### The weight hint

Above the sets, a line shows what was lifted last time at a similar rep count, for example "Last time at 6–8: 40 lb each".

- When every set last time reached the top of the rep range and none was marked Hard, the hint adds one step heavier ("· try 45").
- When a set last time was marked Hard, the hint says to hold the weight.
- In a deload week the hint suggests about 10% under the working weight.
- After a heavy top set on the first lift, the back-off sets are pre-filled about 10% lighter.
- The Friday deadlift, which only comes round some weeks, gets its suggestion from its estimated one-rep max. It also holds the weight after a Hard set.

### How did that feel?

Once every set of a movement is logged, **How did that feel?** offers **Easy**, **Right** and **Hard**. The tap is optional, but it is what lets the hint step the weight up (Easy or Right at the top of the range) or hold it (Hard). Tap the same choice again to clear it.

### History on the same screen

Below the sets, the movement's recent sessions are listed as weight × reps, with the best set ever and a small estimated one-rep-max chart. **See all ›** opens the full history.

### Swap, skip and the ⋯ menu

- **Swap** replaces the movement for today. Movements that fill the same slot come first, then ones with the same movement pattern and muscles, all limited to the equipment where that day happens, and never ones marked Avoid or Can't do there. Swapping back to the planned movement is one tap. The log records what was actually done.
- The **⋯** menu has the full instructions and form cues, a workout note, **Skip movement** (or Un-skip), and **Finish workout**.

### Rest timer

Ticking a set starts a rest countdown just above Prev / Next, sized to that set: about 2.5 minutes after a heavy-day compound lift, less on moderate and light days, and down to 45 seconds for core work. **−30** and **+30** adjust it, tapping it dismisses it, and logging the next set starts a new one. It keeps time from the clock, so it is still right after the phone has been locked.

At zero, phones that can vibrate buzz once (iPhones cannot), and a soft chime plays if sound is on in Settings. A web app on an iPhone cannot alert while it is in the background, so check the timer when you come back to the app.

## 5. Finishing a workout

**Finish** on the last movement (or Finish workout in the ⋯ menu) opens the summary: sets done against planned, duration, total volume, any new personal bests, and any movements left unfinished. It also offers:

- **How hard was today?** A 1 to 5 rating.
- **I'm beat up (lighter next block).** Ticking this cancels the next block's extra volume.
- **Note.**

Leaving the app mid-workout without finishing is fine: the session stays open and resumes where it left off.

## 6. Calendar

The calendar has a **Month** view and a **Week** view. Each session day shows its state:

| State | Meaning |
|---|---|
| Planned | Not done yet. |
| Done | Every planned set logged, or the workout was finished. |
| Partial | Some sets logged. |
| Missed | The date has passed with nothing logged. |
| Done late | Logged on a different day from the one planned. |

Days before the app was first used show as not tracked rather than missed. Deload weeks are shaded. Tap a day to open its log (logged sessions stay editable) or, for an upcoming or missed session, to **Preview** it or **Do it today**.

## 7. History

- **By movement:** every movement that has been logged, searchable. Each opens its full history: every session, the best set and an estimated one-rep-max chart over time.
- **By workout:** past workouts, newest first. Tap one to see and edit everything logged in it.

## 8. Library

The library holds every movement in the catalog. Search by name, alias or equipment, or filter by muscle group. Each movement shows photos (most have start and end photos), the muscles it works, its equipment, cues and step-by-step instructions, and can be marked:

- **Favourite:** planned more often.
- **Avoid:** left out of new plans and swaps everywhere.
- **Can't do at the gym** or **at home:** left out only at that place.

Marks apply to plans built after them. To apply them to the rest of the current block straight away, use **Regenerate upcoming workouts** in Settings.

## 9. Settings

- **You:** bodyweight (used for assisted machines), the Smith machine bar weight, kettlebells at home (for example `25x2, 35` for a pair of 25s and one 35), and the core day's scheme: **Light wave** or **Flat**.
- **Rest timer:** on or off, and **No sound** or **Soft chime**. These are saved per device, so a phone and a laptop can differ.
- **My bands (lightest first):** name each band and put them in order from lightest to heaviest.
- **Plan:** the weekly schedule, and **Regenerate upcoming workouts**, which rebuilds the rest of the current block from today and the next block. Logged workouts are kept.
- **Sync:** paste the sync token to connect, see when the device last synced, sync now, or disconnect.
- **Export my data:** **Back up (JSON)** saves everything (logs, plan, settings, bands); **Sets (CSV)** saves the logged sets as a spreadsheet; **Restore from backup** loads a backup file.

When a new version of the app is ready, a bar with an **Update** button appears outside workouts. Otherwise the update installs the next time the app is opened. The app never reloads in the middle of a workout.

## 10. Backups and more than one device

Each device keeps a full copy of the data and works without a connection. When it has signal, it syncs with the server, so a phone at the gym and a browser at home show the same plan and history. If two devices change the same record offline, the most recent change wins when they next sync; two devices logging the same planned set produce one record, not two.

Back up regularly with **Back up (JSON)**. A restore adds whatever is missing from the backup and never removes logged sets, so it is safe to restore onto a device that already has data.

## 11. Limits

- The weekly schedule and the equipment at each place come from the default profile and cannot be changed in the app yet. Weights are in pounds only.
- There is no screen to add a custom movement.
- The core day's supersets are labelled A to D, but each movement still has its own screen.
- get-fit is for one person and their own devices. There are no accounts.
- Running, meal planning and social features are out of scope.
