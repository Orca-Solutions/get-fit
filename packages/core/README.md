# @orca-solutions/get-fit-core

The training engine behind [get-fit](https://github.com/Orca-Solutions/get-fit): a curated exercise library, a block-periodization plan generator, progression from logged sets, and offline-first sync. MIT licensed.

## Install

From a GitHub release (each `core-v<version>` release carries the package):

```sh
npm install https://github.com/Orca-Solutions/get-fit/releases/download/core-v0.2.0/orca-solutions-get-fit-core-0.2.0.tgz
```

## Entry points

| Import | What it is | Needs |
|---|---|---|
| `@orca-solutions/get-fit-core` | Types, `CATALOG`, `Program` and `STRANGE_PERIODIZATION`, `generateBlock`, progression, coverage, dates, ids, formatting, the sync protocol and the `SyncStore` interface. Pure TypeScript, runs anywhere. | nothing |
| `@orca-solutions/get-fit-core/client` | The device side: an IndexedDB copy of everything, the plan horizon (`ensurePlan`), logging, backup and restore, and the sync engine. | `dexie` |
| `@orca-solutions/get-fit-core/sqlite` | A `SyncStore` on SQLite for a single-user server. | `better-sqlite3` |

## Plan a block

```ts
import { CATALOG, generateBlock, neutralProfile } from '@orca-solutions/get-fit-core';

const { block, workouts, coverage } = generateBlock({
  profile: neutralProfile(),
  exercises: CATALOG,
  startDate: '2026-10-12', // a Monday
});
```

Pass the previous block as `previousBlock` to chain blocks; it rotates movements and ramps volume. `program` defaults to `STRANGE_PERIODIZATION`, the original program written up in [docs/periodization.md](https://github.com/Orca-Solutions/get-fit/blob/main/docs/periodization.md). A `Program` is data: day templates, zone rotation, reps, sets, effort, rest, weekly set bands and selection scores. `validateProgram` reports anything that would stop one from planning.

## Use the client

```ts
import { configureSync, GetFitDB, setDefaultDb, setDefaultProfile, ensurePlan } from '@orca-solutions/get-fit-core/client';

setDefaultDb(new GetFitDB(`get-fit:${userId}`)); // one database per account
setDefaultProfile(() => profileFromSetup);         // what a new device starts with
configureSync({ baseUrl: 'https://api.example.com', credentials: 'include', headers: () => ({}), onUnauthorized: signIn });
await ensurePlan();
```

Without `headers`, sync sends the bearer token stored with `setSyncToken`.

## Stability

Before 1.0, a minor version can change the API. A change to what `STRANGE_PERIODIZATION` plans bumps its `version`, which every block records.
