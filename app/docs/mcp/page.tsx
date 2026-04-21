import Link from 'next/link';

export const metadata = { title: 'MCP Integration — Spine' };

const SNIPPET_SETTINGS = `{
  "mcpServers": {
    "spine": {
      "command": "npx",
      "args": ["-y", "xxiautomate-spine", "serve"]
    }
  }
}`;

const SNIPPET_CLOUD = `$ npx xxiautomate-spine init
# Spine — setup
# ─────────────
# Storage mode — [L]ocal-only or [c]loud sync? (L/c): c
# Paste your Spine API key: spine_live_xxxxxxxxxxxxxxxx
# API base URL (default https://spine.xxiautomate.com): [Enter]
# [spine] API key accepted.
# Config written to ~/.spine/config.json`;

const SNIPPET_LOCAL = `$ npx xxiautomate-spine init
# Storage mode — [L]ocal-only or [c]loud sync? (L/c): [Enter]
# [spine] Local-only storage set. Memories live in ~/.spine/memories.db`;

const tools = [
  {
    name: 'spine_capture',
    sig: 'spine_capture(content, source?, tags?)',
    desc: 'Append a memory to the archive. Storage is append-only — Spine never overwrites or summarises. Returns the new memory id.',
  },
  {
    name: 'get_context',
    sig: 'get_context(query, token_budget?)',
    desc: 'Retrieve the most relevant memories for the current query as a ready-to-use context block. Also returns unresolved conflict count. Call this at the start of any coding session.',
  },
  {
    name: 'pin_memory',
    sig: 'pin_memory(content, source?)',
    desc: 'Capture a memory and mark it as required_context — it will be injected into every future retrieval regardless of similarity score. Use for permanent facts ("project uses Postgres 15, NOT MySQL").',
  },
  {
    name: 'spine_recall',
    sig: 'spine_recall(query, limit?)',
    desc: 'Semantic search over the full corpus. Returns raw memory objects with cosine scores.',
  },
  {
    name: 'spine_context_for_session',
    sig: 'spine_context_for_session(hints[], per_hint?, token_budget?)',
    desc: 'Session bootstrap: pass 1-8 short hints describing the upcoming work. Runs hybrid retrieval per hint, deduplicates, and fuses into one block to prepend to your system prompt.',
  },
  {
    name: 'spine_timeline',
    sig: 'spine_timeline(from?, to?, limit?)',
    desc: 'Chronological retrieval in an optional date range, newest first.',
  },
  {
    name: 'spine_forget',
    sig: 'spine_forget(id)',
    desc: 'Hard-delete a memory by id. Irreversible. Only call when the user explicitly asks to forget a specific fact.',
  },
  {
    name: 'spine_hygiene',
    sig: 'spine_hygiene()',
    desc: 'Returns duplicate pairs pending review, stale count, and cluster breakdown. Use this to surface an archive-health banner.',
  },
  {
    name: 'spine_usage',
    sig: 'spine_usage()',
    desc: 'Plan position: total memory count, cap, percent used, next reset date.',
  },
];

function CodeBlock({ children, lang = 'bash' }: { children: string; lang?: string }) {
  return (
    <div className="relative rounded-lg overflow-hidden border border-cream/[0.07] bg-[#0a0905]">
      <div className="px-4 py-2 border-b border-cream/[0.05] flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-widest text-cream/20">{lang}</span>
      </div>
      <pre className="px-5 py-4 overflow-x-auto">
        <code className="font-mono text-[12px] text-cream/65 leading-relaxed whitespace-pre">{children}</code>
      </pre>
    </div>
  );
}

export default function McpDocsPage() {
  return (
    <div className="min-h-screen bg-[#0D0C0A] text-[#E8E4DD]">
      {/* Nav */}
      <header className="sticky top-0 z-50 px-6 md:px-12 py-5 flex items-center justify-between backdrop-blur-md bg-[#0D0C0A]/80 border-b border-[#E8E4DD]/[0.05]">
        <Link href="/" className="flex items-center gap-3">
          <span className="block w-[7px] h-[7px] rounded-full bg-[#E89A3C]" />
          <span className="font-serif text-xl text-[#E8E4DD]">Spine</span>
        </Link>
        <nav className="flex items-center gap-6 font-mono text-[10px] uppercase tracking-widest">
          <Link href="/timeline" className="text-[#E8E4DD]/35 hover:text-[#E8E4DD]/65 transition-colors duration-300">Timeline</Link>
          <Link href="/pricing" className="text-[#E8E4DD]/35 hover:text-[#E8E4DD]/65 transition-colors duration-300">Pricing</Link>
        </nav>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-20">
        {/* Header */}
        <div className="mb-16">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C]/55 mb-4">Documentation</p>
          <h1 className="font-serif text-5xl text-[#E8E4DD] leading-tight mb-6">
            MCP Integration
          </h1>
          <p className="text-[#E8E4DD]/55 text-lg leading-relaxed max-w-xl">
            One command. Persistent memory across every Claude session. Your AI stops being a stranger.
          </p>
        </div>

        {/* Install */}
        <section className="mb-14">
          <h2 className="font-serif text-2xl text-[#E8E4DD]/85 mb-4">1. Install on a fresh machine</h2>
          <p className="text-[#E8E4DD]/45 text-sm mb-5 leading-relaxed">
            No global install required. <code className="font-mono text-[#E89A3C]/80 bg-[#E89A3C]/[0.06] px-1.5 py-0.5 rounded">npx</code> fetches and runs the latest version each time.
          </p>
          <CodeBlock lang="bash">{`$ npx xxiautomate-spine init`}</CodeBlock>
        </section>

        {/* Cloud setup */}
        <section className="mb-14">
          <h2 className="font-serif text-2xl text-[#E8E4DD]/85 mb-4">2. Cloud mode (recommended)</h2>
          <p className="text-[#E8E4DD]/45 text-sm mb-5 leading-relaxed">
            Syncs every memory to your Spine account. Works across machines, surfaces in the dashboard, and triggers the daily digest.
            Get your API key from{' '}
            <Link href="/settings" className="text-[#E89A3C]/70 hover:text-[#E89A3C] underline underline-offset-2 transition-colors">
              Settings → API Keys
            </Link>.
          </p>
          <CodeBlock lang="shell">{SNIPPET_CLOUD}</CodeBlock>
        </section>

        {/* Local setup */}
        <section className="mb-14">
          <h2 className="font-serif text-2xl text-[#E8E4DD]/85 mb-4">3. Local-only mode</h2>
          <p className="text-[#E8E4DD]/45 text-sm mb-5 leading-relaxed">
            Stores memories in a local SQLite file at <code className="font-mono text-[#E89A3C]/70 bg-[#E89A3C]/[0.06] px-1.5 py-0.5 rounded">~/.spine/memories.db</code>. No account required. No network. Good for offline or air-gapped machines.
          </p>
          <CodeBlock lang="shell">{SNIPPET_LOCAL}</CodeBlock>
        </section>

        {/* Claude Desktop / Claude Code */}
        <section className="mb-14">
          <h2 className="font-serif text-2xl text-[#E8E4DD]/85 mb-4">4. Wire into Claude</h2>
          <p className="text-[#E8E4DD]/45 text-sm mb-3 leading-relaxed">
            After <code className="font-mono text-[#E89A3C]/70 bg-[#E89A3C]/[0.06] px-1.5 py-0.5 rounded">init</code> prints this snippet, paste it into:
          </p>
          <ul className="list-none space-y-1.5 mb-5">
            {[
              ['Claude Desktop', '~/Library/Application Support/Claude/claude_desktop_config.json (Mac) or %APPDATA%/Claude/ (Windows)'],
              ['Claude Code', '~/.claude/settings.json → mcpServers block'],
            ].map(([tool, path]) => (
              <li key={tool} className="flex gap-3 text-sm">
                <span className="text-[#E89A3C]/55 font-mono text-[11px] mt-0.5 flex-shrink-0">{tool}</span>
                <span className="text-[#E8E4DD]/35 font-mono text-[11px] break-all">{path}</span>
              </li>
            ))}
          </ul>
          <CodeBlock lang="json">{SNIPPET_SETTINGS}</CodeBlock>
          <p className="mt-4 text-[#E8E4DD]/30 text-[12px] font-mono">
            Restart Claude after saving. Spine tools appear in the tool inspector immediately.
          </p>
        </section>

        {/* Tools */}
        <section className="mb-14">
          <h2 className="font-serif text-2xl text-[#E8E4DD]/85 mb-6">Available tools</h2>
          <div className="space-y-4">
            {tools.map((t) => (
              <div key={t.name} className="border border-[#E8E4DD]/[0.06] rounded-xl p-5">
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-[6px] h-[6px] rounded-full bg-[#E89A3C] flex-shrink-0" />
                  <code className="font-mono text-[12px] text-[#E89A3C]/80">{t.sig}</code>
                </div>
                <p className="text-[#E8E4DD]/50 text-[13px] leading-relaxed">{t.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Usage example */}
        <section className="mb-14">
          <h2 className="font-serif text-2xl text-[#E8E4DD]/85 mb-4">Example session</h2>
          <p className="text-[#E8E4DD]/45 text-sm mb-5 leading-relaxed">
            At the start of a coding session, Claude calls <code className="font-mono text-[#E89A3C]/70 bg-[#E89A3C]/[0.06] px-1.5 py-0.5 rounded">get_context</code> or <code className="font-mono text-[#E89A3C]/70 bg-[#E89A3C]/[0.06] px-1.5 py-0.5 rounded">spine_context_for_session</code> with hints from your first message.
            When you mention something worth remembering, it calls <code className="font-mono text-[#E89A3C]/70 bg-[#E89A3C]/[0.06] px-1.5 py-0.5 rounded">spine_capture</code>.
            Conflicts and pinned memories surface automatically.
          </p>
          <CodeBlock lang="text">{`User: "Let's continue the Supabase migration."

→ Claude calls: get_context("Supabase migration")
  Returns: 14 relevant memories from the past 3 weeks.

→ Claude calls: spine_capture("User prefers pl/pgsql over SQL functions for complex logic.")

→ User: "Actually we switched to Drizzle."
→ Claude calls: pin_memory("Project uses Drizzle ORM, NOT Supabase client for DB queries.")
  Future sessions always include this fact.`}</CodeBlock>
        </section>

        {/* Decay */}
        <section className="mb-14">
          <h2 className="font-serif text-2xl text-[#E8E4DD]/85 mb-4">Memory decay</h2>
          <p className="text-[#E8E4DD]/45 text-sm mb-5 leading-relaxed">
            Memories not accessed in 60 days are soft-archived (recoverable from your timeline).
            Run the decay script manually or let the nightly cron handle it:
          </p>
          <CodeBlock lang="bash">{`# Check what would be archived (dry run)
$ npm run spine:decay -- --dry

# Archive stale memories
$ npm run spine:decay`}</CodeBlock>
          <p className="mt-4 text-[#E8E4DD]/30 text-[12px] font-mono">
            Archived memories are recoverable from <Link href="/timeline" className="text-[#E89A3C]/50 hover:text-[#E89A3C] transition-colors">/timeline</Link> for 6 months.
          </p>
        </section>

        {/* Footer */}
        <div className="pt-10 border-t border-[#E8E4DD]/[0.05] flex items-center justify-between">
          <Link href="/" className="font-mono text-[10px] uppercase tracking-widest text-[#E8E4DD]/20 hover:text-[#E8E4DD]/45 transition-colors">
            ← Home
          </Link>
          <Link href="/pricing" className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C]/45 hover:text-[#E89A3C] transition-colors">
            View pricing →
          </Link>
        </div>
      </main>
    </div>
  );
}
