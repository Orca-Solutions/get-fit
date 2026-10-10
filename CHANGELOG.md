# Changelog

Notable changes to get-fit. Releases of the core package are tagged `core-v<version>`.

## 2026-10-10

- **Program 1.4.0** (core 0.5.0, not yet released):
  - **Romanian deadlift twice per block:** leg day runs it on its heavy and moderate weeks; the light week and the deload take a back extension, hip thrust or cable pull-through instead.
  - **Friday deadlift:** a 3-set deadlift takes the second row's place on Friday's heavy week, and on its moderate week only when every muscle stays inside its target. Dumbbells come first, then the Smith machine once the dumbbell deadlift is outgrown; a barbell or sumo deadlift is planned only when marked Favourite. Avoiding every deadlift keeps the row every week. Its suggested weight comes from its latest e1RM (`e1rmLoadHint`).
  - **Sumo squats:** leg day's slot 3 alternates by block between single-leg work and a sumo squat (dumbbell, then Smith, kettlebell at home), with the leg press and hack squat first in line for the variety slot in sumo blocks.
  - **Counting:** squats, lunges, the leg press and the hack squat count half toward glutes/hamstrings, and the deadlift half toward back. Lower back is tracked (target 3–5, floor 2), and the core day's hip-extension work counts toward it.
  - **Decline presses:** Smith machine and dumbbell decline presses join Monday's chest press variants where a place lists the new `decline-bench` equipment. The barbell decline bench press needs one too.
  - **Two-sided presses:** main press slots skip free-standing one-arm presses, so the shoulder press moves from the Smith overhead press to the seated dumbbell press at block 4.
  - **API:** `BaseSlot` gains `alternateLaterality`, `stepUp` and `swap`; `GeneratorInput` gains `outgrown`; new `isOutgrown`, `e1rmLoadHint` and `swapSlotKeys`; new coverage group `lower-back` and catalog slot `back:deadlift`. The catalog is 220 movements.

## 2026-10-09

- **core-v0.4.0:** released with program 1.3.0 and everything from program 1.2.0 below (0.3.0 was never released on its own).
- **Program 1.3.0** (core-v0.4.0): every catalog entry has instructions written for this project, and none use free-exercise-db's text. Every entry is `FSL-1.1-MIT`, and the 139 with free-exercise-db photos carry `imageLicense: 'unverified'`. A 29-movement home pack of kettlebell, band and bodyweight movements (tagged `home-pack`) fills every lifting slot for a home-only kit; it is picked only when nothing that fits a slot needs gym equipment, so gym plans are unchanged. The catalog is 215 movements.
- **Program 1.2.0** (core 0.3.0, first released in core-v0.4.0): the main lifts keep at least 3 sets on every loading day, light days take one variety movement instead of two, balancing no longer trims the base compounds, and the quads and chest targets rise to 9–12 and triceps to 7–10. With a barbell and rack, the barbell squat, bench, overhead press and row are the main lifts from block 1; the hinge stays a dumbbell Romanian deadlift. `GeneratedBlock.unfilledSlots` lists the slots a block leaves out.
- The docs no longer call free-exercise-db's photos and instruction text public domain: its upstream project says the photos were scraped and are not for commercial use, so they have no known license.
- **core-v0.2.0:** second release of `@orca-solutions/get-fit-core` and the first under FSL-1.1-MIT, with everything below that came after core-v0.1.0, including the barbell pack.
- **core-v0.1.0:** first release of `@orca-solutions/get-fit-core`, attached to its GitHub release as an installable tarball.
- The repo is now an npm workspace: the engine in `packages/core`, the app in `apps/web` and the sync server in `server`. The training program is data (`Program`, with `STRANGE_PERIODIZATION` as the original), and a golden test pins the reference profile's blocks 1 to 8.
- Property tests run the generator over 300 random setups.
- The generator plans around thin equipment (for example dumbbells only, or a home kit only) instead of failing: a slot nothing fits takes a related movement or is left out, and the block's rationale says so. Two bodyweight movements fill common gaps: Bodyweight Split Squat and Single-Leg Calf Raise.
- The sync server rejects a JSON array as a request body, and a device that signs in with cookies or headers counts as connected when restoring a backup.
- The client can keep one database per account and sign in to a server with custom headers or cookies.
- CI lints workflow files.
- Rest timer on the workout screen: a large count and a thin bar in the thumb zone, −30 / +30, tap to dismiss, optional chime.
- Documentation refreshed, with a new API reference for the core package and the sync server.
- **License:** new work is source-available under FSL-1.1-MIT, which converts to MIT two years after each release. core-v0.1.0 and earlier stay MIT.
- **Barbell pack:** 28 free-barbell and EZ-bar movements (squats, deadlifts, bench and overhead presses, rows, curls, skull crushers and more), with new equipment tags `barbell`, `ez-bar` and `rack` and load types `barbell` and `ez-bar`. They're planned only where the profile lists that gear. With a barbell, the barbell lifts take over the primary slot as it rotates, while block 1 keeps the Smith starters (program 1.1.0). Plans for a gym without a barbell are unchanged.
- `generateBlock` validates a program passed to it and throws its errors, and the notice for an empty slot says when the movements that fit are already on that day.
- The workout screen shows a message for a day with no movements instead of failing, and the sync token and status functions use the database `configureSync` names.

## 2026-10-08

- New weekly split: Monday chest and biceps, Wednesday legs, Friday back, triceps and shoulders.
- Per-muscle weekly set targets replace the rotating focus muscle.
- The next block is planned ahead and refreshed from the latest logs on its first day.
- Export my data: JSON backup, logged sets as CSV, and merge-only restore.
- Multi-device sync fixes: a new device joins the server's plan, the same set logged on two devices stays one record, and a server restored from backup re-syncs every device.
- Desktop layout: sidebar navigation, two-column workout and calendar, Enter to log a set.
- Deployment guide.

## 2026-10-07

- First version: today, logging, history, calendar, library and settings; the plan generator; a curated catalog of about 150 movements with photos; the sync server; CI.
