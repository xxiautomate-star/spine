import { test, expect } from '@playwright/test';

// Skip unless explicitly opted in. Double-guard: playwright.config.ts
// already emits zero projects when the flag is off, but this second
// check means running a single spec directly (e.g. in an IDE) still
// exits clean without opening a browser.
const enabled = process.env.SPINE_EXT_HARNESS === '1';
test.skip(!enabled, 'SPINE_EXT_HARNESS!=1 — Phase 9 harness disabled');

test.describe('chatgpt.com — extension capture + inject', () => {
  test('TODO: loads chat.openai.com, captures a turn, re-injects on new tab', async ({ page }) => {
    // Skeleton only. Real implementation lands when Roman greenlights
    // Phase 9 and an isolated test account + fresh cookies are available.
    // Expected flow:
    //   1. Sign in via stored storage state (browser-context, not API)
    //   2. Start a new chat, assert the Spine panel is injected
    //   3. Send a factual prompt, wait for response, trigger capture
    //   4. Hit /api/timeline with the harness key, assert the memory exists
    //   5. Open a fresh tab, assert spine_context_for_session pre-injects it
    await page.goto('about:blank');
    expect(true).toBe(true);
  });
});
