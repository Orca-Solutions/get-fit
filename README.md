# get-fit

A workout planner and logger for the gym. It generates a training plan in 4-week blocks, logs what was actually lifted set by set, and shows the history of the movement in hand. It works offline on a phone and syncs between devices through a small self-hosted server.

get-fit is a single-user app: one person, any number of their own devices, no accounts. Meal planning, running and social features are out of scope.

## Background

get-fit began as a replacement for AnatolyFit, a subscription workout app whose "strange periodization" was worth keeping but whose bugs kept losing workouts. The project writes that training method down as explicit, tested rules and wraps it in an app that does three things reliably: say what to do today, record what was actually done (which is often not what the plan said), and show how that movement has gone before.

get-fit is independent and not affiliated with AnatolyFit. The training rules, with their sources, are in [docs/periodization.md](docs/periodization.md).

## Principles

- Never lose a logged set. Every tap saves on the device immediately.
- Work offline. The gym's Wi-Fi is not a dependency.
- The plan is a suggestion; the log is the truth.
- Small, tested, and boring in the best way.
- The data belongs to the user: plain JSON that can be exported and restored at any time.

## Features

- **Today:** the day's generated workout with a one-line reason for its shape, set progress, and a jump into logging. Rest days show the next session; missed sessions from the current week can be made up with **Do it today**.
- **Logging:** one screen per movement. Reps show the plan in grey and typing replaces them; weight starts blank, with "last time at this rep count" above it, and carries forward to later sets. ✓ logs whatever is grey. Band movements log the band and steps from the anchor; holds log seconds. An optional Easy / Right / Hard tap per movement feeds progression. The movement's history sits right below.
- **Rest timer:** logging a set starts a countdown sized to that set (longer after heavy compounds, shorter for isolation, grip and core work), with −30 / +30 and tap to dismiss.
- **Swap and skip:** replace a movement with one that fills the same slot or trains the same muscles with the equipment where that day happens, or skip it. Logs record what was actually done.
- **Plan generator:** 4-week blocks (3 loading weeks and a deload), always planned one block ahead; a block planned ahead is refreshed from the latest logs on its first day. The default week is Monday chest and biceps, Wednesday legs, Friday back, triceps and shoulders, and a weekend core day at home. Each lifting day rotates heavy, moderate and light; the main lifts get at least 3 sets every loading day, and moderate and light days add a variety movement and a grip finisher; weekly sets per muscle are balanced against target bands. With a barbell and rack listed, the barbell squat, bench, overhead press and row are the main lifts from the first block. The rules are in [docs/periodization.md](docs/periodization.md) and the code in [packages/core](packages/core).
- **Calendar:** month and week views with done, partial, missed and done-late states, and deload weeks shaded.
- **History and library:** per-movement history with an estimated-1RM trend, and a library of 186 curated movements, most with start and end photos, including an optional barbell and EZ-bar pack that's planned only when the gym's equipment lists that gear. Movements can be marked Favourite, Avoid, or Can't do at the gym or at home, and the generator respects those marks.
- **Sync and backup:** each device keeps a full offline copy and syncs with the server whenever it has signal, so a phone and a desktop browser share one plan and history. Settings › Export my data saves a full JSON backup (restorable, and a restore never removes sets) or the logged sets as CSV.
- **Updates:** a new release installs in the background and takes over on the next launch, or straight away with the **Update** button. The app never reloads a screen mid-workout.

## Stack

Vite, React and TypeScript as an installable PWA; Dexie (IndexedDB) for the on-device copy; a Hono and SQLite server that serves the app and the sync API. One Node process runs it all.

The repo is an npm workspace:

| Path | What it is |
|---|---|
| [`packages/core`](packages/core) | The engine, `@orca-solutions/get-fit-core`: the exercise catalog, the plan generator and the `Program` it follows, progression, the on-device database and sync engine, and the SQLite sync store. Usable by other apps; see its [README](packages/core/README.md). |
| `apps/web` | The PWA. |
| `server` | The sync server, which also serves the built app. |
| `e2e` | Playwright tests against the production build. |

## Develop

Requires Node 22.

```sh
npm install
npm run dev          # app on http://localhost:5173 (proxies /api to :3000)
npm test             # unit tests: golden plans, generator, progression, sync, server, catalog
npm run typecheck
npm run sample       # print a generated block as Markdown
npm run build && SYNC_TOKEN=$(openssl rand -hex 32) npm start   # production build on http://localhost:3000
npm run test:e2e     # Playwright at iPhone size against the production build
```

The exercise catalog is generated: edit `packages/core/scripts/curation.ts`, then `npm run build:exercises` rebuilds `packages/core/src/data/exercises.json` and the photos in `apps/web/public/exercises/`. See [docs/exercise-database.md](docs/exercise-database.md).

`packages/core/tests/golden.test.ts` pins the exact plans for blocks 1 to 8 of the reference profile. A change to the training rules fails it on purpose: if the change is intended, bump the program's `version` and refresh the pins with `GOLDEN_UPDATE=1 npx vitest run packages/core/tests/golden.test.ts`.

CI (`.github/workflows/ci.yml`) runs typecheck, unit tests, the build and the Playwright suite on every push and pull request.

## Using the core package

The engine is released as a tarball attached to a GitHub release named `core-v<version>`, and installs by URL:

```sh
npm install https://github.com/Orca-Solutions/get-fit/releases/download/core-v0.2.0/orca-solutions-get-fit-core-0.2.0.tgz
```

To cut a release: bump `version` in `packages/core/package.json`, merge, then run the **Release core** workflow on `main` from the Actions tab (or push a tag `core-v<version>`). The workflow tests the workspace, packs the package and creates the release.

API reference: [docs/api/core.md](docs/api/core.md).

## Deploy

One service from this repo: build with `npm run build`, start with `npm start`, give it a persistent volume, and set:

- `DATA_DIR`: a directory on the volume, for example `/data`.
- `SYNC_TOKEN`: at least 32 random characters, for example from `openssl rand -hex 32`. It is the only protection on the API (there is no rate limiting), so never use a short or memorable one. The same token goes into Settings › Sync on each device.

`railway.json` configures this for Railway, but any host that runs Node 22 with a persistent disk works. On an iPhone, open the site in Safari and use Share › Add to Home Screen. Domains, backups, rollout and updates are covered in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), and the server's HTTP API in [docs/api/sync-server.md](docs/api/sync-server.md).

## Documentation

See [docs/README.md](docs/README.md) for the full index: the product spec, the training rules, the exercise catalog, deployment and the API reference.

## Credits

Exercise instructions and photos for 139 movements come from [free-exercise-db](https://github.com/yuhonas/free-exercise-db). free-exercise-db releases its data under the Unlicense, but its upstream project, [wrkout/exercises.json](https://github.com/wrkout/exercises.json), says the photos were collected from the internet, that it does not own their copyright, and that they should not be used in commercial projects. The photos and instruction text therefore have no known license; see [docs/exercise-database.md §8](docs/exercise-database.md#8-licensing-notes). Tags, cues, the curated selection and the 47 movements written for this project are this project's own.

## License

get-fit is source-available under the [Functional Source License, Version 1.1, MIT Future License](LICENSE) (FSL-1.1-MIT). The code may be used, modified and shared for any purpose other than a competing commercial product or service, and each release becomes available under the MIT license two years after it is published. Code published before the change to FSL, including core-v0.1.0, remains available under MIT.
