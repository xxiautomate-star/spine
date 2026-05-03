import Link from 'next/link';

export const metadata = { title: 'Features — Spine' };

const SECTIONS = [
  {
    tag: '01 · Capture',
    title: 'Everything, exactly as you said it.',
    body: 'Spine is append-only. Every fact is stored verbatim, with its source, timestamp, and origin session. Nothing is summarised or compressed — vector search retrieves the right fragment at query time.',
    features: [
      { name: 'MCP integration', desc: 'Claude Code, Claude Desktop, Cursor, Windsurf — any MCP-compatible AI. Run spine_capture and it\'s stored.' },
      { name: 'Browser extension', desc: 'Captures claude.ai, ChatGPT, and Gemini conversations automatically. No copy-paste, no friction.' },
      { name: 'Bulk import', desc: 'Ingest a full conversation history with spine_capture_bulk. Import months of context in seconds.' },
      { name: 'API', desc: 'POST /api/capture with your API key. Pipe from any source — scripts, agents, CI.' },
    ],
  },
  {
    tag: '02 · Recall',
    title: 'The right memory, at the right moment.',
    body: 'Hybrid retrieval: cosine similarity over 1536-dim OpenAI embeddings fused with BM25 keyword scoring via reciprocal rank fusion. On Pro, a Haiku 4.5 reranker filters the top candidates.',
    features: [
      { name: 'Semantic search', desc: 'Natural language queries over your full corpus. Finds the idea even when you can\'t remember the exact words.' },
      { name: 'Hybrid vector + BM25', desc: 'Cosine + keyword fusion catches both semantic similarity and exact term matches. More precise than either alone.' },
      { name: 'Context HUD', desc: 'While you type in claude.ai or ChatGPT, Spine checks for relevant prior memories. A non-intrusive overlay appears if something matches.' },
      { name: 'Required-context pins', desc: 'Pin a memory to force-inject it into every retrieval, regardless of similarity. For permanent facts that must never be forgotten.' },
      { name: 'Session bootstrap', desc: 'spine_context_for_session assembles a context block from multiple hints, deduplicated and fused, ready to prepend to the system prompt.' },
    ],
  },
  {
    tag: '03 · Conflict detection',
    title: 'Memory that evolves, not just accumulates.',
    body: 'When a new capture contradicts a prior memory on the same entity, Haiku 4.5 detects the contradiction and creates a conflict row with verbatim quotes from both versions.',
    features: [
      { name: 'Auto-detection', desc: 'Runs after every capture. If the new content contradicts a prior memory on the same entity (person, project, tool, decision), a conflict is flagged immediately.' },
      { name: 'HUD notification', desc: 'The conflict surfaces in the claude.ai content script within 5 seconds — amber overlay with both quotes and one-click resolution.' },
      { name: 'Daily digest', desc: 'Unresolved conflicts appear in the morning digest with full context so you can clear them at the start of the day.' },
      { name: 'Resolution modes', desc: 'Keep latest (soft-deletes the prior), Keep both as timeline, or Merge manually via the dashboard.' },
    ],
  },
  {
    tag: '04 · Memory decay',
    title: 'The archive stays sharp.',
    body: 'Memories not accessed in 60 days are soft-archived — still recoverable from your timeline, but excluded from retrieval. Your context window stays clean.',
    features: [
      { name: 'Last-accessed tracking', desc: 'Every time a memory surfaces in a HUD, recall, or context block, last_accessed_at is bumped. Decay is based on real use, not creation date.' },
      { name: 'Soft archive', desc: 'Archived memories are never deleted. They live in your timeline under a "Stale" filter with a one-click Revive button.' },
      { name: 'npm run spine:decay', desc: 'Run the decay script manually for immediate processing. Pass --dry to see counts without archiving.' },
      { name: 'Weekly stale alert', desc: 'The Monday digest lists memories approaching the decay threshold so you can revive the ones still relevant before they archive.' },
    ],
  },
  {
    tag: '05 · Entity graph',
    title: 'How your work connects.',
    body: 'Every person, project, tool, concept, and decision you mention is extracted by Haiku 4.5 and added to a knowledge graph. The /graph view shows connections; similar entities are proposed for merging.',
    features: [
      { name: 'Auto-extraction', desc: 'Entities are extracted after every capture. No labelling, no annotation — Haiku does it.' },
      { name: 'Relationship types', desc: 'MENTIONED_IN, RELATED_TO, SUPERSEDES. Supersedes edges render in amber in the graph view.' },
      { name: 'Entity merge', desc: 'Nodes with Jaro-Winkler similarity ≥0.85 generate a merge proposal banner in /graph. Merge is one click, undoable for 7 days.' },
      { name: 'D3 force graph', desc: 'Canvas-rendered force simulation. Filter by type, click to inspect, drag to pin.' },
    ],
  },
  {
    tag: '06 · Team workspace',
    title: 'Shared memory. Collective clarity.',
    body: 'On the Team plan, every workspace member contributes to and reads from the same memory graph. Org-level required-context pins apply to all members. Changes are logged.',
    features: [
      { name: 'Shared capture', desc: 'Any member\'s captures land in the shared org graph. Instant knowledge transfer without copy-paste.' },
      { name: 'Policy enforcement', desc: 'Org owners can set memories as required_context — they\'re injected into every team member\'s HUD and MCP context.' },
      { name: 'Audit log', desc: 'Every member add/remove, policy change, and plan upgrade is logged in org_audit_log with actor, action, and metadata.' },
      { name: 'Role model', desc: 'owner · admin · member · viewer. Admins can invite. Members can read and capture. Viewers can read only.' },
    ],
  },
];

export default function FeaturesPage() {
  return (
    <main className="relative marble-bg min-h-screen overflow-x-hidden" style={{ color: 'var(--s-ink)' }}>
      {/* Marble texture overlays */}
      <div className="marble-vein" style={{ position: 'fixed', zIndex: 0 }} />
      <div className="marble-grain" style={{ position: 'fixed', zIndex: 0 }} />

      {/* Gold-foil top edge */}
      <div className="gold-foil-top fixed top-0 inset-x-0 h-[1.5px] z-50" style={{ opacity: 0.95 }} />

      {/* Nav */}
      <header
        className="sticky top-0 z-40 px-6 md:px-12 py-5 flex items-center justify-between"
        style={{
          background: 'rgba(255, 253, 247, 0.78)',
          backdropFilter: 'blur(20px) saturate(150%)',
          WebkitBackdropFilter: 'blur(20px) saturate(150%)',
          borderBottom: '1px solid var(--s-vein)',
        }}
      >
        <Link href="/" className="flex items-center gap-3">
          <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden>
            <defs>
              <linearGradient id="spineFeaturesGold" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#e8c769" />
                <stop offset="55%" stopColor="#b8924a" />
                <stop offset="100%" stopColor="#7a5f2a" />
              </linearGradient>
            </defs>
            <circle cx="16" cy="16" r="14.5" stroke="url(#spineFeaturesGold)" strokeWidth="1" fill="rgba(255,255,255,0.6)" />
            <path d="M16 5L16 27 M11 9L16 5L21 9 M11 23L16 27L21 23 M11 12H21 M11 16H21 M11 20H21" stroke="url(#spineFeaturesGold)" strokeWidth="1.2" strokeLinecap="round" fill="none" />
          </svg>
          <span className="font-serif text-xl" style={{ color: 'var(--s-ink)' }}>Spine</span>
        </Link>
        <nav className="flex items-center gap-6 font-mono text-[10px] uppercase tracking-widest">
          <Link
            href="/pricing"
            className="transition-colors duration-300 hidden sm:block hover:[color:var(--s-gold-deep)]"
            style={{ color: 'var(--s-ink-faint)' }}
          >
            Pricing
          </Link>
          <Link
            href="/proof"
            className="transition-colors duration-300 hidden sm:block hover:[color:var(--s-gold-deep)]"
            style={{ color: 'var(--s-ink-faint)' }}
          >
            Proof
          </Link>
          <Link
            href="/docs/mcp"
            className="transition-colors duration-300 hidden sm:block hover:[color:var(--s-gold-deep)]"
            style={{ color: 'var(--s-ink-faint)' }}
          >
            Docs
          </Link>
          <Link
            href="/login?signup=1"
            className="transition-colors duration-300 hover:[color:var(--s-ink)]"
            style={{ color: 'var(--s-gold-deep)' }}
          >
            Start free →
          </Link>
        </nav>
      </header>

      <div className="relative max-w-4xl mx-auto px-6 py-20" style={{ zIndex: 1 }}>
        <div className="mb-20 rise rise-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] mb-5" style={{ color: 'var(--s-gold-deep)' }}>
            <span className="mr-3" style={{ color: 'var(--s-gold)' }}>§ 001</span>
            Features
          </p>
          <h1 className="font-serif text-5xl md:text-6xl leading-tight tracking-[-0.025em] mb-6" style={{ color: 'var(--s-ink)' }}>
            Every word remembered.
            <br />
            <em className="italic" style={{ color: 'var(--s-gold-deep)' }}>Every contradiction caught.</em>
          </h1>
          <p className="text-lg leading-relaxed max-w-2xl" style={{ color: 'var(--s-ink-soft)' }}>
            Spine is not a notes app. It is a living archive — capture, recall, conflict resolution,
            knowledge graph, and decay management working together as a single system beneath your AI.
          </p>
        </div>

        <div className="space-y-24">
          {SECTIONS.map((s, i) => {
            const sectionN = String(i + 2).padStart(3, '0');
            return (
              <section
                key={s.tag}
                className="pt-16 rise rise-2"
                style={{ borderTop: '1px solid var(--s-vein)' }}
              >
                <p className="font-mono text-[10px] uppercase tracking-[0.28em] mb-5" style={{ color: 'var(--s-gold-deep)' }}>
                  <span className="mr-3" style={{ color: 'var(--s-gold)' }}>§ {sectionN}</span>
                  {s.tag}
                </p>
                <div className="grid md:grid-cols-[1fr,1.4fr] gap-12 mb-10">
                  <div>
                    <h2 className="font-serif text-3xl leading-snug mb-4" style={{ color: 'var(--s-ink)' }}>
                      {s.title}
                    </h2>
                    <p className="text-[14px] leading-relaxed" style={{ color: 'var(--s-ink-soft)' }}>
                      {s.body}
                    </p>
                  </div>
                  <div className="space-y-4">
                    {s.features.map((f) => (
                      <div key={f.name} className="flex gap-4">
                        <span
                          className="flex-shrink-0 font-mono text-[12px] mt-0.5"
                          style={{ color: 'var(--s-gold)' }}
                        >
                          —
                        </span>
                        <div>
                          <p className="text-[13px] font-medium mb-0.5" style={{ color: 'var(--s-ink-strong)' }}>
                            {f.name}
                          </p>
                          <p className="text-[12px] leading-relaxed" style={{ color: 'var(--s-ink-soft)' }}>
                            {f.desc}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                {i === 0 && (
                  <div
                    className="relative mt-6 p-5 rounded-xl overflow-hidden"
                    style={{
                      background: 'linear-gradient(180deg, #ffffff 0%, #fdfaf2 100%)',
                      border: '1px solid var(--s-vein-strong)',
                      boxShadow: 'var(--s-shadow-1)',
                    }}
                  >
                    <div className="gold-foil-top absolute top-0 inset-x-0 h-[1.5px]" style={{ opacity: 0.85 }} />
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-mono text-[12px] select-none" style={{ color: 'var(--s-ink-ghost)' }}>$</span>
                      <code className="font-mono text-[13px]" style={{ color: 'var(--s-gold-deep)' }}>
                        npx @spine/mcp init
                      </code>
                      <span className="font-mono text-[11px] ml-4" style={{ color: 'var(--s-ink-faint)' }}>
                        — one command, any MCP client
                      </span>
                    </div>
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <div
          className="mt-24 pt-16 flex flex-col sm:flex-row gap-4"
          style={{ borderTop: '1px solid var(--s-vein)' }}
        >
          <Link
            href="/login?signup=1"
            className="group inline-flex items-center gap-3 px-7 py-3.5 transition-all duration-500 rounded-md"
            style={{
              background: 'linear-gradient(180deg, #fdfaf2 0%, #f0e3c4 100%)',
              color: 'var(--s-ink-strong)',
              border: '1px solid var(--s-vein-strong)',
              boxShadow: '0 2px 6px rgba(60,45,20,0.08), inset 0 1px 0 rgba(255,255,255,0.6)',
            }}
          >
            <span className="font-serif text-lg">Start free</span>
            <span
              className="font-mono transition-transform duration-300 group-hover:translate-x-1"
              style={{ color: 'var(--s-gold-deep)' }}
            >
              →
            </span>
          </Link>
          <Link
            href="/pricing"
            className="inline-flex items-center justify-center gap-2 px-7 py-3.5 font-mono text-[11px] uppercase tracking-widest transition-all duration-300 rounded-md"
            style={{
              border: '1px solid var(--s-vein-strong)',
              color: 'var(--s-ink-soft)',
              background: 'transparent',
            }}
          >
            View pricing
          </Link>
        </div>
      </div>

      {/* Footer */}
      <footer
        className="relative px-6 md:px-10 py-12 mt-12"
        style={{ zIndex: 1, borderTop: '1px solid var(--s-vein)' }}
      >
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row sm:items-end sm:justify-between gap-6">
          <div className="flex items-center gap-3">
            <svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden>
              <defs>
                <linearGradient id="spineFeaturesFootGold" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#e8c769" />
                  <stop offset="55%" stopColor="#b8924a" />
                  <stop offset="100%" stopColor="#7a5f2a" />
                </linearGradient>
              </defs>
              <circle cx="16" cy="16" r="14.5" stroke="url(#spineFeaturesFootGold)" strokeWidth="1" fill="rgba(255,255,255,0.6)" />
              <path d="M16 5L16 27 M11 9L16 5L21 9 M11 23L16 27L21 23 M11 12H21 M11 16H21 M11 20H21" stroke="url(#spineFeaturesFootGold)" strokeWidth="1.2" strokeLinecap="round" fill="none" />
            </svg>
            <span className="font-serif text-lg" style={{ color: 'var(--s-ink)' }}>Spine</span>
          </div>
          <div className="flex gap-6 font-mono text-[10px] uppercase tracking-widest">
            {[
              ['/', 'Home'],
              ['/pricing', 'Pricing'],
              ['/proof', 'Proof'],
              ['/privacy', 'Privacy'],
              ['/docs/mcp', 'Docs'],
            ].map(([href, label]) => (
              <Link
                key={href}
                href={href}
                className="transition-colors duration-300 hover:[color:var(--s-gold-deep)]"
                style={{ color: 'var(--s-ink-faint)' }}
              >
                {label}
              </Link>
            ))}
          </div>
        </div>
      </footer>
    </main>
  );
}
