# Spine — Claude Code hook scripts

Three reference hooks that turn Spine into a full memory layer for every
Claude Code session: recall at start, capture every turn live, write a
digest at end. Append-only by construction — Spine never deletes,
summarises, or forgets.

These scripts are **reference implementations**. We don't bundle them
because installing shell hooks on a user's machine without consent is a
security smell. Copy what you need, adapt to your shell, paste the JSON
snippet into your Claude Code settings.

## What each hook does

| Hook | When it runs | What it writes | Cost |
|---|---|---|---|
| `session-start` | New CLI session begins | nothing — emits recent-context to stdout | zero |
| `user-prompt-submit` | You hit Enter on a prompt | one turn row, no embedding by default | zero (default) / ~$0.02 per 1000 turns if `SPINE_EMBED_TURNS=1` |
| `session-end` | Stop hook fires (session ends) | one digest row (always embedded) | ~$0.00002 per session |

## Wiring into Claude Code

Edit `~/.claude/settings.json` (or `.claude/settings.json` in a project
for per-project hooks):

### macOS / Linux

```json
{
  "hooks": {
    "SessionStart": [
      { "command": "bash /path/to/spine/hooks/session-start.sh" }
    ],
    "UserPromptSubmit": [
      { "command": "bash /path/to/spine/hooks/user-prompt-submit.sh" }
    ],
    "Stop": [
      { "command": "bash /path/to/spine/hooks/session-end.sh" }
    ]
  }
}
```

### Windows (PowerShell 5.1+)

```json
{
  "hooks": {
    "SessionStart": [
      { "command": "powershell -NoProfile -ExecutionPolicy Bypass -File C:\\path\\to\\spine\\hooks\\session-start.ps1" }
    ],
    "UserPromptSubmit": [
      { "command": "powershell -NoProfile -ExecutionPolicy Bypass -File C:\\path\\to\\spine\\hooks\\user-prompt-submit.ps1" }
    ],
    "Stop": [
      { "command": "powershell -NoProfile -ExecutionPolicy Bypass -File C:\\path\\to\\spine\\hooks\\session-end.ps1" }
    ]
  }
}
```

## Embedding policy — the cost knob

By default, `user-prompt-submit` stores turn rows **without embeddings**.
That keeps your OpenAI bill bounded even on chatty days — turns are
still recallable via the timeline (`spine_timeline`) and the start-of-
session block (`spine_recall_recent`), just not by semantic similarity.

To enable per-turn embeddings (semantic search hits every word you've
ever typed), set the environment variable before launching Claude Code:

```bash
export SPINE_EMBED_TURNS=1   # bash / zsh
$env:SPINE_EMBED_TURNS = '1' # PowerShell
```

At OpenAI's `text-embedding-3-small` price (~$0.02 per million tokens),
1000 average turns runs about $0.02. Worth it for power users; off by
default for everyone else.

## Coexisting with the legacy `hook-stop`

If you're already running `npx spine-mcp hook-stop` on the Stop event,
you can keep it — it captures the raw transcript chunked into 7500-char
segments. The new `session-digest` hook is additive: it writes one extra
row tagged `kind=digest` that Spine surfaces at next-session-start. You
can run both, neither, or just one — they don't conflict.

## Verifying it works

After wiring up, in a fresh Claude Code session:

```
> What do you know about my project?
```

If the SessionStart hook fired correctly, Claude has already seen the
recent-context block. It should reference at least one prior decision
without you re-describing.

Then check the dashboard at `https://spine.xxiautomate.com/sessions` —
your live session should show with each turn populating in near-real-
time.
