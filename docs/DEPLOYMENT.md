# Deployment guide

A starting point for whoever runs get-fit in production: how it's built, what it needs, and how we picture rollout and updates. The details are DevOps's call.

**Target:** `https://getfit.orcasolutions.dev`, served by one Railway service, with DNS on Cloudflare.

## What gets deployed

get-fit is an offline-first PWA plus a small sync server, built from this repo as **one service**:

- `npm run build` builds the PWA into `dist/` and the server into `dist-server/`.
- `npm start` runs a Node 22 server (Hono with SQLite) that:
  - serves the PWA from `dist/`
  - handles `POST /api/sync` (push and pull of records)
  - handles `GET /api/export` (a JSON dump of all live records)
  - answers `GET /api/health`, which needs no token.
- Data is one SQLite file, `get-fit.sqlite`, in `DATA_DIR`.
- `railway.json` already sets the build command, start command, health check and restart policy.

Each device (phone, desktop browser) keeps a full copy of the data in IndexedDB and works with no network. The server is the meeting point between devices and an off-device backup. It is not on the critical path of a workout: if it's down, logging carries on and syncs later.

## Recommended topology: one Railway service, no GitHub Pages

```
Phone / desktop ──HTTPS──▶ Cloudflare DNS (getfit.orcasolutions.dev)
                              │ CNAME
                              ▼
                         Railway service (app + /api, same origin)
                              │
                         Railway volume /data (SQLite)
```

**GitHub Pages isn't needed, and we'd advise against it.** The server already serves the app, so the app and the API share one origin. That means:

- **No CORS:** the app calls `/api/sync` with a relative URL, and the server sends no CORS headers.
- **One service worker scope:** the precache and offline fallback cover the whole site.
- **One thing to deploy and roll back:** the app and API versions always match.

Hosting the front end on Pages would split it from the API. That would need code changes (a configurable API URL and CORS with `Authorization` preflights), a second deploy pipeline, and could leave app and API versions out of step. The front end is a few MB of static files, so there's nothing to gain.

## Setup steps

1. **Railway service:** create it from this GitHub repo, with deploys from `main`.
2. **Volume:** add a volume mounted at `/data`.
3. **Variables:**

   | Variable | Value | Notes |
   |---|---|---|
   | `DATA_DIR` | `/data` | Where the SQLite file lives. Must be on the volume. |
   | `SYNC_TOKEN` | at least 32 random characters, e.g. `openssl rand -hex 32` | The only auth, and there's no rate limiting, so its length is the brute-force defence. Never commit it, never reuse a short or memorable one. Each device enters it once in Settings › Sync. |
   | `PORT` | set by Railway | The server listens on it. |
   | `STATIC_DIR` | leave unset | Defaults to `./dist`. |

   Without `SYNC_TOKEN` the app still loads, but `/api/*` answers 503.
4. **Replicas: one.** SQLite on a volume is single-writer. Don't scale horizontally.
5. **Custom domain:** add `getfit.orcasolutions.dev` in Railway. In Cloudflare, create the CNAME (plus any verification TXT record) that Railway shows. Railway issues the TLS certificate.
6. **Cloudflare proxy:** start with **DNS only** (grey cloud), which is the simplest path. If you turn the proxy on for WAF or rate limiting:
   - Set SSL/TLS mode to **Full (strict)**. Flexible causes redirect loops.
   - Don't add "Cache Everything" or HTML caching rules. The service worker update path depends on `index.html`, `sw.js` and the manifest being revalidated (the origin sends `no-cache` for these).
   - Hashed files under `/assets/` are sent `immutable` and are safe to cache.
   - Don't put Cloudflare Access in front of `/api/*`. The app can't complete an interactive login from inside a sync request.
7. **Smoke test:**
   - `GET /api/health` returns `{"ok":true}`.
   - Open the site and enter the token in Settings › Sync. "Connected and synced" should show.

## Use the final domain from day one

Browsers tie IndexedDB, the service worker and the home-screen install to the **origin**. Data saved on `*.up.railway.app` doesn't follow you to `getfit.orcasolutions.dev`.

Install on phones only from the final domain. If a device has already been used on another origin:

1. Sync it there first.
2. Open the new domain and enter the token. The first sync pulls everything from the server.
3. Then remove the old home-screen icon.

## Backups

The server holds the only off-device copy of the workout logs, which can't be recreated. Every synced device also keeps a full copy.

- **Railway volume backups:** turn on scheduled backups for the `/data` volume. Daily is plenty.
- **Off-site export (optional):** a scheduled job can run `curl -H "Authorization: Bearer $SYNC_TOKEN" https://getfit.orcasolutions.dev/api/export` and store the JSON somewhere private. It contains personal data, so treat it as such.
- **In the app:** Settings › Export my data saves a JSON backup, which can be restored from the same screen and never removes sets, or the logged sets as CSV. On an installed iPhone app it opens the share sheet (Save to Files).
- **If the volume is ever lost:** the server starts with a new database id (epoch). Each device notices on its next sync and re-uploads everything it has, so restoring from the devices works too.

## Rollout

- **Flow:** PR, then CI (typecheck, unit tests, build, and Playwright at iPhone size), then merge to `main`, then Railway auto-deploys `main`.
- **Downtime:** a service with a volume restarts on deploy, so expect a few seconds when `/api/sync` is unavailable. The app is offline-first, so users won't notice. Syncs retry on focus, reconnect and every minute.
- **Staging (optional):** a Railway environment or PR environment with **its own volume and its own token**. Never point staging at the production volume.
- **No migrations:** the server stores records as JSON rows keyed by table and id, so there's no server-side schema to migrate.
- **Client data model:** changes ship inside the app as Dexie schema versions on each device. Treat those as forward-only (see Rollback).

## Rollback

- **Server and app:** redeploy the previous successful deployment in Railway. The server stores records as JSON rows, so an older build reads newer data fine.
- **Client caveat:** IndexedDB schema versions can't go backwards on a device. If a release bumps the Dexie schema version, plan for a fix-forward release rather than a rollback of that change.
- **Bad data:** restore the Railway volume backup, then let devices re-sync. The newest write per record wins, so devices fill in anything newer than the backup.

## How updates reach installed phones

- The service worker uses `autoUpdate`. When the app is opened, the browser fetches `sw.js`. If anything changed, the new version installs in the background and takes over on the next launch or reload. Expect one or two launches before a phone shows a new release.
- Releases are atomic per device: the whole app is precached, so a device runs either the old version or the new one, never a mix.
- Keep the API backward compatible for at least one release, because phones may run the previous app version for a while. `/api/sync` already ignores unknown fields and only validates `id`, `updatedAt` and `deletedAt`.

## Security notes

- The repo is public, so **all secrets live in Railway variables only**. Never commit them.
- One bearer token protects `/api/*`. The server compares tokens in constant time, caps request bodies at 5 MB and 5,000 changes, and validates every record (malformed ones are skipped and logged without their contents).
- There's no rate limiting in the app, so the token's length is the defence: at least 32 random characters (`openssl rand -hex 32`).
- Every response carries HSTS, `X-Content-Type-Options: nosniff`, frame and referrer headers.
- **Rotating the token:** change `SYNC_TOKEN` in Railway, then re-enter it on each device. Devices with the old token fail to sync, but keep all their data and upload it once updated.
- **Optional:** Cloudflare rate limiting on `/api/*` and bot protection. These need the proxy on (see step 6).
