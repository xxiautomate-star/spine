# Spine E2E Walkthrough — Config → Install → Restart → Recall

This document proves the full user journey works end-to-end once:
- `xxiautomate-spine` is published to npm
- `spine.xxiautomate.com` is live
- Supabase is seeded with demo memories (see `scripts/seed-demo.ts`)

---

## Step 1 — Get the config from spine.xxiautomate.com

Visit `https://spine.xxiautomate.com` and click **Get your key →** in the TrialCTA section.

Or fetch it directly:

```bash
curl https://spine.xxiautomate.com/api/trial
```

Expected response:

```json
{
  "key": "spine_live_DEMO_KEY_REPLACE_WITH_YOURS",
  "endpoint": "https://spine.xxiautomate.com",
  "mcpJson": {
    "mcpServers": {
      "spine": {
        "command": "npx",
        "args": ["-y", "xxiautomate-spine"],
        "env": {
          "SPINE_API_KEY": "spine_live_DEMO_KEY_REPLACE_WITH_YOURS",
          "SPINE_ENDPOINT": "https://spine.xxiautomate.com"
        }
      }
    }
  }
}
```

---

## Step 2 — Verify npm package is live

```bash
npm show xxiautomate-spine
```

Expected output includes:
```
xxiautomate-spine@0.1.0
description: The memory layer for your AI...
bin: { 'xxiautomate-spine': './dist/cli.js' }
```

---

## Step 3 — Install MCP config

### Claude Code

Paste into `~/.claude/mcp.json` (create if it doesn't exist):

```json
{
  "mcpServers": {
    "spine": {
      "command": "npx",
      "args": ["-y", "xxiautomate-spine"],
      "env": {
        "SPINE_API_KEY": "your-real-key-from-dashboard",
        "SPINE_ENDPOINT": "https://spine.xxiautomate.com"
      }
    }
  }
}
```

### Claude Desktop

Paste into `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS).
Windows: `%APPDATA%\Claude\claude_desktop_config.json`.

---

## Step 4 — Test the MCP server starts

```bash
npx -y xxiautomate-spine
```

Expected stderr output:
```
[spine] cloud mode via https://spine.xxiautomate.com
```

The server starts on stdio and waits for MCP protocol messages. `Ctrl+C` to stop.

---

## Step 5 — Restart Claude Code / Claude Desktop

For Claude Code:
```bash
# In a new terminal
claude
```

You should see `spine` listed under connected MCP servers in the startup output.

---

## Step 6 — Store a memory

In Claude Code:
```
> Ask Claude: "Remember that my production database is on Supabase Sydney, project ID abc123."
```

Claude calls `spine_remember` tool internally. You'll see it in the tool use output.

Verify via API:
```bash
curl -X POST https://spine.xxiautomate.com/api/recall \
  -H "Authorization: Bearer your-real-key" \
  -H "Content-Type: application/json" \
  -d '{"query": "database location"}'
```

Expected response includes the stored memory with similarity > 0.7.

---

## Step 7 — Start a fresh session and test recall

Close and reopen Claude Code. Start a new session:

```
> Ask Claude: "What do you know about me?"
```

Claude calls `spine_recall` tool with the query. Expected response:

> Based on what Spine has stored from your previous sessions, I know that:
> - Your production database is on Supabase Sydney, project ID abc123
> - [other memories listed]

This proves cross-session memory is working.

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| `npx xxiautomate-spine` hangs with no output | Missing `SPINE_API_KEY` env var — the server starts but can't auth |
| `spine_recall` returns empty | No memories stored yet — run `spine_remember` first |
| `spine_recall` returns 401 | API key invalid or env var not set in MCP config |
| `spine_recall` returns 503 | `OPENAI_API_KEY` not set on server — embedding fails |
| MCP server not in Claude Code list | Config file path wrong or JSON syntax error |

---

## Publishing `xxiautomate-spine` to npm (Roman's action)

```bash
cd packages/mcp
npm run build
npm login          # log in as xxiautomate npm account
npm publish --access public
```

After publishing:
```bash
npm show xxiautomate-spine   # verify it's live
npx xxiautomate-spine --version   # verify installs and runs
```
