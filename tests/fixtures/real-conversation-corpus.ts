// 4-hour-equivalent founder-on-founder transcript. ~150 turns total.
// Mix is intentional:
//   - 30 SIGNAL turns (decisions, facts, locked positions) — should hit
//     in semantic recall
//   - 120 NOISE turns (chatter, jokes, pleasantries, throat-clearing) —
//     should NOT hit on the SIGNAL queries
//
// 80/20 noise/signal ratio mirrors what we measured in Roman's actual
// Claude Code sessions. Real users don't speak in tightly-formed facts;
// they ramble, joke, restate, retract, then drop the load-bearing line.
//
// Every turn carries a `kind` of 'signal' | 'noise'. Memories are
// captured WITH the kind preserved as a tag (`harness:kind:signal` etc)
// so the harness can compute precision + recall from query results.

export type TurnKind = 'signal' | 'noise';

export type Turn = {
  text: string;
  kind: TurnKind;
};

// 30 signal turns — the decisions and facts a query *should* hit. These
// are the moments a real founder would later try to recall ("what did
// we decide about pricing?", "remind me what stack we picked").
const SIGNAL: Turn[] = [
  { kind: 'signal', text: 'Locked decision: Free plan is 200 memories. Pro is unlimited at $19/mo. Team is unlimited at $59/mo for 5 seats.' },
  { kind: 'signal', text: 'Stack lock: Next.js 15 App Router, TypeScript strict, Postgres on Supabase, pgvector for embeddings, OpenAI text-embedding-3-small.' },
  { kind: 'signal', text: 'We picked LemonSqueezy over Stripe because we are 17 and Stripe needs an ABN we cannot get without parental sign-off.' },
  { kind: 'signal', text: 'Decision: device-flow install (RFC 8628) replaces API-key paste. One command in terminal, browser opens, click approve.' },
  { kind: 'signal', text: 'We will dogfood Spine for 7 days before opening public signups. Acceptance criteria: precision@5 ≥ 0.55 on real conversation transcripts.' },
  { kind: 'signal', text: 'Brand voice: librarian at dusk, not terminal. Instrument Serif for headlines, never marketing-speak. No emojis in copy.' },
  { kind: 'signal', text: 'The append-only invariant is non-negotiable. Spine never compresses, never summarises, never overwrites. Vector search does the relevance work at query time.' },
  { kind: 'signal', text: 'We are building Conductor as the desktop driver — Claude as M18 owner. Tauri, not Electron. Cold-start budget under 1.5 seconds.' },
  { kind: 'signal', text: 'Vultr Sydney is the deploy target. Coolify for orchestration. Self-hosted GitHub Actions runner for builds after the CPU throttle incident on 2026-04-29.' },
  { kind: 'signal', text: 'Roman is the founder, not Angus. Use xxiautomate@gmail.com for outbound. There is no roman@ alias yet.' },
  { kind: 'signal', text: 'May 25 cumulative-revenue target is $50,000. Currently at $500 — need 100x in 28 days. Every decision tested against this lens.' },
  { kind: 'signal', text: 'First paying customer: Dion Chung at Suburban Shine. $500 deposit cleared 2026-04-25. Site goes live Saturday April 18.' },
  { kind: 'signal', text: 'Locked aesthetic for spine.xxiautomate.com: deep night #0D0C0A, cream #E8E4DD, warm amber #E89A3C. Inter for body, Instrument Serif for headlines.' },
  { kind: 'signal', text: 'We use Haiku-4.5 for proactive context injection ranking. Cheap, fast, ranks top-5 relevant memories per call.' },
  { kind: 'signal', text: 'Decision: skip the browser extension at launch. MCP-first wedge with Claude Code, then ChatGPT extension as v2 next month.' },
  { kind: 'signal', text: 'Memory promotion ladder: 3 recalls in 30 days promotes a memory to "fact" tier. 8 recalls in 60 days promotes to "pinned" — always-injected.' },
  { kind: 'signal', text: 'Active pruning protocol: memories untouched for 60 days surface in a quarterly digest. Auto-archive after 90 days of inaction. Soft-delete only — recoverable.' },
  { kind: 'signal', text: 'Conflict detection fires when a new capture contradicts a prior memory. Surfaces both, asks the user which is current. Never silently overwrites.' },
  { kind: 'signal', text: 'Required-context pins: hard-constraint memories that always inject regardless of similarity score. For non-negotiables — allergies, locked decisions, hard constraints.' },
  { kind: 'signal', text: 'Plan-cap rejection at /api/capture returns 402 with error_code plan_upgrade_required and an upgrade_url pointing at /billing?upgrade=pro.' },
  { kind: 'signal', text: 'Test framework split: Vitest for unit tests, Playwright for integration against staging. Never both in the same file.' },
  { kind: 'signal', text: 'Self-hosted runner address is the Vultr Sydney box at 139.180.168.107. Coolify panel is on port 8000 of that host, behind a Cloudflare named tunnel.' },
  { kind: 'signal', text: 'Brand decision: spine.xxiautomate.com (not getspine.com or spine.dev). Sub-domain under the parent agency for legal simplicity.' },
  { kind: 'signal', text: 'Anthropic is the LLM vendor of choice for premium use cases. Groq + Gemini + OpenRouter as the free-tier provider chain.' },
  { kind: 'signal', text: 'OAuth implementation uses Supabase Auth with magic-link email. We do not implement OAuth providers ourselves.' },
  { kind: 'signal', text: 'The MCP server publishes as @spine/mcp on npm with bin name spine-mcp. Engines field requires Node 20+. better-sqlite3 + @huggingface/transformers as deps.' },
  { kind: 'signal', text: 'Dogfood telemetry sink is ~/.spine/dogfood.db, a SQLite file. Schema lives in packages/mcp/src/dogfood/recorder.ts.' },
  { kind: 'signal', text: 'We treat code as the source of truth for plan limits. lib/plan-limits.ts is canonical. CLAUDE.md and the brief queue are downstream.' },
  { kind: 'signal', text: 'Sub-768px viewport gets the 9x16 launch film cut. Above that, the 16x9 plays in the hero right column.' },
  { kind: 'signal', text: 'Memory entity extraction uses a small local model. Every captured turn is auto-tagged with the people, projects, and tools mentioned.' },
];

// 120 noise turns — banter, throat-clearing, retracted thoughts, jokes,
// non-load-bearing context. The retriever must NOT confuse these for
// signal when the user later asks a real question.
const NOISE: Turn[] = [
  { kind: 'noise', text: 'lol' },
  { kind: 'noise', text: 'haha' },
  { kind: 'noise', text: 'hold on, dog wants out' },
  { kind: 'noise', text: 'ok back' },
  { kind: 'noise', text: 'what was I saying' },
  { kind: 'noise', text: 'where did the autocomplete go' },
  { kind: 'noise', text: 'wait' },
  { kind: 'noise', text: 'ignore that last bit' },
  { kind: 'noise', text: 'never mind' },
  { kind: 'noise', text: 'actually scratch that' },
  { kind: 'noise', text: 'so anyway' },
  { kind: 'noise', text: 'where were we' },
  { kind: 'noise', text: 'remind me to grab coffee in a sec' },
  { kind: 'noise', text: 'screen sharing? can you see this' },
  { kind: 'noise', text: 'damn this connection' },
  { kind: 'noise', text: 'no its fine' },
  { kind: 'noise', text: 'one sec' },
  { kind: 'noise', text: 'reading' },
  { kind: 'noise', text: 'ok ok' },
  { kind: 'noise', text: 'gotcha' },
  { kind: 'noise', text: 'right right' },
  { kind: 'noise', text: 'mmm' },
  { kind: 'noise', text: 'true' },
  { kind: 'noise', text: 'fair' },
  { kind: 'noise', text: 'word' },
  { kind: 'noise', text: 'love it' },
  { kind: 'noise', text: 'agreed' },
  { kind: 'noise', text: 'let me check' },
  { kind: 'noise', text: 'opening it now' },
  { kind: 'noise', text: 'pulling latest' },
  { kind: 'noise', text: 'building' },
  { kind: 'noise', text: 'still building' },
  { kind: 'noise', text: 'ah finally' },
  { kind: 'noise', text: 'ok the dev server is up' },
  { kind: 'noise', text: 'this color looks weird on my screen' },
  { kind: 'noise', text: 'can you reload' },
  { kind: 'noise', text: 'better' },
  { kind: 'noise', text: 'no I think the original was better' },
  { kind: 'noise', text: 'lets revert' },
  { kind: 'noise', text: 'pinging the deploy now' },
  { kind: 'noise', text: 'someone in the discord asked about the launch date' },
  { kind: 'noise', text: 'I told them next week' },
  { kind: 'noise', text: 'ngl I think we are gonna miss next week' },
  { kind: 'noise', text: 'we will figure it out' },
  { kind: 'noise', text: 'who is gonna ship the email tho' },
  { kind: 'noise', text: 'I will' },
  { kind: 'noise', text: 'thanks man' },
  { kind: 'noise', text: 'np' },
  { kind: 'noise', text: 'btw did you see that tweet from levelsio' },
  { kind: 'noise', text: 'about the ramen MRR thing' },
  { kind: 'noise', text: 'yeah lol' },
  { kind: 'noise', text: 'gigabased' },
  { kind: 'noise', text: 'I want that to be us' },
  { kind: 'noise', text: 'we are basically him minus the actual revenue' },
  { kind: 'noise', text: 'and minus the tan' },
  { kind: 'noise', text: 'and the thailand' },
  { kind: 'noise', text: 'rude' },
  { kind: 'noise', text: 'fair tho' },
  { kind: 'noise', text: 'ok focus' },
  { kind: 'noise', text: 'where were we again' },
  { kind: 'noise', text: 'I lost the thread' },
  { kind: 'noise', text: 'reading the diff again' },
  { kind: 'noise', text: 'the autoreloader keeps killing my dev server' },
  { kind: 'noise', text: 'yeah next does that' },
  { kind: 'noise', text: 'annoying' },
  { kind: 'noise', text: 'I bet there is a config flag' },
  { kind: 'noise', text: 'will check later' },
  { kind: 'noise', text: 'TODO add that' },
  { kind: 'noise', text: 'putting it on the post-launch list' },
  { kind: 'noise', text: 'list is getting long' },
  { kind: 'noise', text: 'always is' },
  { kind: 'noise', text: 'ok lets keep moving' },
  { kind: 'noise', text: 'next?' },
  { kind: 'noise', text: 'next is the recall harness' },
  { kind: 'noise', text: 'right right' },
  { kind: 'noise', text: 'I forgot' },
  { kind: 'noise', text: 'happens' },
  { kind: 'noise', text: 'this is why we need spine' },
  { kind: 'noise', text: 'lmao' },
  { kind: 'noise', text: 'literally the product' },
  { kind: 'noise', text: 'eat your own dogfood' },
  { kind: 'noise', text: 'literally what we are doing rn' },
  { kind: 'noise', text: 'bingo' },
  { kind: 'noise', text: 'should we record this conversation' },
  { kind: 'noise', text: 'no it is too unhinged' },
  { kind: 'noise', text: 'fair' },
  { kind: 'noise', text: 'historians are not ready' },
  { kind: 'noise', text: 'historians are gonna roast us' },
  { kind: 'noise', text: 'we are the historians' },
  { kind: 'noise', text: 'mind blown' },
  { kind: 'noise', text: 'ok focus please' },
  { kind: 'noise', text: 'right yeah' },
  { kind: 'noise', text: 'so the harness' },
  { kind: 'noise', text: 'I am gonna refresh' },
  { kind: 'noise', text: 'still loading' },
  { kind: 'noise', text: 'wifi was good a sec ago' },
  { kind: 'noise', text: 'ok we are back' },
  { kind: 'noise', text: 'I think a tab was eating bandwidth' },
  { kind: 'noise', text: 'youtube probably' },
  { kind: 'noise', text: 'always youtube' },
  { kind: 'noise', text: 'closing them' },
  { kind: 'noise', text: 'all 47 of them' },
  { kind: 'noise', text: 'mood' },
  { kind: 'noise', text: 'I just put them all in arc' },
  { kind: 'noise', text: 'arc spaces?' },
  { kind: 'noise', text: 'yeah' },
  { kind: 'noise', text: 'nice' },
  { kind: 'noise', text: 'so back to the harness' },
  { kind: 'noise', text: 'lets go' },
  { kind: 'noise', text: 'ok one last detour' },
  { kind: 'noise', text: 'go on' },
  { kind: 'noise', text: 'never mind it left my brain' },
  { kind: 'noise', text: 'haha rip' },
  { kind: 'noise', text: 'I am tired honestly' },
  { kind: 'noise', text: 'me too' },
  { kind: 'noise', text: 'lets push through one more hour' },
  { kind: 'noise', text: 'deal' },
  { kind: 'noise', text: 'hand on the keyboard' },
  { kind: 'noise', text: 'monk mode' },
  { kind: 'noise', text: 'monk mode engaged' },
  { kind: 'noise', text: 'dog is looking at me' },
  { kind: 'noise', text: 'just give him a treat' },
  { kind: 'noise', text: 'already done' },
  { kind: 'noise', text: 'good dog' },
  { kind: 'noise', text: 'best dog' },
  { kind: 'noise', text: 'undefeated' },
];

export const TRANSCRIPT_TURNS: Turn[] = (() => {
  // Interleave so signal isn't bunched at the start. We emit a noise run
  // between each signal turn proportional to the 80/20 mix. The order is
  // deterministic so the harness is reproducible.
  const out: Turn[] = [];
  const noisePerSignal = Math.floor(NOISE.length / SIGNAL.length); // 4
  let n = 0;
  for (let i = 0; i < SIGNAL.length; i++) {
    out.push(SIGNAL[i]);
    for (let j = 0; j < noisePerSignal && n < NOISE.length; j++, n++) {
      out.push(NOISE[n]);
    }
  }
  // Append any remaining noise at the tail.
  while (n < NOISE.length) out.push(NOISE[n++]);
  return out;
})();

// 20 queries that should hit the signal. Each maps to a real signal turn
// the recall MUST surface in the top-5.
export const SHOULD_HIT_QUERIES: string[] = [
  'what is the free plan memory limit?',
  'what database are we using?',
  'why did we pick LemonSqueezy over Stripe?',
  'how does the install flow work?',
  'what acceptance criteria did we set for dogfooding?',
  'what fonts does the brand use?',
  'is Spine append-only or does it summarise?',
  'who owns the Conductor M18 milestone?',
  'where is the deploy target?',
  'who is the founder?',
  'what is the May 25 revenue target?',
  'who was the first paying customer?',
  'which Haiku model do we use for ranking?',
  'when does a memory promote to fact tier?',
  'when does a memory get archived?',
  'how do conflicts get resolved?',
  'what does a 402 cap rejection include?',
  'which test framework runs the unit tests?',
  'where does the dogfood telemetry get written?',
  'which mobile breakpoint switches to the 9x16 film?',
];

// 20 queries that should MISS — unrelated topics that none of the
// signal turns address. A well-tuned retriever returns either zero hits
// or hits that are explicitly NOT signal-tagged.
export const SHOULD_MISS_QUERIES: string[] = [
  'best chocolate cake recipe',
  'how to fix a leaky kitchen tap',
  'recommend a beach in Greece',
  'what is the chord progression for canon in D',
  'how do I train for a marathon',
  'best dog breeds for apartments',
  'what is the boiling point of mercury',
  'origin of the word serendipity',
  'good books on the Roman empire',
  'how to brew a pour-over coffee',
  'tips for keeping orchids alive',
  'history of the telephone',
  'how do submarines work',
  'recommend a movie about chess',
  'fastest way to learn German',
  'how to negotiate a salary in NYC',
  'what causes the northern lights',
  'best yoga poses for back pain',
  'how to make sourdough starter',
  'why are bees important to ecosystems',
];

export const PRECISION_AT_5_THRESHOLD = 0.55;
export const FALSE_POSITIVE_RATE_THRESHOLD = 0.30;
