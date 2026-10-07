import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { serveStatic } from '@hono/node-server/serve-static';
import { TABLES, type Change, type Store } from './store.js';

export const MAX_BODY_BYTES = 5 * 1024 * 1024;
export const MAX_CHANGES = 5000;

export type AppOptions = {
  db: Store;
  /** Shared secret; when missing, the API answers 503 but the app is still served. */
  token?: string;
  /** Built PWA to serve (e.g. "dist"). Omit to serve the API only. */
  staticDir?: string;
  /** Max records per pull response (default 2000). */
  pageSize?: number;
};

const digest = (s: string) => createHash('sha256').update(s).digest();
const tokenMatches = (given: string, expected: string) => timingSafeEqual(digest(given), digest(expected));

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const isIso = (v: unknown): v is string => typeof v === 'string' && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v));

/** Returns the parsed request or an error message. */
function parseSyncBody(body: unknown): { cursor: number; changes: Change[] } | string {
  if (!body || typeof body !== 'object') return 'body must be a JSON object';
  const { cursor = 0, changes = [] } = body as { cursor?: unknown; changes?: unknown };
  if (typeof cursor !== 'number' || !Number.isSafeInteger(cursor) || cursor < 0) return 'cursor must be a non-negative integer';
  if (!Array.isArray(changes)) return 'changes must be an array';
  if (changes.length > MAX_CHANGES) return `too many changes (max ${MAX_CHANGES} per request)`;
  for (const [i, ch] of changes.entries()) {
    const { table, record } = (ch ?? {}) as { table?: unknown; record?: Record<string, unknown> };
    if (!TABLES.includes(table as never)) return `changes[${i}]: unknown table ${JSON.stringify(table)}`;
    if (!record || typeof record !== 'object' || Array.isArray(record)) return `changes[${i}]: record must be an object`;
    if (typeof record.id !== 'string' || !record.id || record.id.length > 200) return `changes[${i}]: record.id must be a non-empty string`;
    if (!isIso(record.updatedAt)) return `changes[${i}]: record.updatedAt must be an ISO date string`;
    if (record.deletedAt != null && !isIso(record.deletedAt)) return `changes[${i}]: record.deletedAt must be an ISO date string or null`;
  }
  return { cursor, changes: changes as Change[] };
}

export function createApp({ db, token, staticDir, pageSize = 2000 }: AppOptions) {
  const app = new Hono();

  app.get('/api/health', (c) => c.json({ ok: true }));

  app.use('/api/*', async (c, next) => {
    if (!token) return c.json({ error: 'Sync is not configured on the server: set the SYNC_TOKEN environment variable.' }, 503);
    const given = c.req.header('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1] ?? '';
    if (!given || !tokenMatches(given, token)) return c.json({ error: 'Invalid or missing sync token.' }, 401);
    await next();
  });

  app.post(
    '/api/sync',
    bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: 'Request body too large.' }, 413) }),
    async (c) => {
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: 'Body must be valid JSON.' }, 400);
      }
      const req = parseSyncBody(body);
      if (typeof req === 'string') return c.json({ error: req }, 400);

      // A cursor ahead of the server means the server lost its data: pull from scratch and tell the client to re-push.
      const reset = req.cursor > db.maxSeq();
      const written = db.applyChanges(req.changes);
      const cursor = reset ? 0 : req.cursor;
      const { rows, more } = db.pull(cursor, pageSize);
      return c.json({
        cursor: rows.length ? rows[rows.length - 1].seq : cursor,
        epoch: db.epoch,
        more,
        reset,
        accepted: written.size,
        // Skip echoing back what this request just stored: the client already has it.
        changes: rows.filter((r) => written.get(`${r.table}/${r.record.id}`) !== r.seq).map(({ table, record }) => ({ table, record })),
      });
    },
  );

  app.get('/api/export', (c) => c.json({ exportedAt: new Date().toISOString(), tables: db.exportAll() }));

  app.all('/api/*', (c) => c.json({ error: 'Not found.' }, 404));

  if (staticDir) {
    const setCacheHeaders = (path: string, c: Context) => {
      const immutable = /[\\/]assets[\\/]/.test(path);
      c.header('Cache-Control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
    };
    app.get('*', serveStatic({ root: staticDir, onFound: setCacheHeaders }));
    // SPA fallback: client-side routes (no file extension) get index.html; missing files stay 404.
    const spa = serveStatic({ root: staticDir, path: 'index.html', onFound: setCacheHeaders });
    app.get('*', (c, next) => (/\.[^/]*$/.test(c.req.path) ? next() : spa(c, next)));
  }

  return app;
}
