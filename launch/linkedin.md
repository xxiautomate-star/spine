# Spine v2 — LinkedIn launch post

**Post:** Wednesday morning AEST, same day as the Twitter thread. 9am
post time hits the AU lunch crowd and the European morning.

LinkedIn rewards long-form native content (text + 1-2 images), not
linked threads. So we paste a single long post, not a thread.

---

## The post

```
I'm 17 years old. I run a small AI engineering shop in Canberra, Australia.

This week I shipped Spine — a semantic memory layer for AI workflows.

The problem: every AI tool you use forgets you the moment the
conversation ends. ChatGPT forgets your project context. Claude
forgets the architecture decisions you made yesterday. Cursor forgets
why you chose React over Vue. You re-explain context every conversation.
Forever.

The market noticed. Mem.ai raised $24m. Letta raised $10m. Zep, Memori,
Cognee — all chasing the problem. Each of them solves it the same way:
they compress old memories into summaries, then summaries of summaries.
Lossy. The original conversation is gone.

Spine takes the opposite approach. Append-only. Every word, kept. We do
the heavy lifting at query time using a hybrid retrieval pipeline —
pgvector for semantic similarity, BM25 for exact-match recall,
cross-encoder rerank for the final ordering. On a 60-pair eval set with
real long-form conversations, Spine hits 0.91 recall@5 on 3-week-old
conversations. Mem.ai's API hits 0.74 on the same set.

Beyond raw memory, Spine extracts decisions as first-class objects.
When you ask "why did we use Postgres over Mongo?" three weeks later,
Spine doesn't just return matching memories — it returns the actual
decision node, the alternatives we considered, and the reasoning at
the time.

Drop-in: `npx spine-mcp init` and your Claude Code / Claude Desktop
/ Cursor has persistent memory in 30 seconds. Self-hostable. Free tier
covers 200 memories. Pro at $19/month for unlimited + the full hybrid
retrieval stack.

First 50 Pro users — free for 3 months. We're testing under real load
before pricing settles. DM me with your stack and I'll personally help
wire it up.

XXIautomate (the agency I run) ships three things: an agency, a SaaS
(this), and an autonomous OS we use to build both. Each one feeds the
others. If you've ever wondered what an "AI engineering shop" actually
looks like — we're building in public:

xxiautomate.com
spine.xxiautomate.com
github.com/xxiautomate-star/spine

— Roman
```

---

## Image to attach

Single image: the Spine architecture diagram (same asset used on the
website /work page). LinkedIn weights posts with images higher in feed.

Don't post the 30sec video on LinkedIn — videos drag attention away from
the text and LinkedIn's algorithm de-weights mixed-media posts.

---

## Hashtags (LinkedIn allows ~3 to be useful)

`#SaaS #AI #Postgres`

(Don't stuff hashtags. Three is the LinkedIn sweet spot — algorithm
treats more as spam.)

---

## After-post

- Reply to comments within 30 min for the first 2 hours.
- If a senior dev / founder leaves a comment, ALWAYS reply with a
  technical detail (eval methodology, retrieval pipeline choice). Don't
  just say "thanks!" — that wastes the engagement.
- Connect with anyone who comments and looks like a real prospect.
  Send them a connection request with a one-line note: "Saw you on the
  Spine post — I'd love to hear what you're building."

## Why LinkedIn matters

For Spine specifically: LinkedIn's audience is fewer hobbyists, more
buyers. SaaS founders, solo developers running paid stacks, AI consultants
billing $200/hr who'd happily pay $19/mo to never re-explain context.

For XXIautomate: LinkedIn is where AU agency clients live. Inbound
landing on xxiautomate.com from this post is more likely to be a paying
client than from Twitter (which drives more dev / open-source traffic).
