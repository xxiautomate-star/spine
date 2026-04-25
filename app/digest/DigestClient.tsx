'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────

type DigestTheme = { title: string; summary: string; memory_count: number };
type DigestDecision = { decision: string; quote: string; context: string };
type DigestQuestion = { question: string; context: string; urgency: 'high' | 'medium' | 'low' };
type DigestNag = { topic: string; occurrences: number; last_seen: string };

type Digest = {
  id: string;
  date: string;
  themes: DigestTheme[];
  decisions: DigestDecision[];
  questions: DigestQuestion[];
  nags: DigestNag[];
  memory_count: number;
  sent_at: string | null;
  created_at: string;
  resolvedQuestions: number[];
};

// ── Helpers ───────────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' });
}

function urgencyStyle(u: string): string {
  if (u === 'high') return 'text-amber/80 border-amber/30';
  if (u === 'medium') return 'text-cream/50 border-cream/20';
  return 'text-cream/30 border-cream/10';
}

// ── Question card ─────────────────────────────────────────────────────────

function QuestionCard({
  question,
  index,
  digestDate,
  resolved,
  onResolve,
}: {
  question: DigestQuestion;
  index: number;
  digestDate: string;
  resolved: boolean;
  onResolve: (index: number) => void;
}) {
  const [loading, setLoading] = useState(false);

  async function markResolved() {
    setLoading(true);
    try {
      await fetch(`/api/digest/${digestDate}/resolve`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_type: 'question', item_index: index }),
      });
      onResolve(index);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`border rounded-xl p-5 transition-all duration-500 ${
      resolved ? 'border-cream/[0.04] opacity-40' : 'border-cream/[0.08] hover:border-cream/20'
    }`}>
      <div className="flex items-start gap-3 mb-3">
        <span className={`font-mono text-[9px] uppercase tracking-widest border rounded px-1.5 py-0.5 flex-shrink-0 ${urgencyStyle(question.urgency)}`}>
          {question.urgency}
        </span>
        {resolved && (
          <span className="font-mono text-[9px] uppercase tracking-widest text-cream/25">resolved</span>
        )}
      </div>
      <p className="text-cream/80 text-[15px] leading-relaxed mb-2">{question.question}</p>
      <p className="text-cream/35 text-[13px]">{question.context}</p>
      {!resolved && (
        <button
          onClick={markResolved}
          disabled={loading}
          className="mt-4 font-mono text-[9px] uppercase tracking-widest text-cream/25 hover:text-amber/70 border-b border-transparent hover:border-amber/30 pb-[1px] transition-all duration-300"
        >
          {loading ? 'Saving…' : 'Mark resolved →'}
        </button>
      )}
    </div>
  );
}

// ── Digest card ───────────────────────────────────────────────────────────

function DigestCard({
  digest,
  isOpen,
  onToggle,
}: {
  digest: Digest;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const [resolved, setResolved] = useState<Set<number>>(
    new Set(digest.resolvedQuestions)
  );

  function handleResolve(index: number) {
    setResolved((prev) => new Set([...prev, index]));
  }

  return (
    <article className={`border rounded-2xl overflow-hidden transition-all duration-500 ${
      isOpen ? 'border-cream/[0.12]' : 'border-cream/[0.06] hover:border-cream/[0.10]'
    }`}>
      {/* Header */}
      <button
        onClick={onToggle}
        className="w-full px-6 py-5 flex items-center justify-between gap-4 text-left"
      >
        <div className="flex items-center gap-4 min-w-0">
          <div>
            <p className="font-serif text-xl text-cream/85 leading-tight">{formatDate(digest.date)}</p>
            <p className="font-mono text-[10px] text-cream/25 mt-1">
              {digest.memory_count} memories
              {digest.sent_at ? ' · sent' : ' · not sent'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          {digest.themes.length > 0 && (
            <span className="font-mono text-[9px] text-cream/30">
              {digest.themes.length} theme{digest.themes.length !== 1 ? 's' : ''}
            </span>
          )}
          {digest.decisions.length > 0 && (
            <span className="font-mono text-[9px] text-amber/50">
              {digest.decisions.length} decision{digest.decisions.length !== 1 ? 's' : ''}
            </span>
          )}
          <span className={`font-mono text-[16px] text-cream/25 transition-transform duration-300 ${isOpen ? 'rotate-45' : ''}`}>
            +
          </span>
        </div>
      </button>

      {/* Expanded content */}
      {isOpen && (
        <div className="px-6 pb-6 space-y-6 border-t border-cream/[0.06]">

          {/* Themes */}
          {digest.themes.length > 0 && (
            <div className="pt-5">
              <p className="font-mono text-[9px] uppercase tracking-widest text-amber/50 mb-3">Themes</p>
              <div className="space-y-3">
                {digest.themes.map((t, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className="text-amber/30 mt-1 text-[10px]">—</span>
                    <div>
                      <p className="text-cream/80 text-[14px] font-medium">{t.title}</p>
                      <p className="text-cream/40 text-[13px] leading-relaxed mt-0.5">{t.summary}</p>
                    </div>
                    <span className="ml-auto font-mono text-[9px] text-cream/20 flex-shrink-0">
                      {t.memory_count}×
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Decisions */}
          {digest.decisions.length > 0 && (
            <div>
              <p className="font-mono text-[9px] uppercase tracking-widest text-amber/50 mb-3">Decisions made</p>
              <div className="space-y-3">
                {digest.decisions.map((d, i) => (
                  <div key={i} className="bg-cream/[0.02] border border-cream/[0.07] rounded-lg px-4 py-4">
                    <p className="text-cream/80 text-[14px] mb-2">{d.decision}</p>
                    <p className="font-serif italic text-[13px] text-cream/40 border-l-2 border-amber/25 pl-3">
                      "{d.quote}"
                    </p>
                    <p className="text-cream/30 text-[12px] mt-2">{d.context}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Open questions */}
          {digest.questions.length > 0 && (
            <div>
              <p className="font-mono text-[9px] uppercase tracking-widest text-amber/50 mb-3">Open questions</p>
              <div className="space-y-3">
                {digest.questions.map((q, i) => (
                  <QuestionCard
                    key={i}
                    question={q}
                    index={i}
                    digestDate={digest.date}
                    resolved={resolved.has(i)}
                    onResolve={handleResolve}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Nags */}
          {digest.nags.length > 0 && (
            <div>
              <p className="font-mono text-[9px] uppercase tracking-widest text-amber/50 mb-3">↺ Still unresolved</p>
              {digest.nags.map((n, i) => (
                <div key={i} className="bg-amber/[0.04] border border-amber/[0.15] rounded-xl px-5 py-4">
                  <p className="text-amber/80 text-[14px]">
                    You mentioned <strong>{n.topic}</strong> {n.occurrences} times without implementing it.
                  </p>
                  {n.last_seen && (
                    <p className="text-amber/40 text-[12px] mt-2 font-serif italic">
                      Last seen: "{n.last_seen}"
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}

// ── Trigger digest modal ──────────────────────────────────────────────────

function TriggerButton() {
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function trigger() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/digest', { method: 'POST' });
      if (!res.ok) {
        const d = (await res.json()) as { error?: string };
        throw new Error(d.error ?? 'Failed');
      }
      setDone(true);
      setTimeout(() => window.location.reload(), 1200);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (done) return <span className="font-mono text-[10px] text-amber/60">Generating… refreshing</span>;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={trigger}
        disabled={loading}
        className="font-mono text-[10px] uppercase tracking-widest text-cream/35 hover:text-amber/70 border-b border-transparent hover:border-amber/30 pb-[1px] transition-all duration-300 disabled:opacity-40"
      >
        {loading ? 'Generating…' : 'Generate today\'s digest →'}
      </button>
      {error && <p className="font-mono text-[9px] text-amber/50">{error}</p>}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────

export function DigestClient({ email }: { email: string }) {
  const [digests, setDigests] = useState<Digest[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/digest')
      .then((r) => r.json())
      .then((data: { digests?: Digest[] }) => {
        const list = data.digests ?? [];
        setDigests(list);
        if (list.length > 0) setOpenId(list[0].id);
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      {/* Atmosphere */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div className="absolute top-0 left-1/3 w-[600px] h-[600px] rounded-full bg-amber/[0.04] blur-[200px]" />
      </div>

      {/* Nav */}
      <header className="sticky top-0 z-50 px-6 md:px-10 py-5 flex items-center justify-between backdrop-blur-md bg-night/75 border-b border-cream/[0.05]">
        <Link href="/" className="flex items-center gap-3">
          <span className="block w-[7px] h-[7px] rounded-full bg-amber ember" aria-hidden />
          <span className="font-serif text-xl text-cream">Spine</span>
        </Link>
        <div className="flex items-center gap-5 font-mono text-[10px] uppercase tracking-widest">
          <Link href="/timeline" className="text-cream/35 hover:text-cream/65 transition-colors duration-300 hidden sm:block">Timeline</Link>
          <Link href="/graph" className="text-cream/35 hover:text-cream/65 transition-colors duration-300 hidden sm:block">Graph</Link>
          <span className="text-cream/22 hidden md:block">{email}</span>
        </div>
      </header>

      <div className="relative max-w-3xl mx-auto px-6 md:px-10 pb-24">
        {/* Header */}
        <div className="pt-16 pb-10 flex items-end justify-between rise rise-1">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-amber/55 mb-3">Daily digest</p>
            <h1 className="font-serif text-[clamp(2.5rem,6vw,4rem)] leading-[0.95] text-cream/90">
              What your AI learned.
            </h1>
            <p className="text-cream/35 text-sm mt-3 max-w-md">
              Themes, decisions, and open questions extracted from your conversations each day.
              Lands in your inbox every morning.
            </p>
          </div>
          <div className="flex-shrink-0 ml-6">
            <TriggerButton />
          </div>
        </div>

        {/* List */}
        <div className="space-y-4 rise rise-2">
          {loading && (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="border border-cream/[0.06] rounded-2xl p-6 animate-pulse">
                  <div className="h-5 bg-cream/[0.06] rounded w-48 mb-2" />
                  <div className="h-3 bg-cream/[0.04] rounded w-24" />
                </div>
              ))}
            </div>
          )}

          {!loading && digests.length === 0 && (
            <div className="text-center py-24">
              <p className="font-serif italic text-2xl text-cream/25 mb-3">
                No digests yet.
              </p>
              <p className="font-mono text-[11px] text-cream/18 mb-6">
                Digests are generated daily from your captures. Generate one now or use Claude Code for a while.
              </p>
            </div>
          )}

          {digests.map((d) => (
            <DigestClient.Card
              key={d.id}
              digest={d}
              isOpen={openId === d.id}
              onToggle={() => setOpenId(openId === d.id ? null : d.id)}
            />
          ))}
        </div>
      </div>
    </>
  );
}

// Attach Card as static property so DigestClient can reference it inside render.
DigestClient.Card = DigestCard;
