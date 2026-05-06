import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingNav } from '@/components/MarketingNav';
import { MarketingFooter } from '@/components/MarketingFooter';

export const metadata: Metadata = {
  title: 'Privacy Policy — Spine',
  description:
    'What Spine collects, how it is stored, and what your rights are. Short, plain English.',
};

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="py-12" style={{ borderTop: '1px solid var(--s-vein)' }}>
      <p className="font-mono text-[11px] uppercase tracking-widest mb-6" style={{ color: 'var(--s-gold-deep)' }}>{label}</p>
      {children}
    </section>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-serif font-normal text-2xl md:text-3xl mb-5 leading-snug" style={{ color: 'var(--s-ink)' }}>
      {children}
    </h2>
  );
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="leading-relaxed mb-4 last:mb-0" style={{ color: 'var(--s-ink-soft)' }}>{children}</p>;
}

function DataTable({ rows }: { rows: [string, string][] }) {
  return (
    <div className="overflow-x-auto mt-4 mb-6">
      <table className="w-full text-sm border-collapse">
        <tbody>
          {rows.map(([key, val]) => (
            <tr key={key} style={{ borderTop: '1px solid var(--s-vein)' }}>
              <td className="py-3 pr-6 align-top w-1/3">
                <span className="font-mono text-[12px] font-medium" style={{ color: 'var(--s-ink-strong)' }}>{key}</span>
              </td>
              <td className="py-3 align-top leading-relaxed" style={{ color: 'var(--s-ink-soft)' }}>{val}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ThirdPartyTable() {
  return (
    <div className="overflow-x-auto mt-4 mb-6">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr style={{ borderTop: '1px solid var(--s-vein)' }}>
            <th className="py-3 pr-6 text-left font-mono text-[10px] uppercase tracking-widest w-1/4" style={{ color: 'var(--s-ink-faint)' }}>Service</th>
            <th className="py-3 pr-6 text-left font-mono text-[10px] uppercase tracking-widest w-1/3" style={{ color: 'var(--s-ink-faint)' }}>Purpose</th>
            <th className="py-3 text-left font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--s-ink-faint)' }}>Their policy</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['Supabase', 'Database, auth', 'supabase.com/privacy'],
            ['OpenAI', 'Generating embeddings for semantic search', 'openai.com/policies/privacy-policy'],
            ['LemonSqueezy', 'Payment processing (Pro and Team plans)', 'lemonsqueezy.com/privacy'],
          ].map(([svc, purpose, url]) => (
            <tr key={svc} style={{ borderTop: '1px solid var(--s-vein)' }}>
              <td className="py-3 pr-6 align-top">
                <span className="font-mono text-[12px] font-medium" style={{ color: 'var(--s-ink-strong)' }}>{svc}</span>
              </td>
              <td className="py-3 pr-6 align-top leading-relaxed" style={{ color: 'var(--s-ink-soft)' }}>{purpose}</td>
              <td className="py-3 align-top">
                <a
                  href={`https://${url}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[11px] underline underline-offset-4 transition-colors duration-300"
                  style={{ color: 'var(--s-gold-deep)', textDecorationColor: 'var(--s-vein-strong)' }}
                >
                  {url}
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PermissionsTable() {
  return (
    <DataTable
      rows={[
        ['storage', 'Save your settings and memory queue locally in Chrome'],
        ['activeTab', 'Read the current page\'s URL and title when you trigger a capture'],
        ['chatgpt.com, gemini.google.com', 'Read conversation content on the AI sites you enable'],
        ['spine.xxiautomate.com', 'Sync your queue to the Spine API'],
      ]}
    />
  );
}

export default function PrivacyPage() {
  return (
    <main className="relative marble-bg min-h-screen overflow-x-hidden" style={{ color: 'var(--s-ink)' }}>
      <div className="marble-vein" style={{ position: 'fixed', zIndex: 0 }} />
      <div className="marble-grain" style={{ position: 'fixed', zIndex: 0 }} />
      <div className="gold-foil-top fixed top-0 inset-x-0 h-[1.5px] z-50" style={{ opacity: 0.95 }} />

      <MarketingNav />

      <header className="relative px-6 md:px-16 pt-20 pb-8 max-w-3xl mx-auto" style={{ zIndex: 1 }}>
        <p className="font-mono text-[11px] uppercase tracking-widest mb-6" style={{ color: 'var(--s-gold-deep)' }}>
          Legal · Privacy Policy
        </p>
        <h1 className="font-serif font-normal text-4xl md:text-5xl leading-tight mb-5" style={{ color: 'var(--s-ink)' }}>
          What we know, what we keep,<br className="hidden md:block" /> and what we never touch.
        </h1>
        <p className="leading-relaxed font-mono text-[12px]" style={{ color: 'var(--s-ink-faint)' }}>
          Effective 20 April 2026 · XXIautomate (Roman Puglielli, ABN 46 248 687 420)
        </p>
      </header>

      <div className="relative px-6 md:px-16 pb-32 max-w-3xl mx-auto" style={{ zIndex: 1 }}>

        <Section label="What Spine is">
          <P>
            Spine is a browser extension and MCP server that captures facts from your AI conversations
            and makes them available to your AI in future sessions. Think of it as a personal memory
            archive — yours alone.
          </P>
        </Section>

        <Section label="What we collect">
          <H2>From the browser extension</H2>
          <P>
            When you use Spine on a supported site (ChatGPT, Gemini), the extension reads:
          </P>
          <DataTable
            rows={[
              ['Page URL', 'To identify which AI service generated the memory'],
              ['Page title', 'To label the memory source in your archive'],
              ['Selected text', '(If you manually trigger capture) the content you chose to remember'],
              ['Conversation excerpts', 'Facts extracted from the current chat session'],
            ]}
          />
          <P>We do <strong style={{ color: 'var(--s-ink)', fontWeight: 500 }}>not</strong> collect:</P>
          <ul className="mt-2 mb-4 space-y-2 pl-4">
            {[
              'Your full conversation history',
              'Passwords, payment details, or form data',
              'Browsing history outside of chatgpt.com and gemini.google.com',
              'Any data from sites you haven\'t explicitly enabled in settings',
            ].map((item) => (
              <li key={item} className="flex gap-3 leading-relaxed text-sm" style={{ color: 'var(--s-ink-soft)' }}>
                <span className="select-none flex-shrink-0" style={{ color: 'var(--s-gold)' }}>—</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <H2>From the MCP server</H2>
          <P>
            When you use the Spine MCP tools (<span className="font-mono text-[12px] px-1.5 py-0.5 rounded" style={{ color: 'var(--s-ink-strong)', background: 'rgba(184,146,74,0.10)' }}>spine_remember</span>,{' '}
            <span className="font-mono text-[12px] px-1.5 py-0.5 rounded" style={{ color: 'var(--s-ink-strong)', background: 'rgba(184,146,74,0.10)' }}>spine_recall</span>,{' '}
            <span className="font-mono text-[12px] px-1.5 py-0.5 rounded" style={{ color: 'var(--s-ink-strong)', background: 'rgba(184,146,74,0.10)' }}>spine_forget</span>) inside Claude Code or Claude Desktop:
          </P>
          <DataTable
            rows={[
              ['Memory content you submit', 'The fact you asked Spine to store'],
              ['Recall queries', 'To retrieve relevant memories; not stored separately'],
            ]}
          />
        </Section>

        <Section label="How we store it">
          <P>
            Everything is stored in <strong style={{ color: 'var(--s-ink)', fontWeight: 500 }}>your personal database row</strong>, keyed
            to your account. Row-level security ensures no other user can read your data.
          </P>
          <ul className="mt-2 mb-4 space-y-3 pl-4">
            {[
              'Extension state (queue, settings) lives in chrome.storage.local and chrome.storage.sync — your browser, no third party.',
              'Memories synced to the server are stored in Supabase Postgres (Sydney region) with vector embeddings for semantic search.',
              'We do not sell, license, or share your memory data with any third party.',
              'We do not use your memories to train models.',
            ].map((item) => (
              <li key={item} className="flex gap-3 leading-relaxed text-sm" style={{ color: 'var(--s-ink-soft)' }}>
                <span className="select-none flex-shrink-0 mt-px" style={{ color: 'var(--s-gold)' }}>—</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section label="Third-party services">
          <ThirdPartyTable />
          <P>
            OpenAI receives your memory <em className="italic">content</em> to produce a vector embedding.
            Their data retention policy (zero-day retention on the Embeddings API) means they do not store it.
          </P>
          <P>
            We use no advertising networks, analytics SDKs, or tracking pixels.
          </P>
        </Section>

        <Section label="Retention and deletion">
          <ul className="space-y-3 pl-4">
            {[
              'You can delete any individual memory from your dashboard at any time.',
              'You can delete your entire account and all associated data from Settings → Account → Delete account.',
              'Deletion is permanent. We do not retain backups of deleted memories.',
              'LemonSqueezy retains billing records as required by payment regulations; we have no control over that.',
            ].map((item) => (
              <li key={item} className="flex gap-3 leading-relaxed text-sm" style={{ color: 'var(--s-ink-soft)' }}>
                <span className="select-none flex-shrink-0 mt-px" style={{ color: 'var(--s-gold)' }}>—</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </Section>

        <Section label="Extension permissions">
          <P>
            The extension requests the following Chrome permissions. We request nothing beyond what is necessary.
          </P>
          <PermissionsTable />
          <P>
            We do not request access to all URLs. The extension only operates on the sites listed above.
          </P>
        </Section>

        <Section label="Children">
          <P>
            Spine is not directed at children under 13. We do not knowingly collect data from anyone under 13.
          </P>
        </Section>

        <Section label="Changes">
          <P>
            If we materially change what we collect or how we use it, we will update this policy and notify
            you via the dashboard. Continued use after the notice period constitutes acceptance.
          </P>
        </Section>

        <Section label="Contact">
          <P>
            Questions? Email{' '}
            <a
              href="mailto:rsautomateads@gmail.com"
              className="underline underline-offset-4 transition-colors duration-300"
              style={{ color: 'var(--s-gold-deep)', textDecorationColor: 'var(--s-vein-strong)' }}
            >
              rsautomateads@gmail.com
            </a>{' '}
            or open an issue at{' '}
            <a
              href="https://github.com/xxiautomate-star/spine"
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-[12px] underline underline-offset-4 transition-colors duration-300"
              style={{ color: 'var(--s-gold-deep)', textDecorationColor: 'var(--s-vein-strong)' }}
            >
              github.com/xxiautomate-star/spine
            </a>
            .
          </P>
        </Section>

        <div className="pt-10 mt-4" style={{ borderTop: '1px solid var(--s-vein)' }}>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <p className="font-mono text-[11px] uppercase tracking-widest" style={{ color: 'var(--s-ink-faint)' }}>
              © {new Date().getFullYear()} XXIautomate · ABN 46 248 687 420
            </p>
            <Link
              href="/"
              className="font-mono text-[11px] uppercase tracking-widest transition-colors duration-300"
              style={{ color: 'var(--s-gold-deep)' }}
            >
              spine.xxiautomate.com →
            </Link>
          </div>
        </div>
      </div>

      <MarketingFooter />
    </main>
  );
}
