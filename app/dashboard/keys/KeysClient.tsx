'use client';

import { useState } from 'react';

export type KeyRow = {
  id: string;
  name: string | null;
  created_at: string;
  last_used_at: string | null;
};

type Props = { initialKeys: KeyRow[] };

export function KeysClient({ initialKeys }: Props) {
  const [keys, setKeys] = useState<KeyRow[]>(initialKeys);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [freshKey, setFreshKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [cmdCopied, setCmdCopied] = useState(false);

  async function handleMint(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() || 'Untitled key' }),
      });
      const body = (await res.json()) as { key?: string; row?: KeyRow; error?: string };
      if (!res.ok || !body.key || !body.row) {
        throw new Error(body.error || 'Failed to mint key.');
      }
      setFreshKey(body.key);
      setKeys((prev) => [body.row as KeyRow, ...prev]);
      setName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke(id: string) {
    const ok = window.confirm('Revoke this key? Anything using it will immediately lose access.');
    if (!ok) return;
    const res = await fetch(`/api/keys/${id}`, { method: 'DELETE' });
    if (res.ok) {
      setKeys((prev) => prev.filter((k) => k.id !== id));
    } else {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setError(body.error || 'Failed to revoke key.');
    }
  }

  async function handleCopy() {
    if (!freshKey) return;
    try {
      await navigator.clipboard.writeText(freshKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore — user can copy manually
    }
  }

  async function handleCopyCmd() {
    if (!freshKey) return;
    try {
      await navigator.clipboard.writeText(`npx -y @spine/mcp init --key ${freshKey}`);
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
        <div className="flex flex-col md:flex-row gap-4 md:items-end">
          <div className="flex-1">
            <label htmlFor="name" className="sr-only">
              Key name
            </label>
            <input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="laptop · 2026"
              className="w-full bg-transparent border-b border-cream/20 focus:border-cream/60 focus:outline-none py-2 text-lg placeholder:text-cream/25"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="bg-amber text-night font-mono text-[12px] uppercase tracking-widest px-6 py-3 disabled:opacity-50"
          >
            {busy ? 'Minting…' : 'Mint key'}
          </button>
        </div>
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
              Shown once &middot; store it now
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
                npx -y @spine/mcp init --key {freshKey}
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
            <code className="font-mono text-amber">npx @spine/mcp init --key &lt;key&gt;</code>.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-cream/10 border-t border-b border-cream/10">
          {keys.map((k) => (
            <li key={k.id} className="py-6 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <p className="font-serif text-xl text-cream">{k.name || 'Untitled key'}</p>
                <p className="font-mono text-[11px] uppercase tracking-widest text-cream/40 mt-1">
                  created {formatDate(k.created_at)}
                  {k.last_used_at ? ` · last used ${formatDate(k.last_used_at)}` : ' · never used'}
                </p>
              </div>
              <button
                onClick={() => handleRevoke(k.id)}
                className="self-start md:self-auto font-mono text-[11px] uppercase tracking-widest text-cream/40 hover:text-amber"
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
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
