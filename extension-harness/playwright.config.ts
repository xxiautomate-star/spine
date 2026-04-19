import { defineConfig } from '@playwright/test';
import path from 'node:path';

// Phase 9 harness — loads the packaged Chrome extension and drives
// chatgpt.com / gemini.google.com end-to-end. Off by default via the
// SPINE_EXT_HARNESS env flag so `npm test` from a parent never
// accidentally triggers a paid browser session or hits a live AI.

const enabled = process.env.SPINE_EXT_HARNESS === '1';

// Extension is built by `npm run extension:build` at the repo root and
// emitted to packages/extension/dist. The harness loads that directory
// directly via --disable-extensions-except + --load-extension. The
// paths are relative to this config file so the harness can be run
// from any cwd.
const extensionDir = path.resolve(__dirname, '..', 'packages', 'extension', 'dist');

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  timeout: 60_000,
  use: {
    headless: false,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      args: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
      ],
    },
  },
  // Flag-gate every project so specs never run unless explicitly opted in.
  projects: enabled
    ? [
        {
          name: 'chromium-with-extension',
          use: {},
        },
      ]
    : [],
});
