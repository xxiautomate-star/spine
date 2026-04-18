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

Restart Claude Code. Six new tools appear in the tool inspector:

- `spine_capture`
- `spine_capture_bulk`
- `spine_recall`
- `spine_context`
- `spine_timeline`
- `spine_forget`

## 4. Teach Claude to use them

Add this to your project's `CLAUDE.md` so every session you start gets the rules:

```md
You have access to Spine — an append-only, infinite memory layer.

- Call `spine_capture` whenever you learn a stable fact about me, my preferences, my stack,
  or ongoing work. Never summarise — capture the sentence as I said it.
- At the start of any new task, call `spine_recall` with a short query describing what you
  are about to do. Use what comes back as context.
- Call `spine_context` if you want a ready-to-paste block of the top memories for a query.
- Call `spine_timeline` to scan recent activity.
- Never call `spine_forget` unless I explicitly ask you to.
```

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

## Why all of this matters

Every Spine design decision honours the same principle: **append-only, infinite, never
summarised**. Competitors compress because they run out of context window — Spine does
not, because vector search injects only the relevant slice of memory into each prompt
while the raw corpus stays intact forever.

Your AI remembers every word. Not a summary. Every word.
