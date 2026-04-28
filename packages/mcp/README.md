# @spine/mcp

The memory layer for your AI. Append-only, infinite, never summarised.

Every conversation is captured verbatim — every turn, every decision, every
file you touch. Search any of it with natural language. Your AI starts the
next session knowing what happened in the last one.

---

## Install in 30 seconds

```bash
# Cloud (synced to spine.xxiautomate.com)
npx @spine/mcp init --key YOUR_API_KEY

# Local-only (stored in ~/.spine/memories.db)
npx @spine/mcp init --local
```

Both commands:
- Write `~/.spine/config.json`
- Register the MCP server in `~/.claude/settings.json`
- Register the Stop hook so every session is captured automatically

Restart Claude Code, then confirm the tools appear.

---

## What's new — conversation capture

Spine 1.1 adds three hooks that turn it into a full memory layer for Claude
Code:

| Hook | What it captures | Cost |
|------|------------------|------|
| `SessionStart` → `recall-recent` | injects last 1-3 digests + last 50 turns into the new session | zero |
| `UserPromptSubmit` → `capture-turn` | every prompt as a single turn row | zero by default (set `SPINE_EMBED_TURNS=1` for ~$0.02 / 1000 turns) |
| `Stop` → `session-digest` | one structured digest at session end (files touched, commits, etc.) | ~$0.00002 per session |

Sample hook scripts (mac/linux + Windows PowerShell 5.1) live in
`packages/mcp/hooks/`. Copy what fits your setup, paste the snippet from
`hooks/README.md` into your Claude Code settings, restart.

The principle: Spine NEVER summarises. Turns are stored exactly as you
typed them. Digests are JSON, generated either by Claude during the
session (via the `spine_session_digest` MCP tool) or by the Stop hook as
a heuristic fallback. Either way, append-only — nothing ever overwrites or
forgets.

---

## Weekly digest — your build-in-public artifact

Once you have at least one end-of-session digest, Spine writes one rollup
per ISO week — automatically, idempotently. The rollup is a single JSON
artifact (themes, decisions, open threads, commits referenced) suitable
for posting on HN / Reddit / X as a build-in-public update.

```bash
# Roll up last complete week. Idempotent — second call returns cached row.
npx @spine/mcp weekly-digest
```

```bash
# A specific historical week. ISO 8601 (Monday-anchored, UTC).
npx @spine/mcp weekly-digest --week=2026-W17
```

```bash
# Force regenerate (costs an LLM call).
npx @spine/mcp weekly-digest --week=2026-W17 --force
```

The output is paste-ready markdown:

```markdown
# Spine — week 2026-W17

**6 sessions** · generated 2026-04-29

## Themes
- Vector-recall rewrite finally landed
- Pricing page rebuilt from scratch
- ...

## Decisions
- Locked Postgres 15 over MySQL — RLS + pgvector were the deciders
- Killed the OAuth refresh helper, switched to Supabase magic link
- ...

## Commits
- `a03a277 feat(spine): conversation capture + session digest + recall`
- ...
```

Read it in the dashboard at [`/sessions/weekly`](https://spine.xxiautomate.com/sessions/weekly)
— each card has a one-click "copy as markdown" button so the path from
"Spine wrote it" → "post on HN" is a single click.

The `Stop` hook writes the rollup automatically when it detects the first
session of a new ISO week. State lives in `~/.spine/last-week.txt` and
survives process restarts. Cloud-only — local installs receive a
structured skip.

**Cost:** ~$0.0001 per week (one Haiku-4.5 call, ≤1500 output tokens).
Two-pass summarisation triggers if the input exceeds ~50k tokens.

---

## Tools

| Tool | What it does |
|------|--------------|
| `search_memory(query)` | Semantic search across all sessions |
| `add_memory(content, type)` | Store a fact, decision, or bug fix |
| `get_context(task_description)` | Inject relevant context before a task |
| `get_timeline(from, to, type)` | Chronological view of what you've worked on |
| `replay_file(path)` | Decision history for any file |
| `spine_capture_turn(...)` | Append one conversation turn (used by hook) |
| `spine_session_digest(...)` | Write one end-of-session digest |
| `spine_recall_recent(max_tokens)` | Last digests + last session's turns |
| `add_team_memory(content, type)` | Share a memory with your team |

---

## How it works

1. **You start a session.** SessionStart hook calls `recall-recent` and
   prepends the last few digests + most recent turns into context. Claude
   begins the conversation already knowing what you shipped yesterday.
2. **You type a prompt.** UserPromptSubmit hook calls `capture-turn`. One
   row is appended to your archive, tagged with `session_id` and `role=user`.
   No embedding by default — pure timeline storage.
3. **You finish a session.** Stop hook calls `session-digest`. The
   transcript is parsed for files touched + commits made; a digest row is
   appended (always embedded, low volume).
4. **Next session starts.** Step 1 again. The loop closes.

Every turn is searchable via `get_timeline` and the dashboard
`/sessions` view. Turn rows aren't in semantic search by default (that's
the cost knob); digests always are.

---

## Embedding policy — the cost knob

Default: turns skip embeddings. Digests always embed. This keeps your
OpenAI bill bounded even on chatty days — turns are still recallable via
the timeline and the start-of-session block, just not by cosine similarity.

To enable per-turn embeddings (semantic search hits every word you've ever
typed):

```bash
export SPINE_EMBED_TURNS=1   # bash / zsh
$env:SPINE_EMBED_TURNS = '1' # PowerShell
```

At OpenAI's `text-embedding-3-small` price (~$0.02 per million tokens),
1000 average turns runs about $0.02. Worth it for power users; off by
default for everyone else.

---

## Manual configuration

If auto-registration fails, add this to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "spine": {
      "command": "npx",
      "args": ["-y", "@spine/mcp", "serve"]
    }
  },
  "hooks": {
    "SessionStart": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "npx -y @spine/mcp recall-recent" }] }
    ],
    "UserPromptSubmit": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "npx -y @spine/mcp capture-turn" }] }
    ],
    "Stop": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "npx -y @spine/mcp session-digest" }] }
    ]
  }
}
```

The legacy `hook-stop` (full-transcript chunking) still works and can run
alongside `session-digest` if you want both raw chunks and a digest.

---

## Commands

```
npx @spine/mcp init                 Interactive setup
npx @spine/mcp init --key KEY       Non-interactive cloud setup
npx @spine/mcp init --local         Non-interactive local-only setup
npx @spine/mcp serve                Start MCP server (Claude Code runs this)
npx @spine/mcp recall-recent        SessionStart hook — inject recent context
npx @spine/mcp capture-turn         UserPromptSubmit hook — append a turn
npx @spine/mcp session-digest       Stop hook — write end-of-session digest
npx @spine/mcp hook-stop            Stop hook — chunk full transcript (legacy)
npx @spine/mcp inject               Older proactive-injection hook
npx @spine/mcp sync                 Ingest local ~/.claude/projects/*/memory/*.md
```

---

## Append-only, by design

There is no public `delete_turn`, `update_turn`, or summarise/compress API.
The only deletion path is `spine_forget(id)` for individual memories you
explicitly want gone — designed for sensitive removals, not for routine
cleanup. The corpus grows. Vector search + decay scoring handle relevance
at query time. The full word-for-word history is always there if you need
it.

> *"Your AI remembers every word. Not a summary. Every word."*

---

## Links

- Dashboard: [spine.xxiautomate.com](https://spine.xxiautomate.com)
- Sessions view: [spine.xxiautomate.com/sessions](https://spine.xxiautomate.com/sessions)
- Issues: [github.com/xxiautomate-star/spine](https://github.com/xxiautomate-star/spine)
