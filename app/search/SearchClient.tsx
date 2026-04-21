'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────────

interface MemoryHit {
  id: string;
  content: string;
  source: string | null;
  tags: string[] | null;
  created_at: string;
  similarity: number;
}

interface SearchResponse {
  memories: MemoryHit[];
  query: string;
  total: number;
  plan: string;
}

interface FiltersData {
  sources: string[];
  tags: string[];
}

// ── Source helpers ─────────────────────────────────────────────────────────────

const SOURCE_COLOURS: Record<string, string> = {
  'claude.ai': '#E89A3C',
  'claude-code': '#E89A3C',
  'chatgpt.com': '#10B981',
  'gemini.google.com': '#38BDF8',
  'cursor': '#8B5CF6',
  'vscode': '#4A90E2',
  'windsurf': '#4A90E2',
  'manual': '#9CA3AF',
};

function sourceColor(source: string | null): string {
  if (!source) return 'rgba(232,228,221,0.2)';
  for (const [key, color] of Object.entries(SOURCE_COLOURS)) {
    if (source.toLowerCase().includes(key)) return color;
  }
  return 'rgba(232,228,221,0.35)';
}

function sourceLabel(source: string | null): string {
  if (!source) return 'unknown';
  if (source.startsWith('claude')) return 'Claude';
  if (source.startsWith('chatgpt')) return 'ChatGPT';
  if (source.startsWith('gemini')) return 'Gemini';
  if (source === 'manual') return 'Manual';
  // Workspace/file path: show just the workspace name
  const parts = source.split('/');
  return parts[0] || source;
}

function timeSince(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86400000);
  if (days === 0) {
    const hours = Math.floor(ms / 3600000);
    if (hours === 0) return 'just now';
    return `${hours}h ago`;
  }
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return new Date(iso).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

function SimBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color = pct > 80 ? '#E89A3C' : pct > 60 ? 'rgba(232,154,60,0.55)' : 'rgba(232,228,221,0.2)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 48, height: 3, background: 'rgba(232,228,221,0.08)', borderRadius: 2 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(232,228,221,0.3)' }}>{pct}%</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function SearchClient({ email: _email }: { email: string }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MemoryHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [filters, setFilters] = useState<FiltersData>({ sources: [], tags: [] });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load filter options on mount
  useEffect(() => {
    void fetch('/api/search', { method: 'GET' })
      .then((r) => r.ok ? r.json() : null)
      .then((d: FiltersData | null) => { if (d) setFilters(d); });
    inputRef.current?.focus();
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (!q.trim()) { setResults(null); setError(null); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: q.trim(),
          limit: 20,
          source: sourceFilter || undefined,
          tags: tagFilter ? [tagFilter] : undefined,
        }),
      });
      if (!res.ok) {
        const d = await res.json() as { error?: string };
        throw new Error(d.error ?? 'Search failed.');
      }
      const data = await res.json() as SearchResponse;
      setResults(data.memories);
      setLastQuery(q.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed.');
    } finally {
      setLoading(false);
    }
  }, [sourceFilter, tagFilter]);

  // Debounced search on query change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void doSearch(query), 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query, doSearch]);

  // Re-run when filters change
  useEffect(() => {
    if (query.trim()) void doSearch(query);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFilter, tagFilter]);

  return (
    <div style={{ minHeight: '100vh', background: '#0D0C0A', color: '#E8E4DD' }}>
      {/* Nav */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 50,
        padding: '16px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'rgba(13,12,10,0.9)', backdropFilter: 'blur(24px)',
        borderBottom: '1px solid rgba(232,228,221,0.05)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/timeline" style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: '#E8E4DD' }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#E89A3C', display: 'inline-block' }} />
            <span style={{ fontFamily: 'Georgia, serif', fontSize: 18 }}>Spine</span>
          </Link>
          <span style={{ color: 'rgba(232,228,221,0.2)', fontSize: 14 }}>/</span>
          <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(232,228,221,0.4)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>search</span>
        </div>
        <nav style={{ display: 'flex', gap: 16, fontFamily: 'monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          <Link href="/timeline" style={{ color: 'rgba(232,228,221,0.35)', textDecoration: 'none' }}>Timeline</Link>
          <Link href="/graph" style={{ color: 'rgba(232,228,221,0.35)', textDecoration: 'none' }}>Graph</Link>
        </nav>
      </header>

      <main style={{ maxWidth: 840, margin: '0 auto', padding: '48px 24px' }}>

        {/* Search bar */}
        <div style={{ marginBottom: 32 }}>
          <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(232,154,60,0.55)', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 12 }}>Semantic search</p>
          <div style={{ position: 'relative' }}>
            <div style={{
              position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)',
              color: 'rgba(232,228,221,0.2)', fontSize: 16, pointerEvents: 'none',
            }}>
              {loading ? '⌛' : '◎'}
            </div>
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={'Search memories… e.g. "auth bug fix", "database decision", "deploy process"'}
              style={{
                width: '100%', boxSizing: 'border-box',
                background: 'rgba(232,228,221,0.03)', border: '1px solid rgba(232,228,221,0.1)',
                borderRadius: 8, padding: '14px 16px 14px 44px',
                color: '#E8E4DD', fontSize: 16, fontFamily: 'Georgia, serif',
                outline: 'none', transition: 'border-color 0.2s',
              }}
              onFocus={(e) => { (e.target as HTMLInputElement).style.borderColor = 'rgba(232,154,60,0.4)'; }}
              onBlur={(e) => { (e.target as HTMLInputElement).style.borderColor = 'rgba(232,228,221,0.1)'; }}
            />
          </div>

          {/* Filters */}
          {(filters.sources.length > 0 || filters.tags.length > 0) && (
            <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value)}
                style={{
                  background: 'rgba(232,228,221,0.04)', border: '1px solid rgba(232,228,221,0.08)',
                  borderRadius: 6, padding: '4px 10px', color: 'rgba(232,228,221,0.55)',
                  fontFamily: 'monospace', fontSize: 11, cursor: 'pointer',
                }}
              >
                <option value="">All sources</option>
                {filters.sources.map((s) => (
                  <option key={s} value={s}>{sourceLabel(s)}</option>
                ))}
              </select>
              {filters.tags.length > 0 && (
                <select
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                  style={{
                    background: 'rgba(232,228,221,0.04)', border: '1px solid rgba(232,228,221,0.08)',
                    borderRadius: 6, padding: '4px 10px', color: 'rgba(232,228,221,0.55)',
                    fontFamily: 'monospace', fontSize: 11, cursor: 'pointer',
                  }}
                >
                  <option value="">All tags</option>
                  {filters.tags.slice(0, 50).map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              )}
              {(sourceFilter || tagFilter) && (
                <button
                  onClick={() => { setSourceFilter(''); setTagFilter(''); }}
                  style={{
                    background: 'none', border: '1px solid rgba(232,228,221,0.06)',
                    borderRadius: 6, padding: '4px 10px', color: 'rgba(232,228,221,0.3)',
                    fontFamily: 'monospace', fontSize: 11, cursor: 'pointer',
                  }}
                >
                  Clear filters ×
                </button>
              )}
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div style={{ padding: '12px 16px', background: 'rgba(232,100,60,0.06)', border: '1px solid rgba(232,100,60,0.15)', borderRadius: 8, marginBottom: 24 }}>
            <p style={{ fontFamily: 'monospace', fontSize: 12, color: 'rgba(232,100,60,0.8)' }}>{error}</p>
          </div>
        )}

        {/* Empty state */}
        {!query && !results && (
          <div style={{ textAlign: 'center', padding: '64px 0' }}>
            <p style={{ fontFamily: 'Georgia, serif', fontSize: 28, color: 'rgba(232,228,221,0.15)', marginBottom: 12 }}>
              Your entire archive,<br />one query away.
            </p>
            <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(232,228,221,0.2)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Try: "auth decisions" · "last week's bug" · "database schema"
            </p>
          </div>
        )}

        {/* No results */}
        {results !== null && results.length === 0 && !loading && (
          <div style={{ padding: '48px 0', textAlign: 'center' }}>
            <p style={{ color: 'rgba(232,228,221,0.3)', fontFamily: 'Georgia, serif', fontSize: 18 }}>No memories match "{lastQuery}"</p>
            <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(232,228,221,0.2)', marginTop: 8 }}>
              Try different terms, or{' '}
              <Link href="/timeline" style={{ color: 'rgba(232,154,60,0.6)', textDecoration: 'none' }}>browse the timeline</Link>
            </p>
          </div>
        )}

        {/* Results */}
        {results !== null && results.length > 0 && (
          <div>
            <p style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(232,228,221,0.25)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 16 }}>
              {results.length} results for "{lastQuery}"
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {results.map((hit, i) => {
                const expanded = expandedId === hit.id;
                const col = sourceColor(hit.source);
                const preview = hit.content.length > 200 ? hit.content.slice(0, 200) + '…' : hit.content;
                return (
                  <div
                    key={hit.id}
                    onClick={() => setExpandedId(expanded ? null : hit.id)}
                    style={{
                      padding: '16px 20px', borderRadius: 8,
                      background: expanded ? 'rgba(232,228,221,0.04)' : 'rgba(232,228,221,0.02)',
                      border: `1px solid ${expanded ? 'rgba(232,154,60,0.15)' : 'rgba(232,228,221,0.05)'}`,
                      cursor: 'pointer', transition: 'all 0.15s',
                      borderLeft: `3px solid ${col}`,
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(232,228,221,0.04)'; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = expanded ? 'rgba(232,228,221,0.04)' : 'rgba(232,228,221,0.02)'; }}
                  >
                    {/* Header row */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, gap: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'rgba(232,228,221,0.2)' }}>{String(i + 1).padStart(2, '0')}</span>
                        <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 12, fontSize: 10, fontFamily: 'monospace', background: `${col}18`, color: col, whiteSpace: 'nowrap' }}>
                          {sourceLabel(hit.source)}
                        </span>
                        {hit.tags && hit.tags.slice(0, 3).map((tag) => (
                          <span key={tag} style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(232,228,221,0.25)', background: 'rgba(232,228,221,0.04)', padding: '2px 6px', borderRadius: 4 }}>
                            {tag}
                          </span>
                        ))}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                        <SimBar score={hit.similarity} />
                        <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(232,228,221,0.2)', whiteSpace: 'nowrap' }}>
                          {timeSince(hit.created_at)}
                        </span>
                      </div>
                    </div>

                    {/* Content */}
                    <p style={{ fontSize: 13, color: 'rgba(232,228,221,0.75)', lineHeight: 1.65, margin: 0, fontFamily: 'Georgia, serif' }}>
                      {expanded ? hit.content : preview}
                    </p>

                    {/* Expand hint */}
                    {hit.content.length > 200 && (
                      <p style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 10, color: 'rgba(232,154,60,0.4)' }}>
                        {expanded ? '↑ collapse' : `↓ ${hit.content.length} chars — click to expand`}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
