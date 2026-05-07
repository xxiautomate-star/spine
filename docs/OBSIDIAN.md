# Spine ↔ Obsidian

> Spine lives in the AI conversation layer. Obsidian lives in the personal-notes
> layer. The two together mean memory that survives both surfaces — your AI
> remembers what you wrote, you can read what your AI remembered.

---

## What this gets you

- **AI cites your notes.** The first time Claude / Cursor / ChatGPT asks "do
  you have anything on the OAuth refresh flow?" — the answer comes back as
  excerpts from your actual Obsidian notes, not a paraphrase.
- **Vault becomes searchable across AIs.** Hybrid recall (pgvector + BM25 +
  rerank) over your whole vault, exposed via the existing `search_memory` and
  `get_context` MCP tools. Same archive, every model.
- **No vendor lock-in.** Vault stays in plain Markdown on your disk. Spine
  reads it, never owns it.

This is **one-way (read-only)** in v1 — Obsidian is the source of truth, Spine
is a recall index over it. Two-way write-back is specified at the bottom but
deliberately not implemented; the round-trip safety story isn't ready.

---

## Run it

```bash
# Dry-run first — counts files, no writes.
npx spine-mcp sync --obsidian-vault "/Users/roman/Obsidian" --dry-run

# Live ingestion.
npx spine-mcp sync --obsidian-vault "/Users/roman/Obsidian"

# Re-run is idempotent — only changed files re-embed.
npx spine-mcp sync --obsidian-vault "/Users/roman/Obsidian"
```

Goes through whichever store the active config points at — local SQLite by
default, cloud if `mode: 'cloud'` in `~/.spine/config.json`.

---

## File-walk rules

The walker recurses every subdirectory under the vault root, picking up
`*.md` files. Files are skipped (configurable) when their path matches any
of these defaults:

| Pattern | Why |
|---|---|
| `Daily Notes/` | High volume, low recall signal — typically status/journal |
| `Templates/` | Boilerplate, not memories |
| `_Spine/` | Reserved for future write-back; never re-ingest our own output |
| `.obsidian/` | Plugin state, not content |
| `.trash/` | Trashed notes |
| Files >256KB | Likely binary / pasted exports — caption-only ingest |

Override with `--include "Daily Notes/**"` (repeatable) to force-include any
of the defaults. Use `--ignore "Project Z/**"` to exclude additional paths.

Symlinks are followed once at the vault root and not recursively, so a vault
that links to itself can't infinite-loop the walker.

---

## Frontmatter mapping

Obsidian frontmatter (YAML at the top of a `.md`) maps to Spine memory
metadata as follows:

| Obsidian field | Spine field | Notes |
|---|---|---|
| `tags: [a, b]` | `tags` | Array literal preferred; comma-separated string also accepted |
| `aliases: [...]` | `tags` (`alias:foo`) | Each alias becomes one `alias:<x>` tag so `search_memory("alias:foo")` works |
| `created: 2026-04-12` | `created_at` | Falls back to file mtime if absent |
| `updated: 2026-05-01` | (advisory) | Used by the idempotency check |
| `type: decision` | `type` | One of `decision \| bug \| feature \| context \| fact`; default `context` |
| `importance: high` | `importance` | Pass-through to add_memory; bypasses the auto-scorer |
| any other key | `tags` (`<key>:<value>`) | Free-form metadata becomes searchable tags |

Frontmatter parsing is deliberately tolerant — bad YAML is ignored, the body
is still ingested with default metadata. Spine never refuses a memory because
the frontmatter looks weird.

---

## `[[Wikilinks]]` and embeds

Wikilinks in note bodies are kept verbatim in `content` (they're useful as
anchors when an AI quotes the source) and **also** lifted into tags so they
become a query handle:

| Source | Tags added |
|---|---|
| `See [[OAuth bug]]` | `link:OAuth bug` |
| `[[OAuth bug\|the OAuth incident]]` | `link:OAuth bug` (alias label dropped) |
| `![[diagram.png]]` | `embed:diagram.png` (file content NOT ingested) |

Wikilinks to non-existent notes are still tagged — Spine doesn't validate
that the target exists. This matches Obsidian's "permissive linker" behaviour.

---

## Idempotency and dedup

Re-running the sync against an already-ingested vault should not create
duplicates. The strategy:

1. **Per-file source tag.** Each note gets `source = 'obsidian-sync:<sha1>'`
   where `<sha1>` is the first 12 chars of the file's vault-relative path
   hashed with SHA-1.
2. **Mtime check.** If a memory with the same source tag exists and its
   `created_at` ≥ the file's `mtime`, the file is skipped.
3. **Force re-ingest.** `--force` ignores both checks and re-embeds every
   file. Useful when the embedding model changes (e.g. on the cloud cutover
   from OpenAI text-embedding-3-small to Gemini gemini-embedding-001).

If a file is renamed in Obsidian, the dedup hash changes — the renamed file
re-ingests and the old memory remains under its old source tag. Use
`--prune` (deferred to v2) to drop orphaned memories whose source tag no
longer maps to any current file.

---

## What this is NOT (yet)

- **Not real-time.** No file-watcher; you re-run the command after a sync
  session. A `--watch` flag is on the v2 backlog.
- **Not write-back.** Spine never writes into the vault. See the next
  section for the spec.
- **Not selective per-tag.** No `--only-tag` filter yet — everything outside
  the skip-list lands in the archive. Filter at recall time using the tags
  themselves.
- **Not Obsidian Sync–aware.** Conflicts between two devices syncing the
  same vault are Obsidian's problem; Spine sees whatever's on disk at run
  time.

---

## Two-way (write-back) — spec only, not implemented

The asymmetric direction — Spine memories writing back into the vault as
`.md` notes — has a lot of upside (the things your AI remembered show up
inside your second brain) and a real risk (round-trip overwrite of edits
you made in Obsidian).

**Sketch:**

- Memories land in `Vault/_Spine/<YYYY-MM>/<id>.md`.
- Frontmatter encodes `id`, `created_at`, `importance`, `tags`, `signal_tier`.
- Body = the memory `content`, with detected `[[wikilinks]]` preserved when
  the linked note already exists.
- A `direction` config flag controls write-back:
  - `read-only` (default) — the safe one. Equivalent to the v1 above.
  - `vault-wins` — Obsidian edits override Spine writes; Spine appends
    revisions as new memories instead of overwriting.
  - `spine-wins` — Spine reformats the file on every sync; **never default
    to this**.

**Risk surfaces (why we're not building yet):**

- Edit a Spine-written `.md` in Obsidian, then re-sync. Without a
  `vault-wins` policy, your edit is lost.
- File-system watchers can fire dozens of times during a single Obsidian
  save; we'd need debounce to avoid thrashing the API.
- Deletes are ambiguous — if you delete a `_Spine/` note in Obsidian, did
  you mean "forget this memory" (call `spine_forget`) or "stop syncing it
  to disk" (vault-side opt-out)? Needs a UX answer first.

**Decision:** ship one-way, watch user behaviour for a month, then choose
between `vault-wins` write-back vs. a separate `spine-mcp export-vault`
command that builds a fresh `_Spine/` folder on demand.

---

## Implementation pointers

- The sync walker lives at `packages/mcp/src/commands/sync.ts`. The
  `--obsidian-vault` branch shares the existing `parseFrontmatter` +
  `mapType` helpers and reuses the `fileSourceTag` dedup pattern from the
  Claude Code memory ingestion path.
- Cloud captures route through `/api/capture` which already accepts the
  `importance` field added in session 5.
- Tests live in `packages/mcp/src/test/` (todo: add a fixture vault).
