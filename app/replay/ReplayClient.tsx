'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ReplayHit {
  id: string;
  content: string;
  source: string | null;
  tags: string[] | null;
  type: string | null;
  project: string | null;
  created_at: string;
  similarity?: number;
  match_type: 'semantic' | 'keyword' | 'both';
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const TYPE_STYLES: Record<string, { label: string; color: string; bg: string }> = {
  decision: { label: 'decision',  color: '#E89A3C', bg: 'rgba(232,154,60,0.12)' },
  bug:      { label: 'bug fix',   color: '#F87171', bg: 'rgba(248,113,113,0.12)' },
  feature:  { label: 'feature',   color: '#34D399', bg: 'rgba(52,211,153,0.12)' },
  context:  { label: 'context',   color: '#60A5FA', bg: 'rgba(96,165,250,0.10)' },
  fact:     { label: 'fact',      color: '#A78BFA', bg: 'rgba(167,139,250,0.10)' },
};

function typeStyle(type: string | null) {
  return TYPE_STYLES[type ?? 'context'] ?? TYPE_STYLES.context;
}

function sourceLabel(source: string | null): string {
  if (!source) return '';
  if (source.startsWith('claude')) return 'Claude';
  if (source.startsWith('chatgpt')) return 'ChatGPT';
  if (source.startsWith('gemini')) return 'Gemini';
  return source.split('/')[0] ?? source;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function monthKey(iso: string): string {
  return iso.slice(0, 7); // "2026-04"
}

function formatMonth(key: string): string {
  const [y, m] = key.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
}

function groupByMonth(hits: ReplayHit[]): { key: string; label: string; hits: ReplayHit[] }[] {
  const map = new Map<string, ReplayHit[]>();
  for (const h of hits) {
    const k = monthKey(h.created_at);
    const g = map.get(k) ?? [];
    g.push(h);
    map.set(k, g);
  }
  return [...map.entries()].map(([key, hits]) => ({ key, label: formatMonth(key), hits }));
}

function spanSummary(hits: ReplayHit[]): string {
  if (hits.length === 0) return '';
  const oldest = new Date(hits[0].created_at);
  const newest = new Date(hits[hits.length - 1].created_at);
  const diffMs = newest.getTime() - oldest.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return 'today';
  if (diffDays < 7) return `${diffDays} days`;
  if (diffDays < 31) return `${Math.floor(diffDays / 7)} weeks`;
  const months = Math.round(diffDays / 30);
  return `${months} month${months !== 1 ? 's' : ''}`;
}

// ── Card component ─────────────────────────────────────────────────────────────

function ReplayCard({ hit, index }: { hit: ReplayHit; index: number }) {
  const ts = typeStyle(hit.type);
  const [expanded, setExpanded] = useState(false);
  const preview = hit.content.length > 280 ? hit.content.slice(0, 280) + '…' : hit.content;

  return (
    <div
      style={{
        position: 'relative',
        paddingLeft: 28,
        marginBottom: 2,
        animation: 'riseIn 0.5s ease forwards',
        opacity: 0,
        animationDelay: `${Math.min(index * 80, 800)}ms`,
      }}
    >
      {/* Timeline dot */}
      <span
        style={{
          position: 'absolute',
          left: -4,
          top: 20,
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: ts.color,
          boxShadow: `0 0 8px ${ts.color}60`,
          display: 'block',
        }}
      />

      <div
        onClick={() => hit.content.length > 280 && setExpanded(!expanded)}
        style={{
          padding: '16px 20px',
          borderRadius: 8,
          background: 'rgba(232,228,221,0.025)',
          border: '1px solid rgba(232,228,221,0.06)',
          borderLeft: `2px solid ${ts.color}`,
          cursor: hit.content.length > 280 ? 'pointer' : 'default',
          transition: 'background 0.2s',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(232,228,221,0.045)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(232,228,221,0.025)'; }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(232,228,221,0.35)' }}>
            {formatDate(hit.created_at)} · {formatTime(hit.created_at)}
          </span>
          <span
            style={{
              fontFamily: 'monospace', fontSize: 9, padding: '2px 7px', borderRadius: 12,
              color: ts.color, background: ts.bg,
            }}
          >
            {ts.label}
          </span>
          {hit.source && (
            <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'rgba(232,228,221,0.2)' }}>
              {sourceLabel(hit.source)}
            </span>
          )}
          {hit.project && (
            <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'rgba(96,165,250,0.5)' }}>
              {hit.project}
            </span>
          )}
          {hit.match_type === 'both' && (
            <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'rgba(52,211,153,0.5)' }}>
              exact match
            </span>
          )}
        </div>

        {/* Content */}
        <p style={{ fontFamily: 'Georgia, serif', fontSize: 14, lineHeight: 1.75, color: 'rgba(232,228,221,0.78)', margin: 0 }}>
          {expanded ? hit.content : preview}
        </p>

        {/* Tags */}
        {hit.tags && hit.tags.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {hit.tags.filter((t) => !t.startsWith('__')).slice(0, 4).map((t) => (
              <span key={t} style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(232,228,221,0.2)' }}>
                #{t}
              </span>
            ))}
          </div>
        )}

        {/* Expand hint */}
        {hit.content.length > 280 && (
          <p style={{ marginTop: 6, fontFamily: 'monospace', fontSize: 10, color: 'rgba(232,154,60,0.4)' }}>
            {expanded ? '↑ collapse' : `↓ read more (${hit.content.length} chars)`}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────

function EmptyState({ path }: { path: string }) {
  const filename = path.split('/').pop() ?? path;
  return (
    <div style={{ padding: '64px 0', textAlign: 'center' }}>
      <p style={{ fontFamily: 'Georgia, serif', fontSize: 26, color: 'rgba(232,228,221,0.15)', marginBottom: 16 }}>
        No memories found for <em>{filename}</em>
      </p>
      <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(232,228,221,0.2)', textTransform: 'uppercase', letterSpacing: '0.1em', lineHeight: 1.8 }}>
        Memories are captured when you discuss or modify this file in Claude Code.<br />
        Enable the Stop hook to start building the trail automatically.
      </p>
      <div style={{
        marginTop: 32, display: 'inline-block', padding: '14px 20px',
        background: 'rgba(232,228,221,0.03)', border: '1px solid rgba(232,228,221,0.08)',
        borderRadius: 8, textAlign: 'left', maxWidth: 480,
      }}>
        <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(232,154,60,0.55)', marginBottom: 8 }}>
          .claude/settings.json
        </p>
        <pre style={{ fontFamily: 'monospace', fontSize: 12, color: 'rgba(232,228,221,0.55)', margin: 0, lineHeight: 1.6 }}>{`{
  "hooks": {
    "Stop": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "npx spine-mcp hook-stop"
      }]
    }]
  }
}`}</pre>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function ReplayClient({ email: _email, initialPath }: { email: string; initialPath: string }) {
  const [path, setPath] = useState(initialPath);
  const [submitted, setSubmitted] = useState(initialPath !== '');
  const [hits, setHits] = useState<ReplayHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const runReplay = useCallback(async (p: string) => {
    if (!p.trim()) return;
    setLoading(true);
    setError(null);
    setHits(null);
    try {
      const res = await fetch('/api/replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: p.trim(), limit: 60 }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? 'Replay failed.');
      }
      const data = await res.json() as { memories: ReplayHit[]; count: number };
      setHits(data.memories);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Replay failed.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-run if initialPath provided (from URL param)
  useEffect(() => {
    if (initialPath) void runReplay(initialPath);
    else inputRef.current?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!path.trim()) return;
    setSubmitted(true);
    void runReplay(path);
  }

  const groups = hits ? groupByMonth(hits) : [];
  const span = hits && hits.length > 0 ? spanSummary(hits) : null;

  return (
    <>
      <style>{`
        @keyframes riseIn {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        ::placeholder { color: rgba(232,228,221,0.2) !important; }
      `}</style>

      {/* Atmosphere */}
      <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
        <div style={{ position: 'absolute', top: -120, left: '20%', width: 600, height: 600, borderRadius: '50%', background: 'rgba(232,154,60,0.04)', filter: 'blur(200px)' }} />
        <div style={{ position: 'absolute', bottom: 0, right: 0, width: 400, height: 400, borderRadius: '50%', background: 'rgba(0,0,0,0.5)', filter: 'blur(180px)' }} />
      </div>

      {/* Nav */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50, padding: '16px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'rgba(13,12,10,0.9)', backdropFilter: 'blur(24px)',
        borderBottom: '1px solid rgba(232,228,221,0.05)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/timeline" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: '#E8E4DD' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#E89A3C', display: 'inline-block' }} />
            <span style={{ fontFamily: 'Georgia, serif', fontSize: 18 }}>Spine</span>
          </Link>
          <span style={{ color: 'rgba(232,228,221,0.2)', fontSize: 14 }}>/</span>
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(232,228,221,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>replay</span>
        </div>
        <nav style={{ display: 'flex', gap: 16, fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          <Link href="/timeline" style={{ color: 'rgba(232,228,221,0.35)', textDecoration: 'none' }}>Timeline</Link>
          <Link href="/search"   style={{ color: 'rgba(232,228,221,0.35)', textDecoration: 'none' }}>Search</Link>
        </nav>
      </header>

      <main style={{ maxWidth: 760, margin: '0 auto', padding: '48px 24px 96px', position: 'relative', zIndex: 1 }}>

        {/* Hero */}
        {!submitted && (
          <div style={{ marginBottom: 40, animation: 'fadeIn 0.6s ease forwards' }}>
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(232,154,60,0.55)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 16 }}>
              Spine Replay
            </p>
            <h1 style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(2rem,6vw,3.5rem)', fontStyle: 'italic', color: 'rgba(232,228,221,0.9)', lineHeight: 1.1, margin: '0 0 16px', fontWeight: 'normal' }}>
              Why is this code the way it is?
            </h1>
            <p style={{ fontSize: 14, color: 'rgba(232,228,221,0.4)', fontFamily: 'Georgia, serif', lineHeight: 1.7, maxWidth: 520 }}>
              Give Spine a file path. It reconstructs the full decision trail — when it was built, every bug that shaped it, why each choice was made. Six months of context, in seconds.
            </p>
          </div>
        )}

        {/* Input */}
        <form onSubmit={handleSubmit} style={{ marginBottom: submitted && hits ? 40 : 0 }}>
          <div style={{ display: 'flex', gap: 10 }}>
            <div style={{ flex: 1, position: 'relative' }}>
              <span style={{
                position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                fontFamily: 'monospace', fontSize: 14, color: 'rgba(232,154,60,0.4)',
                pointerEvents: 'none',
              }}>
                {loading ? '⌛' : '◎'}
              </span>
              <input
                ref={inputRef}
                value={path}
                onChange={(e) => setPath(e.target.value)}
                placeholder="src/auth/middleware.ts"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: 'rgba(232,228,221,0.03)',
                  border: '1px solid rgba(232,228,221,0.1)',
                  borderRadius: 8, padding: '14px 16px 14px 40px',
                  color: '#E8E4DD', fontSize: 14,
                  fontFamily: 'JetBrains Mono, Fira Code, monospace',
                  outline: 'none', transition: 'border-color 0.2s',
                }}
                onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = 'rgba(232,154,60,0.4)'; }}
                onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = 'rgba(232,228,221,0.1)'; }}
              />
            </div>
            <button
              type="submit"
              disabled={loading || !path.trim()}
              style={{
                padding: '14px 24px', borderRadius: 8,
                background: loading || !path.trim() ? 'rgba(232,154,60,0.15)' : '#E89A3C',
                color: loading || !path.trim() ? 'rgba(232,154,60,0.5)' : '#0D0C0A',
                border: 'none', cursor: loading || !path.trim() ? 'not-allowed' : 'pointer',
                fontFamily: 'monospace', fontSize: 12, fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '0.08em',
                transition: 'all 0.2s', whiteSpace: 'nowrap',
              }}
            >
              {loading ? 'Replaying…' : 'Replay →'}
            </button>
          </div>
        </form>

        {/* Error */}
        {error && (
          <div style={{ padding: '12px 16px', background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.15)', borderRadius: 8, marginTop: 16 }}>
            <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'rgba(248,113,113,0.8)', margin: 0 }}>{error}</p>
          </div>
        )}

        {/* Results */}
        {hits !== null && (
          <div style={{ animation: 'fadeIn 0.4s ease forwards' }}>

            {/* Stats */}
            {hits.length > 0 && (
              <div style={{ marginBottom: 40 }}>
                <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(232,228,221,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
                  {hits.length} {hits.length === 1 ? 'memory' : 'memories'}
                  {span ? ` · ${span} of context` : ''}
                </p>
                {/* Type breakdown */}
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }}>
                  {Object.entries(
                    hits.reduce((acc, h) => {
                      const t = h.type ?? 'context';
                      acc[t] = (acc[t] ?? 0) + 1;
                      return acc;
                    }, {} as Record<string, number>)
                  ).sort((a, b) => b[1] - a[1]).map(([type, count]) => {
                    const ts = typeStyle(type);
                    return (
                      <span key={type} style={{ fontFamily: 'monospace', fontSize: 10, color: ts.color, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: ts.color, display: 'inline-block' }} />
                        {count} {ts.label}
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {hits.length === 0 ? (
              <EmptyState path={path} />
            ) : (
              <div>
                {groups.map((group) => (
                  <div key={group.key} style={{ marginBottom: 48 }}>
                    {/* Month divider */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
                      <div style={{ flex: 1, height: 1, background: 'linear-gradient(to right, rgba(232,154,60,0.25), transparent)' }} />
                      <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(232,154,60,0.5)', textTransform: 'uppercase', letterSpacing: '0.12em', whiteSpace: 'nowrap' }}>
                        {group.label}
                      </span>
                      <div style={{ flex: 1, height: 1, background: 'linear-gradient(to left, rgba(232,154,60,0.25), transparent)' }} />
                    </div>

                    {/* Thread line + cards */}
                    <div style={{ position: 'relative', borderLeft: '1px solid rgba(232,154,60,0.15)', paddingLeft: 4 }}>
                      {group.hits.map((hit, i) => {
                        const globalIndex = groups.slice(0, groups.indexOf(group)).reduce((s, g) => s + g.hits.length, 0) + i;
                        return <ReplayCard key={hit.id} hit={hit} index={globalIndex} />;
                      })}
                    </div>
                  </div>
                ))}

                {/* Footer */}
                <div style={{ borderTop: '1px solid rgba(232,228,221,0.06)', paddingTop: 24, marginTop: 24 }}>
                  <p style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 13, color: 'rgba(232,228,221,0.2)', lineHeight: 1.7 }}>
                    {hits.length} {hits.length === 1 ? 'memory' : 'memories'} retrieved.
                    Every session adds to the trail. This file will never be a mystery again.
                  </p>
                  <div style={{ marginTop: 16, display: 'flex', gap: 16 }}>
                    <Link href={`/search?q=${encodeURIComponent(path)}`} style={{ fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(232,154,60,0.5)', textDecoration: 'none' }}>
                      Deep search →
                    </Link>
                    <Link href="/timeline" style={{ fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(232,228,221,0.25)', textDecoration: 'none' }}>
                      Full timeline →
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </>
  );
}
