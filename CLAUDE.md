# SPINE — Worker Boot File

> You are a WORKER terminal. Your job is to build this SaaS product end-to-end.
> The COMMANDER terminal (running in `C:\Projects\claude-build`) gives you prompts.
> You reply with short status updates. Commander decides next steps.

---

## WHAT YOU'RE BUILDING

**Product:** SPINE — the memory layer for AI.

**The problem:** Every AI conversation is a cold start. ChatGPT, Claude, Gemini — they all forget you every session. Power users have hacked around this with sprawling memory files, scratchpads, system prompts. Normal users just re-brief, every time, forever.

**The product:** An MCP server + dashboard + browser extension that captures memories from every AI conversation and injects relevant context automatically. Your AI finally remembers you. Across sessions. Across models.

**The core principle — INFINITE, NOT COMPRESSED:** SPINE is append-only. It does NOT summarize, compress, or throw away. Every word, every conversation, every file mentioned, every tool call — stored forever. Vector search + semantic retrieval do the heavy lifting at query time. Competitors summarize because they run out of context window. We don't — we inject only what's relevant for *this* moment via embeddings, but the full corpus is always there. Tagline: "Your AI remembers every word. Not a summary. Every word."

**The wedge:** MCP is the official Anthropic-blessed protocol for exactly this. We ship an `npx spine` install and the user's Claude Code / Claude Desktop has persistent memory in 30 seconds.

**The hook:** *"I gave my AI 6 months of memory and now it knows me better than my co-founder."*

**Customer:** Developers and AI power-users first (those already using Claude Code, Cursor, Claude Desktop daily). Normie market later via Chrome extension for ChatGPT.

**Pricing (canonical — `lib/plan-limits.ts` is the source of truth):**
- Free — 200 memories, MCP + browser extension, vector recall, JSON export
- Pro $19/mo — unlimited memories, hybrid vector+BM25, cross-encoder rerank, conflict detection, decay recovery, required-context pins, weekly digest
- Team $59/mo · 5 seats — everything in Pro + shared workspace, policies, org audit log, priority support

---

## STACK (locked, do not deviate)

- **Frontend:** Next.js 15 App Router + TypeScript + Tailwind
- **DB/Auth:** Supabase (Postgres + pgvector for semantic memory search)
- **Payments:** Stripe
- **Deploy:** Coolify on Vultr Sydney (git push to main auto-deploys)
- **MCP server:** published as `@spine/mcp` npm package, runs locally on the user's machine, syncs to our Supabase
- **Embeddings:** OpenAI `text-embedding-3-small` for vector search, OR Voyage AI if we want cheap
- **Proactive injection:** Claude Haiku-4.5 filters which memories are relevant for the current conversation (cheap, fast)

---

## DESIGN LAW

This is NOT a terminal/dev-tool aesthetic like Autonomous Architect. This is about *memory, persistence, the archive of a relationship with your AI*. Think:

- Reference aesthetics: Readwise, Arc browser, Apple Journal, Craft, Things
- Palette: deep night `#0D0C0A` bg, cream text `#E8E4DD`, warm amber accent `#E89A3C` (like memory glow), occasional ink-blue `#4A5E7A`
- Typography: **Instrument Serif** for headlines (editorial, intimate), Inter for UI body, JetBrains Mono for timestamps/IDs
- Vibe: a library at dusk. Lamplit archive. Private diary.
- Micro-interactions: slow, deliberate, breath-paced (400-600ms, not 150ms snap)
- NO emojis. NO marketing-speak. Copy is reflective, slightly literary.

Example headline voice:
- ❌ "Never forget important details again with AI memory that sticks!"
- ✅ "Your AI forgets you every morning. We fix that."

---

## BUILD ORDER (phases)

**Phase 1 — Landing + waitlist (START HERE)**
- Landing page: hero, the problem, how it works (MCP install in 30 sec), pricing, FAQ, waitlist form
- Supabase table `waitlist` (email, created_at, tier_interest, referrer, use_case)
- Deploy to Coolify

**Phase 2 — MCP server MVP**
- `@spine/mcp` npm package: one command install, point at our API
- Server exposes tools: `spine_remember(fact)`, `spine_recall(query)`, `spine_forget(id)`
- Every time Claude Code uses these tools, memory syncs to user's Supabase row
- Auth via API key from dashboard

**Phase 3 — Dashboard**
- Sign in (Supabase OAuth)
- Timeline view: every memory, grouped by day, searchable
- API key management
- Memory edit/delete

**Phase 4 — Proactive injection**
- Smart context hook: before every Claude call, MCP pulls top 5 relevant memories and adds to system prompt
- Uses Haiku-4.5 to rank relevance

**Phase 5 — Chrome extension (ChatGPT/Gemini support)**
- Extension captures conversations on chatgpt.com / gemini.google.com
- Extracts facts, stores to Spine
- Injects context at start of new conversations via content script

**Phase 6 — Stripe billing**
- Checkout
- Plan enforcement (100 memory cap on free tier)
- Usage dashboard

---

## WORKING DIRECTORY

`C:\Projects\claude-build\saas\spine\`

Everything you build goes here. Do NOT touch anything outside this folder.

---

## DEPLOY

- Live host: Vercel. Project root = `saas/spine/`. Domain: `spine.xxiautomate.com`.
- `git push origin main` → Vercel auto-builds + deploys.
- Cron jobs run via Vercel cron (declared in `saas/spine/vercel.json`) — see `docs/CRON.md`.
- Before pushing: `npm run build` locally, fix errors, then push.
- Coolify-on-Vultr is the documented self-host path (`docs/SELF_HOST.md`); production no longer uses it.

---

## REPORTING BACK

When you finish a task, report in this exact format:

```
DONE: <what shipped>
DEPLOYED: <yes/no>
BLOCKED: <anything that needs Commander / Roman>
NEXT: <your proposed next step>
```

Keep replies under 200 words. Commander will paste your status into the main terminal and give you the next prompt.

---

## RULES

- No TODO comments in shipped code
- No placeholder content — always real copy
- Mobile-correct at 375px
- Test golden path in a browser before reporting DONE
- Decisions for Roman (pricing tweak, brand call, naming) → BLOCKED line
- Secrets (API keys, env vars) → BLOCKED with `.env.local.example` template
- Working name is SPINE — final brand may change after design review
