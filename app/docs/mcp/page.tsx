import Link from 'next/link';
import { MarketingNav } from '@/components/MarketingNav';
import { MarketingFooter } from '@/components/MarketingFooter';

export const metadata = { title: 'MCP Integration — Spine' };

const SNIPPET_SETTINGS = `{
  "mcpServers": {
    "spine": {
      "command": "npx",
      "args": ["-y", "spine-mcp", "serve"]
    }
  }
}`;

const SNIPPET_CLOUD = `$ npx spine-mcp init
# Spine — setup
# ─────────────
# Storage mode — [L]ocal-only or [c]loud sync? (L/c): c
# Paste your Spine API key: spine_live_xxxxxxxxxxxxxxxx
# API base URL (default https://spine.xxiautomate.com): [Enter]
# [spine] API key accepted.
# Config written to ~/.spine/config.json`;

const SNIPPET_LOCAL = `$ npx spine-mcp init
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
    <div
      className="relative rounded-lg overflow-hidden"
      style={{
        background: 'linear-gradient(180deg, #ffffff 0%, #fdfaf2 100%)',
        border: '1px solid var(--s-vein-strong)',
        boxShadow: 'var(--s-shadow-1)',
      }}
    >
      <div
        className="px-4 py-2 flex items-center justify-between"
        style={{ borderBottom: '1px solid var(--s-vein)' }}
      >
        <span className="font-mono text-[9px] uppercase tracking-widest" style={{ color: 'var(--s-ink-faint)' }}>{lang}</span>
      </div>
      <pre className="px-5 py-4 overflow-x-auto">
        <code className="font-mono text-[12px] leading-relaxed whitespace-pre" style={{ color: 'var(--s-ink-strong)' }}>{children}</code>
      </pre>
    </div>
  );
}

export default function McpDocsPage() {
  return (
    <main className="relative marble-bg min-h-screen overflow-x-hidden" style={{ color: 'var(--s-ink)' }}>
      <div className="marble-vein" style={{ position: 'fixed', zIndex: 0 }} />
      <div className="marble-grain" style={{ position: 'fixed', zIndex: 0 }} />
      <div className="gold-foil-top fixed top-0 inset-x-0 h-[1.5px] z-50" style={{ opacity: 0.95 }} />

      <MarketingNav />

      <div className="relative max-w-3xl mx-auto px-6 py-20" style={{ zIndex: 1 }}>
        <div className="mb-16 rise rise-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] mb-5" style={{ color: 'var(--s-gold-deep)' }}>
            <span className="mr-3" style={{ color: 'var(--s-gold)' }}>§ 001</span>
            Documentation
          </p>
          <h1 className="font-serif text-5xl leading-tight tracking-[-0.025em] mb-6" style={{ color: 'var(--s-ink)' }}>
            MCP Integration
          </h1>
          <p className="text-lg leading-relaxed max-w-xl" style={{ color: 'var(--s-ink-soft)' }}>
            One command. Persistent memory across every Claude session. Your AI stops being a stranger.
          </p>
        </div>

        <section className="mb-14">
          <h2 className="font-serif text-2xl mb-4" style={{ color: 'var(--s-ink)' }}>1. Install on a fresh machine</h2>
          <p className="text-sm mb-5 leading-relaxed" style={{ color: 'var(--s-ink-soft)' }}>
            No global install required. <code className="font-mono px-1.5 py-0.5 rounded" style={{ color: 'var(--s-gold-deep)', background: 'rgba(184,146,74,0.10)' }}>npx</code> fetches and runs the latest version each time.
          </p>
          <CodeBlock lang="bash">{`$ npx spine-mcp init`}</CodeBlock>
        </section>

        <section className="mb-14">
          <h2 className="font-serif text-2xl mb-4" style={{ color: 'var(--s-ink)' }}>2. Cloud mode (recommended)</h2>
          <p className="text-sm mb-5 leading-relaxed" style={{ color: 'var(--s-ink-soft)' }}>
            Syncs every memory to your Spine account. Works across machines, surfaces in the dashboard, and triggers the daily digest.
            Get your API key from{' '}
            <Link href="/settings" className="underline underline-offset-4 transition-colors" style={{ color: 'var(--s-gold-deep)', textDecorationColor: 'var(--s-vein-strong)' }}>
              Settings → API Keys
            </Link>.
          </p>
          <CodeBlock lang="shell">{SNIPPET_CLOUD}</CodeBlock>
        </section>

        <section className="mb-14">
          <h2 className="font-serif text-2xl mb-4" style={{ color: 'var(--s-ink)' }}>3. Local-only mode</h2>
          <p className="text-sm mb-5 leading-relaxed" style={{ color: 'var(--s-ink-soft)' }}>
            Stores memories in a local SQLite file at <code className="font-mono px-1.5 py-0.5 rounded" style={{ color: 'var(--s-gold-deep)', background: 'rgba(184,146,74,0.10)' }}>~/.spine/memories.db</code>. No account required. No network. Good for offline or air-gapped machines.
          </p>
          <CodeBlock lang="shell">{SNIPPET_LOCAL}</CodeBlock>
        </section>

        <section className="mb-14">
          <h2 className="font-serif text-2xl mb-4" style={{ color: 'var(--s-ink)' }}>4. Wire into Claude</h2>
          <p className="text-sm mb-3 leading-relaxed" style={{ color: 'var(--s-ink-soft)' }}>
            After <code className="font-mono px-1.5 py-0.5 rounded" style={{ color: 'var(--s-gold-deep)', background: 'rgba(184,146,74,0.10)' }}>init</code> prints this snippet, paste it into:
          </p>
          <ul className="list-none space-y-1.5 mb-5">
            {[
              ['Claude Desktop', '~/Library/Application Support/Claude/claude_desktop_config.json (Mac) or %APPDATA%/Claude/ (Windows)'],
              ['Claude Code', '~/.claude/settings.json → mcpServers block'],
            ].map(([tool, path]) => (
              <li key={tool} className="flex gap-3 text-sm">
                <span className="font-mono text-[11px] mt-0.5 flex-shrink-0" style={{ color: 'var(--s-gold-deep)' }}>{tool}</span>
                <span className="font-mono text-[11px] break-all" style={{ color: 'var(--s-ink-faint)' }}>{path}</span>
              </li>
            ))}
          </ul>
          <CodeBlock lang="json">{SNIPPET_SETTINGS}</CodeBlock>
          <p className="mt-4 text-[12px] font-mono" style={{ color: 'var(--s-ink-faint)' }}>
            Restart Claude after saving. Spine tools appear in the tool inspector immediately.
          </p>
        </section>

        <section className="mb-14">
          <h2 className="font-serif text-2xl mb-6" style={{ color: 'var(--s-ink)' }}>Available tools</h2>
          <div className="space-y-4">
            {tools.map((t) => (
              <div
                key={t.name}
                className="rounded-xl p-5"
                style={{
                  background: 'rgba(255, 253, 247, 0.62)',
                  border: '1px solid var(--s-vein)',
                }}
              >
                <div className="flex items-center gap-3 mb-3">
                  <span className="w-[6px] h-[6px] rounded-full flex-shrink-0" style={{ background: 'var(--s-gold)' }} />
                  <code className="font-mono text-[12px]" style={{ color: 'var(--s-gold-deep)' }}>{t.sig}</code>
                </div>
                <p className="text-[13px] leading-relaxed" style={{ color: 'var(--s-ink-soft)' }}>{t.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-14">
          <h2 className="font-serif text-2xl mb-4" style={{ color: 'var(--s-ink)' }}>Example session</h2>
          <p className="text-sm mb-5 leading-relaxed" style={{ color: 'var(--s-ink-soft)' }}>
            At the start of a coding session, Claude calls <code className="font-mono px-1.5 py-0.5 rounded" style={{ color: 'var(--s-gold-deep)', background: 'rgba(184,146,74,0.10)' }}>get_context</code> or <code className="font-mono px-1.5 py-0.5 rounded" style={{ color: 'var(--s-gold-deep)', background: 'rgba(184,146,74,0.10)' }}>spine_context_for_session</code> with hints from your first message.
            When you mention something worth remembering, it calls <code className="font-mono px-1.5 py-0.5 rounded" style={{ color: 'var(--s-gold-deep)', background: 'rgba(184,146,74,0.10)' }}>spine_capture</code>.
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

        <section className="mb-14">
          <h2 className="font-serif text-2xl mb-4" style={{ color: 'var(--s-ink)' }}>Memory decay</h2>
          <p className="text-sm mb-5 leading-relaxed" style={{ color: 'var(--s-ink-soft)' }}>
            Memories not accessed in 60 days are soft-archived (recoverable from your timeline).
            Run the decay script manually or let the nightly cron handle it:
          </p>
          <CodeBlock lang="bash">{`# Check what would be archived (dry run)
$ npm run spine:decay -- --dry

# Archive stale memories
$ npm run spine:decay`}</CodeBlock>
          <p className="mt-4 text-[12px] font-mono" style={{ color: 'var(--s-ink-faint)' }}>
            Archived memories are recoverable from <Link href="/timeline" className="underline underline-offset-4" style={{ color: 'var(--s-gold-deep)', textDecorationColor: 'var(--s-vein-strong)' }}>/timeline</Link> for 6 months.
          </p>
        </section>

        <div className="pt-10 flex items-center justify-between" style={{ borderTop: '1px solid var(--s-vein)' }}>
          <Link href="/" className="font-mono text-[10px] uppercase tracking-widest transition-colors" style={{ color: 'var(--s-ink-faint)' }}>
            ← Home
          </Link>
          <Link href="/pricing" className="font-mono text-[10px] uppercase tracking-widest transition-colors" style={{ color: 'var(--s-gold-deep)' }}>
            View pricing →
          </Link>
        </div>
      </div>

      <MarketingFooter />
    </main>
  );
}
