'use client';

import { useMemo, useState } from 'react';

type WaitlistRow = {
  id: string;
  email: string;
  source: string | null;
  created_at: string;
};

type InviteRow = {
  code: string;
  email: string;
  issued_at: string;
  redeemed_at: string | null;
  plan_grant: string;
};

type Props = {
  waitlist: WaitlistRow[];
  invites: InviteRow[];
};

export function AdminWaitlistClient({ waitlist, invites }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [invitesLocal, setInvitesLocal] = useState<InviteRow[]>(invites);
  const [plan, setPlan] = useState<'free' | 'pro' | 'power'>('pro');
  const [search, setSearch] = useState('');

  const invitedEmails = useMemo(
    () => new Set(invitesLocal.map((i) => i.email.toLowerCase())),
    [invitesLocal]
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return waitlist;
    return waitlist.filter((w) => w.email.toLowerCase().includes(needle));
  }, [waitlist, search]);

  async function issueInvite(row: WaitlistRow) {
    if (busy) return;
    setBusy(row.id);
    setMsg(null);
    try {
      const res = await fetch('/api/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: row.email, waitlist_id: row.id, plan }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        code?: string;
        invite_url?: string;
        email_sent?: boolean;
        email_error?: string;
        error?: string;
      };
      if (!res.ok || !data.ok) {
        setMsg(`Failed: ${data.error ?? 'unknown'}`);
        return;
      }
      setInvitesLocal((prev) => [
        {
          code: data.code!,
          email: row.email,
          issued_at: new Date().toISOString(),
          redeemed_at: null,
          plan_grant: plan,
        },
        ...prev,
      ]);
      setMsg(
        data.email_sent
          ? `Invite sent to ${row.email} · ${data.code}`
          : `Code generated (${data.code}) — email failed: ${data.email_error}. Copy link: ${data.invite_url}`
      );
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-10 md:grid-cols-[1fr,1fr]">
      {/* Waitlist list */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-cream/50">
            § Signups
          </p>
          <div className="flex gap-2">
            {(['free', 'pro', 'power'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPlan(p)}
                className={`px-3 py-1 font-mono text-[10px] uppercase tracking-widest border transition-colors ${
                  plan === p
                    ? 'border-amber text-amber'
                    : 'border-cream/15 text-cream/40 hover:border-cream/40'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="filter by email"
          className="w-full mb-4 bg-transparent border border-cream/15 focus:border-amber focus:outline-none px-3 py-2 text-sm placeholder:text-cream/25"
        />

        {msg && (
          <p className="mb-4 font-mono text-[11px] text-amber/90 break-all bg-amber/[0.04] border border-amber/20 p-3">
            {msg}
          </p>
        )}

        <ul className="divide-y divide-cream/[0.06]">
          {filtered.length === 0 && (
            <li className="py-6 font-mono text-[11px] text-cream/40">No signups yet.</li>
          )}
          {filtered.map((row) => {
            const already = invitedEmails.has(row.email.toLowerCase());
            return (
              <li key={row.id} className="py-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-cream/90 truncate">{row.email}</p>
                  <p className="font-mono text-[10px] uppercase tracking-widest text-cream/35 mt-1">
                    {new Date(row.created_at).toLocaleString('en-AU', { hour12: false })}
                    {row.source ? ` · ${row.source}` : ''}
                  </p>
                </div>
                <button
                  onClick={() => issueInvite(row)}
                  disabled={busy !== null || already}
                  className={`shrink-0 font-mono text-[10px] uppercase tracking-widest px-3 py-2 transition-colors ${
                    already
                      ? 'bg-cream/[0.05] text-cream/30 cursor-default'
                      : 'bg-amber text-night hover:bg-cream disabled:opacity-50'
                  }`}
                >
                  {already ? 'Invited' : busy === row.id ? 'Sending…' : `Invite → ${plan}`}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Invites log */}
      <section>
        <p className="font-mono text-[10px] uppercase tracking-widest text-cream/50 mb-4">
          § Invites issued
        </p>
        <ul className="divide-y divide-cream/[0.06]">
          {invitesLocal.length === 0 && (
            <li className="py-6 font-mono text-[11px] text-cream/40">None yet.</li>
          )}
          {invitesLocal.map((i) => (
            <li key={i.code} className="py-4">
              <div className="flex items-center justify-between gap-4">
                <p className="text-cream/80 truncate text-sm">{i.email}</p>
                <span
                  className={`font-mono text-[10px] uppercase tracking-widest ${
                    i.redeemed_at ? 'text-cream/35' : 'text-amber'
                  }`}
                >
                  {i.redeemed_at ? 'redeemed' : i.plan_grant}
                </span>
              </div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-cream/35 mt-1 break-all">
                {i.code} · {new Date(i.issued_at).toLocaleString('en-AU', { hour12: false })}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
