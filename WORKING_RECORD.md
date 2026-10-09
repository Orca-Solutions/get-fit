# Working record

## Current state (2026-10-09)

- The app is complete for a single user: planning, logging, swap and skip, history, calendar, library, settings, export and restore, multi-device sync, the rest timer, in-app updates and a responsive desktop layout.
- The repo is an npm workspace: `packages/core` (the engine), `apps/web` (the PWA) and `server` (the sync server).
- `@orca-solutions/get-fit-core` 0.4.0 is released as the GitHub release `core-v0.4.0` (0.1.0, the first release, stays MIT; 0.2.0 and later are FSL-1.1-MIT).
- Docs: [docs/SPEC.md](docs/SPEC.md), [docs/periodization.md](docs/periodization.md), [docs/exercise-database.md](docs/exercise-database.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and the [API reference](docs/api/README.md).

## Verification

- `npm run typecheck` and `npm test`: golden plans for blocks 1 to 8, property tests over random setups, generator, progression, client, sync, server and catalog.
- `npm run test:e2e`: Playwright at iPhone size against the production build (logging, reload, history, rest timer, updates).
- CI runs workflow lint, typecheck, unit tests, the build and the end-to-end suite on every push and pull request.
- Changes get an independent review of the diff before merging.

## Open items

- Supersets shown as one screen with alternating rows (the core day currently steps through each movement in order).
- Early deload trigger within a block, and the 10-day-gap load drop ([docs/periodization.md §4.8](docs/periodization.md#48-not-yet-implemented)).
- The finer progression rules and tuning on real logs.
- Weekly targets from block 6 on: Friday runs out of room, so back can dip to 8 in one week, triceps reach 10.5 in one week, and from block 8 rear delts sit at 1.5–2 (target 3–5). Blocks 1 to 5 stay inside every target.
- Server-side field checks on synced records (today the server validates only the sync fields).
- Editable schedule and units, and a screen for adding custom movements.
