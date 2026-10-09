# API reference

get-fit exposes two APIs:

| API | What it is | Reference |
|---|---|---|
| `@orca-solutions/get-fit-core` | The TypeScript training engine: domain types, the exercise catalog, the plan generator, progression helpers, the sync protocol, an IndexedDB client (`/client`) and a SQLite sync store (`/sqlite`). The PWA in `apps/web` and the server in `server/` are both built on it. | [core.md](core.md) |
| Sync server | The HTTP API served by `server/` (Hono on Node with SQLite): a health check, one push-and-pull sync endpoint, a JSON export, and static hosting for the built PWA. | [sync-server.md](sync-server.md) |

The core is designed so other applications can build on it: a different front end can use `/client` against the same server, and a server with its own storage can implement the `SyncStore` interface and speak the same sync protocol.

Related documents:

- [../SPEC.md](../SPEC.md): the product, its screens and its data model.
- [../periodization.md](../periodization.md): the training rules the generator implements.
- [../exercise-database.md](../exercise-database.md): where the catalog comes from and how movements are tagged.
- [../DEPLOYMENT.md](../DEPLOYMENT.md): running the server.

## Stability

The package is pre-1.0. Until 1.0, a minor version can change the API, so pin an exact version.

Plans are versioned separately from the code. Every `Block` records the `generatorVersion` (currently `1.2.0`) and the `programId` and `programVersion` of the program that planned it. A change to what `STRANGE_PERIODIZATION` plans bumps that program's `version` (currently `1.1.0`), so a stored block always says which rules produced it.

The sync protocol is shared by every client and server through `SYNC_TABLES` and the types in `protocol.ts`. The server only validates the envelope of each record (`id`, `updatedAt`, `deletedAt`) and stores the rest as given, so clients can add fields without a server change.
