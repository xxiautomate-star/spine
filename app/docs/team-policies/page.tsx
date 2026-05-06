import Link from 'next/link';
import { MarketingNav } from '@/components/MarketingNav';
import { MarketingFooter } from '@/components/MarketingFooter';

export const metadata = { title: 'Team Memory Policies — Spine' };

const CODE_RLS = `-- Every table in Spine is scoped by org_id.
-- Two tenants cannot see each other's memories.
create policy memories_org_all on public.memories
  for all using (
    org_id = any(my_org_ids())  -- resolves to user's orgs
  );

-- my_org_ids() returns org IDs where user is a member.
create function public.my_org_ids()
returns setof uuid as $$
  select org_id from public.org_members
  where user_id = auth.uid()
$$ language sql security definer stable;`;

const CODE_PIN = `// Force a memory into every team member's context
PATCH /api/memories/{id}/policy
{
  "required_context": true,
  "visibility": "team"
}

// Or via MCP:
pin_memory("We use PostgreSQL 15. Never MySQL. Never SQLite in prod.")`;

const CODE_INVITE = `POST /api/team/{team_id}/invite
{ "email": "teammate@company.com" }

// Sends an invite email via Resend.
// Teammate accepts at /team/join?token=...
// Role defaults to 'member'. Owner can promote to 'admin'.`;

const CODE_AUDIT = `GET /api/org/{id}/audit-log

// Returns:
{
  "log": [
    {
      "action": "plan.upgrade",
      "actor": "roman@company.com",
      "metadata": { "plan": "team", "lsSubId": "sub_xxx" },
      "created_at": "2026-04-21T09:32:11Z"
    },
    {
      "action": "member.invite",
      "actor": "roman@company.com",
      "target": "teammate@company.com",
      "created_at": "2026-04-21T09:34:05Z"
    }
  ]
}`;

function CodeBlock({ children, lang = 'typescript' }: { children: string; lang?: string }) {
  return (
    <div
      className="rounded-xl overflow-hidden mb-6"
      style={{
        background: 'linear-gradient(180deg, #ffffff 0%, #fdfaf2 100%)',
        border: '1px solid var(--s-vein-strong)',
        boxShadow: 'var(--s-shadow-1)',
      }}
    >
      <div className="px-4 py-2" style={{ borderBottom: '1px solid var(--s-vein)' }}>
        <span className="font-mono text-[9px] uppercase tracking-widest" style={{ color: 'var(--s-ink-faint)' }}>{lang}</span>
      </div>
      <pre className="px-5 py-4 overflow-x-auto">
        <code className="font-mono text-[12px] leading-relaxed whitespace-pre" style={{ color: 'var(--s-ink-strong)' }}>{children}</code>
      </pre>
    </div>
  );
}

export default function TeamPoliciesPage() {
  return (
    <main className="relative marble-bg min-h-screen overflow-x-hidden" style={{ color: 'var(--s-ink)' }}>
      <div className="marble-vein" style={{ position: 'fixed', zIndex: 0 }} />
      <div className="marble-grain" style={{ position: 'fixed', zIndex: 0 }} />
      <div className="gold-foil-top fixed top-0 inset-x-0 h-[1.5px] z-50" style={{ opacity: 0.95 }} />

      <MarketingNav />

      <div className="relative max-w-3xl mx-auto px-6 py-20" style={{ zIndex: 1 }}>
        <div className="mb-16 rise rise-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] mb-5" style={{ color: 'var(--s-gold-deep)' }}>
            <span className="mr-3" style={{ color: 'var(--s-gold)' }}>§ Team plan</span>
            Documentation
          </p>
          <h1 className="font-serif text-5xl leading-tight tracking-[-0.025em] mb-6" style={{ color: 'var(--s-ink)' }}>
            Team memory policies
          </h1>
          <p className="text-lg leading-relaxed max-w-xl" style={{ color: 'var(--s-ink-soft)' }}>
            How Spine isolates tenants, shares memory across a workspace, enforces required-context policies,
            and logs every change to the org audit trail.
          </p>
        </div>

        <section className="mb-16 pt-12" style={{ borderTop: '1px solid var(--s-vein)' }}>
          <h2 className="font-serif text-3xl mb-4" style={{ color: 'var(--s-ink)' }}>1. Tenant isolation</h2>
          <p className="text-[14px] leading-relaxed mb-6" style={{ color: 'var(--s-ink-soft)' }}>
            Every table in Spine — memories, entity_nodes, entity_edges, memory_conflicts, merge_proposals, digests
            — carries an <code className="font-mono text-[12px] px-1.5 py-0.5 rounded" style={{ color: 'var(--s-gold-deep)', background: 'rgba(184,146,74,0.10)' }}>org_id</code> column.
            Supabase Row Level Security (RLS) is enabled on all tables.
            The policy checks that the requesting user is a member of the row&apos;s org — two tenants can never
            see each other&apos;s data, even via the API.
          </p>
          <CodeBlock lang="sql">{CODE_RLS}</CodeBlock>
          <p className="text-[13px] leading-relaxed" style={{ color: 'var(--s-ink-faint)' }}>
            Service-role API calls (cron jobs, decay runner) bypass RLS and operate on all orgs.
            User-facing API routes use the Supabase session client — RLS enforces automatically.
          </p>
        </section>

        <section className="mb-16 pt-12" style={{ borderTop: '1px solid var(--s-vein)' }}>
          <h2 className="font-serif text-3xl mb-4" style={{ color: 'var(--s-ink)' }}>2. Workspace model</h2>
          <p className="text-[14px] leading-relaxed mb-6" style={{ color: 'var(--s-ink-soft)' }}>
            Every user belongs to at least one <strong style={{ color: 'var(--s-ink)' }}>org</strong>.
            When you sign up, Spine calls <code className="font-mono text-[12px]" style={{ color: 'var(--s-gold-deep)' }}>spine_ensure_default_org()</code> to
            create your personal workspace automatically.
          </p>
          <div className="grid sm:grid-cols-2 gap-4 mb-6">
            {[
              { role: 'owner', desc: 'Full control. Invite, remove members. Set org plan. Delete org.' },
              { role: 'admin', desc: 'Invite and remove members. Set memory policies. Cannot delete org.' },
              { role: 'member', desc: 'Capture memories. Read all org memories. Cannot manage members.' },
              { role: 'viewer', desc: 'Read-only access to org memories. Cannot capture.' },
            ].map(({ role, desc }) => (
              <div
                key={role}
                className="p-4 rounded-xl"
                style={{
                  background: 'rgba(255, 253, 247, 0.62)',
                  border: '1px solid var(--s-vein)',
                }}
              >
                <p className="font-mono text-[11px] uppercase tracking-wider mb-1.5" style={{ color: 'var(--s-gold-deep)' }}>{role}</p>
                <p className="text-[12px] leading-relaxed" style={{ color: 'var(--s-ink-soft)' }}>{desc}</p>
              </div>
            ))}
          </div>
          <p className="text-[13px]" style={{ color: 'var(--s-ink-faint)' }}>
            Roles are stored in <code className="font-mono text-[11px]" style={{ color: 'var(--s-gold-deep)' }}>org_members.role</code>.
            Invite tokens are 48-char hex strings that expire after 7 days of non-use.
          </p>
        </section>

        <section className="mb-16 pt-12" style={{ borderTop: '1px solid var(--s-vein)' }}>
          <h2 className="font-serif text-3xl mb-4" style={{ color: 'var(--s-ink)' }}>3. Required-context policies</h2>
          <p className="text-[14px] leading-relaxed mb-6" style={{ color: 'var(--s-ink-soft)' }}>
            Any memory can be pinned as <code className="font-mono text-[12px]" style={{ color: 'var(--s-gold-deep)' }}>required_context</code>.
            Pinned memories are injected into every team member&apos;s context block — regardless of cosine similarity.
            They appear in the MCP <code className="font-mono text-[12px]" style={{ color: 'var(--s-gold-deep)' }}>get_context</code> response
            and in the browser extension HUD.
          </p>
          <CodeBlock lang="typescript">{CODE_PIN}</CodeBlock>
          <p className="text-[13px] leading-relaxed" style={{ color: 'var(--s-ink-faint)' }}>
            Use sparingly. Pinned memories always consume context budget. The recommended limit is
            5–10 pinned memories per org to avoid overwhelming the context window with boilerplate.
          </p>
        </section>

        <section className="mb-16 pt-12" style={{ borderTop: '1px solid var(--s-vein)' }}>
          <h2 className="font-serif text-3xl mb-4" style={{ color: 'var(--s-ink)' }}>4. Inviting team members</h2>
          <p className="text-[14px] leading-relaxed mb-6" style={{ color: 'var(--s-ink-soft)' }}>
            Owners and admins can invite via the dashboard or the REST API.
            An invite email is sent via Resend. The invited person accepts at{' '}
            <code className="font-mono text-[12px]" style={{ color: 'var(--s-gold-deep)' }}>/team/join?token=…</code>.
          </p>
          <CodeBlock lang="http">{CODE_INVITE}</CodeBlock>
          <p className="text-[13px]" style={{ color: 'var(--s-ink-faint)' }}>
            The Team plan supports up to 5 seats. Adding a 6th member returns{' '}
            <code className="font-mono text-[11px]" style={{ color: 'var(--s-gold-deep)' }}>402 seat_limit_reached</code>.
          </p>
        </section>

        <section className="mb-16 pt-12" style={{ borderTop: '1px solid var(--s-vein)' }}>
          <h2 className="font-serif text-3xl mb-4" style={{ color: 'var(--s-ink)' }}>5. Org audit log</h2>
          <p className="text-[14px] leading-relaxed mb-6" style={{ color: 'var(--s-ink-soft)' }}>
            All administrative actions are written to <code className="font-mono text-[12px]" style={{ color: 'var(--s-gold-deep)' }}>org_audit_log</code>.
            Any org member can read it. Actions include: <code className="font-mono text-[11px]" style={{ color: 'var(--s-gold-deep)' }}>member.invite</code>,{' '}
            <code className="font-mono text-[11px]" style={{ color: 'var(--s-gold-deep)' }}>member.join</code>,{' '}
            <code className="font-mono text-[11px]" style={{ color: 'var(--s-gold-deep)' }}>member.remove</code>,{' '}
            <code className="font-mono text-[11px]" style={{ color: 'var(--s-gold-deep)' }}>policy.change</code>,{' '}
            <code className="font-mono text-[11px]" style={{ color: 'var(--s-gold-deep)' }}>plan.upgrade</code>.
          </p>
          <CodeBlock lang="json">{CODE_AUDIT}</CodeBlock>
        </section>

        <div className="pt-10 flex items-center justify-between" style={{ borderTop: '1px solid var(--s-vein)' }}>
          <Link href="/docs/mcp" className="font-mono text-[10px] uppercase tracking-widest transition-colors" style={{ color: 'var(--s-ink-faint)' }}>
            ← MCP Docs
          </Link>
          <Link href="/pricing" className="font-mono text-[10px] uppercase tracking-widest transition-colors" style={{ color: 'var(--s-gold-deep)' }}>
            Team pricing →
          </Link>
        </div>
      </div>

      <MarketingFooter />
    </main>
  );
}
