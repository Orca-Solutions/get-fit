# get-fit

A personal workout planner and logger. One user (me), one phone, no accounts, no meal plans.

## Why this exists

I liked AnatolyFit. Specifically, I liked its "strange periodization": the idea that you don't hit the same muscles the same way every week, but keep changing the angle, the rep range and the load so your body never settles into a rut. It made training feel less like a spreadsheet and more like a plan with a point of view.

What I didn't like was losing workouts to bugs. After enough sessions where the app got in the way of the training, I decided to build my own version that does the one thing I need, reliably: tell me what to do today, let me log what I actually did (which is often not what the plan said), and show me how that movement has gone before.

This project is not affiliated with AnatolyFit. It's an independent, from-scratch take on the training ideas that drew me to it, built for an audience of one.

## Principles

- Never lose a logged set. Everything saves the moment you tap it.
- Works offline. The gym's Wi-Fi is not a dependency.
- The plan is a suggestion; the log is the truth.
- Small, tested, and boring in the best way.
- Your data is plain JSON you can take anywhere.

## What it does

- **Today:** the day's generated workout with a one-line reason for its shape, progress, and a jump into logging.
- **Logging:** one screen per movement. Reps show the plan in grey and typing replaces them; weight starts blank with "last time at this rep count" above it, and carries forward to later sets. ✓ logs whatever is grey. Band movements log band and steps from the anchor; holds log seconds. History for the movement sits right below.
- **Plan generator:** 4-week blocks (3 loading weeks and a deload), always planned one block ahead; a block planned ahead is refreshed from your latest logs on its first day. Mon chest and biceps, Wed legs, Fri back, triceps and shoulders, weekend core at home. Each lifting day rotates heavy, moderate and light; lighter days add variety movements and a grip finisher. The rules are written down in [docs/periodization.md](docs/periodization.md) and implemented in [src/generator](src/generator).
- **Calendar:** month and week views with done, partial, missed and done-late states, deload weeks shaded.
- **History and library:** per-movement history with an estimated-1RM trend; about 130 curated movements with start/end photos.
- **Sync:** each device keeps a full offline copy and syncs to a small server when it has signal, so the phone and a desktop browser share one plan and history. Settings › Export my data saves a full JSON backup (restorable, never removes sets) or your logged sets as CSV.

## Stack

Vite, React and TypeScript as an installable PWA; Dexie (IndexedDB) on the phone; a Hono + SQLite server that serves the app and `/api/sync`. One Railway service runs it all.

## Develop

```sh
npm install
npm run dev          # app on http://localhost:5173 (proxies /api to :3000)
npm test             # unit tests: generator, progression, sync, server, catalog
npm run typecheck
npm run sample       # print a generated block as Markdown
npm run build && SYNC_TOKEN=dev npm start   # production build on http://localhost:3000
npm run test:e2e     # Playwright at iPhone size against the production build
```

The exercise catalog is generated: edit `scripts/curation.ts`, then `npm run build:exercises` rebuilds `src/data/exercises.json` and the photos in `public/exercises/`.

## Deploy (Railway)

One service from this repo. Build command `npm run build`, start command `npm start`. Add a volume mounted at `/data` and set:

- `DATA_DIR=/data`
- `SYNC_TOKEN=<a long random string>`; paste the same token into the app's Settings › Sync on each device.

Then open the service URL on the iPhone in Safari, Share › Add to Home Screen.

## Credits

Exercise instructions and photos come from [free-exercise-db](https://github.com/yuhonas/free-exercise-db) (public domain, Unlicense). Tags, cues and the curated selection are this project's own.

## License

MIT.
