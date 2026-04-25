'use client';

import { useState, useEffect } from 'react';

// ── Animated mockup of the conflict HUD firing in claude.ai ───────────────────
// No real video needed — pure CSS keyframe choreography.

const SCENARIO = {
  messages: [
    {
      role: 'user',
      text: 'What payment processor are we using for the marketplace?',
      delay: 0,
    },
    {
      role: 'ai',
      text: 'Based on your previous sessions, you confirmed using Stripe Connect for the marketplace — set up in March.',
      delay: 1200,
    },
    {
      role: 'user',
      text: "Actually we switched to PayPal Payouts last week. Better fee structure.",
      delay: 2600,
    },
  ],
  hudDelay: 4400, // when the conflict HUD fires
  resetDelay: 11500,
};

type Phase =
  | 'idle'
  | 'msg0'
  | 'msg1'
  | 'msg2'
  | 'hud'
  | 'done';

export function ConflictHeroLoop() {
  const [phase, setPhase] = useState<Phase>('idle');

  useEffect(() => {
    let cancelled = false;
    async function run() {
      const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

      while (!cancelled) {
        setPhase('idle');
        await sleep(600);
        setPhase('msg0');
        await sleep(1200);
        if (cancelled) break;
        setPhase('msg1');
        await sleep(1400);
        if (cancelled) break;
        setPhase('msg2');
        await sleep(1800);
        if (cancelled) break;
        setPhase('hud');
        await sleep(5000);
        if (cancelled) break;
        setPhase('done');
        await sleep(1800);
      }
    }
    void run();
    return () => { cancelled = true; };
  }, []);

  const show = (p: Phase) => {
    const order: Phase[] = ['idle', 'msg0', 'msg1', 'msg2', 'hud', 'done'];
    return order.indexOf(phase) >= order.indexOf(p);
  };

  return (
    <div className="relative w-[440px] h-[500px] select-none">
      {/* Browser chrome frame */}
      <div className="absolute inset-0 rounded-2xl overflow-hidden border border-[#E8E4DD]/[0.1] bg-[#0a0908] shadow-[0_40px_100px_rgba(0,0,0,0.5)]">
        {/* Fake browser bar */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[#E8E4DD]/[0.06] bg-[#0c0b09]">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-[#FF5F57]/70" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#FEBC2E]/70" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#28C840]/70" />
          </div>
          <div className="flex-1 mx-3 px-3 py-1 rounded-md bg-[#E8E4DD]/[0.04] border border-[#E8E4DD]/[0.06]">
            <span className="font-mono text-[10px] text-[#E8E4DD]/25">claude.ai/new</span>
          </div>
        </div>

        {/* Fake claude.ai sidebar strip */}
        <div className="flex h-[calc(100%-38px)]">
          <div className="w-10 border-r border-[#E8E4DD]/[0.04] bg-[#0a0908] flex flex-col items-center pt-4 gap-3">
            <div className="w-5 h-5 rounded-full bg-[#E89A3C]/80" />
            <div className="w-4 h-0.5 rounded bg-[#E8E4DD]/10" />
            <div className="w-4 h-0.5 rounded bg-[#E8E4DD]/10" />
            <div className="w-4 h-0.5 rounded bg-[#E8E4DD]/10" />
          </div>

          {/* Chat area */}
          <div className="flex-1 flex flex-col px-5 pt-5 pb-4 gap-4 overflow-hidden relative">
            {/* Message 0 — user */}
            <div
              className="flex justify-end transition-all duration-500"
              style={{
                opacity: show('msg0') ? 1 : 0,
                transform: show('msg0') ? 'none' : 'translateY(8px)',
              }}
            >
              <div className="max-w-[80%] px-4 py-3 rounded-2xl rounded-tr-sm bg-[#2a2825] text-[#E8E4DD]/80 text-[12px] leading-relaxed">
                {SCENARIO.messages[0].text}
              </div>
            </div>

            {/* Message 1 — AI */}
            <div
              className="flex gap-3 transition-all duration-500"
              style={{
                opacity: show('msg1') ? 1 : 0,
                transform: show('msg1') ? 'none' : 'translateY(8px)',
              }}
            >
              <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#E89A3C]/60 to-[#4A5E7A]/60 flex-shrink-0 mt-1" />
              <div className="max-w-[85%] text-[#E8E4DD]/75 text-[12px] leading-relaxed">
                {SCENARIO.messages[1].text}
              </div>
            </div>

            {/* Message 2 — user */}
            <div
              className="flex justify-end transition-all duration-500"
              style={{
                opacity: show('msg2') ? 1 : 0,
                transform: show('msg2') ? 'none' : 'translateY(8px)',
              }}
            >
              <div className="max-w-[80%] px-4 py-3 rounded-2xl rounded-tr-sm bg-[#2a2825] text-[#E8E4DD]/80 text-[12px] leading-relaxed">
                {SCENARIO.messages[2].text}
              </div>
            </div>

            {/* Conflict HUD */}
            <div
              className="absolute top-4 right-3 w-[200px] transition-all duration-500"
              style={{
                opacity: show('hud') && phase !== 'done' ? 1 : 0,
                transform: show('hud') && phase !== 'done' ? 'none' : 'translateX(12px)',
              }}
            >
              <div className="bg-[#0D0C0A]/98 border border-[rgba(232,100,60,0.4)] rounded-xl p-3.5 shadow-[0_8px_40px_rgba(0,0,0,0.8)]">
                {/* Header */}
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-[5px] h-[5px] rounded-full bg-[#E8643C] flex-shrink-0" />
                  <p className="font-mono text-[8px] uppercase tracking-wider text-[#E8643C]">Memory conflict</p>
                  <div className="ml-auto w-3 h-3 rounded-full bg-[#E8E4DD]/[0.05] flex items-center justify-center">
                    <span className="text-[#E8E4DD]/30 text-[8px] leading-none">×</span>
                  </div>
                </div>

                {/* Entity */}
                <p className="text-[#E8E4DD]/40 text-[10px] mb-2.5 leading-snug">
                  Contradiction in <strong className="text-[#E8E4DD]/60">payment processor</strong>
                </p>

                {/* Before */}
                <div className="bg-[#E8E4DD]/[0.03] rounded-lg p-2.5 mb-2">
                  <p className="font-mono text-[7px] text-[#E8E4DD]/25 uppercase tracking-wider mb-1">Before</p>
                  <p className="text-[#E8E4DD]/55 text-[10px] leading-snug italic">
                    &ldquo;using Stripe Connect for marketplace&rdquo;
                  </p>
                </div>

                {/* Now */}
                <div className="bg-[#E8E4DD]/[0.03] rounded-lg p-2.5 mb-3">
                  <p className="font-mono text-[7px] text-[#E8E4DD]/25 uppercase tracking-wider mb-1">Now</p>
                  <p className="text-[#E8E4DD]/80 text-[10px] leading-snug italic">
                    &ldquo;switched to PayPal Payouts&rdquo;
                  </p>
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <button className="flex-1 font-mono text-[8px] uppercase tracking-wider text-[#E89A3C]/80 bg-[#E89A3C]/[0.08] border border-[#E89A3C]/20 rounded-md py-1.5 hover:bg-[#E89A3C]/[0.15] transition-colors">
                    Keep new →
                  </button>
                  <button className="font-mono text-[8px] text-[#E8E4DD]/25 px-2 py-1.5 hover:text-[#E8E4DD]/50 transition-colors">
                    Both
                  </button>
                </div>

                {/* Spine badge */}
                <p className="mt-2.5 font-mono text-[7px] text-[#E8E4DD]/15 text-right">spine · memory guard</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Ambient glow behind the mockup */}
      <div className="absolute inset-0 -z-10 rounded-2xl bg-[#E89A3C]/[0.06] blur-[60px] scale-110" />

      {/* Label */}
      <div className="absolute -bottom-8 left-0 right-0 flex items-center justify-center gap-2">
        <div className="w-1.5 h-1.5 rounded-full bg-[#E89A3C] animate-pulse" />
        <p className="font-mono text-[9px] uppercase tracking-widest text-[#E8E4DD]/25">
          Live conflict detection · firing now
        </p>
      </div>
    </div>
  );
}
