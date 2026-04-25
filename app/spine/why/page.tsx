import type { Metadata } from 'next';
import Link from 'next/link';
import { WhyExplorer } from './WhyExplorer';

export const metadata: Metadata = {
  title: 'Spine — the ranker in the open',
  description:
    'Every other AI memory tool returns results. Spine returns results and why it ranked them. Move the sliders and watch the top-5 reorder — live.',
};

export default function SpineWhyPage() {
  return (
    <main className="relative bg-night text-cream min-h-screen overflow-x-hidden">
      {/* Nav */}
      <nav className="fixed top-0 inset-x-0 z-50 px-5 md:px-10 py-4 md:py-5 flex items-center justify-between backdrop-blur-md bg-night/70 border-b border-cream/[0.05]">
        <Link href="/spine" className="flex items-center gap-3">
          <span className="block w-2 h-2 rounded-full bg-amber ember" aria-hidden />
          <span className="font-serif text-lg md:text-xl tracking-wide">Spine</span>
          <span className="font-mono text-[10px] uppercase tracking-widest text-cream/30 hidden sm:inline">
            · labs
          </span>
        </Link>
        <div className="flex items-center gap-4 md:gap-6">
          <Link
            href="/spine"
            className="font-mono text-[10px] uppercase tracking-widest text-cream/45 hover:text-amber transition-colors"
          >
            Overview
          </Link>
          <Link
            href="/spine/proof"
            className="font-mono text-[10px] uppercase tracking-widest text-cream/45 hover:text-amber transition-colors hidden sm:inline"
          >
            Proof
          </Link>
          <Link
            href="/spine/stats"
            className="font-mono text-[10px] uppercase tracking-widest text-cream/45 hover:text-amber transition-colors hidden sm:inline"
          >
            Stats
          </Link>
          <Link
            href="/spine#waitlist"
            className="font-mono text-[10px] uppercase tracking-widest px-3 py-2 md:px-4 bg-amber text-night hover:bg-cream transition-colors"
          >
            Get a seat →
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-28 md:pt-36 pb-10 md:pb-16 px-5 md:px-10">
        <div className="max-w-5xl mx-auto">
          <p className="font-mono text-[10px] uppercase tracking-widest text-amber mb-6">
            § Why · the ranker in the open
          </p>
          <h1 className="font-serif text-[2.4rem] leading-[1.02] sm:text-[3.2rem] md:text-[4.8rem] md:leading-[0.98] text-cream tracking-tight max-w-5xl">
            Mem.ai returns results.
            <br />
            <em className="italic text-amber">Spine returns results and why.</em>
          </h1>

          <div className="mt-10 md:mt-12 max-w-3xl">
            <blockquote className="border-l-2 border-amber/50 pl-5 md:pl-7 py-1 text-lg md:text-xl text-cream/85 font-serif italic leading-relaxed">
              Type a query. See every candidate in the retrieval pool — BM25,
              vector, recency, and graph centrality scored side-by-side, plus
              the cross-encoder score. Move the sliders. The top-5 reorders in
              front of you. No server round-trip — this is the same maths the
              production ranker runs.
            </blockquote>
          </div>
        </div>
      </section>

      {/* Explorer */}
      <section className="px-5 md:px-10 pb-16 md:pb-24">
        <div className="max-w-7xl mx-auto">
          <WhyExplorer />
        </div>
      </section>

      {/* How to read this */}
      <section className="px-5 md:px-10 py-16 md:py-24 border-t border-cream/[0.05]">
        <div className="max-w-4xl mx-auto grid md:grid-cols-2 gap-8 md:gap-12">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-amber mb-4">
              § How to read this
            </p>
            <h2 className="font-serif text-2xl md:text-3xl text-cream mb-6 leading-snug">
              Four signals, one fusion.
            </h2>
            <ul className="space-y-4 text-cream/65 leading-relaxed text-[15px]">
              <li>
                <span className="text-amber font-mono text-[11px] uppercase tracking-widest">semantic</span> — pgvector cosine similarity against your query embedding (text-embedding-3-small, 1536 dims).
              </li>
              <li>
                <span className="text-amber font-mono text-[11px] uppercase tracking-widest">keyword</span> — Postgres BM25 via ts_rank. Picks up exact terms the embedding might smear.
              </li>
              <li>
                <span className="text-amber font-mono text-[11px] uppercase tracking-widest">recency</span> — exp(-age / 90d half-life). Newer memories weight higher unless actively superseded.
              </li>
              <li>
                <span className="text-amber font-mono text-[11px] uppercase tracking-widest">graph</span> — personalized PageRank over your memory entity graph. Memories that anchor many others rank up.
              </li>
            </ul>
          </div>

          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-amber mb-4">
              § Weights are learned
            </p>
            <h2 className="font-serif text-2xl md:text-3xl text-cream mb-6 leading-snug">
              From your own citation behaviour.
            </h2>
            <p className="text-cream/65 leading-relaxed text-[15px] mb-4">
              When a memory is shown and its phrasing appears in your next
              turn, that&rsquo;s a positive label. A logistic regressor fits
              the weights to maximise the chance that cited memories rank top.
              Retrained nightly. AUC tracked in the changelog.
            </p>
            <p className="text-cream/65 leading-relaxed text-[15px]">
              The sliders above let you override the learned weights for a
              single query — or save them as a profile and make them your
              account default.
            </p>
          </div>
        </div>
      </section>

      {/* Pitch */}
      <section className="px-5 md:px-10 py-16 md:py-24 border-t border-cream/[0.05]">
        <div className="max-w-3xl mx-auto border-l-2 border-amber/45 pl-5 md:pl-7">
          <p className="font-mono text-[10px] uppercase tracking-widest text-amber mb-4">
            § The transparency moat
          </p>
          <p className="font-serif italic text-xl md:text-2xl text-cream/85 leading-snug mb-5">
            &ldquo;Every AI memory tool built before Spine hides the ranker. We
            publish it, measure it, and let you tune it. That transparency is
            the product.&rdquo;
          </p>
          <p className="text-cream/55 text-[15px] leading-relaxed">
            Mem.ai, Supermemory, Zep, Rewind — all black-box. You send a query,
            you get results, you don&rsquo;t know why. Spine treats explainability
            as the retrieval layer being honest, not as a UI decoration.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="px-5 md:px-10 py-16 md:py-24 border-t border-cream/[0.05]">
        <div className="max-w-3xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div>
            <p className="font-serif text-2xl md:text-3xl text-cream leading-tight">
              Want your own ranker in the open?
            </p>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-cream/35">
              Waitlist rolling access · sliders save per account
            </p>
          </div>
          <Link
            href="/spine#waitlist"
            className="group inline-flex items-center justify-center gap-3 px-6 py-3 bg-amber text-night hover:bg-cream transition-colors duration-500 self-start md:self-auto"
          >
            <span className="font-serif text-lg">Request a seat</span>
            <span className="transition-transform duration-500 group-hover:translate-x-1 font-mono">→</span>
          </Link>
        </div>
      </section>

      <footer className="px-5 md:px-10 py-10 border-t border-cream/[0.05]">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <Link href="/spine" className="font-mono text-[10px] uppercase tracking-widest text-cream/30 hover:text-amber">
            ← back to Spine
          </Link>
          <p className="font-mono text-[10px] uppercase tracking-widest text-cream/20">
            © {new Date().getFullYear()} · XXIautomate
          </p>
        </div>
      </footer>
    </main>
  );
}
