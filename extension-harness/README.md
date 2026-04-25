# @spine/extension-harness

Playwright harness that loads the Spine browser extension and drives
chatgpt.com + gemini.google.com end-to-end. **Scaffold only.** Tests
skip unless `SPINE_EXT_HARNESS=1` is set in the environment.

## Why this folder is isolated

The root `package.json` declares `"workspaces": ["packages/*"]`. This
folder sits at `extension-harness/` (not `packages/extension-harness/`)
so a parent `npm install` at the repo root never hoists or installs its
devDependencies. Playwright and its bundled Chromium stay out of the
main build surface until someone explicitly opts in.

## Running the harness

Phase 9 is **held pending Roman's greenlight**. Until then, the scripts
below exist but do nothing user-visible:

```bash
cd extension-harness
npm install
npm run install-browsers
SPINE_EXT_HARNESS=1 npm test
```

With the flag unset, `npm test` is a no-op — `playwright.config.ts`
emits zero projects and every spec calls `test.skip(...)` as a second
guard.

## Prerequisites (for when the greenlight lands)

1. The extension must be built first:
   `npm run extension:build` at the repo root (emits to `packages/extension/dist`).
2. A test OpenAI account + test Google account with storage state
   captured and stored out-of-band (never committed).
3. A Spine API key for a dedicated harness user so the harness can
   hit `/api/timeline` and verify captured memories.

## Design notes

- Runs headed, viewport 1440×900 — matches the screenshot target for
  Phase 9 live-fire captures.
- `fullyParallel: false, workers: 1` — AI sites rate-limit aggressively
  and the extension content script is singleton per tab.
- Trace/video/screenshot on failure only — keeps artefact size sane.
- No CI integration yet. Phase 9 specs are manual-fire until they're
  stable enough to trust.
