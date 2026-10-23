import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { assertPatchedNode } from '../runtime.js';
import type { SqliteStore } from '@orca-solutions/get-fit-core/sqlite';

afterEach(() => vi.unstubAllGlobals());

describe('patched server runtime', () => {
  it('accepts the security release and later stable Node 22 patches, not other lines or prereleases', () => {
    for (const version of ['v22.23.4', 'v22.23.5', 'v22.24.0']) expect(() => assertPatchedNode(version)).not.toThrow();
    for (const version of ['v22.23.3', 'v22.22.9', 'v20.20.0', 'v24.22.1', 'v22.24.0-rc.1', '22.23.4', 'v22.023.4']) {
      expect(() => assertPatchedNode(version)).toThrow(/requires Node.js/);
    }
  });

  it('uses the actual process version when the caller supplies no argument', () => {
    vi.stubGlobal('process', { ...process, version: 'v22.23.3' });
    expect(() => assertPatchedNode()).toThrow(/requires Node.js/);
    vi.stubGlobal('process', { ...process, version: 'v22.23.4' });
    expect(() => assertPatchedNode()).not.toThrow();
  });
});

describe('authenticated same-process runtime metadata', () => {
  const untouchedStore = () => new Proxy({} as SqliteStore, { get: () => { throw new Error('runtime metadata must not touch the database'); } });

  it('returns only the serving process version with no-store and no database access', async () => {
    const app = createApp({ db: untouchedStore(), token: 'synthetic-token' });
    const response = await app.request('/api/runtime', { headers: { Authorization: 'Bearer synthetic-token' } });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ nodeVersion: process.version });
  });

  it('keeps runtime metadata behind authentication, including missing server configuration', async () => {
    const app = createApp({ db: untouchedStore(), token: 'synthetic-token' });
    for (const headers of [undefined, { Authorization: 'Bearer wrong' }]) {
      const response = await app.request('/api/runtime', { headers });
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain(process.version);
    }
    expect((await createApp({ db: untouchedStore() }).request('/api/runtime')).status).toBe(503);
  });

  it('preserves auth-first unknown GET behavior for the rotation check without accessing the store', async () => {
    const db = untouchedStore();
    const app = createApp({ db, token: 'synthetic-token' });
    expect((await app.request('/api/rotation-check', { headers: { Authorization: 'Bearer synthetic-token' } })).status).toBe(404);
    expect((await app.request('/api/rotation-check', { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401);
    expect((await createApp({ db }).request('/api/rotation-check')).status).toBe(503);
    expect(await (await app.request('/api/health')).json()).toEqual({ ok: true });
  });
});
