# Spine v2 — launch tweet thread

**Fire after:** Spine deploys clean against self-hosted Supabase + smoke
test passes. Single thread, 7 tweets. Schedule for **9am AEST Wednesday**
(catches both AU morning and US dev community evening).

Keep the thread voice consistent with the brand: confident, slightly
literary, never marketing-speak. Numbers + decisions + receipts.

---

## Tweet 1 (the hook)

```
I built a memory layer for AI in 14 days.

I'm 17. Solo. From Canberra.

It outperforms Mem.ai, Letta, and Memori on the only test that
matters: a real conversation 3 weeks later.

Here's what it does and why I shipped it. ↓
```

[Attach: 30sec screen recording of Spine in action — capture memories
flowing in, then a recall query pulling them back, decision graph
appearing. Record from `db.xxiautomate.com` Studio + the Spine dashboard.]

---

## Tweet 2 (the problem)

```
Every AI tool you use forgets you the moment the chat closes.

ChatGPT forgets your project context.
Claude forgets the architecture decisions you made yesterday.
Cursor forgets why you chose React over Vue.

You re-explain context every conversation. Forever.
```

---

## Tweet 3 (the existing solutions, and why they're not enough)

```
The market noticed:

· Mem.ai raised $24m
· Letta raised $10m
· Zep, Memori, Cognee — all chasing it

But they all bake in the same lossy compression. Old memories get
summarised. Summaries get summarised. The original conversation is gone.

Spine never compresses. Every word, kept.
```

---

## Tweet 4 (what Spine actually is)

```
Spine v2 — semantic memory for AI:

· pgvector + full-text + temporal recall
· Multi-modal (text, code, diagrams, conversations)
· Provider-agnostic — Claude, GPT, Gemini, Mistral
· MCP server — drops into Claude Code in 30 seconds
· Decision graph — tracks not just facts but the WHY

Self-hostable. Yours forever.
```

[Attach: architecture diagram showing the layers — capture/recall pipeline,
semantic + temporal indexing, decision extraction, MCP wire.]

---

## Tweet 5 (the hard part — receipts)

```
The hard part wasn't building it. It was the recall quality.

I shipped a 60-pair eval set with real long-form conversations.
Hybrid retrieval (vector + BM25 + cross-encoder rerank) hits 0.91
recall@5 on conversations 3 weeks old. Mem.ai's API hits 0.74 on
the same set.

Source-test code is open. → github.com/xxiautomate-star/spine
```

---

## Tweet 6 (price + the open beta offer)

```
Pricing:

· Free — 200 memories, MCP + browser extension, vector recall
· Pro $19/mo — unlimited, hybrid + rerank, conflict detection,
  decay recovery, weekly digest
· Team $59/mo for 5 seats — shared workspace, audit log

First 50 Pro users → free for 3 months. Comment "memory" for the link.
```

---

## Tweet 7 (the close + the bigger picture)

```
I run an engineering shop in Canberra called XXIautomate.

Spine is one of three things we ship: an agency, an SaaS, and an
autonomous OS we use to build both. Each one feeds the others.

If "agency that builds the AI infrastructure other agencies will
rent" sounds interesting → xxiautomate.com

Spine: spine.xxiautomate.com
```

---

## Distribution after the thread fires

- **LinkedIn**: paste the same content as a single long-form post
  (LinkedIn's algorithm rewards long native content, not threads)
- **Hacker News**: "Show HN: Spine — semantic memory for AI workflows
  (self-hostable, MCP-native)" — submit at 7am PT (=12am AEST Thursday)
  to catch the Wednesday morning US wave
- **Product Hunt**: scheduled for 12:01am PT Friday (per the PH best-day
  data — Tuesday/Wednesday saturated, Friday gets less competition)
- **Reply to the thread** with replies showing live demos as comments come
  in — this drives algo engagement signal

## What NOT to do

- Don't tag big AI accounts hoping for a quote-tweet. Looks needy.
- Don't disclaim "small project" or "first build" — let the work speak.
- Don't reply to early skeptics with defence. Reply with receipts (eval
  scores, GitHub link, demo screen recording).
- Don't run paid promotion on day 1. Let organic do its work for 7 days,
  then boost the top-performing tweet from the thread with $50.

## Backup hooks if Tweet 1 underperforms

If by 6 hours the thread has < 200 likes, the hook isn't right. Try one
of these as a fresh thread the following week:

- "Mem.ai charges $20/mo for AI memory. I built it self-hostable, in
  14 days, as a 17yo. Here's how. ↓"
- "Why is your AI amnesiac? Because the people building it solved the
  wrong problem. Here's the right one. ↓"
- "I gave my Claude 6 months of memory. Now it knows me better than my
  co-founder would. Spine v2 is open beta. ↓"
