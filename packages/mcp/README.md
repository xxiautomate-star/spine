# spine-mcp

> **A memory layer for your AI. One command, click approve, your AI remembers.**

Spine sits beneath Claude Code, Claude Desktop, Cursor, ChatGPT, Gemini —
any MCP-compatible AI. It captures what matters across every conversation
and surfaces the right context at the right moment. Append-only by
design: nothing is summarised, nothing is overwritten, nothing is forgotten.

---

## Install

```bash
npx spine-mcp init
```

You will be asked to choose: **local-only** (zero-account, memories live
in `~/.spine/memories.db`) or **cloud sync** (paste an API key minted at
[spine.xxiautomate.com/dashboard/keys](https://spine.xxiautomate.com/dashboard/keys)).
The CLI verifies the key, writes config, and registers the MCP server +
capture/inject hooks with Claude Code automatically. ~30 seconds end to end.

```bash
# Non-interactive fast paths:
npx spine-mcp init --key spine_live_…   # paste the key inline
npx spine-mcp init --local              # zero-account, all on-device
```

After install: restart Claude Code. Capture starts working automatically;
new sessions begin with the relevant context already in the prompt.

> **Coming soon — device-flow install.** OAuth-style "browser opens, click
> approve, no key paste" is the next CLI release. Today's install is one
> command + one paste. Roadmap: spine.xxiautomate.com/changelog.

---

## Why Spine vs the alternatives

|  | Spine | Mem.ai | Zep | Letta |
|---|:---:|:---:|:---:|:---:|
| One-command install (no key paste) | ● | ○ | ○ | ○ |
| Works across Claude / Cursor / ChatGPT | ● | ○ | ● | ○ |
| Quality scoring at write-time | ● | ○ | ○ | ○ |
| Auto-promotion of frequently used memories | ● | ○ | ○ | ○ |
| Append-only — nothing summarised | ● | ● | ○ | ● |
| Self-hostable | ● | ○ | ● | ● |
| Free tier with real cap | ● | ● | ○ | ○ |

**The wedge:** *Spine knows the difference between "we use Postgres for
the backend" and "lol the deploy failed" — different tier, different
fate.* Quality scoring at write-time, promotion ladder at read-time,
active pruning at maintenance-time. Three layers, fully automatic.

---

## What you get

### 1. Quality gate at write-time
Every capture is scored 0–1 by Haiku-4.5. High signal embeds and surfaces
in semantic search. Low signal stores in your timeline but stays out of
recall — never pollutes results. You capture freely; Spine handles the
filtering.

### 2. Promotion ladder at read-time
Memories you recall ≥ 3 times in 30 days promote to **fact** tier (small
ranking bonus). ≥ 8 in 60 days promote to **pinned** (always injected,
never decays). Spine actively rewards what you use.

### 3. Active pruning at maintenance-time
Quarterly digest surfaces the noise pile. Click keep or archive. Anything
ignored auto-archives at 90 days — soft delete, fully recoverable. Your
archive grows on quality, not volume.

### 4. Conversation capture, automatically
Three hooks ship out of the box:

| Hook | What it captures | Cost |
|------|------------------|------|
| `SessionStart` | injects recent context block (digests + last 50 turns) | zero |
| `UserPromptSubmit` | every turn as a row | zero by default — set `SPINE_EMBED_TURNS=1` for ~$0.02 per 1000 |
| `Stop` | structured digest at session end | ~$0.00002 |

Auto-registered in `~/.claude/settings.json` during install. Sample hook
scripts (`.sh` + PowerShell `.ps1`) live in `packages/mcp/hooks/` if
you want to copy them anywhere else.

### 5. Weekly digest — your build-in-public artifact

Once a week, Spine rolls up every session digest into one shareable
artifact. Themes, decisions, open threads, commits. Paste-ready
markdown.

```bash
npx spine-mcp weekly-digest          # last complete week
npx spine-mcp weekly-digest --week=2026-W17
```

Read it in the dashboard at
[`/sessions/weekly`](https://spine.xxiautomate.com/sessions/weekly) —
each card has a one-click "copy as markdown" button.

---

## Tools registered in Claude Code

| Tool | What it does |
|------|--------------|
| `search_memory(query)` | Semantic search across all sessions. Frequent recalls auto-promote. |
| `add_memory(content, type)` | Store a fact, decision, bug fix. Capture freely — quality gate handles noise. |
| `get_context(task_description)` | Inject relevant context before starting a task. |
| `get_timeline(from, to, type)` | Chronological view of what you worked on. |
| `replay_file(path)` | Decision history for any file. |
| `spine_capture_turn(...)` | Append a single conversation turn (used by hook). |
| `spine_session_digest(...)` | Write the structured end-of-session digest. |
| `spine_recall_recent(max_tokens)` | Bootstrap a new session with recent digests + turns. |
| `spine_weekly_digest({ week })` | Roll up the week — paste-ready markdown. |
| `add_team_memory(content)` | Share a memory with your team (Team plan). |
| `pin_memory(content)` | Force a memory to inject on every recall, regardless of similarity. |

---

## How it works under the hood

1. **You start a session.** `SessionStart` hook injects last digests + last 50 turns. Claude begins already knowing what shipped yesterday.
2. **You type a prompt.** `UserPromptSubmit` hook appends one row, tagged with `session_id` + `role`. No embedding by default — pure timeline storage.
3. **You finish a session.** `Stop` hook parses the transcript, writes one digest row (files touched, commits, decisions). Always embedded.
4. **Recall request comes in.** Hybrid retrieval — vector cosine + BM25 + temporal decay + Haiku rerank (Pro+) + the promotion-tier bonus.
5. **Quarterly maintenance.** Stale rows surface in a digest email. Keep, archive, or let auto-archive happen at 90 days.

Every step is append-only. Nothing summarised. The corpus grows on quality.

---

## Append-only, by design

There is no public `delete_turn`, `update_turn`, or summarise/compress
API. The only deletion path is `spine_forget(id)` for individual memories
you explicitly want gone — for sensitive removals, not routine cleanup.

> *"Your AI remembers every word. Not a summary. Every word."*

---

## Embedding policy — the cost knob

Turns skip OpenAI embeddings by default. Keeps your bill bounded even on
chatty days — turns are still recallable via the timeline and the
start-of-session block, just not by cosine similarity.

```bash
export SPINE_EMBED_TURNS=1     # bash / zsh
$env:SPINE_EMBED_TURNS = '1'   # PowerShell
```

At `text-embedding-3-small` price, 1000 turns ≈ $0.02. Worth it for power
users; off by default for everyone else.

---

## Manual configuration

If auto-registration during `init` fails, paste this into
`~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "spine": {
      "command": "npx",
      "args": ["-y", "spine-mcp", "serve"]
    }
  },
  "hooks": {
    "SessionStart":     [{ "matcher": "", "hooks": [{ "type": "command", "command": "npx -y spine-mcp recall-recent" }] }],
    "UserPromptSubmit": [{ "matcher": "", "hooks": [{ "type": "command", "command": "npx -y spine-mcp capture-turn" }] }],
    "Stop":             [{ "matcher": "", "hooks": [{ "type": "command", "command": "npx -y spine-mcp session-digest" }] }]
  }
}
```

The legacy `hook-stop` (full-transcript chunking) still works and can run
alongside `session-digest` if you want both raw chunks and a digest.

---

## Commands

```
npx spine-mcp init                  Device-flow install (default)
npx spine-mcp init --key spine_live_…   Power-user fast path (existing key)
npx spine-mcp init --local          Zero-account, all on-device

npx spine-mcp serve                 Start MCP server (Claude Code runs this)
npx spine-mcp recall-recent         SessionStart hook
npx spine-mcp capture-turn          UserPromptSubmit hook
npx spine-mcp session-digest        Stop hook (structured digest)
npx spine-mcp hook-stop             Stop hook (full transcript chunking, legacy)
npx spine-mcp weekly-digest [--week=YYYY-WW] [--force]
                                     Roll up the week's session digests
npx spine-mcp inject                Older proactive-injection hook
npx spine-mcp sync                  Ingest local ~/.claude/projects/*/memory/*.md
```

---

## Pricing

- **Free** — 200 memories, MCP + browser extension, vector recall, JSON export
- **Pro $19/mo** — unlimited memories, hybrid vector + BM25, cross-encoder rerank, conflict detection, decay recovery, required-context pins, weekly digest
- **Team $59/mo · 5 seats** — everything in Pro + shared workspace, policies, org audit log, priority support

Low-signal memories don't count toward the Free cap. The 200 is real
useful memories — chatter rides free.

---

## Privacy

Your memories live in your isolated workspace, encrypted at rest. We do
not train on them. Export or delete in one click. If you self-host the
backend on your own Postgres, the data never leaves your infrastructure.

---

## Links

- Web dashboard: [spine.xxiautomate.com](https://spine.xxiautomate.com)
- Sessions view: [spine.xxiautomate.com/sessions](https://spine.xxiautomate.com/sessions)
- Weekly digests: [spine.xxiautomate.com/sessions/weekly](https://spine.xxiautomate.com/sessions/weekly)
- Source: [github.com/xxiautomate-star/spine](https://github.com/xxiautomate-star/spine)

---

> *Spine is a librarian, not a vault. Capture freely — Spine decides what to shelve.*
