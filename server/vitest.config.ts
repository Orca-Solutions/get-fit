import { defineConfig } from 'vitest/config';
import { defaultServerConditions } from 'vite';

export default defineConfig({
  // Tests run against the engine's TypeScript source, so they never need a build of it first.
  ssr: { resolve: { conditions: ['source', ...defaultServerConditions] } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
