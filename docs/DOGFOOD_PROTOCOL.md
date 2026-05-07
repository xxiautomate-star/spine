# Dogfood protocol

The 7-day self-audit that gates the public launch of `spine-mcp`.

The Gate 2 retrieval harness used 200 synthetic memories. Real
conversations are noisier — 80% chatter, 20% signal. Until Spine survives
a week of Roman's actual usage, we don't know that it works. This file
is the playbook.

## Why this exists

We do not yet know:

- whether semantic recall surfaces decisions you actually need
- whether the signal-tier scorer correctly demotes chatter
- whether memories that get injected actually get *used* by the LLM
- whether the latency/token cost is sustainable when running all day

This protocol gives us numbers on all four.

## 1. Install Spine MCP from local source (no npm publish)

```bash
# in the repo root
cd saas/spine/packages/mcp
npm install
npm run build

# Symlink the local build globally so claude/cursor/etc. pick it up
npm link

# Verify
spine-mcp --version
which spine-mcp        # should resolve into your global npm prefix
```

Then register with Claude Code (or Claude Desktop / Cursor):

```bash
spine-mcp init --local         # local-only, no cloud sync
# OR
spine-mcp init --key spine_live_xxxxx     # cloud sync via Spine API
```

## 2. Swap the `serve` command for `dogfood`

The `dogfood` subcommand is wire-compatible with `serve` — your AI client
sees no difference — but every tool call gets recorded to a sidecar
SQLite at `~/.spine/dogfood.db`.

Edit your Claude Code MCP config (or Cursor / Claude Desktop equivalent)
and change the command from:

```jsonc
{
  "mcpServers": {
    "spine": {
      "command": "spine-mcp",
      "args": ["serve"]
    }
  }
}
```

to:

```jsonc
{
  "mcpServers": {
    "spine": {
      "command": "spine-mcp",
      "args": ["dogfood"]
    }
  }
}
```

Restart your AI client. Confirm in stderr: `[spine-dogfood] recording
telemetry to /Users/<you>/.spine/dogfood.db`.

## 3. Use Spine for 7 consecutive days

No artificial test queries. **Use it like a tool you already paid for.**
The whole point is to expose the friction that synthetic harnesses miss:

- Rambling, mixed-purpose conversations
- Same question asked three different ways
- Context-switches mid-session
- Days where you barely use it
- Days where you hammer it

## 4. Open the diary daily

```bash
# Set the admin id once (your Supabase user UUID)
export SPINE_ADMIN_USER_ID="<your-supabase-user-uuid>"

# Run the dashboard locally
npm run dev

# In another tab
open http://localhost:3000/api/dogfood/diary
# Or with a custom window: http://localhost:3000/api/dogfood/diary?days=3
```

You'll get JSON like:

```json
{
  "windowDays": 7,
  "totals": {
    "captures": 412,
    "recalls": 88,
    "capturesPerDay": 58.86,
    "recallsPerDay": 12.57
  },
  "recall": { "hitRate": 0.85, "recallsWithHit": 75 },
  "injection": {
    "memoriesInjected": 312,
    "memoriesReferenced": 0,
    "falsePositiveRate": 1.0
  },
  "signalTierDistribution": { "high": 71, "standard": 263, "low": 78 },
  "sourceDistribution": { "claude": 410, "unknown": 2 }
}
```

The first run will show `falsePositiveRate: 1.0` because we haven't yet
shipped the `/api/recall/feedback` endpoint that flips
`was_referenced=1` after the LLM cites an injected memory back. Until
that lands, treat the FP rate as a manual judgment call from the diary
template below.

## 5. Daily diary template

Copy this into a markdown note at the start of each dogfood day:

```markdown
# Day N — YYYY-MM-DD

## Numbers (from /api/dogfood/diary)
- Captures: 0
- Recalls: 0
- Recall hit rate: 0%
- Tier distribution: high=0, standard=0, low=0

## Sessions today
- session-id-1 — what I was doing
- session-id-2 — ...

## Surprises
(things that worked unexpectedly well, or unexpectedly badly)
-

## Painpoints
(friction that would make a stranger churn — be honest, no PR-speak)
-

## Manual FP audit (3 random recalls)
- query: "..." → returned: [...] → relevant? Y/N
- query: "..." → returned: [...] → relevant? Y/N
- query: "..." → returned: [...] → relevant? Y/N

## Decision: keep / fix / kill
(one line)
```

## 6. Go / no-go criteria for public launch

After 7 days, Spine ships **only** if:

- [ ] **Recall hit rate ≥ 0.65** averaged across the 7 days (Spine
      finds something for 2 out of 3 real questions)
- [ ] **Manual FP audit precision ≥ 0.7** (of the recalls Roman audits
      manually — 3 per day, 21 total — at least 70% of the surfaced
      memories are genuinely relevant)
- [ ] **Capture/day rate ≥ 20** (the friction is low enough that you
      actually use it; below 20 means it isn't sticking)
- [ ] **Signal-tier distribution looks right** — high+standard ≥ 80%,
      low ≤ 20%. If low is overflowing, the scorer is too aggressive.
- [ ] **Real-conversation harness passes** —
      `npm run test:real-conversation` returns green against staging
      (precision@5 ≥ 0.55 AND false-positive ≤ 0.30 — see
      tests/real-conversation-harness.spec.ts).
- [ ] **At least 3 "surprises that worked" entries** across the 7 days
      and **fewer than 3 painpoints that would make a stranger churn.**

If any of these fail: the issue is in `lib/retrieval.ts` (weights),
`lib/signal-scorer.ts` (write-time gate), or `lib/context-block.ts`
(injection format). Fix the underlying behavior — never lower the gate.

## 7. After the dogfood week

Once the criteria above are met:

```bash
# Switch back to vanilla serve in your AI client config
# Restart the client
spine-mcp --version

# Publish (Gate 5 of the launch stress-test brief)
cd saas/spine/packages/mcp
npm version patch
npm publish --access public
```

The `~/.spine/dogfood.db` file is yours to keep. It's the receipts.
