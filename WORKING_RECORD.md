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
- Pre-generate the next block during the deload week so the calendar shows it ahead of time.
