// Playwright config for Spine — gates 1, 4, etc. of the launch stress-test
// brief. Tests live under saas/spine/tests/ and run against a deployed
// staging Spine (set STAGING_BASE_URL + bearer keys via env). Runs in CI
// only when staging credentials are present — otherwise the suite skips
// at the env-validation step in each spec.

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  // No webServer — these are integration tests against a deployed staging.
  // To run locally: STAGING_BASE_URL=http://localhost:3000 npx playwright test
  use: {
    baseURL: process.env.STAGING_BASE_URL ?? 'http://localhost:3000',
    extraHTTPHeaders: { 'User-Agent': 'spine-stress-test/1.0' },
  },
  retries: process.env.CI ? 1 : 0,
  workers: 1, // Sequential — these tests mutate shared staging state.
  reporter: process.env.CI ? 'github' : 'list',
});
