import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { SpineEmailForm } from '@/components/SpineEmailForm';
import { SpineLiveDemo } from '@/components/SpineLiveDemo';
import { MetaPixel } from '@/components/MetaPixel';
import type { BenchSummary } from '@/app/api/spine-bench/route';

export const metadata: Metadata = {
  title: 'Spine — portable memory for any AI',
  description:
    'One memory. Every AI. Automatic. Spine is the quiet memory layer beneath your assistant — the first consumer-shipped portable AI memory layer. Waitlist open.',
  openGraph: {
    title: 'Spine — portable memory for any AI',
    description: 'One memory. Every AI. Automatic.',
    type: 'website',
  },
};

export const revalidate = 60;

async function fetchBench(): Promise<BenchSummary | null> {
  try {
    const h = await headers();
    const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
    const proto = h.get('x-forwarded-proto') ?? 'https';
    const res = await fetch(`${proto}://${host}/api/spine-bench`, { next: { revalidate: 60 } });
    if (!res.ok) return null;
    return (await res.json()) as BenchSummary;
  } catch {
    return null;
  }
}

function fmtScale(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
  return n.toLocaleString();
}

export default async function SpineLabs() {
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  const bench = await fetchBench();

  return (
    <main className="relative bg-night text-cream overflow-x-hidden">
      <MetaPixel pixelId={pixelId} />

      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 z-50 px-5 md:px-10 py-4 md:py-5 flex items-center justify-between backdrop-blur-md bg-night/70 border-b border-cream/[0.05]">
        <Link href="/spine" className="flex items-center gap-3">
          <span className="block w-2 h-2 rounded-full bg-amber ember" aria-hidden />
          <span className="font-serif text-lg md:text-xl tracking-wide">Spine</span>
          <span className="font-mono text-[9px] md:text-[10px] uppercase tracking-widest text-cream/30 hidden sm:inline">
            · labs
          </span>
        </Link>
        <div className="flex items-center gap-4 md:gap-6">
          <Link
            href="/spine/why"
            className="font-mono text-[10px] uppercase tracking-widest text-amber hover:text-cream transition-colors duration-300"
          >
            Why
          </Link>
          <Link
            href="/spine/proof"
            className="font-mono text-[10px] uppercase tracking-widest text-cream/45 hover:text-amber transition-colors duration-300 hidden sm:inline"
          >
            Proof
          </Link>
          <Link
            href="/spine/stats"
            className="font-mono text-[10px] uppercase tracking-widest text-cream/45 hover:text-amber transition-colors duration-300 hidden sm:inline"
          >
            Stats
          </Link>
          <Link
            href="/spine/log"
            className="font-mono text-[10px] uppercase tracking-widest text-cream/45 hover:text-amber transition-colors duration-300 hidden sm:inline"
          >
            Log
          </Link>
          <a
            href="#waitlist"
            className="font-mono text-[10px] uppercase tracking-widest px-3 py-2 md:px-4 bg-amber text-night hover:bg-cream transition-colors duration-300"
          >
            Get a seat →
          </a>
        </div>
      </nav>

      {/* Hero */}
      <section id="top" className="relative pt-28 md:pt-32 pb-20 md:pb-28 px-5 md:px-10">
        {/* Atmosphere */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
          <div className="absolute top-[20%] left-[10%] w-[500px] h-[500px] rounded-full bg-amber/[0.07] blur-[180px] lamp-bloom" />
          <div className="absolute bottom-0 right-[5%] w-[420px] h-[320px] rounded-full bg-ink/[0.08] blur-[160px]" />
        </div>

        <div className="relative max-w-5xl mx-auto">
          <p className="font-mono text-[10px] uppercase tracking-widest text-amber mb-8 rise rise-1">
            § Spine · labs · launch proof · 2026-04-22
          </p>

          <p className="font-mono text-[11px] uppercase tracking-widest text-cream/50 mb-4 rise rise-1">
            Job title · Chief of Staff for your AI
          </p>

          <h1 className="font-serif text-[2.4rem] leading-[1.02] sm:text-[3.2rem] md:text-[4.6rem] md:leading-[0.98] lg:text-[5.4rem] text-cream tracking-tight rise rise-2">
            One memory. <em className="italic text-amber">Every AI.</em>
            <br />
            Automatic.
          </h1>

          {/* Verbatim recursion-moment hero copy — from project_spine_self_use_proof_2026_04_22.md */}
          <div className="mt-10 md:mt-12 max-w-3xl rise rise-3">
            <blockquote className="border-l-2 border-amber/50 pl-5 md:pl-7 py-1 text-lg md:text-xl text-cream/85 font-serif italic leading-relaxed">
              In April I noticed my AI was getting better because of my memory
              system. I built Spine to make that compounding effect work for
              anyone. Eight months later, Spine reminded me of that original
              observation at the exact moment the compounding was happening
              again — without me asking. That&rsquo;s what your AI is missing.
            </blockquote>
            <p className="mt-6 text-[15px] md:text-base text-cream/55 leading-relaxed max-w-2xl">
              Spine is not a memory database. It&rsquo;s the layer that makes
              your AI remember <em className="italic text-amber/85">why</em>{' '}
              things mattered, not just <em className="italic">what</em>{' '}
              happened. Plug it into any Claude / Cursor / Copilot / custom
              agent. The compounding starts immediately.
            </p>
          </div>

          {/* Primary CTA */}
          <div id="waitlist" className="mt-12 md:mt-16 max-w-xl rise rise-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-cream/50 mb-5">
              § Waitlist · rolling access
            </p>
            <SpineEmailForm source="labs-spine-hero" />
            <p className="mt-5 font-mono text-[10px] uppercase tracking-widest text-cream/30">
              No credit card · Claude · ChatGPT · Gemini · Cursor · any MCP client
            </p>
          </div>
        </div>
      </section>

      {/* Scale proof strip */}
      {bench?.latest && (
        <section className="relative px-5 md:px-10 py-12 md:py-16 border-t border-cream/[0.05] bg-amber/[0.02]">
          <Link
            href="/spine/proof"
            className="group block max-w-5xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-6 hover:opacity-90 transition-opacity"
          >
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-amber mb-3">
                § Proof · latest benchmark · needle-in-haystack
              </p>
              <p className="font-serif text-2xl md:text-4xl text-cream leading-tight">
                <span className="text-amber">{fmtScale(bench.latest.scale)} memories</span> indexed.{' '}
                <em className="italic">{bench.latest.p99_latency_ms}ms p99.</em>{' '}
                {(bench.latest.recall_accuracy * 100).toFixed(1)}% of needles found.
              </p>
            </div>
            <span className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-cream/55 group-hover:text-amber transition-colors shrink-0">
              See the method →
            </span>
          </Link>
        </section>
      )}

      {/* Live demo — the working moment, re-playable */}
      <section className="relative px-5 md:px-10 py-20 md:py-28 border-t border-cream/[0.05]">
        <div className="max-w-5xl mx-auto">
          <p className="font-mono text-[10px] uppercase tracking-widest text-amber mb-6">
            § The working moment · live
          </p>
          <h2 className="font-serif text-3xl md:text-5xl leading-[1.05] max-w-3xl mb-8">
            Ask Spine something from the creator&rsquo;s own corpus.
          </h2>
          <p className="text-cream/55 max-w-2xl leading-relaxed mb-10 text-[15px] md:text-base">
            Real recall against 310 memories ingested from eight months of real
            work. Every answer below was retrieved through the same pipeline
            the production product uses. Latency badge is end-to-end from your
            browser to Supabase and back.
          </p>

          <div className="p-5 md:p-8 border border-cream/[0.08] bg-cream/[0.015]">
            <SpineLiveDemo />
          </div>
        </div>
      </section>

      {/* The recursion moment — proof section */}
      <section className="relative px-5 md:px-10 py-20 md:py-28 border-t border-cream/[0.05]">
        <div className="max-w-4xl mx-auto">
          <p className="font-mono text-[10px] uppercase tracking-widest text-amber mb-6">
            § 002 · The recursion moment
          </p>
          <h2 className="font-serif text-3xl md:text-5xl leading-[1.08] max-w-3xl mb-14">
            Three unprompted fires.
            <br />
            One of them was the observation that started the project.
          </h2>

          <ol className="space-y-12 md:space-y-14">
            {[
              {
                n: 'Turn 01',
                title: 'How do we use memory to make Claude the best?',
                body: 'Spine surfaced the locked six-terminal strategy, the folder-architected-for-Claude decision, and the self-improvement system plan. Every one of them load-bearing for the exact question asked.',
              },
              {
                n: 'Turn 02',
                title: 'Write memory tailored to me — you don’t understand yourself yet.',
                body: 'Spine surfaced the 2026-04-05 foundational commitment — "I want you to be the best ever Claude for a person" — at the exact moment a memory file about being the best Claude for Roman was being written.',
              },
              {
                n: 'Turn 03',
                title: 'wait wait wait. the Spine shit bro holy.',
                body: 'Spine surfaced the 2026-04-11 observation that the memory stack was making Claude measurably better at design over time. The product fed the creator’s own insight about the product back, at the moment the effect was recurring in front of him. No query. No prompt. Semantic retrieval alone.',
              },
            ].map((t) => (
              <li
                key={t.n}
                className="grid md:grid-cols-[120px,1fr] gap-4 md:gap-10 items-start"
              >
                <span className="font-mono text-[11px] uppercase tracking-widest text-cream/35">
                  {t.n}
                </span>
                <div>
                  <p className="font-serif italic text-xl md:text-2xl text-cream leading-snug mb-4">
                    “{t.title}”
                  </p>
                  <p className="text-cream/55 leading-relaxed max-w-2xl text-[15px] md:text-base">
                    {t.body}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-16 md:mt-20 border-l-2 border-amber/50 pl-5 md:pl-7 py-2 max-w-3xl">
            <p className="font-serif italic text-xl md:text-2xl text-cream/90 leading-snug">
              &ldquo;Tonight I had a conversation with a Claude terminal that
              had never met me. It talked like it&rsquo;d known me for months.
              Because Spine was running in the background. Your AIs don&rsquo;t
              know you. Spine is the memory layer that fixes that.&rdquo;
            </p>
            <p className="mt-5 font-mono text-[10px] uppercase tracking-widest text-cream/35">
              — Roman · 2026-04-22 · portable-memory thesis
            </p>
          </div>
        </div>
      </section>

      {/* The category */}
      <section className="relative px-5 md:px-10 py-20 md:py-28 border-t border-cream/[0.05]">
        <div className="max-w-5xl mx-auto">
          <p className="font-mono text-[10px] uppercase tracking-widest text-amber mb-6">
            § 003 · The category nobody named yet
          </p>
          <h2 className="font-serif text-3xl md:text-5xl leading-[1.05] max-w-3xl mb-14">
            Your memory is attached to you, not the model.
          </h2>

          <div className="grid md:grid-cols-2 gap-5 md:gap-6">
            {[
              {
                name: 'ChatGPT Memory',
                verdict: 'Locked to ChatGPT. Forgets you on every other assistant.',
              },
              {
                name: 'Claude Projects',
                verdict: 'Locked to Claude. Scoped to one project at a time.',
              },
              {
                name: 'Mem0 / MemGPT',
                verdict: 'Research-grade. No consumer shape, no shipped install.',
              },
              {
                name: 'Spine',
                verdict:
                  'First consumer-shipped portable AI memory layer. One corpus. Every AI. Automatic cross-instance injection.',
                us: true,
              },
            ].map((c) => (
              <div
                key={c.name}
                className={`p-6 md:p-7 border transition-colors duration-500 ${
                  c.us
                    ? 'border-amber/50 bg-amber/[0.04]'
                    : 'border-cream/[0.08] hover:border-cream/[0.18]'
                }`}
              >
                <p className="font-mono text-[10px] uppercase tracking-widest text-cream/40 mb-4">
                  {c.us ? 'Spine · us' : c.name}
                </p>
                <p className="font-serif text-lg md:text-xl text-cream/85 leading-snug">
                  {c.us ? (
                    <>
                      <span className="text-amber">First consumer-shipped</span>{' '}
                      portable AI memory layer. One corpus. Every AI. Automatic
                      cross-instance injection.
                    </>
                  ) : (
                    c.verdict
                  )}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* v1.1 engineering roadmap — transparent changelog */}
      <section className="relative px-5 md:px-10 py-20 md:py-28 border-t border-cream/[0.05]">
        <div className="max-w-4xl mx-auto">
          <p className="font-mono text-[10px] uppercase tracking-widest text-amber mb-6">
            § 004 · v1.1 engineering roadmap · published
          </p>
          <h2 className="font-serif text-3xl md:text-5xl leading-[1.05] max-w-3xl mb-10">
            What we&rsquo;re improving next. In plain view.
          </h2>
          <p className="text-cream/55 max-w-2xl leading-relaxed mb-12 text-[15px]">
            A second Spine-wired terminal reviewed the product the same night.
            The four recommendations below are on the public roadmap. Each one
            becomes a line in the{' '}
            <Link href="/spine/log" className="underline decoration-amber/40 hover:decoration-amber text-amber/90">
              changelog
            </Link>{' '}
            when shipped.
          </p>

          <ol className="space-y-6">
            {[
              {
                n: '01',
                title: 'Active-thread reranker',
                body: 'Embed the last 2–3 conversation turns, weighted toward the active query. RRF fuse pgvector + BM25 as the baseline. Cross-encoder rerank where quality actually lives.',
              },
              {
                n: '02',
                title: 'Per-session de-duplication',
                body: 'Once a memory is injected in-thread, don’t re-inject it on the next turn unless relevance jumps meaningfully. Track injected IDs.',
              },
              {
                n: '03',
                title: 'superseded_by correction chain',
                body: 'Append-only stays, but updates link through superseded_by so stale memories weight lower without being destroyed.',
              },
              {
                n: '04',
                title: 'Provenance on every injection',
                body: 'Age + last-confirmed-date travel with every memory. The receiving AI can weight confidence instead of treating all memories as equal-authority.',
              },
            ].map((r) => (
              <li
                key={r.n}
                className="grid grid-cols-[40px,1fr] gap-4 md:gap-8 py-5 border-b border-cream/[0.06]"
              >
                <span className="font-mono text-[11px] text-cream/35 md:pt-0.5">{r.n}</span>
                <div>
                  <p className="font-serif text-xl md:text-2xl text-cream mb-2">{r.title}</p>
                  <p className="text-cream/55 leading-relaxed text-[15px]">{r.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative px-5 md:px-10 py-24 md:py-32 border-t border-cream/[0.05]">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-serif text-4xl md:text-6xl leading-[1.0] text-cream mb-8">
            Your AIs don&rsquo;t know you.
            <br />
            <em className="italic text-amber">Fix that.</em>
          </h2>
          <p className="text-cream/55 text-lg leading-relaxed mb-10 max-w-xl">
            One memory. Every AI. Automatic. The waitlist is open; access is
            rolling. No credit card.
          </p>
          <SpineEmailForm source="labs-spine-footer" />
        </div>
      </section>

      {/* Footer */}
      <footer className="px-5 md:px-10 py-14 border-t border-cream/[0.05]">
        <div className="max-w-5xl mx-auto flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div>
            <div className="flex items-center gap-3">
              <span className="block w-2 h-2 rounded-full bg-amber ember" />
              <p className="font-serif text-2xl text-cream">Spine</p>
            </div>
            <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-cream/30">
              Portable memory for any AI · Canberra
            </p>
          </div>
          <div className="flex flex-col md:items-end gap-2">
            <div className="flex flex-wrap gap-5 font-mono text-[10px] uppercase tracking-widest">
              <Link href="/spine/why" className="text-cream/30 hover:text-amber transition-colors">
                Why
              </Link>
              <Link href="/spine/proof" className="text-cream/30 hover:text-amber transition-colors">
                Proof
              </Link>
              <Link href="/spine/stats" className="text-cream/30 hover:text-amber transition-colors">
                Stats
              </Link>
              <Link href="/spine/log" className="text-cream/30 hover:text-amber transition-colors">
                Changelog
              </Link>
              <Link href="/docs/mcp" className="text-cream/30 hover:text-amber transition-colors">
                Docs
              </Link>
              <Link href="/privacy" className="text-cream/30 hover:text-amber transition-colors">
                Privacy
              </Link>
            </div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-cream/20">
              © {new Date().getFullYear()} · XXIautomate
            </p>
          </div>
        </div>
      </footer>
    </main>
  );
}
