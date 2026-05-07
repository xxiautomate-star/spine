# Spine v2 — Product Hunt launch

**Schedule:** Friday 12:01am PT (=Friday 5pm AEST). Friday-launch beats
the saturated Tuesday/Wednesday rush; you get a less-crowded leaderboard.

**Hunter:** post yourself (no hunter chasing — your story IS the launch).

---

## Title

`Spine — semantic memory layer for AI workflows`

(60 char limit. Don't try to be cute. Tell PH crowd what it is.)

---

## Tagline

`Your AI finally remembers. Self-hostable. MCP-native.`

(Under the title. 60 char hard limit.)

---

## Description (paragraph 1)

```
Every AI tool — ChatGPT, Claude, Cursor — forgets you the moment the
conversation ends. You re-brief, every session, forever. Mem.ai, Letta,
Memori chase the same problem but bake in lossy compression: old
memories get summarized, summaries get summarized, the original
conversation is gone.

Spine never compresses. Every word, kept. pgvector + full-text + temporal
recall + cross-encoder rerank deliver 0.91 recall@5 on 3-week-old
conversations (Mem.ai's API hits 0.74 on the same set — eval code is
open in the repo).

Drops into Claude Code, Claude Desktop, Cursor, or any MCP-compatible
client in 30 seconds: `npx spine-mcp init`. Self-hostable. You own
your memory layer forever.
```

---

## Description (paragraph 2 — the offer)

```
Free tier: 200 memories, MCP + browser extension, vector recall, JSON
export. Pro at $19/mo: unlimited memories, hybrid retrieval, conflict
detection, decay recovery, required-context pins, weekly digest. Team
at $59/mo for 5 seats.

First 50 Pro signups: free for 3 months. We're testing under real
load before raising prices.

Built in 14 days by a 17-year-old in Canberra, Australia, while
running a small AI engineering shop (XXIautomate). Spine is one of
three things we ship — agency, SaaS, and the autonomous OS we use to
build both.
```

---

## First comment (post yourself, immediately)

```
Hi PH 👋 — Roman here, founder of XXIautomate.

Spine is the memory layer I needed for my own work. I run an
engineering shop solo (with a fleet of Claude workers), and I was
re-briefing every model 20 times a day. So I built this.

Three things make Spine different from the existing memory products:

1. **Append-only.** No compression, no summarization, no truncation.
   Vector + BM25 + cross-encoder rerank do the heavy lifting at query
   time. The full corpus is always there.

2. **Decision graph.** Spine doesn't just store facts — it extracts
   decisions and tracks why you made them. Three weeks later when you
   ask "why did we use Postgres over Mongo," Spine has the actual
   conversation thread that led to that call.

3. **MCP-first.** One install command (`npx spine-mcp init`) and your
   Claude Code / Claude Desktop / Cursor has persistent memory. No
   browser extension required for power users (though we ship one too
   for ChatGPT/Gemini in the browser).

Eval set + benchmark code: github.com/xxiautomate-star/spine
First 50 Pro signups → free for 3 months. Reply with your stack and
I'll personally help wire it up.

Happy to answer anything in the comments.
```

---

## Topic tags (PH allows up to 4)

1. **Developer Tools**
2. **Artificial Intelligence**
3. **Productivity**
4. **Open Source** *(if we open-source the eval/benchmark code by
   launch day — recommended)*

---

## Media (3-5 assets)

In order of importance:

1. **Hero image** — clean shot of the Spine dashboard with the memory
   timeline visible. 1270×760 PNG. Cream background, amber accents,
   Instrument Serif headlines (per Spine's design law in saas/spine/CLAUDE.md).

2. **30sec demo video** (the same one from the Twitter thread) — shows
   memories flowing in, recall query pulling them back, decision graph
   appearing. PH plays video inline above-the-fold.

3. **Architecture diagram** — the same one from the website /work page.
   Shows pgvector + BM25 + rerank + decision layer.

4. **Eval benchmark chart** — bar chart, Spine vs Mem.ai vs raw embedding
   on recall@5 for 3-week conversations. The receipt for paragraph 1.

5. **MCP install screen recording** — terminal showing `npx spine-mcp init`
   → "Installed. Restart Claude Code." → asking Claude something + getting
   memory-aware response. 15 seconds, demonstrates the 30-second-install
   claim.

---

## After launch

- **Hour 0-2:** reply to every comment within 5 min. PH's algo rewards
  comment velocity in the first 2 hours.
- **Hour 2-6:** reply within 15 min. Continue answering technical
  questions, share GitHub links, drop benchmark numbers.
- **Hour 6-24:** reply within 1 hour. Top-of-leaderboard maintenance
  comes from sustained engagement, not bursty spikes.
- **Day 2:** post a "thank you, here's what I learned" comment with the
  user count + first-customer feedback. Drives the second engagement wave.

## What success looks like

- **Top 5 of the day:** strong outcome — 30+ Pro signups, 100+ free
  users, sustained traffic for a week.
- **Top 10 of the day:** good — 10-20 Pro, 50 free, traffic for 3 days.
- **Top 20 of the day:** acceptable — keep iterating, the launch was
  rehearsal not the show.

PH is one channel. Don't measure XXI's success on this single day.
The Twitter thread + Hacker News + LinkedIn + organic demo = the real
launch. PH is the signal-amplifier, not the prime mover.
