import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { openStore } from './store.js';

const port = Number(process.env.PORT ?? 3000);
const dataDir = resolve(process.env.DATA_DIR ?? './data');
const staticDir = resolve(process.env.STATIC_DIR ?? './dist');
const token = process.env.SYNC_TOKEN?.trim() || undefined;

mkdirSync(dataDir, { recursive: true });
const db = openStore(join(dataDir, 'get-fit.sqlite'));
const app = createApp({ db, token, staticDir });

if (!token) console.warn('SYNC_TOKEN is not set: /api/sync will answer 503 until it is.');

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`get-fit listening on http://localhost:${info.port} (data: ${dataDir}, app: ${staticDir})`);
});

const shutdown = () => server.close(() => { db.close(); process.exit(0); });
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
