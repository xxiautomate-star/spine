# @spine/mcp

The memory layer for your AI. Append-only, infinite, never summarised.

Every Claude Code session is captured verbatim, chunked, and stored. Search across all of them with natural language. Your AI finally remembers.

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

## Tools

| Tool | What it does |
|------|-------------|
| `search_memory(query)` | Semantic search across all sessions |
| `add_memory(content, type)` | Store a fact, decision, or bug fix |
| `get_context(task_description)` | Inject relevant context before a task |
| `get_timeline(from, to, type)` | Chronological view of what you've worked on |
| `replay_file(path)` | Decision history for any file |
| `add_team_memory(content, type)` | Share a memory with your team |

---

## How it works

1. You finish a Claude Code session
2. The Stop hook fires: `npx @spine/mcp hook-stop`
3. The full transcript is chunked into 2000-token segments
4. Each chunk is embedded and stored (local SQLite or cloud Postgres)
5. Next session: `get_context("what you're working on")` returns the most relevant chunks via BM25 + vector RRF + recency decay

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
    "Stop": [
      {
        "matcher": "",
        "hooks": [{ "type": "command", "command": "npx @spine/mcp hook-stop" }]
      }
    ]
  }
}
```

---

## Commands

```
npx @spine/mcp init                 Interactive setup
npx @spine/mcp init --key KEY       Non-interactive cloud setup
npx @spine/mcp init --local         Non-interactive local-only setup
npx @spine/mcp serve                Start MCP server (Claude Code runs this)
npx @spine/mcp hook-stop            Session capture hook (runs automatically)
```

---

## Links

- Dashboard: [spine.xxiautomate.com](https://spine.xxiautomate.com)
- Issues: [github.com/xxiautomate-star/spine](https://github.com/xxiautomate-star/spine)
