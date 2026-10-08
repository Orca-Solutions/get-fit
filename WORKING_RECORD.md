# Working record

## Current state (2026-10-07)

- Planning docs: docs/SPEC.md, docs/periodization.md, docs/exercise-database.md.
- v1 build (PR #1): app, generator, catalog, sync server, CI, Railway config.
- Sample generated block shared with jason for review (the one checkpoint before polish).

## Verification

- `npm test`: generator, progression, sync, server and catalog unit tests.
- `npm run test:e2e`: Playwright at iPhone size against the production build (log sets, reload, history; calendar; sync connect).
- An independent review pass of the diff before marking the PR ready.

## Open items (polish pass)

- Rest timer.
- Supersets shown as one screen with alternating rows (core day currently steps through each movement in order).
- Early deload trigger within a block; 10-day-gap load drop in the weight hint.
- Progression tuning on real logs.
- Weekly targets from block 6 on: Friday runs out of room, so back can dip to 8 in one week, triceps reach 10.5 in one week, and from block 8 rear delts sit at 1.5–2 (target 3–5). Blocks 1–5 stay inside every target.
