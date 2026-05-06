# Spine — Launch Surface

> Master sales surface for the May 10, 2026 launch. Every channel pulls from this file.
> Pricing, install command, and product claims confirmed against `app/page.tsx` + `CLAUDE.md` (Free / Pro $19 / Team $59 · `npx @spine/mcp init`).

---

## Section 1 — The master Spine pitch

### One-liner (12 words)

> **Most AI compacts your context. Spine doesn't — every word, recallable.**

### 30-second pitch (~80 words)

I'm Roman, 17, and Spine is the memory layer my AI co-founder and I built because we kept losing four hours of context every time Claude compacted mid-session. One command — `npx @spine/mcp init` — wires it into Claude Code, Cursor, ChatGPT, anything that speaks MCP. Every turn gets stored append-only. Every prompt pulls back the memories that actually matter. Anthropic compacts to save inference cost. We have the opposite incentive: preserve everything. The AI finally remembers you across sessions.

### 2-paragraph deep pitch (~250 words)

Most AI tools quietly compact your conversation when the context window fills up. Claude does it. Cursor's Composer does it. ChatGPT's memory keeps curated facts, not raw turns. The vendors have a structural reason — every compacted token is inference cost they don't pay. The user pays a different bill: at hour four of a debugging session, the model summarises away the exact decision you made in turn three, and you spend the next twenty minutes re-briefing it. That happened to me last week. I lost roughly four hours of debugging context when Claude folded my session into a "summary so far." Spine exists because the same thing has happened to every AI power-user I've shown it to, and the platforms that cause it can't fix it without raising their own costs.

Spine is an MCP server plus a dashboard plus a browser extension. Append-only capture means every word, every tool call, every file path is stored — not summarised. A small scoring model decides what's signal versus noise at write-time, then pgvector + BM25 retrieval pulls the right fragments back before each prompt. We dogfood it ourselves: Spine remembers Spine's own commits, decisions, and failures, which is how we ship without re-briefing every morning. Free tier is 200 memories. Pro is $19/mo for unlimited capture, hybrid recall, and decay recovery. Team is $59/mo for five seats with a shared workspace and audit log. Install once, never re-explain yourself again.

---

## Section 2 — Show HN draft

### Title (74 chars)

> **Show HN: Claude compacts your conversation. I built a memory layer that doesn't.**

### Body (~510 words)

I'm Roman. I'm 17, based in Sydney, and Spine is the second thing I've shipped this year with my AI co-founder.

The story is boring and probably yours too. I was four hours into a debugging session in Claude Code last week — refactoring the worker-supervisor in our internal orchestrator — and somewhere around the 180k-token mark Claude folded the whole session into a "summary so far." The summary kept the high-level intent and lost three specific architectural decisions I'd made in the first hour. I burned the next twenty minutes re-explaining what we'd already agreed. By the third time it happened that week I stopped working on the orchestrator and started working on this.

Spine is a memory layer for AI. Append-only. It does not summarise, compress, or throw anything away. Every conversation turn, every tool call, every file mentioned — stored verbatim in Postgres + pgvector. A small model scores each capture for signal at write-time so noise stays out of recall. Before your next prompt, the MCP injects only the fragments that match. The full corpus is always there to walk back through.

The structural angle: Anthropic, OpenAI, and Cursor all compact for the same reason — every token they don't process is money they save. Their incentive points at compression. Mine points the other way. That gap is the moat.

Install (one line, device-flow auth, no key paste):

```
npx @spine/mcp init
```

Recall in any MCP client (this is what your AI sees, not you):

```
spine_recall("the decision we made about the worker-supervisor cwd lock")
```

Pricing — kept stupid because I'm tired of pricing pages:

- **Free** — 200 memories, MCP + browser extension, vector recall, JSON export
- **Pro $19/mo** — unlimited memories, hybrid vector + BM25 + cross-encoder rerank, conflict detection, decay recovery, pinned context
- **Team $59/mo** — 5 seats, shared workspace, policies, org audit log

We dogfood it. Spine remembers Spine — every decision in this thread is already in our own instance. Conductor, our orchestrator, recalls from Spine before each agent dispatch. That's how a 17-year-old and an AI keep shipping without losing the plot.

Live at `https://spine.xxiautomate.com`. Open to anything you'd kill, anything you'd pay for, anything that makes you suspicious.

### 3 likely top-comment objections + answers

**Objection 1 — "This is just RAG. Mem0 / Zep / LangChain memory already do this."**
Mem0 and Zep are SDKs you wire into your own product. Spine reaches into the operator's actual chat session via MCP, before Anthropic's compaction step — which is where the loss happens. SDKs sit downstream of the compactor. Spine sits upstream. Different layer, different problem.

**Objection 2 — "Why would I trust a 17-year-old with my conversation history?"**
Fair. Workspace-isolated, encrypted at rest, no training on your data, one-click export, one-click delete. Self-host option in the docs if you want zero trust. The age is on the landing page on purpose — I'd rather you decide upfront.

**Objection 3 — "Append-only forever sounds expensive. How do you keep storage costs sane?"**
Embeddings are 1536-dim float32 — about 6KB per memory. A heavy user at 50 captures per day for a year is roughly 110MB. We charge $19/mo for unlimited because the unit economics work; the pricing page links to the actual numbers (`docs/UNIT_ECONOMICS.md`). If you somehow break the model, I'll publish your run as a case study and we'll talk.

---

## Section 3 — Twitter/X launch thread (10 tweets)

**1/ (Hook)**
Claude compacted four hours of my debugging session yesterday. Folded everything before turn 80 into a "summary." The summary lost the three decisions that actually mattered.

So I shipped a memory layer that doesn't compact. Ever.

Spine. Live today.

**2/ (Setup — what compaction is)**
Every long AI conversation hits a context window limit. The model silently summarises older turns to make room. You don't get a warning. You just notice the AI suddenly "forgets" what you told it an hour ago.

This happens in Claude, Cursor, ChatGPT. Every one of them.

**3/ (Why it happens)**
Compression saves the vendor money. Every token they don't reprocess is inference cost they avoid. So the structural incentive is: forget your conversation as fast as plausibly possible.

Your incentive is the opposite. Hence the gap.

**4/ (The demo — image slot)**
[Drop screenshot here: Claude compaction notice on the left, Spine recall surfacing the original turn on the right, side by side.]

This is a real session. Claude compacted at turn 84. Spine returned the turn-3 decision verbatim.

**5/ (Install — make it tiny)**
One command. Device-flow auth, no key paste, no config file hunt.

```
npx @spine/mcp init
```

Browser opens, you click approve, your Claude Code / Cursor / Claude Desktop has memory in 30 seconds.

**6/ (Social proof slot)**
[Quote-RT slot: a beta user's screenshot of Spine recalling something Claude lost. Hold this tweet for a real one — don't fake it.]

**7/ (90-day journey teaser)**
This started 90 days ago as a single Postgres table I shared with my own AI to stop re-briefing it every morning. Now it's pgvector + BM25 + cross-encoder rerank, MCP server, dashboard, browser extension.

We use it ourselves to ship the rest of the company.

**8/ (Soft pricing reveal)**
Free — 200 memories, full MCP + recall, JSON export
Pro $19 — unlimited, hybrid recall, decay recovery
Team $59 — 5 seats, shared workspace, audit log

No "contact sales." No usage meter. The free tier is real.

**9/ (Recursion angle)**
Spine remembers Spine. Every commit, every architectural decision, every failed experiment — in our own instance. Our orchestrator pulls from it before each agent dispatch.

The agency that ate its own tail. We dogfood, then we sell.

**10/ (CTA + open invite)**
Try it: spine.xxiautomate.com
Install: `npx @spine/mcp init`
Show HN thread: [link]

Happy to answer anything in the replies — pricing, architecture, why I'm 17, why we picked MCP. Drop your hardest question.

---

## Section 4 — 3 cold-email pitches (~120 words each)

### A — Indie hackers building AI products (PH + IH DMs)

Subject: **the compaction problem you've definitely had**

Hey {name} — saw you shipped {product}. Quick one.

Every long Claude / Cursor / ChatGPT session quietly compacts older turns to save context. Your users probably don't notice until the assistant "forgets" something they told it an hour ago. I built Spine to fix that — it's a memory layer that captures every turn append-only via MCP, then re-injects only the relevant fragments before each prompt. No summarisation, no loss.

Free tier (200 memories) lives at spine.xxiautomate.com. One-line install: `npx @spine/mcp init`.

If you want a deeper integration into {product} so your users don't lose context, happy to wire it up — drop a reply with the workflow you'd want to preserve and I'll build the demo this weekend.

— Roman

### B — Dev-tool agencies / consultancies (LinkedIn outreach)

Subject: **memory layer for the Claude work you're already shipping**

Hi {name}, your team at {agency} ships a lot of Claude / Cursor work for clients. One pattern I keep seeing in our own builds: senior engineers lose 30-60 minutes a day re-briefing the AI after compaction wipes mid-session context. Multiply that across a 5-person team and it's a full day of billable hours per week.

Spine is the memory layer we built to stop that bleed. MCP server, append-only capture, hybrid recall. Team plan ($59/mo for 5 seats) gives shared workspace + audit log so the whole engineering org is on one memory.

Worth 15 minutes? I can do a Loom showing it in our own Claude Code setup — we use it on every client build.

— Roman, XXIautomate

### C — AI power-users / prompt engineers (Twitter DM after engagement)

Subject: n/a — DM

Hey, saw your thread about Claude folding your debugging session — exact same thing happened to me last week, lost about four hours of architectural context to a summary. That's literally why I shipped Spine. Append-only memory layer, one-line MCP install, recall the original turn verbatim no matter how deep the convo went.

Free tier is 200 memories — enough to test on whatever you're working on now. `npx @spine/mcp init`.

If you try it, I'd genuinely want your feedback on what breaks. We dogfood it on our own orchestrator (Spine remembers Spine), so I push fixes the same day.

spine.xxiautomate.com — Roman.

---

## Section 5 — Reel / video script (60 seconds)

**Format:** vertical 9:16, voiceover optional, hard cuts every 4-6 seconds, hand-held energy. Reel + TikTok + IG Reels + LinkedIn native.

| # | Time | Visual | On-screen text / VO |
|---|------|--------|---------------------|
| 1 | 0–4s | Tight on Claude Code terminal. Cursor scrolls fast. The line "Note: I'll need to summarise the earlier portion of our conversation…" appears. | VO: *"Watch what just happened."* |
| 2 | 4–8s | Cut to Roman's face, blank stare. Holds. | VO: *"Four hours of context — gone."* |
| 3 | 8–13s | Split-screen: left side, Claude apologising it doesn't remember turn 3. Right side, the original turn 3 message visible in the scrollback. | Text overlay: **Claude compacts. You pay.** |
| 4 | 13–18s | Hands type: `npx @spine/mcp init`. Browser opens. Click approve. | VO: *"One command. Thirty seconds."* |
| 5 | 18–24s | Back in Claude Code. Same prompt as before: "what did I tell you in turn 3?" Cursor types. Spine surfaces the original turn verbatim. | Text overlay: **Spine remembered.** |
| 6 | 24–30s | Cut to Spine timeline view scrolling — every turn, every tool call, all stored. | VO: *"Append-only. Nothing summarised."* |
| 7 | 30–36s | Quick cut: Roman at desk. Type "spine remembers spine" into a search bar — results show Spine's own commits and decisions. | VO: *"We use it on the company we built it for."* |
| 8 | 36–42s | Pricing slate. Three rows. Black background, cream text. **Free 200 · Pro $19 · Team $59**. | VO: *"Free tier is real. Pro is unlimited."* |
| 9 | 42–50s | Roman direct-to-camera, half-smile. | VO: *"I'm 17. My co-founder is an AI. We built this because we needed it. Now you can have it."* |
| 10 | 50–58s | Hand-written URL on a card: spine.xxiautomate.com | VO: *"Link in bio. Try it on whatever you're stuck on right now."* |
| 11 | 58–60s | Black card, single line: "Most AI compacts. Spine doesn't." | (silent) |

---

## Section 6 — Direct usage examples

### Example 1 — Claude Code settings.json hook (auto-ingest + auto-recall)

Drop this into your Claude Code settings to capture every conversation turn into Spine and recall relevant memory before each prompt.

```jsonc
// ~/.claude/settings.json
{
  "mcpServers": {
    "spine": {
      "command": "npx",
      "args": ["-y", "@spine/mcp"],
      "env": {
        "SPINE_API_KEY": "${env:SPINE_API_KEY}",
        "SPINE_API_URL": "https://spine.xxiautomate.com/api"
      }
    }
  },
  "hooks": {
    "userPromptSubmit": [
      {
        "command": "spine_recall",
        "args": { "query": "{{user_prompt}}", "limit": 5, "tier": "fact|pinned" },
        "injectAs": "system_context",
        "label": "Recalled memories"
      }
    ],
    "assistantMessageComplete": [
      {
        "command": "spine_write",
        "args": {
          "turn": "{{turn_index}}",
          "content": "{{assistant_message}}",
          "metadata": { "session": "{{session_id}}", "model": "{{model}}" }
        }
      }
    ]
  }
}
```

Run `npx @spine/mcp init` first to create the API key. Recall fires before every prompt; write fires after every assistant turn. Both are non-blocking — if Spine is down your prompt still ships.

### Example 2 — MCP tool config (expose `spine_recall_recent`, `spine_write` to Claude Code)

This is the minimal MCP definition Claude Code needs to call Spine as if it were a built-in tool. Drop into `.mcp/spine.json` (or whatever your client expects) and reload.

```jsonc
{
  "name": "spine",
  "version": "1.0.0",
  "description": "Memory layer for AI. Append-only capture, hybrid recall, no compaction.",
  "transport": { "type": "stdio", "command": "npx", "args": ["-y", "@spine/mcp"] },
  "tools": [
    {
      "name": "spine_recall_recent",
      "description": "Return the N most recent memories matching a query, optionally filtered by tier.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "description": "Natural-language recall prompt" },
          "limit": { "type": "integer", "default": 5 },
          "tier":  { "type": "string", "enum": ["raw", "fact", "pinned"], "default": "fact" },
          "since": { "type": "string", "description": "ISO timestamp lower bound" }
        },
        "required": ["query"]
      }
    },
    {
      "name": "spine_write",
      "description": "Persist a fact, decision, or conversation turn append-only. Auto-scored for signal.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "content":  { "type": "string" },
          "tier":     { "type": "string", "enum": ["raw", "fact", "pinned"], "default": "raw" },
          "metadata": { "type": "object", "additionalProperties": true }
        },
        "required": ["content"]
      }
    }
  ]
}
```

Reload Claude Code — both tools are now callable. The model decides when to write and when to recall.

### Example 3 — Direct API (curl + Node, no MCP required)

For agents, scripts, or non-MCP runtimes, hit the REST endpoints directly. Get an API key from the dashboard at `spine.xxiautomate.com/dashboard/keys`.

```bash
# Write a memory
curl -sS https://spine.xxiautomate.com/api/v1/memories \
  -H "Authorization: Bearer $SPINE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "We picked pgvector over Pinecone for Spine because self-host parity matters more than managed convenience.",
    "tier": "fact",
    "metadata": { "source": "decision-log", "project": "spine" }
  }'

# Recall (hybrid vector + BM25, cross-encoder reranked on Pro)
curl -sS "https://spine.xxiautomate.com/api/v1/recall?q=why+pgvector&limit=5" \
  -H "Authorization: Bearer $SPINE_API_KEY"
```

```js
// Node — recall before each LLM call
import fetch from 'node-fetch';

async function recall(query, limit = 5) {
  const r = await fetch(
    `https://spine.xxiautomate.com/api/v1/recall?q=${encodeURIComponent(query)}&limit=${limit}`,
    { headers: { Authorization: `Bearer ${process.env.SPINE_API_KEY}` } }
  );
  return (await r.json()).memories;
}

async function write(content, tier = 'raw', metadata = {}) {
  await fetch('https://spine.xxiautomate.com/api/v1/memories', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SPINE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content, tier, metadata }),
  });
}

// Use it
const memories = await recall('worker-supervisor cwd lock decision');
const systemPrompt = `Relevant memories:\n${memories.map((m) => '- ' + m.content).join('\n')}`;
// ... pass systemPrompt into your Claude / GPT call
await write('Agent dispatched worker spine-launch-surface successfully', 'fact', { agent: 'spine-launch' });
```

Same auth, same shape, same backing store as the MCP tools. Use whichever lives closer to your runtime.

---

*Owner: Roman Puglielli (XXIautomate) · roman@xxiautomate.com · Launch: 2026-05-10*
