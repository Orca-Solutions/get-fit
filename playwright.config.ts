import { defineConfig } from '@playwright/test';

// Runs the production build through the real server, at iPhone size.
export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: {
    command: 'rm -rf .e2e-data && PORT=4173 DATA_DIR=.e2e-data SYNC_TOKEN=e2e-token node dist-server/server/index.js',
    url: 'http://localhost:4173/api/health',
    reuseExistingServer: false,
  },
});
