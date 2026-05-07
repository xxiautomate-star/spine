'use client';

import { useState } from 'react';

export type KeyScope = 'full' | 'read' | 'write' | 'read_write';

export type KeyRow = {
  id: string;
  name: string | null;
  scope: KeyScope | null;
  expires_at: string | null;
  use_count: number | null;
  created_at: string;
  last_used_at: string | null;
};

type Receipt = {
  id: string;
  route: string;
  scope_required: string | null;
  status_code: number | null;
  ts: string;
};

type Props = { initialKeys: KeyRow[] };

const SCOPE_OPTIONS: Array<{ value: KeyScope; label: string; hint: string }> = [
  { value: 'full', label: 'Full access', hint: 'Read + write + future admin ops' },
  { value: 'read_write', label: 'Read + write', hint: 'Recall and capture, no admin' },
  { value: 'read', label: 'Read only', hint: 'Recall, search, ask. Cannot capture.' },
  { value: 'write', label: 'Write only', hint: 'Capture only. Cannot recall.' },
];

const EXPIRY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'never', label: 'No expiry' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '1y', label: '1 year' },
];

export function KeysClient({ initialKeys }: Props) {
  const [keys, setKeys] = useState<KeyRow[]>(initialKeys);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<KeyScope>('full');
  const [expiry, setExpiry] = useState<string>('never');
  const [busy, setBusy] = useState(false);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [cmdCopied, setCmdCopied] = useState(false);
  const [receiptsOpen, setReceiptsOpen] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<Record<string, Receipt[] | 'loading'>>({});

  async function handleMint(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim() || 'Untitled key',
          scope,
          expiry,
        }),
      });
      const body = (await res.json()) as { key?: string; row?: KeyRow; error?: string };
      if (!res.ok || !body.key || !body.row) {
        throw new Error(body.error || 'Failed to mint key.');
      }
      setFreshKey(body.key);
      setKeys((prev) => [body.row as KeyRow, ...prev]);
      setName('');
      setScope('full');
      setExpiry('never');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(id: string) {
    const ok = window.confirm(
      'Revoke this key? Anything using it will immediately lose access.'
    );
    if (!ok) return;
    const res = await fetch(`/api/keys/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setKeys((prev) => prev.filter((k) => k.id !== id));
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error || 'Failed to revoke key.');
    }
  }

  async function handleToggleReceipts(id: string) {
    if (receiptsOpen === id) {
      setReceiptsOpen(null);
      return;
    }
    setReceiptsOpen(id);
    if (receipts[id]) return; // cached
    setReceipts((prev) => ({ ...prev, [id]: 'loading' }));
    try {
      const res = await fetch(`/api/keys/${id}/receipts?limit=20`);
      const body = (await res.json()) as { receipts?: Receipt[] };
      setReceipts((prev) => ({ ...prev, [id]: body.receipts ?? [] }));
    } catch {
      setReceipts((prev) => ({ ...prev, [id]: [] }));
    }
  }

  async function handleCopy() {
    if (!freshKey) return;
    try {
      await navigator.clipboard.writeText(freshKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  async function handleCopyCmd() {
    if (!freshKey) return;
    try {
      await navigator.clipboard.writeText(`npx -y spine-mcp init --key ${freshKey}`);
      setCmdCopied(true);
      setTimeout(() => setCmdCopied(false), 2000);
    } catch {
      /* manual copy */
    }
  }

  return (
    <>
      <form onSubmit={handleMint} className="mb-16 border border-cream/10 p-6 md:p-8">
        <p className="font-mono text-[11px] uppercase tracking-widest text-cream/40 mb-5">
          New key
        </p>

        <label htmlFor="name" className="sr-only">
          Key name
        </label>
        <input
          id="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="laptop · 2026"
          className="w-full bg-transparent border-b border-cream/20 focus:border-cream/60 focus:outline-none py-2 text-lg placeholder:text-cream/25 mb-8"
        />

        <div className="grid md:grid-cols-2 gap-6 mb-8">
          <div>
            <label htmlFor="scope" className="block font-mono text-[10px] uppercase tracking-widest text-cream/40 mb-2">
              Scope
            </label>
            <select
              id="scope"
              value={scope}
              onChange={(e) => setScope(e.target.value as KeyScope)}
              className="w-full bg-transparent border border-cream/15 focus:border-cream/60 focus:outline-none px-3 py-2 text-cream font-mono text-[13px]"
            >
              {SCOPE_OPTIONS.map((s) => (
                <option key={s.value} value={s.value} className="bg-night">
                  {s.label}
                </option>
              ))}
            </select>
            <p className="mt-1.5 font-mono text-[10px] text-cream/35">
              {SCOPE_OPTIONS.find((s) => s.value === scope)?.hint}
            </p>
          </div>
          <div>
            <label htmlFor="expiry" className="block font-mono text-[10px] uppercase tracking-widest text-cream/40 mb-2">
              Expires after
            </label>
            <select
              id="expiry"
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              className="w-full bg-transparent border border-cream/15 focus:border-cream/60 focus:outline-none px-3 py-2 text-cream font-mono text-[13px]"
            >
              {EXPIRY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} className="bg-night">
                  {o.label}
                </option>
              ))}
            </select>
            <p className="mt-1.5 font-mono text-[10px] text-cream/35">
              Rotate keys on a schedule to limit blast radius.
            </p>
          </div>
        </div>

        <button
          type="submit"
          disabled={busy}
          className="bg-amber text-night font-mono text-[12px] uppercase tracking-widest px-6 py-3 disabled:opacity-50"
        >
          {busy ? 'Minting…' : 'Mint key'}
        </button>
        {error && <p className="mt-4 font-mono text-[11px] text-amber">{error}</p>}
      </form>

      {freshKey && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-night/90 backdrop-blur-sm flex items-center justify-center px-6"
        >
          <div className="max-w-lg w-full border border-amber/40 bg-night p-8">
            <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-6">
              Shown once · store it now
            </p>
            <h2 className="font-serif text-3xl text-cream mb-4">Your new key.</h2>
            <p className="text-cream/60 leading-relaxed mb-6">
              This is the only time we can show you the full key. Copy it into your MCP config — we
              only store a hash.
            </p>
            <pre className="font-mono text-sm text-amber bg-cream/[0.04] border border-cream/10 px-4 py-4 break-all whitespace-pre-wrap mb-2">
              {freshKey}
            </pre>
            <button
              onClick={handleCopy}
              className="font-mono text-[10px] uppercase tracking-widest text-cream/50 hover:text-amber mb-6"
            >
              {copied ? 'Copied' : 'Copy key'}
            </button>

            <div className="border-t border-cream/10 pt-6 mb-6">
              <p className="font-mono text-[11px] uppercase tracking-widest text-cream/40 mb-3">
                Install in 30 seconds
              </p>
              <p className="text-cream/60 text-sm leading-relaxed mb-4">
                Paste this into your terminal. Spine will register itself with Claude Code and the
                hooks will start firing on your next session.
              </p>
              <pre className="font-mono text-sm text-cream bg-cream/[0.04] border border-cream/10 px-4 py-4 break-all whitespace-pre-wrap mb-2">
                npx -y spine-mcp init --key {freshKey}
              </pre>
              <button
                onClick={handleCopyCmd}
                className="font-mono text-[10px] uppercase tracking-widest text-amber hover:text-cream"
              >
                {cmdCopied ? 'Copied — paste in your terminal' : 'Copy install command'}
              </button>
            </div>

            <div className="flex items-center justify-end">
              <button
                onClick={() => {
                  setFreshKey(null);
                  setCopied(false);
                  setCmdCopied(false);
                }}
                className="font-mono text-[12px] uppercase tracking-widest text-cream/50 hover:text-cream"
              >
                Done — I have saved it
              </button>
            </div>
          </div>
        </div>
      )}

      {keys.length === 0 ? (
        <div className="py-20 border border-cream/10 text-center">
          <p className="font-serif text-3xl md:text-4xl text-cream mb-3">No keys yet.</p>
          <p className="text-cream/50 max-w-md mx-auto">
            Mint your first key above, then install Spine into Claude Code with{' '}
            <code className="font-mono text-amber">npx spine-mcp init --key &lt;key&gt;</code>.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-cream/10 border-t border-b border-cream/10">
          {keys.map((k) => (
            <KeyListItem
              key={k.id}
              row={k}
              onRevoke={handleRevoke}
              onToggleReceipts={handleToggleReceipts}
              receiptsOpen={receiptsOpen === k.id}
              receipts={receipts[k.id]}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function KeyListItem({
  row,
  onRevoke,
  onToggleReceipts,
  receiptsOpen,
  receipts,
}: {
  row: KeyRow;
  onRevoke: (id: string) => void;
  onToggleReceipts: (id: string) => void;
  receiptsOpen: boolean;
  receipts: Receipt[] | 'loading' | undefined;
}) {
  const expired =
    row.expires_at !== null && new Date(row.expires_at).getTime() <= Date.now();
  const expiresInDays = row.expires_at
    ? Math.ceil((new Date(row.expires_at).getTime() - Date.now()) / 86_400_000)
    : null;

  return (
    <li className="py-6">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-3 mb-1.5">
            <p className="font-serif text-xl text-cream">{row.name || 'Untitled key'}</p>
            {row.scope && (
              <span className="font-mono text-[10px] uppercase tracking-widest text-cream/55 border border-cream/15 px-1.5 py-0.5 rounded">
                {row.scope.replace('_', ' + ')}
              </span>
            )}
            {expired && (
              <span className="font-mono text-[10px] uppercase tracking-widest text-rose-400/85 border border-rose-400/40 px-1.5 py-0.5 rounded">
                expired
              </span>
            )}
          </div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-cream/40">
            created {formatDate(row.created_at)}
            {row.last_used_at ? ` · last used ${formatDate(row.last_used_at)}` : ' · never used'}
            {row.use_count !== null && row.use_count > 0 ? ` · ${row.use_count.toLocaleString()} uses` : ''}
            {expiresInDays !== null && !expired
              ? ` · expires in ${expiresInDays}d`
              : ''}
          </p>
        </div>
        <div className="flex items-center gap-4 self-start md:self-auto">
          <button
            onClick={() => onToggleReceipts(row.id)}
            className="font-mono text-[11px] uppercase tracking-widest text-cream/40 hover:text-cream"
          >
            {receiptsOpen ? 'Hide receipts' : 'Receipts'}
          </button>
          <button
            onClick={() => onRevoke(row.id)}
            className="font-mono text-[11px] uppercase tracking-widest text-cream/40 hover:text-amber"
          >
            Revoke
          </button>
        </div>
      </div>

      {receiptsOpen && (
        <div className="mt-5 border-l-2 border-cream/[0.08] pl-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-cream/40 mb-3">
            Recent uses
          </p>
          {receipts === 'loading' ? (
            <p className="font-mono text-[11px] text-cream/40">loading…</p>
          ) : !receipts || receipts.length === 0 ? (
            <p className="font-mono text-[11px] text-cream/40">No receipts yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {receipts.map((r) => (
                <li
                  key={r.id}
                  className="flex flex-wrap items-baseline gap-2 font-mono text-[11px] text-cream/55"
                >
                  <span className="text-cream/35">{formatDate(r.ts)}</span>
                  <span className="text-cream/85">{r.route}</span>
                  {r.scope_required && (
                    <span className="text-cream/45">scope={r.scope_required}</span>
                  )}
                  {r.status_code !== null && (
                    <span
                      className={
                        r.status_code !== null && r.status_code >= 400
                          ? 'text-rose-400/80'
                          : 'text-emerald-300/65'
                      }
                    >
                      {r.status_code}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
