import { test, expect } from '@playwright/test';

const enabled = process.env.SPINE_EXT_HARNESS === '1';
test.skip(!enabled, 'SPINE_EXT_HARNESS!=1 — Phase 9 harness disabled');

test.describe('gemini.google.com — extension capture + inject', () => {
  test('TODO: loads gemini, captures a turn, re-injects on new session', async ({ page }) => {
    // Skeleton only. Real implementation parallels chatgpt.spec.ts but
    // accounts for Gemini's different DOM surface and Google account
    // handling (storage state captured from a dedicated test account).
    await page.goto('about:blank');
    expect(true).toBe(true);
  });
});
