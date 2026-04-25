import { defineConfig } from 'vitest/config';

// Gate the suite behind SPINE_EXT_HARNESS exactly like the Playwright
// config: when the flag is off, include no specs. Every spec file also
// wraps its describe in describe.skipIf(...) as a second guard so
// running a single file directly from an IDE still exits clean.

const enabled = process.env.SPINE_EXT_HARNESS === '1';

export default defineConfig({
  test: {
    environment: 'node',
    include: enabled ? ['src/**/*.spec.ts'] : [],
    // Flag-off exits 0 — a parent `npm test` must never fail because
    // the gated harness wasn't opted in.
    passWithNoTests: true,
    globals: false,
    reporters: ['default'],
  },
});
