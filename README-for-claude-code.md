# Install Spine into your Claude Code, right now

You are about to become Spine user #1. Five minutes, give or take the first model download.

Spine is append-only, infinite, never summarised. Every word you or Claude captures stays
forever; relevant memories are injected into new conversations via vector search. Your AI
stops meeting you for the first time, each morning, forever.

---

## 1. Build the MCP package locally

From this folder (`saas/spine`):

```bash
npm install
npm run mcp:build
npm run mcp:test
```

The first `mcp:test` run downloads the ~90MB `Xenova/all-MiniLM-L6-v2` embedding model
into `~/.cache/huggingface/`. Subsequent runs are instant.

Expected output ends with:

```
all passed:
  ok  captureBulk returned 3 ids
  ok  coffee query returned coffee memory first (sim=~0.5)
  ok  framework query returned Next.js memory first (sim=~0.3)
  ok  timeline returned 3 memories
  ok  soft delete hides memory from timeline
```

## 2. Initialise Spine

```bash
node packages/mcp/dist/cli.js init
```

Choose **Local** when asked (default). Memories will live in `~/.spine/memories.db`.
A SQLite file. Fully inspectable. Yours.

## 3. Register Spine with Claude Code

Open Claude Code settings (`claude mcp add` or edit your MCP settings file directly) and
add an entry that points at your built `cli.js`:

```json
{
  "mcpServers": {
    "spine": {
      "command": "node",
      "args": [
        "C:/Projects/claude-build/saas/spine/packages/mcp/dist/cli.js",
        "serve"
      ]
    }
  }
}
```

Once `@spine/mcp` is published to npm, you will use:

```json
{
  "mcpServers": {
    "spine": {
      "command": "npx",
      "args": ["-y", "@spine/mcp", "serve"]
    }
  }
}
```

Restart Claude Code. Seven new tools appear in the tool inspector:

- `spine_capture`
- `spine_capture_bulk`
- `spine_recall` — top-5 hybrid (vector + BM25 + temporal decay) reranked by Haiku 4.5
- `spine_context` — single-query context block, ready to paste into a prompt
- `spine_context_for_session` — multi-hint bootstrap, called ONCE at session start
- `spine_timeline`
- `spine_forget` — hard delete (no undo)

## 4. Teach Claude to use them

Add this to your project's `CLAUDE.md` so every session you start gets the rules:

```md
You have access to Spine — an append-only, infinite memory layer.

- **On session start**: call `spine_context_for_session` with 3-5 hints describing what we
  are about to work on (filenames, topics, queries). Prepend the returned block to your
  working context. This is the primary proactive-injection hook.
- **During the session**: call `spine_recall` with a short query whenever you need more
  context for a specific step. Results are already reranked for relevance.
- **After learning**: call `spine_capture` whenever you learn a stable fact about me, my
  preferences, my stack, or ongoing work. Never summarise — capture the sentence as I said it.
- `spine_context` gives a ready-to-paste block for a single query (token-budgeted).
- `spine_timeline` scans recent activity chronologically.
- `spine_forget` is a hard delete — never call it unless I explicitly ask to forget a
  specific memory.
```

### How retrieval actually works

Every `spine_recall` (cloud mode) runs this pipeline server-side:

1. Embed the query with OpenAI `text-embedding-3-small` (1536-dim).
2. Fetch 30 candidates by cosine similarity (HNSW index over pgvector).
3. Fetch 30 candidates by BM25 full-text rank (Postgres `tsvector` + GIN index).
4. Merge with reciprocal rank fusion (k=60), multiply by temporal decay
   (`exp(-days / (90/ln2))` — half-life 90 days).
5. Send the top 30 fused candidates to Claude Haiku 4.5 with a cached system prompt.
6. Return the reranked top N with per-pick relevance scores and one-sentence reasons.

If `ANTHROPIC_API_KEY` is unset, step 5 is skipped and the fused-only ordering is returned.
The raw pgvector-only path is still available at `POST /api/recall/raw` for debugging.

Open `spine.xxiautomate.com/dashboard/recall` to watch each stage on your own archive.

## 5. Inspect the archive

Every memory lives in `~/.spine/memories.db`. Open it with any SQLite client, or:

```bash
sqlite3 ~/.spine/memories.db "select substr(content,1,80) || '…', created_at from memories where deleted_at is null order by created_at desc limit 10;"
```

Once cloud sync is configured and the dashboard has auth, the same view renders at
`spine.xxiautomate.com/dashboard/memories`.

## 6. Switch to cloud sync later

When Roman has the API key flow ready, run:

```bash
node packages/mcp/dist/cli.js login --key spine_live_xxxxxxxx
```

Or re-run `init` and choose Cloud. Same six tools, now hitting Supabase + pgvector through
the Spine API. Your local SQLite stays where it is as an offline fallback.

---

## 7. Capture from ChatGPT and Gemini (browser extension)

Claude Code is the home base, but most of the day-to-day still happens in
ChatGPT and Gemini. The Spine extension pipes those conversations into the same
archive and offers relevant memories at the start of every new chat.

### Build the extension

```bash
npm install
npm run extension:build
```

The bundle lands in `packages/extension/dist/`. Everything is plain ESM — no
runtime deps, no remote code. Production icons live in `packages/extension/icons/`
and are regenerated with `npm run extension:icons`.

### Load it into Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top right toggle).
3. Click **Load unpacked**, pick `packages/extension/dist/`.
4. Pin the **Spine** action icon and click it once → **Open settings**.
5. Paste your API key from `/dashboard/keys`. Save.

### Smoke test the golden path

1. Open `https://chatgpt.com` and start any conversation. Send three short
   messages, wait for replies.
2. Within ~30 seconds (the background flush interval), refresh
   `spine.xxiautomate.com/dashboard/memories` — your turns appear with
   `source = chatgpt` and tags `["user"]` / `["assistant"]`.
3. Open `chatgpt.com/` in a new tab (a fresh conversation). A small panel slides
   in from the bottom-right: *"Spine remembered something."* Click **Insert
   into prompt** — the relevant memory block is prepended to the composer.
4. Repeat on `https://gemini.google.com`. Same flow, same panel.

### What it does, and what it never does

- It captures **only** the rendered conversation text on the platforms you
  toggled on. No background browsing data. No tracking.
- The API key lives only in your Chrome profile's `chrome.storage.sync`. The
  background worker is the sole owner; content scripts never see it.
- Auto-inject is opt-in and consent-gated. The panel never types for you — you
  click **Insert** or **Dismiss**.
- Captures are deduped by content hash; the same turn can't be sent twice
  across DOM mutations or page reloads.
- Network failures back off exponentially (5s → 5min cap) and the queue
  persists in `chrome.storage.local` across worker restarts.

### Package for the Chrome Web Store

```bash
npm run extension:package
```

Produces `packages/extension/spine-extension-<version>.zip`, ready to upload.

---

## Why all of this matters

Every Spine design decision honours the same principle: **append-only, infinite, never
summarised**. Competitors compress because they run out of context window — Spine does
not, because vector search injects only the relevant slice of memory into each prompt
while the raw corpus stays intact forever.

Your AI remembers every word. Not a summary. Every word.
