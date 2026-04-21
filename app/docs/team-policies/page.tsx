import Link from 'next/link';

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
    <div className="rounded-xl overflow-hidden border border-[#E8E4DD]/[0.07] bg-[#0a0905] mb-6">
      <div className="px-4 py-2 border-b border-[#E8E4DD]/[0.05]">
        <span className="font-mono text-[9px] uppercase tracking-widest text-[#E8E4DD]/20">{lang}</span>
      </div>
      <pre className="px-5 py-4 overflow-x-auto">
        <code className="font-mono text-[12px] text-[#E8E4DD]/60 leading-relaxed whitespace-pre">{children}</code>
      </pre>
    </div>
  );
}

export default function TeamPoliciesPage() {
  return (
    <div className="min-h-screen bg-[#0D0C0A] text-[#E8E4DD]">
      <header className="sticky top-0 z-50 px-6 md:px-12 py-5 flex items-center justify-between backdrop-blur-md bg-[#0D0C0A]/80 border-b border-[#E8E4DD]/[0.05]">
        <Link href="/" className="flex items-center gap-3">
          <span className="block w-[7px] h-[7px] rounded-full bg-[#E89A3C]" />
          <span className="font-serif text-xl">Spine</span>
        </Link>
        <nav className="flex items-center gap-5 font-mono text-[10px] uppercase tracking-widest">
          <Link href="/docs/mcp" className="text-[#E8E4DD]/35 hover:text-[#E8E4DD]/65 transition-colors hidden sm:block">MCP Docs</Link>
          <Link href="/pricing" className="text-[#E8E4DD]/35 hover:text-[#E8E4DD]/65 transition-colors hidden sm:block">Pricing</Link>
          <Link href="/login?signup=1" className="text-[#E89A3C]/70 hover:text-[#E89A3C] transition-colors">Start free →</Link>
        </nav>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-20">
        <div className="mb-16">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C]/55 mb-4">Team plan · Documentation</p>
          <h1 className="font-serif text-5xl text-[#E8E4DD] leading-tight mb-6">Team memory policies</h1>
          <p className="text-[#E8E4DD]/50 text-lg leading-relaxed max-w-xl">
            How Spine isolates tenants, shares memory across a workspace, enforces required-context policies,
            and logs every change to the org audit trail.
          </p>
        </div>

        {/* Tenant isolation */}
        <section className="mb-16 border-t border-[#E8E4DD]/[0.06] pt-12">
          <h2 className="font-serif text-3xl text-[#E8E4DD] mb-4">1. Tenant isolation</h2>
          <p className="text-[#E8E4DD]/50 text-[14px] leading-relaxed mb-6">
            Every table in Spine — memories, entity_nodes, entity_edges, memory_conflicts, merge_proposals, digests
            — carries an <code className="font-mono text-[#E89A3C]/70 text-[12px] bg-[#E89A3C]/[0.06] px-1.5 py-0.5 rounded">org_id</code> column.
            Supabase Row Level Security (RLS) is enabled on all tables.
            The policy checks that the requesting user is a member of the row&apos;s org — two tenants can never
            see each other&apos;s data, even via the API.
          </p>
          <CodeBlock lang="sql">{CODE_RLS}</CodeBlock>
          <p className="text-[#E8E4DD]/35 text-[13px] leading-relaxed">
            Service-role API calls (cron jobs, decay runner) bypass RLS and operate on all orgs.
            User-facing API routes use the Supabase session client — RLS enforces automatically.
          </p>
        </section>

        {/* Workspace model */}
        <section className="mb-16 border-t border-[#E8E4DD]/[0.06] pt-12">
          <h2 className="font-serif text-3xl text-[#E8E4DD] mb-4">2. Workspace model</h2>
          <p className="text-[#E8E4DD]/50 text-[14px] leading-relaxed mb-6">
            Every user belongs to at least one <strong className="text-[#E8E4DD]/70">org</strong>.
            When you sign up, Spine calls <code className="font-mono text-[#E89A3C]/70 text-[12px]">spine_ensure_default_org()</code> to
            create your personal workspace automatically.
          </p>
          <div className="grid sm:grid-cols-2 gap-4 mb-6">
            {[
              { role: 'owner', desc: 'Full control. Invite, remove members. Set org plan. Delete org.' },
              { role: 'admin', desc: 'Invite and remove members. Set memory policies. Cannot delete org.' },
              { role: 'member', desc: 'Capture memories. Read all org memories. Cannot manage members.' },
              { role: 'viewer', desc: 'Read-only access to org memories. Cannot capture.' },
            ].map(({ role, desc }) => (
              <div key={role} className="p-4 border border-[#E8E4DD]/[0.07] rounded-xl">
                <p className="font-mono text-[11px] text-[#E89A3C]/70 uppercase tracking-wider mb-1.5">{role}</p>
                <p className="text-[#E8E4DD]/45 text-[12px] leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
          <p className="text-[#E8E4DD]/35 text-[13px]">
            Roles are stored in <code className="font-mono text-[#E89A3C]/60 text-[11px]">org_members.role</code>.
            Invite tokens are 48-char hex strings that expire after 7 days of non-use.
          </p>
        </section>

        {/* Required-context policies */}
        <section className="mb-16 border-t border-[#E8E4DD]/[0.06] pt-12">
          <h2 className="font-serif text-3xl text-[#E8E4DD] mb-4">3. Required-context policies</h2>
          <p className="text-[#E8E4DD]/50 text-[14px] leading-relaxed mb-6">
            Any memory can be pinned as <code className="font-mono text-[#E89A3C]/70 text-[12px]">required_context</code>.
            Pinned memories are injected into every team member&apos;s context block — regardless of cosine similarity.
            They appear in the MCP <code className="font-mono text-[#E89A3C]/70 text-[12px]">get_context</code> response
            and in the browser extension HUD.
          </p>
          <CodeBlock lang="typescript">{CODE_PIN}</CodeBlock>
          <p className="text-[#E8E4DD]/35 text-[13px] leading-relaxed">
            Use sparingly. Pinned memories always consume context budget. The recommended limit is
            5–10 pinned memories per org to avoid overwhelming the context window with boilerplate.
          </p>
        </section>

        {/* Inviting members */}
        <section className="mb-16 border-t border-[#E8E4DD]/[0.06] pt-12">
          <h2 className="font-serif text-3xl text-[#E8E4DD] mb-4">4. Inviting team members</h2>
          <p className="text-[#E8E4DD]/50 text-[14px] leading-relaxed mb-6">
            Owners and admins can invite via the dashboard or the REST API.
            An invite email is sent via Resend. The invited person accepts at{' '}
            <code className="font-mono text-[#E89A3C]/70 text-[12px]">/team/join?token=…</code>.
          </p>
          <CodeBlock lang="http">{CODE_INVITE}</CodeBlock>
          <p className="text-[#E8E4DD]/35 text-[13px]">
            The Team plan supports up to 5 seats. Adding a 6th member returns{' '}
            <code className="font-mono text-[#E89A3C]/60 text-[11px]">402 seat_limit_reached</code>.
          </p>
        </section>

        {/* Audit log */}
        <section className="mb-16 border-t border-[#E8E4DD]/[0.06] pt-12">
          <h2 className="font-serif text-3xl text-[#E8E4DD] mb-4">5. Org audit log</h2>
          <p className="text-[#E8E4DD]/50 text-[14px] leading-relaxed mb-6">
            All administrative actions are written to <code className="font-mono text-[#E89A3C]/70 text-[12px]">org_audit_log</code>.
            Any org member can read it. Actions include: <code className="font-mono text-[#E89A3C]/60 text-[11px]">member.invite</code>,{' '}
            <code className="font-mono text-[#E89A3C]/60 text-[11px]">member.join</code>,{' '}
            <code className="font-mono text-[#E89A3C]/60 text-[11px]">member.remove</code>,{' '}
            <code className="font-mono text-[#E89A3C]/60 text-[11px]">policy.change</code>,{' '}
            <code className="font-mono text-[#E89A3C]/60 text-[11px]">plan.upgrade</code>.
          </p>
          <CodeBlock lang="json">{CODE_AUDIT}</CodeBlock>
        </section>

        {/* Footer nav */}
        <div className="pt-10 border-t border-[#E8E4DD]/[0.05] flex items-center justify-between">
          <Link href="/docs/mcp" className="font-mono text-[10px] uppercase tracking-widest text-[#E8E4DD]/20 hover:text-[#E8E4DD]/45 transition-colors">
            ← MCP Docs
          </Link>
          <Link href="/pricing" className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C]/45 hover:text-[#E89A3C] transition-colors">
            Team pricing →
          </Link>
        </div>
      </main>
    </div>
  );
}
