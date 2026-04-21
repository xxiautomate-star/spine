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
    <div className="min-h-screen bg-[#0D0C0A] text-[#E8E4DD]">
      <header className="sticky top-0 z-50 px-6 md:px-12 py-5 flex items-center justify-between backdrop-blur-md bg-[#0D0C0A]/80 border-b border-[#E8E4DD]/[0.05]">
        <Link href="/" className="flex items-center gap-3">
          <span className="block w-[7px] h-[7px] rounded-full bg-[#E89A3C]" />
          <span className="font-serif text-xl">Spine</span>
        </Link>
        <nav className="flex items-center gap-6 font-mono text-[10px] uppercase tracking-widest">
          <Link href="/pricing" className="text-[#E8E4DD]/35 hover:text-[#E8E4DD]/65 transition-colors hidden sm:block">Pricing</Link>
          <Link href="/docs/mcp" className="text-[#E8E4DD]/35 hover:text-[#E8E4DD]/65 transition-colors hidden sm:block">Docs</Link>
          <Link href="/login?signup=1" className="text-[#E89A3C]/70 hover:text-[#E89A3C] transition-colors">Start free →</Link>
        </nav>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-20">
        <div className="mb-20">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C]/55 mb-4">Features</p>
          <h1 className="font-serif text-5xl md:text-6xl text-[#E8E4DD] leading-tight mb-6">
            Every word remembered.
            <br />
            <span className="text-[#E8E4DD]/40">Every contradiction caught.</span>
          </h1>
          <p className="text-[#E8E4DD]/50 text-lg leading-relaxed max-w-2xl">
            Spine is not a notes app. It is a living archive — capture, recall, conflict resolution,
            knowledge graph, and decay management working together as a single system beneath your AI.
          </p>
        </div>

        <div className="space-y-24">
          {SECTIONS.map((s, i) => (
            <section key={s.tag} className="border-t border-[#E8E4DD]/[0.06] pt-16">
              <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C]/55 mb-5">{s.tag}</p>
              <div className="grid md:grid-cols-[1fr,1.4fr] gap-12 mb-10">
                <div>
                  <h2 className="font-serif text-3xl text-[#E8E4DD] leading-snug mb-4">{s.title}</h2>
                  <p className="text-[#E8E4DD]/50 text-[14px] leading-relaxed">{s.body}</p>
                </div>
                <div className="space-y-4">
                  {s.features.map((f) => (
                    <div key={f.name} className="flex gap-4">
                      <span className="text-[#E89A3C]/40 flex-shrink-0 font-mono text-[12px] mt-0.5">—</span>
                      <div>
                        <p className="text-[#E8E4DD]/75 text-[13px] font-medium mb-0.5">{f.name}</p>
                        <p className="text-[#E8E4DD]/35 text-[12px] leading-relaxed">{f.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              {i === 0 && (
                <div className="mt-6 p-4 bg-[#E89A3C]/[0.04] border border-[#E89A3C]/[0.15] rounded-xl">
                  <code className="font-mono text-[12px] text-[#E89A3C]/70">
                    $ npx xxiautomate-spine init
                  </code>
                  <span className="font-mono text-[11px] text-[#E8E4DD]/25 ml-4">— one command, any MCP client</span>
                </div>
              )}
            </section>
          ))}
        </div>

        <div className="mt-24 pt-16 border-t border-[#E8E4DD]/[0.06] flex flex-col sm:flex-row gap-4">
          <Link
            href="/login?signup=1"
            className="group inline-flex items-center gap-3 px-7 py-3.5 bg-[#E89A3C] text-[#0D0C0A] font-mono text-[11px] uppercase tracking-widest hover:bg-[#E8E4DD] transition-colors duration-300"
          >
            Start free
            <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
          </Link>
          <Link href="/pricing" className="inline-flex items-center gap-2 px-7 py-3.5 border border-[#E8E4DD]/[0.12] text-[#E8E4DD]/50 font-mono text-[11px] uppercase tracking-widest hover:border-[#E8E4DD]/30 hover:text-[#E8E4DD]/80 transition-all duration-300">
            View pricing
          </Link>
        </div>
      </main>
    </div>
  );
}
