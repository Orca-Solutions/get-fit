# Working record

## Node security proposal (2026-10-23, source only)

- NODE-GF01 branch starts from main `1a0f867e312eb9b9ec451cd727911b09d46d65b2`, separately from feature PR #32. No app merge, provider change, deployment or client activity is included.
- Root engine/lock selection is 22.23.4; dependencies are unchanged. A guard in the actual server entry refuses unsupported Node before data-directory creation, SQLite/epoch work or listening, while allowing later stable 22 patches. Authenticated `/api/runtime` reports only that serving process's version, without database access. Public health and auth-first unknown rotation-check behavior are unchanged.
- Seven focused tests passed: version floor/default process version, mocked startup-before-effects and supported startup, authenticated no-DB metadata, refusal without a token and unchanged rotation-check/health. The five runtime tests were rerun after a TypeScript-only fixture repair; both startup results were reused. Server TypeScript check passes. Local verification used existing Node 26.9.0 and locked dependencies, with explicit synthetic versions for startup tests; this is not actual patched 22 runtime acceptance. Full build/browser suites and live deployment were not rerun here; existing PR CI supplies normal integration checks.
- Review: focused independent review required for startup availability and the authenticated metadata boundary. DevOps/Security review the exact draft before Jason's coordinated merge. The actual Railway builder remains unproven, and neither package selection nor restart/redeploy alone establishes the deployed patch. See [deployment guidance](docs/DEPLOYMENT.md#node-security-release-selection-and-acceptance) and [runtime API](docs/api/sync-server.md#get-apiruntime).

## Current state (2026-10-16)

- The app is complete for a single user: planning, logging, swap and skip, history, calendar, library, settings, export and restore, multi-device sync, the rest timer, in-app updates and a responsive desktop layout. It is maintained for fixes and gets no new features; development continues in the core package.
- The repo is an npm workspace: `packages/core` (the engine), `apps/web` (the PWA) and `server` (the sync server).
- `@orca-solutions/get-fit-core` 0.6.2 (program 1.5.0) is released as the GitHub release `core-v0.6.2` (0.1.0, the first release, stays MIT; 0.2.0 and later are FSL-1.1-MIT).
- Docs: the [user guide](docs/USER_GUIDE.md), [docs/SPEC.md](docs/SPEC.md), [docs/periodization.md](docs/periodization.md), [docs/exercise-database.md](docs/exercise-database.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and the [API reference](docs/api/README.md).

## Verification

- `npm run typecheck` and `npm test`: golden plans for blocks 1 to 8, property tests over random setups, generator, progression, client, sync, server and catalog.
- `npm run test:e2e`: Playwright at iPhone size against the production build (logging, reload, history, rest timer, updates).
- CI runs workflow lint, typecheck, unit tests, the build and the end-to-end suite on every push and pull request.
- Changes get an independent review of the diff before merging.

## Open items

Core (training rules):

- Early deload trigger within a block, and the 10-day-gap load drop ([docs/periodization.md §4.9](docs/periodization.md#49-not-yet-implemented)).
- The finer progression rules and tuning on real logs.
- Weekly targets from block 6 on: Friday runs out of room, so back can dip to 8 in one week, triceps reach 10.5 in one week, and from block 8 rear delts sit at 1.5–2 (target 3–5). Blocks 1 to 5 stay inside every target.

App (known gaps; the app is maintained for fixes, so these are not planned):

- Supersets shown as one screen with alternating rows (the core day currently steps through each movement in order).
- Server-side field checks on synced records (today the server validates only the sync fields).
- Editable schedule and units, and a screen for adding custom movements.
