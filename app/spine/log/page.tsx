import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Spine — changelog',
  description: 'Every Round shipped, in the open. Builds-in-public proof.',
};

type Entry = {
  round: string;
  date: string;
  title: string;
  body: string;
  commits?: string[];
};

// Curated from git history. When a new Round lands, append here.
const LOG: Entry[] = [
  {
    round: 'Round 19',
    date: '2026-04-24',
    title: 'Real labels · /spine/why interactive explorer · leak audit',
    body:
      'Three moves to make the transparency moat visible. (1) Every recall logs the full candidate pool (not just top-5) with per-signal why to saas_spine_recall_candidates; a new /api/spine-feedback endpoint takes the user\'s next turn and infers which shown memories were cited via 5-gram / 7-gram overlap, writing was_used labels. Trainer retrained from real labels via a logistic regressor, persists AUC for drift tracking. Nightly cron at /api/cron/retrain-weights. (2) /spine/why — category-defining interactive explorer. Type a query, see ALL 20 candidates with 4 signal bars + cross-encoder score, drag sliders, top-5 reorders live client-side (no server round-trip). Save profile to your account, copy as JSON, or activate as your default weights. (3) scripts/leak-audit.mjs — 20 adversarial queries against /api/spine/search and /api/spine/candidates, asserts every result.user_id = SPINE_DEMO_USER_ID. Exits non-zero on any leak.',
    commits: ['015 migration', 'recall-log', 'label-inference', 'spine-feedback', 'spine/candidates', 'spine/why', 'weight-profiles', 'cron/retrain-weights', 'leak-audit'],
  },
  {
    round: 'Round 18',
    date: '2026-04-24',
    title: 'Hybrid rerank v2 · 4-signal fusion · why trace on every recall',
    body:
      'Retrieval is no longer a black box. Four signals fused: BM25, vector cosine, recency decay, memory-graph centrality (personalized PageRank over memory_edges). Weights learned from Spine\'s own session-injection history via logistic regression — falls back to hand-tuned priors if the trainer has not run. Cross-encoder pass (BAAI/bge-reranker-v2-m3 via Together AI) on the top 20 before returning top 5. Cached by query + candidate-id hash for 10 min. Every response carries a per-memory why object {bm25, vec, recency, centrality, final, dominant} plus the top 3 competitors it beat. New /api/spine/search public endpoint runs the full stack against the curated 30-memory demo corpus so the landing page stops leaking real life. Head-to-head bench (scripts/bench-ranking.mjs) measures MRR@5 lift against vector-only.',
    commits: ['014 migration', 'rerank-v2', 'cross-encoder+together', 'compute-centrality', 'train-rerank-weights', 'seed-demo-public', 'bench-ranking'],
  },
  {
    round: 'Round 17',
    date: '2026-04-24',
    title: 'Proof of a million memories · needle-in-haystack benchmark',
    body:
      'Reproducible scale benchmark. scripts/scale-seed.mjs inserts N synthetic memories (10k, 100k, 1M — your call) with real OpenAI embeddings. scripts/scale-bench.mjs hides uniquely-tokened needles in that haystack and asks Spine to find them. Every run writes to saas_spine_bench_runs; /spine/proof reads that table live. Latency-vs-scale SVG chart proves the logarithmic shape, not just a single point. The "infinite memory" promise is now a checked claim, not a marketing line.',
    commits: ['013 migration', 'scale-corpus', 'scale-seed', 'scale-bench', '/spine/proof'],
  },
  {
    round: 'Round 16',
    date: '2026-04-24',
    title: 'v1.1 retrieval quality + rolling access',
    body:
      'The four engineering fixes from the 2026-04-22 collaborative review, shipped together. Active-thread reranker blends the last 2–3 turns into the query embedding. Cohere Rerank 3 replaces Haiku as the primary cross-encoder (Haiku stays as fallback). Per-session de-duplication means a memory injected in-thread is not re-injected until its relevance score jumps meaningfully. `superseded_by` chain lets updates outweigh stale memories without destroying them. Every injection line now carries [age · confirmed · src] provenance so the receiving AI can weight confidence. Plus: invite flow — /admin/waitlist issues codes, /auth/after-invite redeems, rolling access stops being a marketing word.',
    commits: ['012 migration', 'thread-embed', 'cross-encoder', 'session-dedup', 'invites'],
  },
  {
    round: 'Round 15',
    date: '2026-04-23',
    title: 'Labs landing · live demo · public stats',
    body:
      'New /spine page leading verbatim with the recursion-moment hero copy from the self-use proof. Email-only waitlist writes to saas_spine_waitlist. Live demo component runs real recall against the 310-memory corpus with an end-to-end latency badge. /spine/stats surfaces total memories, cross-session recalls (7d), average latency, and memories per dollar — queried live, never mocked. Meta Pixel + Conversions API bridge wired.',
    commits: ['011 migration', '/api/spine-waitlist', '/api/spine-stats', '/api/spine-events/lead'],
  },
  {
    round: 'Round 14',
    date: '2026-04-22',
    title: 'Self-use proof · 310 memories ingested · cross-session recall',
    body:
      'Spine fired three unprompted retrievals on its creator in a row — including his own April observation about memory compounding at the exact moment it was compounding again. Launch gate cleared organically. The MCP package synced 310 real memories and the cross-session reach is now measurable.',
    commits: ['e696ac9'],
  },
  {
    round: 'Round 13',
    date: '2026-04-22',
    title: 'MCP cloud sync · offline buffer',
    body:
      'CloudStore queues writes when the network drops and flushes on reconnect. `spine_remember` aliased for voice ergonomics. Date filters on recall. Embedding model bumped to bge-small-en-v1.5 for self-hosted parity.',
    commits: ['fab1318', 'e696ac9'],
  },
  {
    round: 'Round 12',
    date: '2026-04-22',
    title: 'Stripe Checkout + webhook',
    body:
      'Three-tier billing wired in test mode. Checkout session on success routes the webhook to promote the profile; failed webhook re-queues without double-promotion.',
    commits: ['1a8f6a5'],
  },
  {
    round: 'Round 11',
    date: '2026-04-22',
    title: 'Timeline editing · soft delete · restore',
    body:
      'Inline edit on every timeline entry. Soft-delete with a 5-second undo toast, restore endpoint for everything else. Append-only stays — deletes are metadata, not destruction.',
    commits: ['e9616d6'],
  },
  {
    round: 'Round 10',
    date: '2026-04-22',
    title: 'MCP v1.0.0 · auto-register',
    body:
      'Publish-ready @spine/mcp. `npx @spine/mcp init` writes itself into ~/.claude/settings.json. Zero-config install.',
    commits: ['024a104'],
  },
  {
    round: 'Round 9',
    date: '2026-04-22',
    title: 'Full transcript capture · hybrid search · BM25 + RRF + MMR',
    body:
      'Every turn stored, not summarised. Retrieval fuses pgvector + BM25 via reciprocal rank fusion, then MMR-diversifies. The "infinite, not compressed" promise now has the retrieval to back it.',
    commits: ['5274e37', '3a2e33e'],
  },
  {
    round: 'Round 8',
    date: '2026-04-21',
    title: 'Replay · team memory · morning briefing',
    body:
      'Spine Replay reconstructs a session as a readable scroll. Team plan shares a workspace memory. Morning briefing email summarises last 24h at 7am local.',
    commits: ['22486ea'],
  },
  {
    round: 'Round 7',
    date: '2026-04-21',
    title: 'VS Code + Cursor extension · MCP tool rename',
    body:
      'Editor extensions surface Spine where you already type. `search_memory`, `add_memory`, `get_timeline` tools. Homepage install demo loop.',
    commits: ['e718652', 'be6ac47'],
  },
  {
    round: 'Round 6',
    date: '2026-04-21',
    title: 'Multi-tenant orgs · billing · onboarding',
    body:
      'Org-level memory scoping. LemonSqueezy billing. Six-step onboarding wizard. Retention emails when a memory hasn’t been touched in weeks.',
    commits: ['fc14f13'],
  },
  {
    round: 'Round 5',
    date: '2026-04-21',
    title: 'Knowledge graph · daily digest · cross-session HUD',
    body:
      'Entities extracted from every capture. Daily digest shows what was captured, what surfaced, what went stale. Conflict HUD flags contradictions.',
    commits: ['ad2f4d2', 'acdb312'],
  },
  {
    round: 'Round 4',
    date: '2026-04-21',
    title: 'Frictionless capture · retrieval · pricing',
    body:
      'Capture lowered to a single button. Retrieval re-ranker. Pricing page with three tiers.',
    commits: ['a9b7bd4'],
  },
  {
    round: 'Round 3',
    date: '2026-04-20',
    title: 'Chrome store assets · privacy policy · /privacy route',
    body:
      'Store submission unblocked. Icons, screenshots, and the privacy policy at /privacy.',
    commits: ['b70a8fe', 'c8398e6'],
  },
  {
    round: 'Round 2',
    date: '2026-04-20',
    title: 'Demo video · live dashboard · one-click install',
    body:
      'First demo video. Live dashboard behind auth. One-click install writes MCP config automatically.',
    commits: ['ae91c25'],
  },
  {
    round: 'Round 1',
    date: '2026-04-18',
    title: 'Proactive context injection',
    body:
      'The first moment Spine did something the user didn’t ask for — injecting relevant memories into the prompt automatically.',
    commits: ['5ba3b0a'],
  },
];

export default function SpineLogPage() {
  return (
    <main className="relative bg-night text-cream min-h-screen overflow-x-hidden">
      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 z-50 px-5 md:px-10 py-4 md:py-5 flex items-center justify-between backdrop-blur-md bg-night/70 border-b border-cream/[0.05]">
        <Link href="/spine" className="flex items-center gap-3">
          <span className="block w-2 h-2 rounded-full bg-amber ember" aria-hidden />
          <span className="font-serif text-lg md:text-xl tracking-wide">Spine</span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-cream/30 hidden sm:inline">
            · labs
          </span>
        </Link>
        <div className="flex items-center gap-4 md:gap-6">
          <Link
            href="/spine"
            className="font-mono text-[10px] uppercase tracking-widest text-cream/45 hover:text-amber transition-colors duration-300"
          >
            Overview
          </Link>
          <Link
            href="/spine/stats"
            className="font-mono text-[10px] uppercase tracking-widest text-cream/45 hover:text-amber transition-colors duration-300"
          >
            Live stats
          </Link>
          <Link
            href="/spine#waitlist"
            className="font-mono text-[10px] uppercase tracking-widest px-3 py-2 md:px-4 bg-amber text-night hover:bg-cream transition-colors duration-300"
          >
            Get a seat →
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-28 md:pt-32 pb-12 md:pb-16 px-5 md:px-10">
        <div className="max-w-4xl mx-auto">
          <p className="font-mono text-[10px] uppercase tracking-widest text-amber mb-6">
            § Changelog · build-in-public · {LOG.length} rounds shipped
          </p>
          <h1 className="font-serif text-[2.2rem] leading-[1.02] sm:text-[2.8rem] md:text-[4rem] md:leading-[1.02] text-cream tracking-tight">
            Every round. In the open.
          </h1>
          <p className="mt-6 text-cream/55 max-w-2xl text-[15px] md:text-base leading-relaxed">
            Spine ships in rounds. Each round is a self-contained shipment —
            dated, summarised, and linked. Nothing is hidden. Nothing is
            rewritten after the fact.
          </p>
        </div>
      </section>

      {/* Log */}
      <section className="px-5 md:px-10 pb-24 md:pb-32">
        <div className="max-w-4xl mx-auto">
          <ol className="relative">
            {LOG.map((e, i) => (
              <li
                key={e.round}
                className="rise grid grid-cols-[20px,1fr] md:grid-cols-[180px,1fr] gap-4 md:gap-10 py-8 md:py-10 border-b border-cream/[0.06]"
                style={{ animationDelay: `${i * 0.04}s` }}
              >
                <div className="flex md:block">
                  <span className="block w-1 md:w-[2px] bg-amber/40 md:h-full md:mx-auto" aria-hidden />
                  <div className="hidden md:block pl-0">
                    <p className="font-mono text-[10px] uppercase tracking-widest text-amber/90 mt-1">
                      {e.round}
                    </p>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-cream/35 mt-2">
                      {e.date}
                    </p>
                  </div>
                </div>
                <div>
                  <p className="md:hidden font-mono text-[10px] uppercase tracking-widest text-amber/90">
                    {e.round} · {e.date}
                  </p>
                  <p className="mt-1 md:mt-0 font-serif text-2xl md:text-3xl text-cream leading-snug mb-3">
                    {e.title}
                  </p>
                  <p className="text-cream/60 leading-relaxed text-[15px] md:text-base max-w-2xl">
                    {e.body}
                  </p>
                  {e.commits && (
                    <p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-cream/30">
                      refs · {e.commits.join(' · ')}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* CTA */}
      <section className="px-5 md:px-10 py-16 md:py-24 border-t border-cream/[0.05]">
        <div className="max-w-3xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <p className="font-serif text-2xl md:text-3xl text-cream leading-tight">
              Want the next round in your inbox?
            </p>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-cream/35">
              Waitlist doubles as release notes · unsubscribe anytime
            </p>
          </div>
          <Link
            href="/spine#waitlist"
            className="group inline-flex items-center justify-center gap-3 px-6 py-3 bg-amber text-night hover:bg-cream transition-colors duration-500 self-start md:self-auto"
          >
            <span className="font-serif text-lg">Request a seat</span>
            <span className="transition-transform duration-500 group-hover:translate-x-1 font-mono">→</span>
          </Link>
        </div>
      </section>

      <footer className="px-5 md:px-10 py-10 border-t border-cream/[0.05]">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/spine" className="font-mono text-[10px] uppercase tracking-widest text-cream/30 hover:text-amber">
            ← back to Spine
          </Link>
          <p className="font-mono text-[10px] uppercase tracking-widest text-cream/20">
            © {new Date().getFullYear()} · XXIautomate
          </p>
        </div>
      </footer>
    </main>
  );
}
