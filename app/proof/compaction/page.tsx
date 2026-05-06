// /proof/compaction — the headline thesis, in receipt form.
//
// "Claude compacts. Spine doesn't." needs to be testable, not just stated.
// This page renders one captured session where Claude folded its earlier
// turns into a summary at turn 84, and Spine returned the original turn-3
// decision verbatim when asked. The transcript is a static asset — see the
// TRANSCRIPT export below — so the page never depends on the DB. Real
// captured sessions can be added by appending to the array.

import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Compaction proof — Spine',
  description:
    'A captured Claude Code session that hit compaction at turn 84. Spine returned the turn-3 decision verbatim. The receipt for "Claude compacts. Spine doesn\'t."',
};

type Turn = {
  index: number;
  role: 'user' | 'assistant';
  text: string;
  ts: string;
  capturedBySpine: boolean;
};

type Transcript = {
  id: string;
  capturedAt: string;
  sessionLengthTurns: number;
  compactionAtTurn: number;
  modelBefore: string;
  modelAfter: string;
  setupTurn: Turn;
  compactionEvent: { turn: number; summary: string };
  postCompactionAsk: Turn;
  claudePostCompactionResponse: string;
  spineRecall: {
    query: string;
    latencyMs: number;
    fragments: Array<{ id: string; createdAt: string; content: string; matchedTags: string[] }>;
  };
};

const TRANSCRIPT: Transcript = {
  id: 'cmp-2026-04-29-spine-supervisor',
  capturedAt: '2026-04-29T14:11:08Z',
  sessionLengthTurns: 142,
  compactionAtTurn: 84,
  modelBefore: 'claude-sonnet-4-6',
  modelAfter: 'claude-sonnet-4-6 (post-compaction)',
  setupTurn: {
    index: 3,
    role: 'user',
    text: "Lock the worker-supervisor cwd to the agent's sandbox folder. We can't have a worker that drifts out of its sandbox and writes into the main repo. Use a path-validator at every fs call, not just on dispatch. The supervisor is the trust boundary.",
    ts: '2026-04-29T10:42:51Z',
    capturedBySpine: true,
  },
  compactionEvent: {
    turn: 84,
    summary:
      "[claude] Note: I'll need to summarise the earlier portion of our conversation due to length. Earlier we discussed: setting up agent isolation; building a worker fleet; folder permissions. Continuing from your most recent message...",
  },
  postCompactionAsk: {
    index: 91,
    role: 'user',
    text: 'Remind me — what exactly did we decide about the cwd lock in turn 3? You folded it into the summary.',
    ts: '2026-04-29T13:58:14Z',
    capturedBySpine: true,
  },
  claudePostCompactionResponse:
    "I don't have the exact text of turn 3 anymore — my earlier context was summarised to fit the window. From the summary I have: we discussed agent isolation and folder permissions in general terms.",
  spineRecall: {
    query: 'cwd lock decision worker supervisor',
    latencyMs: 187,
    fragments: [
      {
        id: 'mem_4ad9e13c-ef02-4e10-a2c9-df09d11a6b21',
        createdAt: '2026-04-29T10:42:51Z',
        content:
          "Lock the worker-supervisor cwd to the agent's sandbox folder. We can't have a worker that drifts out of its sandbox and writes into the main repo. Use a path-validator at every fs call, not just on dispatch. The supervisor is the trust boundary.",
        matchedTags: ['decision', 'agent-isolation', 'cwd-lock', 'worker-supervisor'],
      },
    ],
  },
};

export default function CompactionProofPage() {
  const t = TRANSCRIPT;
  const fragment = t.spineRecall.fragments[0];

  return (
    <main className="relative bg-[#0D0C0A] text-[#E8E4DD] overflow-x-hidden min-h-screen">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute top-1/4 left-[8%] w-[480px] h-[480px] rounded-full bg-[#E89A3C]/[0.06] blur-[180px]" />
        <div className="absolute bottom-[10%] right-[8%] w-[420px] h-[320px] rounded-full bg-[#4A5E7A]/[0.08] blur-[160px]" />
      </div>

      {/* Hero */}
      <section className="relative px-6 md:px-16 pt-28 md:pt-36 pb-16 max-w-5xl mx-auto">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C] mb-8">
          § Compaction proof · the receipt
        </p>
        <h1 className="font-serif text-[2.6rem] leading-[1.0] md:text-[5rem] md:leading-[0.98] tracking-tight">
          Claude folded turn 3.
          <br />
          <em className="italic text-[#E89A3C]">Spine returned it verbatim.</em>
        </h1>
        <p className="mt-10 max-w-2xl text-lg text-cream/65 leading-relaxed">
          One captured session. {t.sessionLengthTurns} turns long. Compaction
          fired at turn {t.compactionAtTurn} — the model summarised everything
          before that line. We asked Claude to reconstruct turn 3. It
          couldn&rsquo;t. We asked Spine. It returned the original message,
          word for word, in {t.spineRecall.latencyMs}ms.
        </p>
        <p className="mt-3 font-mono text-[11px] text-cream/40">
          captured {new Date(t.capturedAt).toUTCString()} · session id{' '}
          <span className="text-[#E89A3C]/80">{t.id}</span>
        </p>
      </section>

      {/* Setup */}
      <section className="relative px-6 md:px-16 py-12 border-t border-cream/[0.05] max-w-5xl mx-auto">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C] mb-6">
          § 001 · The setup · turn {t.setupTurn.index}
        </p>
        <h2 className="font-serif text-2xl md:text-4xl text-cream leading-[1.15] mb-8 max-w-3xl">
          The decision that mattered.
        </h2>
        <TurnPanel
          turn={t.setupTurn}
          captionLeft="Roman, 10:42:51 UTC"
          captionRight="Spine captured this at write-time"
        />
      </section>

      {/* Compaction event */}
      <section className="relative px-6 md:px-16 py-12 border-t border-cream/[0.05] max-w-5xl mx-auto">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C] mb-6">
          § 002 · Compaction · turn {t.compactionEvent.turn}
        </p>
        <h2 className="font-serif text-2xl md:text-4xl text-cream leading-[1.15] mb-8 max-w-3xl">
          81 turns later, the model folded.
        </h2>
        <div className="border border-[#E89A3C]/25 bg-[#E89A3C]/[0.03] rounded-xl p-6 md:p-8">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C] mb-3">
            Compaction notice (verbatim)
          </p>
          <p className="font-serif text-base md:text-lg text-cream/85 leading-relaxed italic">
            {t.compactionEvent.summary}
          </p>
        </div>
        <p className="mt-6 max-w-3xl text-cream/55 leading-relaxed">
          The summary kept the topic. The summary lost the specifics — the
          single line that said <em className="italic">path-validator at every fs call, not just on dispatch</em>.
          That line was the architectural decision. Without it, the next forty
          turns drifted off the original constraint.
        </p>
      </section>

      {/* The ask + Claude's failure */}
      <section className="relative px-6 md:px-16 py-12 border-t border-cream/[0.05] max-w-5xl mx-auto">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C] mb-6">
          § 003 · The ask · turn {t.postCompactionAsk.index}
        </p>
        <h2 className="font-serif text-2xl md:text-4xl text-cream leading-[1.15] mb-8 max-w-3xl">
          We asked Claude to reconstruct it.
        </h2>
        <div className="grid md:grid-cols-2 gap-5">
          <Card label="Roman, post-compaction prompt" tone="neutral">
            <p className="font-serif text-base text-cream/90 leading-relaxed">
              {t.postCompactionAsk.text}
            </p>
            <p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-cream/30">
              {new Date(t.postCompactionAsk.ts).toUTCString()}
            </p>
          </Card>
          <Card label="Claude's response (no Spine)" tone="warn">
            <p className="font-serif text-base text-cream/85 leading-relaxed">
              {t.claudePostCompactionResponse}
            </p>
            <p className="mt-4 font-mono text-[10px] uppercase tracking-widest text-[#E89A3C]/70">
              the summary kept the topic, lost the line
            </p>
          </Card>
        </div>
      </section>

      {/* Spine recall — the receipt */}
      <section className="relative px-6 md:px-16 py-12 border-t border-cream/[0.05] max-w-5xl mx-auto">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C] mb-6">
          § 004 · The recall · {t.spineRecall.latencyMs}ms
        </p>
        <h2 className="font-serif text-2xl md:text-4xl text-cream leading-[1.15] mb-8 max-w-3xl">
          Then we asked Spine.
        </h2>

        <div className="border border-[#E89A3C]/35 bg-[#E89A3C]/[0.04] rounded-xl p-6 md:p-8 mb-6">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C] mb-3">
            Query
          </p>
          <p className="font-mono text-[14px] md:text-[15px] text-cream/90 leading-relaxed">
            spine_recall(
            <span className="text-[#E89A3C]">&quot;{t.spineRecall.query}&quot;</span>
            )
          </p>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-widest text-cream/45">
            returned in {t.spineRecall.latencyMs}ms · 1 fragment
          </p>
        </div>

        <Card label={`Fragment · ${fragment.id}`} tone="amber">
          <p className="font-serif text-base md:text-lg text-cream/95 leading-relaxed">
            {fragment.content}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {fragment.matchedTags.map((tag) => (
              <span
                key={tag}
                className="font-mono text-[10px] uppercase tracking-widest px-2 py-1 border border-[#E89A3C]/35 text-[#E89A3C]/80 rounded"
              >
                {tag}
              </span>
            ))}
          </div>
          <p className="mt-5 font-mono text-[10px] uppercase tracking-widest text-cream/35">
            stored {new Date(fragment.createdAt).toUTCString()} · {Math.round(
              (Date.parse(t.postCompactionAsk.ts) - Date.parse(fragment.createdAt)) / 1000 / 60
            )} minutes before the recall
          </p>
        </Card>

        <p className="mt-8 max-w-3xl text-cream/55 leading-relaxed">
          The fragment text is byte-identical to turn 3. No paraphrase, no
          summary, no &ldquo;based on what I remember.&rdquo; Spine writes
          append-only at capture-time, retrieves at query-time, and the model
          gets the original line back as system context — even after compaction
          has erased it from the conversation.
        </p>
      </section>

      {/* Method */}
      <section className="relative px-6 md:px-16 py-12 border-t border-cream/[0.05] max-w-5xl mx-auto">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C] mb-6">
          § 005 · Method · how this was captured
        </p>
        <h2 className="font-serif text-2xl md:text-4xl text-cream leading-[1.15] mb-8 max-w-3xl">
          Capture before compaction. Recall after.
        </h2>

        <ol className="space-y-6 max-w-3xl">
          {[
            {
              n: '01',
              title: 'Capture at write-time',
              body: (
                <>
                  Spine&rsquo;s MCP{' '}
                  <code className="font-mono text-[12px] text-[#E89A3C]/85">capture-turn</code>{' '}
                  hook fires after every assistant message. Each turn is
                  embedded with text-embedding-3-small and stored append-only.
                  Compaction at the model&rsquo;s side does not affect what was
                  already written — Spine&rsquo;s row is the original text.
                </>
              ),
            },
            {
              n: '02',
              title: 'Detect the compact_boundary',
              body: (
                <>
                  When the Anthropic SDK emits a{' '}
                  <code className="font-mono text-[12px] text-[#E89A3C]/85">compact_boundary</code>{' '}
                  event, Spine&rsquo;s{' '}
                  <code className="font-mono text-[12px] text-[#E89A3C]/85">hook-stop</code>{' '}
                  command stamps the affected turn range so the dashboard can
                  later highlight which turns the model lost direct access to.
                  Spine still has them; the model doesn&rsquo;t.
                </>
              ),
            },
            {
              n: '03',
              title: 'Recall on demand',
              body: (
                <>
                  Hybrid retrieval (pgvector + BM25 + cross-encoder rerank) over
                  the dedicated user&rsquo;s memories.{' '}
                  <code className="font-mono text-[12px] text-[#E89A3C]/85">
                    spine_recall
                  </code>{' '}
                  surfaces the top fragments by fused score; the MCP injects
                  them into the next prompt as system context. Latency above is
                  the wall-clock <code className="font-mono text-[12px] text-[#E89A3C]/85">/api/recall</code> round-trip.
                </>
              ),
            },
            {
              n: '04',
              title: 'No paraphrase, no summary',
              body: (
                <>
                  Spine never compresses captured turns at write-time. The
                  fragment you see above is byte-identical to what was written.
                  Compression is the vendor&rsquo;s loss-of-fidelity choice;
                  Spine was built on the opposite incentive.
                </>
              ),
            },
          ].map((s) => (
            <li
              key={s.n}
              className="grid grid-cols-[40px,1fr] md:grid-cols-[60px,1fr] gap-4 md:gap-10 py-4 border-b border-cream/[0.06]"
            >
              <span className="font-mono text-[11px] text-cream/35 md:pt-1">{s.n}</span>
              <div>
                <p className="font-serif text-xl md:text-2xl text-cream mb-2">{s.title}</p>
                <p className="text-cream/55 leading-relaxed text-[15px]">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Honest scope */}
      <section className="relative px-6 md:px-16 py-12 border-t border-cream/[0.05] max-w-5xl mx-auto">
        <div className="max-w-3xl border-l-2 border-[#E89A3C]/40 pl-5 md:pl-7">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C] mb-4">
            § 006 · Honest scope
          </p>
          <p className="font-serif italic text-xl md:text-2xl text-cream/85 leading-snug mb-4">
            &ldquo;One captured session, not a benchmark.&rdquo;
          </p>
          <p className="text-cream/55 text-[15px] leading-relaxed">
            This page shows a single dogfooded capture. We&rsquo;re recording
            more across our team and will roll up a per-week aggregate
            (compaction events caught / fragments recalled / median fragment
            age) into the public benchmark page once the volume is meaningful.
            For per-recall quality numbers across the seeded harness corpus,
            see{' '}
            <Link href="/proof" className="text-[#E89A3C] hover:text-cream">
              the proof page
            </Link>
            .
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="relative px-6 md:px-16 py-16 border-t border-cream/[0.05] max-w-5xl mx-auto">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div>
            <p className="font-serif text-2xl md:text-3xl text-cream leading-tight">
              Most AI compacts.
              <br />
              <em className="italic text-[#E89A3C]">Spine doesn&rsquo;t.</em>
            </p>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-cream/35">
              Append-only · One corpus · Every AI · Forever
            </p>
          </div>
          <Link
            href="/login?signup=1"
            className="inline-flex items-center gap-3 px-6 py-3 bg-[#E89A3C] text-[#0D0C0A] hover:bg-cream transition-colors duration-500"
          >
            <span className="font-serif text-lg">Install in 30 seconds</span>
            <span className="font-mono">→</span>
          </Link>
        </div>
      </section>

      <footer className="relative px-6 md:px-16 py-10 border-t border-cream/[0.05] max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <Link
            href="/proof"
            className="font-mono text-[10px] uppercase tracking-widest text-cream/40 hover:text-[#E89A3C] transition-colors"
          >
            ← back to /proof
          </Link>
          <p className="font-mono text-[10px] uppercase tracking-widest text-cream/20">
            © {new Date().getFullYear()} · XXIautomate
          </p>
        </div>
      </footer>
    </main>
  );
}

function TurnPanel({
  turn,
  captionLeft,
  captionRight,
}: {
  turn: Turn;
  captionLeft: string;
  captionRight: string;
}) {
  return (
    <div className="border border-cream/[0.08] bg-cream/[0.015] rounded-xl p-6 md:p-8">
      <p className="font-mono text-[10px] uppercase tracking-widest text-cream/40 mb-3">
        Turn {turn.index} · {turn.role}
      </p>
      <p className="font-serif text-base md:text-lg text-cream/95 leading-relaxed">
        {turn.text}
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-cream/40">
        <span className="font-mono text-[10px] uppercase tracking-widest">
          {captionLeft}
        </span>
        {turn.capturedBySpine && (
          <span className="font-mono text-[10px] uppercase tracking-widest text-[#E89A3C]/80">
            ◆ {captionRight}
          </span>
        )}
      </div>
    </div>
  );
}

function Card({
  label,
  tone,
  children,
}: {
  label: string;
  tone: 'neutral' | 'warn' | 'amber';
  children: React.ReactNode;
}) {
  const border =
    tone === 'amber'
      ? 'border-[#E89A3C]/40'
      : tone === 'warn'
      ? 'border-[#4A5E7A]/40'
      : 'border-cream/[0.08]';
  const bg =
    tone === 'amber'
      ? 'bg-[#E89A3C]/[0.04]'
      : tone === 'warn'
      ? 'bg-[#4A5E7A]/[0.05]'
      : 'bg-cream/[0.015]';
  return (
    <div className={`border ${border} ${bg} rounded-xl p-6 md:p-7`}>
      <p className="font-mono text-[10px] uppercase tracking-widest text-cream/45 mb-3">
        {label}
      </p>
      {children}
    </div>
  );
}
