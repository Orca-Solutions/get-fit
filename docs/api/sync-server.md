# Sync server HTTP API

The server in `server/` is a small Hono app on Node. It stores every synced record for one person in a SQLite file (through `@orca-solutions/get-fit-core/sqlite`), exposes one push-and-pull sync endpoint, a health check and a JSON export, and serves the built PWA from the same origin.

- Source: `server/app.ts` (routes, `createApp`) and `server/index.ts` (process entry point).
- Record shapes: [core.md](core.md#domain-types). Shared protocol types: [core.md](core.md#sync-protocol-and-syncstore).
- Hosting, backups and rollback: [../DEPLOYMENT.md](../DEPLOYMENT.md). Product context: [../SPEC.md](../SPEC.md).

## Contents

- [Configuration](#configuration)
- [Authentication](#authentication)
- [Endpoints](#endpoints)
- [`POST /api/sync`](#post-apisync)
- [Epochs and resets](#epochs-and-resets)
- [Errors](#errors)
- [Worked example](#worked-example)
- [Writing a client](#writing-a-client)
- [Static files](#static-files)
- [Security headers](#security-headers)
- [Embedding the app](#embedding-the-app)

## Configuration

`server/index.ts` reads these environment variables at startup:

| Variable | Default | Effect |
|---|---|---|
| `PORT` | `3000` | Port to listen on. |
| `DATA_DIR` | `./data` | Directory for the database file `get-fit.sqlite`; created if missing. Resolved against the working directory. |
| `STATIC_DIR` | `./dist` | Built PWA to serve. Resolved against the working directory. |
| `SYNC_TOKEN` | unset | Shared secret for the API (trimmed). Unset or blank: every `/api/*` route except `/api/health` answers 503. |
| `SYNC_EPOCH_RESET` | unset | Any new value starts a new sync epoch once, at startup (see [Epochs and resets](#epochs-and-resets)). The value is remembered in the database, so restarting with the same value does nothing. |

The process closes the HTTP server and the database on `SIGINT` and `SIGTERM`.

Limits, from `server/app.ts`:

| Constant | Value | Applies to |
|---|---|---|
| `MAX_BODY_BYTES` | 5 MiB (5 × 1024 × 1024 bytes) | `POST /api/sync` request body |
| `MAX_CHANGES` | 5000 | `changes` per request |
| `pageSize` | 2000 (`createApp` option) | Records per pull response |

There is no rate limiting and no CORS handling: the API expects the app on the same origin.

## Authentication

Every `/api/*` route except `GET /api/health` requires:

```http
Authorization: Bearer <SYNC_TOKEN>
```

- The scheme is matched case-insensitively; the token is everything after the whitespace that follows it.
- The token is compared in constant time: both values are hashed with SHA-256 and the digests compared with `crypto.timingSafeEqual`, so neither the content nor the length leaks through timing.
- No token configured on the server: `503` with `{ "error": "Sync is not configured on the server: set the SYNC_TOKEN environment variable." }`.
- Missing, malformed or wrong token: `401` with `{ "error": "Invalid or missing sync token." }`.

Authentication runs before routing within `/api/*`, so an unknown API path answers 401 or 503 rather than 404 when the request isn't authorised.

## Endpoints

| Method and path | Auth | Description |
|---|---|---|
| `GET /api/health` | none | Liveness check. Always `200 { "ok": true }`, even without a configured token. |
| `POST /api/sync` | Bearer | Push changes and pull everything stored since a cursor. See below. |
| `GET /api/export` | Bearer | Every non-deleted record, grouped by table. |
| any other `/api/*` | Bearer | `404 { "error": "Not found." }` |
| `GET` anything else | none | Static files from `STATIC_DIR`, with an SPA fallback. See [Static files](#static-files). |

### `GET /api/export`

```json
{
  "exportedAt": "2026-10-14T18:00:00.000Z",
  "tables": {
    "profile": [],
    "blocks": [],
    "plannedWorkouts": [],
    "sessions": [],
    "loggedSets": [ { "id": "...", "updatedAt": "...", "...": "..." } ],
    "exerciseFlags": [],
    "customExercises": []
  }
}
```

Every table in `SYNC_TABLES` is present. Records are returned exactly as they were pushed, ordered by table and id; soft-deleted records are left out. The `/client` function `importAll` accepts this document as a backup (it has no `app` field, which `importAll` treats as acceptable).

## `POST /api/sync`

One request both pushes and pulls. The server stores the pushed changes first, then returns the next page of records stored after the client's cursor.

### Request body

```ts
{
  cursor?: number;        // last seq the client pulled; default 0
  cursorKey?: CursorKey;  // the last record the client pulled: { table, id, updatedAt }
  epoch?: string;         // the server epoch the client last saw
  changes?: Change[];     // records to store; default []
}
// Change = { table: SyncTable; record: { id: string; updatedAt: string; deletedAt?: string | null; ...any other fields } }
```

| Field | Rule | When it fails |
|---|---|---|
| body | A JSON object. (A JSON array passes this check and reads as an empty request.) | Not JSON: 400 `Body must be valid JSON.`; `null` or a primitive: 400 `body must be a JSON object`. |
| `cursor` | A safe non-negative integer. Default `0`. | 400 `cursor must be a non-negative integer` |
| `changes` | An array of at most `MAX_CHANGES` (5000). Default `[]`. | 400 `changes must be an array` or `too many changes (max 5000 per request)` |
| `cursorKey` | `table` and `id` strings and an ISO `updatedAt`. | Ignored (treated as absent). |
| `epoch` | A string. | Ignored (treated as absent). |

Other top-level fields are ignored.

### Validation

Each change is checked on its own. A malformed change is **skipped and counted** in the response's `rejected`, not fatal: rejecting the whole batch would make the device resend it, and fail, forever. The server logs the first three reasons.

| Check | Reason logged |
|---|---|
| `table` is one of `profile`, `blocks`, `plannedWorkouts`, `sessions`, `loggedSets`, `exerciseFlags`, `customExercises` | `unknown table "<table>"` |
| `record` is an object (not an array) | `record must be an object` |
| `record.id` is a non-empty string of at most 200 characters | `record.id must be a non-empty string` |
| `record.updatedAt` is an ISO 8601 date-time with a time zone (`YYYY-MM-DDTHH:MM[:SS[.fff]]` then `Z` or `±HH:MM`) that parses | `record.updatedAt must be an ISO date string` |
| `record.deletedAt` is absent, `null`, or such a date-time | `record.deletedAt must be an ISO date string or null` |

Nothing else about a record is checked: the server stores the whole record as JSON, unknown fields included. Shape checks for the app's screens (`validRow` in the core) run on the clients, on upload and on pull.

### Storage rules (last write wins)

- A change is stored only when no record with the same `table` and `id` exists, or its `updatedAt` is **strictly newer** than the stored one. Timestamps are compared after normalising to UTC (`new Date(updatedAt).toISOString()`). An equal or older version is dropped silently: it counts as neither accepted nor rejected.
- Changes in one request are applied in order, in one transaction.
- Each stored change gets the next sequence number (`seq`), so a record that changes moves to the end of the pull order. Each record appears in the log once, at its latest `seq`.
- Deletes are soft: a record with `deletedAt` is stored and pulled like any other version. The server never removes a record.
- Records from different tables never collide: the key is `(table, id)`.

### Response body

`200` with:

| Field | Type | Description |
|---|---|---|
| `cursor` | `number` | `seq` of the last record in this page, or the cursor the page started from when it is empty. Send it back as `cursor`. |
| `cursorKey` | `CursorKey` | `{ table, id, updatedAt }` of the last record in this page. Omitted when the page is empty; keep the previous one. |
| `epoch` | `string` | The server's current epoch. |
| `more` | `boolean` | More records remain after this page; request again with the new cursor. |
| `reset` | `boolean` | The server found it had lost data and started a new epoch during this request (see below). |
| `accepted` | `number` | Changes from this request that were stored. |
| `rejected` | `number` | Changes from this request skipped as malformed. |
| `changes` | `Change[]` | Records with `seq` greater than the starting cursor, oldest first, at most `pageSize`. Records stored by this same request are left out (the client already has them), though they still count toward the page and the cursor moves past them. |

## Epochs and resets

The epoch is a random id for the server's database. A new epoch tells every device that the server's history has changed: each must forget its cursor, pull everything from cursor 0, and push every record it holds, so that whatever the server lost is restored from the devices.

The server starts a new epoch when:

1. **A request shows the server is behind**, and the request's `epoch` is absent or equal to the current one:
   - its `cursor` is greater than the highest `seq` stored (the database was wiped or replaced), or
   - its `cursor` is greater than 0 and the server no longer has the `cursorKey` record at that `updatedAt` or newer (the database was restored from an older backup).

   The server rotates the epoch, stores the request's changes, pulls from cursor 0, and answers with `reset: true` and the new `epoch`.
2. **`SYNC_EPOCH_RESET` changes** (checked at startup, via `resetEpochOnce`). Use this after a planned restore, so every device re-syncs even before one of them notices the gap.
3. **The database file is new.** A fresh file gets a fresh epoch.

A request that carries an older epoch never triggers a reset: that device is about to re-sync anyway, so its cursor proves nothing. The server answers normally with its current epoch (and an empty page if the cursor is past the end).

What a client must do:

- Store the `epoch` from every response.
- When a response's `epoch` differs from the stored one, discard that response, reset `cursor` to 0 and `cursorKey` to none, and sync again with every local record queued for push.
- When `reset` is `true`, the response already starts from cursor 0: apply it, then push every local record.

## Errors

All API errors are JSON objects with a single `error` string.

| Status | When | Body |
|---|---|---|
| 400 | Body is not valid JSON | `{ "error": "Body must be valid JSON." }` |
| 400 | Body is `null` or not an object | `{ "error": "body must be a JSON object" }` |
| 400 | Bad `cursor` | `{ "error": "cursor must be a non-negative integer" }` |
| 400 | `changes` not an array | `{ "error": "changes must be an array" }` |
| 400 | More than 5000 changes | `{ "error": "too many changes (max 5000 per request)" }` |
| 401 | Missing or wrong bearer token | `{ "error": "Invalid or missing sync token." }` |
| 404 | Unknown `/api/*` route or method (after authentication) | `{ "error": "Not found." }` |
| 413 | Sync body over 5 MiB | `{ "error": "Request body too large." }` |
| 503 | `SYNC_TOKEN` not configured | `{ "error": "Sync is not configured on the server: set the SYNC_TOKEN environment variable." }` |

Malformed individual changes are not errors; see [Validation](#validation). An unexpected server failure returns Hono's default `500` plain-text response.

## Worked example

Device A has already pushed the first set of a squat. Device B logs the second set and syncs for the first time on this epoch, from cursor 0. Its batch also contains one damaged record.

```http
POST /api/sync HTTP/1.1
Authorization: Bearer <SYNC_TOKEN>
Content-Type: application/json
```

```json
{
  "cursor": 0,
  "epoch": "5c5e7442-795c-4aa8-9982-375a57aa2b74",
  "changes": [
    {
      "table": "loggedSets",
      "record": {
        "id": "s-w-2026-10-14-legs|w-2026-10-14-legs-0|smith-machine-squat|1",
        "createdAt": "2026-10-14T17:08:40.000Z",
        "updatedAt": "2026-10-14T17:08:40.000Z",
        "deletedAt": null,
        "sessionId": "s-w-2026-10-14-legs",
        "exerciseId": "smith-machine-squat",
        "plannedExerciseId": "w-2026-10-14-legs-0",
        "setIndex": 1,
        "weight": 95,
        "reps": 8,
        "effort": "right",
        "date": "2026-10-14",
        "loggedAt": "2026-10-14T17:08:40.000Z"
      }
    },
    { "table": "loggedSets", "record": { "id": "", "updatedAt": "yesterday" } }
  ]
}
```

Response (`200`):

```json
{
  "cursor": 2,
  "cursorKey": {
    "table": "loggedSets",
    "id": "s-w-2026-10-14-legs|w-2026-10-14-legs-0|smith-machine-squat|1",
    "updatedAt": "2026-10-14T17:08:40.000Z"
  },
  "epoch": "5c5e7442-795c-4aa8-9982-375a57aa2b74",
  "more": false,
  "reset": false,
  "accepted": 1,
  "rejected": 1,
  "changes": [
    {
      "table": "loggedSets",
      "record": {
        "id": "s-w-2026-10-14-legs|w-2026-10-14-legs-0|smith-machine-squat|0",
        "createdAt": "2026-10-14T17:05:12.000Z",
        "updatedAt": "2026-10-14T17:05:12.000Z",
        "deletedAt": null,
        "sessionId": "s-w-2026-10-14-legs",
        "exerciseId": "smith-machine-squat",
        "plannedExerciseId": "w-2026-10-14-legs-0",
        "setIndex": 0,
        "weight": 90,
        "reps": 8,
        "effort": "right",
        "date": "2026-10-14",
        "loggedAt": "2026-10-14T17:05:12.000Z"
      }
    }
  ]
}
```

The new set was stored at `seq` 2 (`accepted: 1`) and the damaged record skipped (`rejected: 1`). The page holds `seq` 1 (device A's set) and `seq` 2, but only device A's set is returned, because B sent `seq` 2 itself. `cursor` and `cursorKey` point at `seq` 2, so B's next request starts after its own write.

## Writing a client

The `/client` entry point of the core implements all of this (see [core.md](core.md#sync-engine)). A client written from scratch needs this loop:

1. Keep `cursor` (start at 0), `cursorKey`, `epoch` and a push watermark in local storage.
2. Collect every local record (soft-deleted ones included) changed since the watermark. Send them in batches, with `cursor`, `cursorKey` and `epoch`, in one `POST /api/sync` per batch; send `changes: []` when there's nothing left to push.
3. For each response:
   - If `epoch` differs from the stored one, store it, set `cursor` to 0, clear `cursorKey`, queue every local record, and continue from step 2 without applying the response.
   - Otherwise apply `changes`: keep a pulled record only if it is newer than the local copy (by `updatedAt`), or merge it with application-specific rules. Then store `cursor` and, when present, `cursorKey`.
   - If `reset` is true, queue every local record for push.
4. Repeat while records remain to push or `more` is true.
5. After success, move the push watermark to the time the sync started (less a margin for clock skew and writes made during the sync; re-pushing a record is harmless, because an equal `updatedAt` is ignored).

Keep batches under 5000 changes and 5 MiB; the core client sends 500 per request. Records need an `id` and an ISO `updatedAt`; give every write a fresh `updatedAt`, since the server only stores strictly newer versions.

## Static files

Only when `staticDir` is set, which `server/index.ts` always does (`STATIC_DIR`, default `./dist`):

- `GET` requests outside `/api/*` are served from that directory.
- A path whose last segment has no `.` (a client-side route such as `/calendar`) that matches no file gets `index.html`. A missing path with an extension (e.g. `/missing.js`) stays 404.
- Cache headers on every file served:

| File | `Cache-Control` |
|---|---|
| Under an `assets/` directory (hashed build output) | `public, max-age=31536000, immutable` |
| Everything else (`index.html`, the service worker, the manifest, icons, the SPA fallback) | `no-cache` |

## Security headers

Every response, API and static, carries Hono's `secureHeaders` defaults with no Content Security Policy (the app is entirely same-origin) and no `Cross-Origin-Embedder-Policy`:

| Header | Value |
|---|---|
| `Strict-Transport-Security` | `max-age=15552000; includeSubDomains` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `SAMEORIGIN` |
| `Referrer-Policy` | `no-referrer` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-origin` |
| `Origin-Agent-Cluster` | `?1` |
| `X-DNS-Prefetch-Control` | `off` |
| `X-Download-Options` | `noopen` |
| `X-Permitted-Cross-Domain-Policies` | `none` |
| `X-XSS-Protection` | `0` |

`X-Powered-By` is removed. Values are those of the Hono version in `package-lock.json` (4.13).

## Embedding the app

`server/app.ts` exports the app factory and the limits, for tests or a custom entry point:

```ts
import { openSqliteStore } from '@orca-solutions/get-fit-core/sqlite';
import { createApp } from './app.js';

const app = createApp({ db: openSqliteStore(':memory:'), token: 'test-token', pageSize: 100 });
const res = await app.request('/api/sync', {
  method: 'POST',
  headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
  body: JSON.stringify({ cursor: 0, changes: [] }),
});
console.log(res.status, await res.json());
```

`AppOptions`:

| Field | Type | Description |
|---|---|---|
| `db` | `SqliteStore` | From `openSqliteStore()`. |
| `token` | `string` (optional) | Shared secret. Missing: the API answers 503; static files are still served. |
| `staticDir` | `string` (optional) | Built PWA to serve. Omit to serve the API only. |
| `pageSize` | `number` (optional) | Max records per pull response; default 2000. |

The module also exports `MAX_BODY_BYTES` and `MAX_CHANGES`.

`createApp` returns a Hono app; `app.fetch` is a standard fetch handler and `app.request(path, init)` drives it in tests without a network. The server workspace (`@get-fit/server`) is not packaged for reuse: another server implements the protocol above against its own `SyncStore` (see [core.md](core.md#syncstore)).
