// Vitest config for Spine unit tests.
// Pure-logic tests with mocked dependencies — runs offline, no DB required.

import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.spec.ts'], // .spec.ts → Playwright; .test.ts → Vitest
    environment: 'node',
    globals: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
