# Selector contract

Every content script depends on a small set of DOM selectors and tag-name
conventions from the host platform. When a platform redesigns, capture
silently drops to zero — there is no JavaScript error, just empty
`collectTurns()` calls. This file is the source of truth for what we
depend on, so the diagnostic path on a regression is short:

> *"Captures from {platform} dropped to zero overnight"* → open this file →
> open dev tools on the live site → re-verify each row → patch the driver.

## ChatGPT (`content-chatgpt.ts`)

| Purpose | Selector | Notes |
|---|---|---|
| Conversation root | `main` | Falls back to `document.body`. |
| Turn elements | `[data-message-author-role]` | Both user and assistant. |
| Role classification | attribute `data-message-author-role` value `"user"` \| `"assistant"` | Anything else is skipped. |
| Inner text node | `.markdown, [data-message-id] .whitespace-pre-wrap, .whitespace-pre-wrap` | Used to strip surrounding chrome before extraction. |
| Prompt input | `textarea#prompt-textarea` (legacy) → `div#prompt-textarea[contenteditable="true"]` (current) → `[contenteditable="true"]` (fallback) | Triple fallback; OpenAI swapped textareas for contenteditable in 2024. |
| Fresh-conversation check | path `/` or `/c`, OR no `[data-message-author-role]` elements present | Used to gate proactive injection. |

**Most likely failure mode:** OpenAI renames `data-message-author-role` in
a redesign. Diagnose by inspecting any visible turn element in dev tools
and copying its current attribute name into `TURN_SEL`.

## Gemini (`content-gemini.ts`)

| Purpose | Selector | Notes |
|---|---|---|
| Conversation root | `chat-window, main, [role="main"]` | Custom-element first, generic fallback. |
| User turn | `user-query, [data-test-id="user-query"]` | Custom element, occasionally swapped for a div under `data-test-id`. |
| Model turn | `model-response, [data-test-id="model-response"]` | Same pattern. |
| Role classification | tag-name `<user-query>` → `'user'`, anything else → `'assistant'` | The dual-element model means role is implicit in the tag. |
| Prompt input | `rich-textarea .ql-editor`, then `rich-textarea [contenteditable="true"]`, then `[contenteditable="true"]` | Quill editor inside a custom element. |

**Most likely failure mode:** Google rewrites Gemini's web UI in Lit and
the custom-element tag names change. Diagnose by inspecting a visible
user message in dev tools and reading the *outer* tag name (not the inner
content).

## Claude.ai (`content-claude.ts`)

The Claude.ai driver is more elaborate (it also renders the conflict
HUD); see the source for the full set. Most-load-bearing selectors:

- Conversation root: `main, [data-testid="claude-app"]`
- Turn elements: `[data-testid="user-message"], [data-testid="assistant-message"]`
- Role: derived from `data-testid` value
- Prompt input: `[contenteditable="true"][role="textbox"]`

## Cross-platform (`common/capture.ts`)

The shared layer is platform-agnostic — it does not touch DOM directly,
only what the driver returns. If captures from *every* platform stop, the
problem is here, not in a driver:

- `MutationObserver` filtering: only triggers `scan()` when an added node
  matches the driver's `getConversationRoot()` subtree
- Hash dedup: `fnv1a64(role + content)` — duplicate turns dropped on the
  client before the network call
- Send debounce: 500ms after last DOM mutation

## How to verify after a redesign

1. Open the platform in Chrome with the Spine extension installed
2. Have a short conversation (3–5 turns)
3. Check `chrome://extensions/` → Spine → Service worker logs
4. Look for `[spine] capture: N turns from <platform>` lines
5. If `N === 0` consistently, run `document.querySelectorAll('<turn-selector>')`
   in dev tools to confirm the selector match-count
6. Patch the driver, rebuild (`npm run extension:build`), reload the
   extension in `chrome://extensions/`

## When this file is wrong

The contract here can drift from production code. If you change a
selector in any `content-*.ts`, update the matching row above in the
same commit. Reviewers should reject driver edits with no SELECTORS.md
update.
