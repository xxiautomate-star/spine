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
import { MarketingNav } from '@/components/MarketingNav';
import { MarketingFooter } from '@/components/MarketingFooter';
import { CompactionTheater } from '@/components/CompactionTheater';

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

// Aspect-ratio presets for embed-mode Loom / ads recording. Each maps to
// a Tailwind max-width that constrains the theatre frame so a stylable
// browser window can be cropped cleanly to the target dimensions.
//   16:9 — landscape (Loom default, YouTube)
//   9:16 — vertical (Reels / TikTok / IG Stories)
//   1:1  — square (LinkedIn carousel, Twitter)
type Aspect = '16:9' | '9:16' | '1:1';

function parseAspect(raw: string | undefined): Aspect {
  if (raw === '9:16' || raw === '1:1') return raw;
  return '16:9';
}

function parseSpeed(raw: string | undefined): number {
  if (!raw) return 1;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(4, Math.max(0.25, n));
}

const ASPECT_FRAME: Record<Aspect, string> = {
  '16:9': 'max-w-5xl',
  '9:16': 'max-w-md',
  '1:1': 'max-w-2xl',
};

export default async function CompactionProofPage({
  searchParams,
}: {
  searchParams?: Promise<{
    embed?: string;
    loop?: string;
    aspect?: string;
    speed?: string;
  }>;
}) {
  const t = TRANSCRIPT;
  const fragment = t.spineRecall.fragments[0];

  // Embed mode strips nav/footer/static-receipt sections so only the
  // interactive theatre remains — for screen-recordings, Loom decks,
  // and ads creative. Triggered by ?embed=1.
  //
  // Optional ?loop=0 (or `loop=false`) flips the theatre into play-once
  // mode — the auto-play stops at the end instead of rewinding so the
  // recording stays clean through the full reveal. Loop is on by default
  // because the marketing-page version benefits from continuous motion.
  //
  // Optional ?aspect=9:16|16:9|1:1 constrains the theatre frame. Default
  // 16:9 matches Loom / YouTube; 9:16 keeps vertical recordings tight.
  //
  // Optional ?speed=0.5|1|2|... applies a multiplier to every auto-play
  // delay. 1 = canonical, 2 = double-speed, 0.5 = slow-mo. Clamped 0.25–4.
  const params = (await searchParams) ?? {};
  const embedded = params.embed === '1' || params.embed === 'true';
  const playOnce = params.loop === '0' || params.loop === 'false';
  const aspect = parseAspect(params.aspect);
  const speed = parseSpeed(params.speed);

  if (embedded) {
    return (
      <main
        className="relative marble-bg min-h-screen flex items-center justify-center px-4 md:px-8 py-6 md:py-10"
        style={{ color: 'var(--s-ink)' }}
      >
        <div className="marble-vein" style={{ position: 'fixed', zIndex: 0 }} />
        <div className="marble-grain" style={{ position: 'fixed', zIndex: 0 }} />
        {/* Aspect-aware frame. 16:9 (default) → wide; 9:16 → narrow for
            vertical Reels; 1:1 → square for LinkedIn carousels. */}
        <div
          className={`w-full ${ASPECT_FRAME[aspect]} mx-auto`}
          style={{ position: 'relative', zIndex: 1 }}
          data-aspect={aspect}
          data-speed={speed}
        >
          <p
            className="font-mono text-[10px] uppercase tracking-[0.32em] mb-4"
            style={{ color: 'var(--s-gold-deep)' }}
          >
            <span className="mr-3" style={{ color: 'var(--s-gold)' }}>§ Compaction proof</span>
            spine.xxiautomate.com
          </p>
          <CompactionTheater playOnce={playOnce} speed={speed} />
          <p
            className="mt-5 font-mono text-[10px] tracking-widest"
            style={{ color: 'var(--s-ink-faint)' }}
          >
            captured {new Date(t.capturedAt).toUTCString()} · session id{' '}
            <span style={{ color: 'var(--s-gold-deep)' }}>{t.id}</span>
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="relative marble-bg min-h-screen overflow-x-hidden" style={{ color: 'var(--s-ink)' }}>
      <div className="marble-vein" style={{ position: 'fixed', zIndex: 0 }} />
      <div className="marble-grain" style={{ position: 'fixed', zIndex: 0 }} />
      <div className="gold-foil-top fixed top-0 inset-x-0 h-[1.5px] z-50" style={{ opacity: 0.95 }} />

      <MarketingNav />

      {/* Hero */}
      <section className="relative px-6 md:px-16 pt-20 pb-16 max-w-5xl mx-auto" style={{ zIndex: 1 }}>
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] mb-8" style={{ color: 'var(--s-gold-deep)' }}>
          <span className="mr-3" style={{ color: 'var(--s-gold)' }}>§ Compaction proof</span>
          the receipt
        </p>
        <h1 className="font-serif text-[2.6rem] leading-[1.0] md:text-[5rem] md:leading-[0.98] tracking-tight" style={{ color: 'var(--s-ink)' }}>
          Claude folded turn 3.
          <br />
          <em className="italic" style={{ color: 'var(--s-gold-deep)' }}>Spine returned it verbatim.</em>
        </h1>
        <p className="mt-10 max-w-2xl text-lg leading-relaxed" style={{ color: 'var(--s-ink-soft)' }}>
          One captured session. {t.sessionLengthTurns} turns long. Compaction
          fired at turn {t.compactionAtTurn} — the model summarised everything
          before that line. We asked Claude to reconstruct turn 3. It
          couldn&rsquo;t. We asked Spine. It returned the original message,
          word for word, in {t.spineRecall.latencyMs}ms.
        </p>
        <p className="mt-3 font-mono text-[11px]" style={{ color: 'var(--s-ink-faint)' }}>
          captured {new Date(t.capturedAt).toUTCString()} · session id{' '}
          <span style={{ color: 'var(--s-gold-deep)' }}>{t.id}</span>
        </p>
      </section>

      {/* Theatre — interactive scrubber over the same 142-turn session.
          Sits above the static receipt so the headline is moving before
          the reader scrolls into the byte-level evidence. */}
      <section
        className="relative px-6 md:px-16 pb-4 max-w-5xl mx-auto"
        style={{ zIndex: 1 }}
      >
        <CompactionTheater />
      </section>

      {/* Setup */}
      <section className="relative px-6 md:px-16 py-12 max-w-5xl mx-auto" style={{ zIndex: 1, borderTop: '1px solid var(--s-vein)' }}>
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] mb-6" style={{ color: 'var(--s-gold-deep)' }}>
          <span className="mr-3" style={{ color: 'var(--s-gold)' }}>§ 001</span>
          The setup · turn {t.setupTurn.index}
        </p>
        <h2 className="font-serif text-2xl md:text-4xl leading-[1.15] mb-8 max-w-3xl" style={{ color: 'var(--s-ink)' }}>
          The decision that mattered.
        </h2>
        <TurnPanel
          turn={t.setupTurn}
          captionLeft="Roman, 10:42:51 UTC"
          captionRight="Spine captured this at write-time"
        />
      </section>

      {/* Compaction event */}
      <section className="relative px-6 md:px-16 py-12 max-w-5xl mx-auto" style={{ zIndex: 1, borderTop: '1px solid var(--s-vein)' }}>
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] mb-6" style={{ color: 'var(--s-gold-deep)' }}>
          <span className="mr-3" style={{ color: 'var(--s-gold)' }}>§ 002</span>
          Compaction · turn {t.compactionEvent.turn}
        </p>
        <h2 className="font-serif text-2xl md:text-4xl leading-[1.15] mb-8 max-w-3xl" style={{ color: 'var(--s-ink)' }}>
          81 turns later, the model folded.
        </h2>
        <div
          className="rounded-xl p-6 md:p-8"
          style={{
            background: 'linear-gradient(180deg, #fdfaf2 0%, #f5ecd4 100%)',
            border: '1px solid var(--s-vein-strong)',
            boxShadow: 'var(--s-shadow-1)',
          }}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] mb-3" style={{ color: 'var(--s-gold-deep)' }}>
            Compaction notice (verbatim)
          </p>
          <p className="font-serif text-base md:text-lg leading-relaxed italic" style={{ color: 'var(--s-ink-strong)' }}>
            {t.compactionEvent.summary}
          </p>
        </div>
        <p className="mt-6 max-w-3xl leading-relaxed" style={{ color: 'var(--s-ink-soft)' }}>
          The summary kept the topic. The summary lost the specifics — the
          single line that said <em className="italic" style={{ color: 'var(--s-gold-deep)' }}>path-validator at every fs call, not just on dispatch</em>.
          That line was the architectural decision. Without it, the next forty
          turns drifted off the original constraint.
        </p>
      </section>

      {/* The ask + Claude's failure */}
      <section className="relative px-6 md:px-16 py-12 max-w-5xl mx-auto" style={{ zIndex: 1, borderTop: '1px solid var(--s-vein)' }}>
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] mb-6" style={{ color: 'var(--s-gold-deep)' }}>
          <span className="mr-3" style={{ color: 'var(--s-gold)' }}>§ 003</span>
          The ask · turn {t.postCompactionAsk.index}
        </p>
        <h2 className="font-serif text-2xl md:text-4xl leading-[1.15] mb-8 max-w-3xl" style={{ color: 'var(--s-ink)' }}>
          We asked Claude to reconstruct it.
        </h2>
        <div className="grid md:grid-cols-2 gap-5">
          <Card label="Roman, post-compaction prompt" tone="neutral">
            <p className="font-serif text-base leading-relaxed" style={{ color: 'var(--s-ink)' }}>
              {t.postCompactionAsk.text}
            </p>
            <p className="mt-4 font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--s-ink-ghost)' }}>
              {new Date(t.postCompactionAsk.ts).toUTCString()}
            </p>
          </Card>
          <Card label="Claude's response (no Spine)" tone="warn">
            <p className="font-serif text-base leading-relaxed" style={{ color: 'var(--s-ink-strong)' }}>
              {t.claudePostCompactionResponse}
            </p>
            <p className="mt-4 font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--s-amber-warm)' }}>
              the summary kept the topic, lost the line
            </p>
          </Card>
        </div>
      </section>

      {/* Spine recall — the receipt */}
      <section className="relative px-6 md:px-16 py-12 max-w-5xl mx-auto" style={{ zIndex: 1, borderTop: '1px solid var(--s-vein)' }}>
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] mb-6" style={{ color: 'var(--s-gold-deep)' }}>
          <span className="mr-3" style={{ color: 'var(--s-gold)' }}>§ 004</span>
          The recall · {t.spineRecall.latencyMs}ms
        </p>
        <h2 className="font-serif text-2xl md:text-4xl leading-[1.15] mb-8 max-w-3xl" style={{ color: 'var(--s-ink)' }}>
          Then we asked Spine.
        </h2>

        <div
          className="rounded-xl p-6 md:p-8 mb-6"
          style={{
            background: 'linear-gradient(180deg, #fdfaf2 0%, #f5ecd4 100%)',
            border: '1px solid var(--s-vein-strong)',
            boxShadow: 'var(--s-shadow-1)',
          }}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] mb-3" style={{ color: 'var(--s-gold-deep)' }}>
            Query
          </p>
          <p className="font-mono text-[14px] md:text-[15px] leading-relaxed" style={{ color: 'var(--s-ink)' }}>
            spine_recall(
            <span style={{ color: 'var(--s-gold-deep)' }}>&quot;{t.spineRecall.query}&quot;</span>
            )
          </p>
          <p className="mt-3 font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--s-ink-faint)' }}>
            returned in {t.spineRecall.latencyMs}ms · 1 fragment
          </p>
        </div>

        <Card label={`Fragment · ${fragment.id}`} tone="amber">
          <p className="font-serif text-base md:text-lg leading-relaxed" style={{ color: 'var(--s-ink)' }}>
            {fragment.content}
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {fragment.matchedTags.map((tag) => (
              <span
                key={tag}
                className="font-mono text-[10px] uppercase tracking-widest px-2 py-1 rounded"
                style={{
                  border: '1px solid var(--s-vein-strong)',
                  color: 'var(--s-gold-deep)',
                  background: 'rgba(255, 253, 247, 0.65)',
                }}
              >
                {tag}
              </span>
            ))}
          </div>
          <p className="mt-5 font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--s-ink-ghost)' }}>
            stored {new Date(fragment.createdAt).toUTCString()} · {Math.round(
              (Date.parse(t.postCompactionAsk.ts) - Date.parse(fragment.createdAt)) / 1000 / 60
            )} minutes before the recall
          </p>
        </Card>

        <p className="mt-8 max-w-3xl leading-relaxed" style={{ color: 'var(--s-ink-soft)' }}>
          The fragment text is byte-identical to turn 3. No paraphrase, no
          summary, no &ldquo;based on what I remember.&rdquo; Spine writes
          append-only at capture-time, retrieves at query-time, and the model
          gets the original line back as system context — even after compaction
          has erased it from the conversation.
        </p>
      </section>

      {/* Method */}
      <section className="relative px-6 md:px-16 py-12 max-w-5xl mx-auto" style={{ zIndex: 1, borderTop: '1px solid var(--s-vein)' }}>
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] mb-6" style={{ color: 'var(--s-gold-deep)' }}>
          <span className="mr-3" style={{ color: 'var(--s-gold)' }}>§ 005</span>
          Method · how this was captured
        </p>
        <h2 className="font-serif text-2xl md:text-4xl leading-[1.15] mb-8 max-w-3xl" style={{ color: 'var(--s-ink)' }}>
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
                  <code className="font-mono text-[12px]" style={{ color: 'var(--s-gold-deep)' }}>capture-turn</code>{' '}
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
                  <code className="font-mono text-[12px]" style={{ color: 'var(--s-gold-deep)' }}>compact_boundary</code>{' '}
                  event, Spine&rsquo;s{' '}
                  <code className="font-mono text-[12px]" style={{ color: 'var(--s-gold-deep)' }}>hook-stop</code>{' '}
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
                  <code className="font-mono text-[12px]" style={{ color: 'var(--s-gold-deep)' }}>spine_recall</code>{' '}
                  surfaces the top fragments by fused score; the MCP injects
                  them into the next prompt as system context. Latency above is
                  the wall-clock <code className="font-mono text-[12px]" style={{ color: 'var(--s-gold-deep)' }}>/api/recall</code> round-trip.
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
              className="grid grid-cols-[40px,1fr] md:grid-cols-[60px,1fr] gap-4 md:gap-10 py-4"
              style={{ borderBottom: '1px solid var(--s-vein)' }}
            >
              <span className="font-mono text-[11px] md:pt-1" style={{ color: 'var(--s-gold-deep)' }}>{s.n}</span>
              <div>
                <p className="font-serif text-xl md:text-2xl mb-2" style={{ color: 'var(--s-ink)' }}>{s.title}</p>
                <p className="leading-relaxed text-[15px]" style={{ color: 'var(--s-ink-soft)' }}>{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* Honest scope */}
      <section className="relative px-6 md:px-16 py-12 max-w-5xl mx-auto" style={{ zIndex: 1, borderTop: '1px solid var(--s-vein)' }}>
        <div className="max-w-3xl pl-5 md:pl-7" style={{ borderLeft: '2px solid var(--s-vein-strong)' }}>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] mb-4" style={{ color: 'var(--s-gold-deep)' }}>
            § 006 · Honest scope
          </p>
          <p className="font-serif italic text-xl md:text-2xl leading-snug mb-4" style={{ color: 'var(--s-ink-strong)' }}>
            &ldquo;One captured session, not a benchmark.&rdquo;
          </p>
          <p className="text-[15px] leading-relaxed" style={{ color: 'var(--s-ink-soft)' }}>
            This page shows a single dogfooded capture. We&rsquo;re recording
            more across our team and will roll up a per-week aggregate
            (compaction events caught / fragments recalled / median fragment
            age) into the public benchmark page once the volume is meaningful.
            For per-recall quality numbers across the seeded harness corpus,
            see{' '}
            <Link
              href="/proof"
              className="underline underline-offset-4 transition-colors duration-300"
              style={{ color: 'var(--s-gold-deep)', textDecorationColor: 'var(--s-vein-strong)' }}
            >
              the proof page
            </Link>
            .
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="relative px-6 md:px-16 py-16 max-w-5xl mx-auto" style={{ zIndex: 1, borderTop: '1px solid var(--s-vein)' }}>
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div>
            <p className="font-serif text-2xl md:text-3xl leading-tight" style={{ color: 'var(--s-ink)' }}>
              Most AI compacts.
              <br />
              <em className="italic" style={{ color: 'var(--s-gold-deep)' }}>Spine doesn&rsquo;t.</em>
            </p>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--s-ink-faint)' }}>
              Append-only · One corpus · Every AI · Forever
            </p>
          </div>
          <Link
            href="/login?signup=1"
            className="group inline-flex items-center gap-3 px-7 py-3.5 transition-all duration-500 rounded-md"
            style={{
              background: 'linear-gradient(180deg, #fdfaf2 0%, #f0e3c4 100%)',
              color: 'var(--s-ink-strong)',
              border: '1px solid var(--s-vein-strong)',
              boxShadow: '0 2px 6px rgba(60,45,20,0.10), inset 0 1px 0 rgba(255,255,255,0.6)',
            }}
          >
            <span className="font-serif text-lg">Install in 30 seconds</span>
            <span className="font-mono transition-transform duration-500 group-hover:translate-x-1" style={{ color: 'var(--s-gold-deep)' }}>→</span>
          </Link>
        </div>
      </section>

      <MarketingFooter />
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
    <div
      className="rounded-xl p-6 md:p-8"
      style={{
        background: 'linear-gradient(180deg, #ffffff 0%, #fdfaf2 100%)',
        border: '1px solid var(--s-vein)',
        boxShadow: 'var(--s-shadow-1)',
      }}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] mb-3" style={{ color: 'var(--s-ink-faint)' }}>
        Turn {turn.index} · {turn.role}
      </p>
      <p className="font-serif text-base md:text-lg leading-relaxed" style={{ color: 'var(--s-ink)' }}>
        {turn.text}
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--s-ink-faint)' }}>
          {captionLeft}
        </span>
        {turn.capturedBySpine && (
          <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: 'var(--s-gold-deep)' }}>
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
  const cardStyle =
    tone === 'amber'
      ? {
          background: 'linear-gradient(180deg, #fdfaf2 0%, #f5ecd4 100%)',
          border: '1px solid var(--s-vein-strong)',
          boxShadow: 'var(--s-shadow-1)',
        }
      : tone === 'warn'
      ? {
          background: 'rgba(201, 125, 59, 0.08)',
          border: '1px solid var(--s-vein-strong)',
        }
      : {
          background: 'linear-gradient(180deg, #ffffff 0%, #fdfaf2 100%)',
          border: '1px solid var(--s-vein)',
          boxShadow: 'var(--s-shadow-1)',
        };
  return (
    <div className="rounded-xl p-6 md:p-7" style={cardStyle}>
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] mb-3" style={{ color: 'var(--s-ink-faint)' }}>
        {label}
      </p>
      {children}
    </div>
  );
}
