# Project brief: get-fit

## Purpose

A single-user workout app: generate a plan in the spirit of AnatolyFit's "strange periodization", log what was actually done set by set, and show the history of the movement in hand. It works offline on a phone and syncs across the user's own devices. It exists because AnatolyFit kept losing workouts to bugs.

## Scope

- Installable PWA, offline-first; each device keeps a full copy of the data.
- Plan generator: 4-week blocks (3 loading weeks and a deload); Mon chest and biceps, Wed legs, Fri back, triceps and shoulders, weekend core at home; heavy/moderate/light rotation, variety slots, grip finishers, per-muscle weekly targets and a coverage check ([docs/periodization.md](docs/periodization.md)).
- Logging: reps placeholder = planned reps in grey; weight blank with a "last time at this rep count" hint and carry-forward; band and stance; timed holds; optional effort tap; rest timer.
- Movement history, calendar (month and week; done, partial, missed, done late), exercise library (186 curated movements, most with photos), settings, JSON and CSV export, restore.
- Sync to one small self-hosted server (Hono and SQLite) with a single secret token.
- The engine as a reusable package, `@orca-solutions/get-fit-core`, released on GitHub.

Out of scope: meal planning, running (runs stay outside the app), accounts, multiple users, social features.

## Acceptance criteria

- Every tap saves on the device immediately; nothing needs the network to log.
- A generated block respects the session sizes (6–8 movements, 12–22 sets) and the weekly muscle floors; the core day covers all 8 dynamics with home equipment only.
- The golden test pins the reference profile's blocks 1 to 8; any change to what the program plans bumps its version.
- Unit tests (golden plans, property tests, generator, progression, sync, server, catalog) and the phone-size end-to-end tests pass in CI.

## Contributing

- Work happens on feature branches and lands through pull requests that pass CI. The maintainer reviews and merges.
- Deployments and secrets (the sync token, hosting variables) are handled by whoever runs the server; nothing secret is ever committed.
