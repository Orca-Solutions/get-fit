import { defineConfig } from 'vitest/config';

// One run across the workspace: the engine, the web app and the server.
export default defineConfig({
  test: {
    projects: ['packages/core', 'apps/web', 'server'],
  },
});
