import { RecallClient } from './RecallClient';

export const dynamic = 'force-dynamic';

export default function RecallPage() {
  return (
    <main>
      <section className="px-6 md:px-16 pt-24 pb-24">
        <div className="max-w-5xl mx-auto">
          <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-8">
            § 003 &middot; Recall
          </p>
          <h1 className="font-serif text-5xl md:text-7xl leading-[0.98] text-cream mb-6">
            Watch it think.
          </h1>
          <p className="text-cream/60 text-lg max-w-2xl leading-relaxed mb-16">
            Every recall runs hybrid vector + BM25 retrieval, fuses by reciprocal rank with a
            90-day temporal decay, then reranks the top 30 with Claude Haiku 4.5. This panel shows
            the full pipeline so you can tune it.
          </p>

          <RecallClient />
        </div>
      </section>
    </main>
  );
}
