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
  webServer: [
    {
      command: 'rm -rf .e2e-data && PORT=4173 DATA_DIR=.e2e-data SYNC_TOKEN=e2e-token node dist-server/server/index.js',
      url: 'http://localhost:4173/api/health',
      reuseExistingServer: false,
    },
    {
      // A copy of the build that the release test changes, so other tests never see a new version.
      command: 'rm -rf .e2e-release && mkdir -p .e2e-release && cp -r dist .e2e-release/app && PORT=4174 DATA_DIR=.e2e-release/data STATIC_DIR=.e2e-release/app SYNC_TOKEN=e2e-token node dist-server/server/index.js',
      url: 'http://localhost:4174/api/health',
      reuseExistingServer: false,
    },
    // One server each for the two-device specs, so their sync data starts empty and stays their own.
    {
      command: 'rm -rf .e2e-sync && PORT=4175 DATA_DIR=.e2e-sync SYNC_TOKEN=e2e-token node dist-server/server/index.js',
      url: 'http://localhost:4175/api/health',
      reuseExistingServer: false,
    },
    {
      command: 'rm -rf .e2e-rollover && PORT=4176 DATA_DIR=.e2e-rollover SYNC_TOKEN=e2e-token node dist-server/server/index.js',
      url: 'http://localhost:4176/api/health',
      reuseExistingServer: false,
    },
  ],
});
