# manifest.json additions for hygiene poll

Apply these when Phase 9 greenlights promotion of
`extension-harness/src/*` into `packages/extension/src/`. The current
`packages/extension/manifest.json` already has `"storage"` under
`permissions` and the host permissions we need — so the only real
additions are (a) a second content script bundle that targets all
supported AI hosts and (b) a build-step entry so the new background
module is concatenated into `background.js`.

## Content script entry

Add to `content_scripts[]`:

```json
{
  "matches": [
    "https://chatgpt.com/*",
    "https://chat.openai.com/*",
    "https://gemini.google.com/*"
  ],
  "js": ["content-hygiene.js"],
  "run_at": "document_idle"
}
```

`content-hygiene.js` is the built output of
`extension-harness/src/content-entry.ts`. It is deliberately separate
from the existing `content-chatgpt.js` / `content-gemini.js` scripts
so the hygiene poll runs on both hosts without duplicating capture
logic.

## Background service worker

The existing manifest already declares:

```json
"background": { "service_worker": "background.js", "type": "module" }
```

Promote `extension-harness/src/background.ts` by either:

- adding `import './background-hygiene';` to the existing
  `packages/extension/src/background.ts` (rename this file to
  `background-hygiene.ts` on promotion), OR
- concatenating the two entrypoints via `build.mjs` so both sets of
  listeners register under the single worker.

Either way, only one compiled `background.js` should ship — MV3 allows
exactly one service worker per extension.

## No new permissions

`storage`, `activeTab`, and the AI host permissions already cover
everything the poll + badge path touches. `chrome.action` is available
by default because `action` is declared in the manifest.
