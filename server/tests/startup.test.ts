import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const effects = vi.hoisted(() => ({ calls: [] as string[] }));
vi.mock('node:fs', () => ({ mkdirSync: () => effects.calls.push('mkdir') }));
vi.mock('@orca-solutions/get-fit-core/sqlite', () => ({
  openSqliteStore: () => {
    effects.calls.push('open');
    return { resetEpochOnce: () => { effects.calls.push('epoch'); return false; }, close: vi.fn() };
  },
}));
vi.mock('../app.js', () => ({ createApp: () => { effects.calls.push('app'); return { fetch: vi.fn() }; } }));
vi.mock('@hono/node-server', () => ({ serve: () => { effects.calls.push('listen'); return { close: vi.fn() }; } }));

beforeEach(() => { vi.resetModules(); effects.calls.length = 0; });
afterEach(() => vi.unstubAllGlobals());

function runtime(version: string) {
  vi.stubGlobal('process', {
    ...process,
    version,
    env: { PORT: '3000', DATA_DIR: '/synthetic/data', STATIC_DIR: '/synthetic/dist', SYNC_TOKEN: 'synthetic-token' },
    on: vi.fn(),
  });
}

it('rejects an old runtime before directory creation, SQLite/epoch mutation or listening', async () => {
  runtime('v22.23.3');
  await expect(import('../index.js')).rejects.toThrow(/requires Node.js/);
  expect(effects.calls).toEqual([]);
});

it('starts the existing server sequence on a later patched Node 22', async () => {
  runtime('v22.23.5');
  await import('../index.js');
  expect(effects.calls).toEqual(['mkdir', 'open', 'epoch', 'app', 'listen']);
});
