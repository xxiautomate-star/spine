'use client';

// CompactionTheater — the headline thesis as a moving picture.
//
// Two stacked context strips replay the same 142-turn session.
//   Claude (top)  — turns 1-83 collapse into a "summary" block at turn 84.
//                   The model literally loses the bytes of turn 3.
//   Spine (bottom) — append-only. Turn 3 stays sharp through every turn.
//
// At turn 91 (the post-compaction ask) two panels reveal underneath:
// Claude can only paraphrase, Spine returns the original line verbatim.
//
// Auto-plays on mount, scrubber lets the reader stop at the moment of
// failure. No video, no external libs — keyframes + state.

import { useEffect, useMemo, useRef, useState } from 'react';

const SESSION_LENGTH = 142;
const COMPACT_TURN = 84;
const ASK_TURN = 91;
const SETUP_TURN = 3;

const TURN_3_TEXT =
  "Lock the worker-supervisor cwd to the agent's sandbox folder. Use a path-validator at every fs call, not just on dispatch. The supervisor is the trust boundary.";

const COMPACTION_SUMMARY =
  "Earlier we discussed: setting up agent isolation; building a worker fleet; folder permissions. Continuing from your most recent message…";

const CLAUDE_VAGUE =
  "I don't have the exact text of turn 3 anymore — my earlier context was summarised to fit the window. From the summary I have: agent isolation and folder permissions in general terms.";

// ms per turn during auto-play. Two pauses are layered on top.
const TURN_TICK_MS = 80;
const COMPACT_PAUSE_MS = 1600;
const ASK_PAUSE_MS = 2400;

export type CompactionTheaterProps = {
  /**
   * When true, the auto-play stops at turn=SESSION_LENGTH instead of
   * looping back to turn=1 after a short pause. Used for screen-recording
   * (Loom, ads creative) where a rewind in the middle of a take ruins
   * the shot. Pair with the embed-mode page so the user can record one
   * clean run-through without the looping animation.
   */
  playOnce?: boolean;
};

export function CompactionTheater({ playOnce = false }: CompactionTheaterProps = {}) {
  const [turn, setTurn] = useState(1);
  const [playing, setPlaying] = useState(true);
  const [hasInteracted, setHasInteracted] = useState(false);
  const tickRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-play loop with two narrative pauses.
  useEffect(() => {
    if (!playing) return;
    if (turn >= SESSION_LENGTH) {
      // Play-once: stop at the end. Recording-friendly — no auto-rewind
      // mid-take. The user can scrub manually if they want a second pass.
      if (playOnce) {
        setPlaying(false);
        return;
      }
      tickRef.current = setTimeout(() => setTurn(1), 2000);
      return () => {
        if (tickRef.current) clearTimeout(tickRef.current);
      };
    }
    const isCompactBeat = turn === COMPACT_TURN;
    const isAskBeat = turn === ASK_TURN;
    const delay = isCompactBeat
      ? COMPACT_PAUSE_MS
      : isAskBeat
      ? ASK_PAUSE_MS
      : TURN_TICK_MS;
    tickRef.current = setTimeout(() => setTurn((t) => t + 1), delay);
    return () => {
      if (tickRef.current) clearTimeout(tickRef.current);
    };
  }, [turn, playing, playOnce]);

  const compacted = turn > COMPACT_TURN;
  const askReached = turn >= ASK_TURN;

  const handleScrub = (next: number) => {
    if (!hasInteracted) setHasInteracted(true);
    setPlaying(false);
    setTurn(Math.max(1, Math.min(SESSION_LENGTH, Math.round(next))));
  };

  const togglePlay = () => {
    if (!hasInteracted) setHasInteracted(true);
    setPlaying((p) => !p);
  };

  return (
    <div
      className="rounded-2xl px-5 py-7 md:px-9 md:py-10"
      style={{
        background: 'linear-gradient(180deg, #fdfaf2 0%, #f5ecd4 100%)',
        border: '1px solid var(--s-vein-strong)',
        boxShadow: 'var(--s-shadow-2)',
      }}
    >
      {/* Title row + scene state */}
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div>
          <p
            className="font-mono text-[10px] uppercase tracking-[0.28em] mb-2"
            style={{ color: 'var(--s-gold-deep)' }}
          >
            Live theatre · scrub or watch
          </p>
          <p
            className="font-serif italic text-xl md:text-2xl leading-tight"
            style={{ color: 'var(--s-ink-strong)' }}
          >
            One session. Two memories.
          </p>
        </div>
        <div
          className="flex items-center gap-3 font-mono text-[11px]"
          style={{ color: 'var(--s-ink-soft)' }}
        >
          <span aria-live="polite" suppressHydrationWarning>
            turn {String(turn).padStart(3, '0')} / {SESSION_LENGTH}
          </span>
          <button
            type="button"
            onClick={togglePlay}
            className="px-3 py-1 rounded transition-colors duration-300"
            style={{
              border: '1px solid var(--s-vein-strong)',
              color: 'var(--s-gold-deep)',
              background: 'rgba(255,253,247,0.7)',
            }}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? 'pause' : 'play'}
          </button>
        </div>
      </div>

      {/* Claude strip */}
      <ContextStrip
        title="Claude's context"
        subtitle="window-bounded · forgets to fit"
        turn={turn}
        compacted={compacted}
        canForget
      />

      {/* Spine strip */}
      <div className="mt-6">
        <ContextStrip
          title="Spine's archive"
          subtitle="append-only · never compacted"
          turn={turn}
          compacted={compacted}
          canForget={false}
        />
      </div>

      {/* Scrubber */}
      <div className="mt-7">
        <input
          type="range"
          min={1}
          max={SESSION_LENGTH}
          value={turn}
          onChange={(e) => handleScrub(Number(e.target.value))}
          className="w-full compaction-scrubber"
          aria-label="Scrub session turn"
        />
        <div
          className="mt-2 flex justify-between font-mono text-[9px] uppercase tracking-widest"
          style={{ color: 'var(--s-ink-faint)' }}
        >
          <span>turn 1</span>
          <span style={{ color: 'var(--s-gold-deep)' }}>
            turn {COMPACT_TURN} · compaction
          </span>
          <span>turn {SESSION_LENGTH}</span>
        </div>
      </div>

      {/* Reveal panels — only when ask has been reached */}
      <div
        className="grid md:grid-cols-2 gap-4 mt-7 transition-all duration-700"
        style={{
          opacity: askReached ? 1 : 0,
          transform: askReached ? 'translateY(0)' : 'translateY(8px)',
          pointerEvents: askReached ? 'auto' : 'none',
        }}
      >
        <RevealCard
          label={`Claude · turn ${ASK_TURN} response`}
          tone="warn"
          mono={false}
        >
          <p className="font-serif text-[15px] leading-relaxed">{CLAUDE_VAGUE}</p>
          <p
            className="mt-3 font-mono text-[10px] uppercase tracking-widest"
            style={{ color: 'var(--s-amber-warm)' }}
          >
            paraphrase from summary · turn 3 lost
          </p>
        </RevealCard>
        <RevealCard
          label={`Spine · spine_recall(…) · 187ms`}
          tone="amber"
          mono={false}
        >
          <p className="font-serif text-[15px] leading-relaxed">{TURN_3_TEXT}</p>
          <p
            className="mt-3 font-mono text-[10px] uppercase tracking-widest"
            style={{ color: 'var(--s-gold-deep)' }}
          >
            byte-identical to turn 3 · stored at write-time
          </p>
        </RevealCard>
      </div>

      <style jsx>{`
        .compaction-scrubber {
          appearance: none;
          height: 4px;
          background: linear-gradient(
            to right,
            var(--s-gold) 0%,
            var(--s-gold) ${(turn / SESSION_LENGTH) * 100}%,
            var(--s-vein) ${(turn / SESSION_LENGTH) * 100}%,
            var(--s-vein) 100%
          );
          border-radius: 999px;
          outline: none;
        }
        .compaction-scrubber::-webkit-slider-thumb {
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 999px;
          background: var(--s-gold-deep);
          border: 2px solid #fdfaf2;
          box-shadow: 0 1px 4px rgba(60, 45, 20, 0.25);
          cursor: pointer;
        }
        .compaction-scrubber::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 999px;
          background: var(--s-gold-deep);
          border: 2px solid #fdfaf2;
          box-shadow: 0 1px 4px rgba(60, 45, 20, 0.25);
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}

// Single horizontal strip rendering the 142 turns as thin bars. The
// visual cue for compaction is the left segment dissolving into a
// single textured "summary" block.
function ContextStrip({
  title,
  subtitle,
  turn,
  compacted,
  canForget,
}: {
  title: string;
  subtitle: string;
  turn: number;
  compacted: boolean;
  canForget: boolean;
}) {
  const bars = useMemo(() => {
    return Array.from({ length: SESSION_LENGTH }, (_, i) => i + 1);
  }, []);

  // Whether each bar is "in the window" right now.
  const inWindow = (n: number) => n <= turn;

  // For Claude: bars 1..83 disappear once compaction has fired (turn>84).
  // For Spine: every bar that has been written stays.
  const isCompactedBar = (n: number) =>
    canForget && compacted && n < COMPACT_TURN;

  return (
    <div
      className="rounded-xl px-4 py-4 md:px-6 md:py-5"
      style={{
        background:
          'linear-gradient(180deg, rgba(255,255,255,0.65) 0%, rgba(253,250,242,0.85) 100%)',
        border: '1px solid var(--s-vein)',
      }}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <p
          className="font-serif text-base md:text-lg"
          style={{ color: 'var(--s-ink)' }}
        >
          {title}
        </p>
        <p
          className="font-mono text-[10px] uppercase tracking-[0.22em]"
          style={{
            color: canForget ? 'var(--s-amber-warm)' : 'var(--s-gold-deep)',
          }}
        >
          {subtitle}
        </p>
      </div>

      {/* The strip itself */}
      <div
        className="relative h-[68px] md:h-[80px] rounded-md overflow-hidden"
        style={{
          background: 'rgba(60,45,20,0.045)',
          border: '1px solid var(--s-vein)',
        }}
      >
        {/* Compaction summary block — only on Claude strip after turn 84 */}
        {canForget && compacted && (
          <div
            className="absolute inset-y-1 left-1 z-10 rounded flex items-center px-3"
            style={{
              width: `${(COMPACT_TURN / SESSION_LENGTH) * 100}%`,
              background:
                'repeating-linear-gradient(135deg, rgba(201,125,59,0.22) 0 6px, rgba(201,125,59,0.10) 6px 12px)',
              border: '1px dashed var(--s-amber-warm)',
              animation: 'compaction-fold 600ms ease-out',
            }}
          >
            <p
              className="font-mono text-[10px] uppercase tracking-[0.2em] truncate"
              style={{ color: 'var(--s-amber-warm)' }}
            >
              ◇ summary · turns 1–{COMPACT_TURN - 1} folded
            </p>
          </div>
        )}

        {/* Per-turn bars */}
        <div className="absolute inset-0 flex items-stretch px-1 gap-[1px]">
          {bars.map((n) => {
            const active = inWindow(n);
            const isSetup = n === SETUP_TURN;
            const isAsk = n === ASK_TURN;
            const isCompactPoint = n === COMPACT_TURN;
            const folded = isCompactedBar(n);

            const baseColor = folded
              ? 'transparent'
              : active
              ? isSetup
                ? 'var(--s-gold-deep)'
                : isAsk
                ? 'var(--s-amber-warm)'
                : isCompactPoint
                ? 'var(--s-amber-warm)'
                : 'rgba(60,45,20,0.55)'
              : 'rgba(60,45,20,0.10)';

            const heightPct = isSetup || isAsk ? 92 : isCompactPoint ? 100 : 70;
            const opacity = folded ? 0 : 1;

            return (
              <div
                key={n}
                className="flex-1 self-center transition-all duration-500"
                style={{
                  height: `${heightPct}%`,
                  background: baseColor,
                  opacity,
                  boxShadow:
                    isSetup && active
                      ? '0 0 6px rgba(140,103,42,0.55)'
                      : 'none',
                }}
                title={
                  isSetup
                    ? `turn ${n} — the decision`
                    : isCompactPoint
                    ? `turn ${n} — compaction`
                    : isAsk
                    ? `turn ${n} — the ask`
                    : `turn ${n}`
                }
              />
            );
          })}
        </div>

        {/* Playhead */}
        <div
          aria-hidden
          className="absolute top-0 bottom-0 transition-all duration-200"
          style={{
            left: `${(turn / SESSION_LENGTH) * 100}%`,
            width: 2,
            background: 'var(--s-gold-deep)',
            boxShadow: '0 0 8px rgba(140,103,42,0.6)',
          }}
        />
      </div>

      {/* Footer captions: turn-3 truth on each strip */}
      <div className="mt-3 flex items-center justify-between gap-3">
        <p
          className="font-mono text-[10px] uppercase tracking-widest"
          style={{ color: 'var(--s-ink-faint)' }}
        >
          turn 3 ·
          <span
            className="ml-1 transition-colors duration-500"
            style={{
              color: canForget && compacted ? 'var(--s-amber-warm)' : 'var(--s-gold-deep)',
            }}
          >
            {canForget && compacted ? 'lost (folded into summary)' : 'present, verbatim'}
          </span>
        </p>
        {canForget && compacted ? (
          <p
            className="font-serif italic text-[12px] md:text-[13px] truncate max-w-[58%]"
            style={{ color: 'var(--s-amber-warm)' }}
            title={COMPACTION_SUMMARY}
          >
            “{COMPACTION_SUMMARY}”
          </p>
        ) : (
          <p
            className="font-serif italic text-[12px] md:text-[13px] truncate max-w-[58%]"
            style={{ color: 'var(--s-ink-soft)' }}
            title={TURN_3_TEXT}
          >
            “{TURN_3_TEXT}”
          </p>
        )}
      </div>

      <style jsx>{`
        @keyframes compaction-fold {
          from {
            opacity: 0;
            transform: scaleX(1.04);
          }
          to {
            opacity: 1;
            transform: scaleX(1);
          }
        }
      `}</style>
    </div>
  );
}

function RevealCard({
  label,
  tone,
  mono,
  children,
}: {
  label: string;
  tone: 'warn' | 'amber';
  mono: boolean;
  children: React.ReactNode;
}) {
  const style =
    tone === 'amber'
      ? {
          background: 'linear-gradient(180deg, #fdfaf2 0%, #f5ecd4 100%)',
          border: '1px solid var(--s-vein-strong)',
          boxShadow: 'var(--s-shadow-1)',
        }
      : {
          background: 'rgba(201, 125, 59, 0.08)',
          border: '1px solid var(--s-vein-strong)',
        };
  return (
    <div className="rounded-xl p-5 md:p-6" style={style}>
      <p
        className="font-mono text-[10px] uppercase tracking-[0.22em] mb-3"
        style={{ color: 'var(--s-ink-faint)' }}
      >
        {label}
      </p>
      <div
        className={mono ? 'font-mono' : ''}
        style={{ color: 'var(--s-ink)' }}
      >
        {children}
      </div>
    </div>
  );
}
