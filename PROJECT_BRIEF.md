# Project brief: get-fit

## Purpose

A personal, single-user workout app for one iPhone: generate a plan in the spirit of AnatolyFit's "strange periodization", log what was actually done set by set, and show the history of the movement in hand. Built because AnatolyFit kept losing workouts to bugs.

## Approved scope (v1)

- Installable PWA, offline-first; the phone is the source of truth.
- Plan generator: 4-week blocks (3 loading + deload); Mon legs, Wed chest and biceps, Fri back, triceps and shoulders, weekend core at home; heavy/moderate/light rotation, variety slots, grip finishers, focus muscle, coverage check (docs/periodization.md).
- Logging: reps placeholder = planned reps in grey; weight blank with "last time at this rep count" hint and carry-forward; band level + steps; timed holds.
- Movement history, calendar (month/week, done/partial/missed/done-late), exercise library (~150 curated movements with photos), settings, JSON export/import.
- Sync to one Railway service (Hono + SQLite) with a single secret token.

Out of scope: meal planning, running (the daily 2-mile run stays outside the app), accounts, social, rest timer (deferred to polish).

## Acceptance criteria

- Every tap saves on the device immediately; nothing needs the network to log.
- A generated block respects the session sizes (6–8 movements, 12–22 sets) and the weekly muscle floors; the core day covers all 8 dynamics with home equipment only.
- Unit tests (generator, progression, sync, server, catalog) and the phone-size end-to-end test pass in CI.

## Permissions

- Coding agents work on feature branches and open draft PRs; jason merges.
- Deploying to Railway and creating the sync token are jason's steps.
