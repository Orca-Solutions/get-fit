# Changelog

Notable changes to get-fit. Releases of the core package are tagged `core-v<version>`.

## 2026-10-09

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
