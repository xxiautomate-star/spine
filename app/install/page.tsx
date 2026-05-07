'use client';

import Link from 'next/link';
import { useState, useEffect } from 'react';

const ONE_LINER_NO_KEY = 'npx -y spine-mcp init';
const ONE_LINER_LOCAL  = 'npx -y spine-mcp init --local';
const MCP_SNIPPET = `{
  "mcpServers": {
    "spine": {
      "command": "npx",
      "args": ["-y", "spine-mcp", "serve"]
    }
  },
  "hooks": {
    "Stop":              [{ "matcher": "", "hooks": [{ "type": "command", "command": "npx spine-mcp hook-stop" }] }],
    "UserPromptSubmit":  [{ "matcher": "", "hooks": [{ "type": "command", "command": "npx spine-mcp inject" }] }]
  }
}`;

// ── Step indicator ────────────────────────────────────────────────────────

function StepDot({ n, active, done }: { n: number; active: boolean; done: boolean }) {
  return (
    <div className={`w-8 h-8 rounded-full border flex items-center justify-center font-mono text-[12px] flex-shrink-0 transition-all duration-500 ${
      done
        ? 'border-amber bg-amber text-night'
        : active
        ? 'border-amber/60 bg-amber/10 text-amber'
        : 'border-cream/15 text-cream/30'
    }`}>
      {done ? '✓' : n}
    </div>
  );
}

function StepConnector({ done }: { done: boolean }) {
  return (
    <div className={`w-px h-8 transition-all duration-700 ${done ? 'bg-amber/40' : 'bg-cream/10'}`} />
  );
}

// ── Steps ────────────────────────────────────────────────────────────────

function Step1({ onNext }: { onNext: () => void }) {
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [copiedLocal, setCopiedLocal] = useState(false);
  const [copiedJson, setCopiedJson] = useState(false);
  const [showManual, setShowManual] = useState(false);

  function copy(text: string, setter: (b: boolean) => void) {
    navigator.clipboard.writeText(text).then(() => {
      setter(true);
      setTimeout(() => setter(false), 2000);
    }).catch(() => void 0);
  }

  return (
    <div className="space-y-6">
      <div>
        {/* THE ONE-LINER — leads everything */}
        <div className="border border-amber/30 rounded-xl p-5 mb-4 bg-amber/[0.03]">
          <div className="flex items-start gap-4 mb-4">
            <div className="w-9 h-9 rounded-lg bg-amber/15 border border-amber/30 flex items-center justify-center flex-shrink-0">
              <span className="font-mono text-amber text-[13px]">MCP</span>
            </div>
            <div>
              <h3 className="text-cream text-[15px] font-medium mb-0.5">Claude Code &middot; one command</h3>
              <p className="text-cream/45 text-[13px]">
                Auto-registers the server and the capture+inject hooks. ~30 seconds.
              </p>
            </div>
          </div>

          <div className="relative mb-3">
            <pre className="bg-cream/[0.05] border border-cream/[0.10] rounded-lg px-4 py-4 font-mono text-[13px] text-cream overflow-x-auto">
              {ONE_LINER_NO_KEY}
            </pre>
            <button
              onClick={() => copy(ONE_LINER_NO_KEY, setCopiedCmd)}
              className={`absolute top-2.5 right-2.5 font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 rounded border transition-all duration-200 ${
                copiedCmd
                  ? 'border-emerald-400/40 text-emerald-400 bg-emerald-400/10'
                  : 'border-cream/10 text-cream/40 hover:text-cream/70 hover:border-cream/20'
              }`}
            >
              {copiedCmd ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
          <p className="font-mono text-[10px] text-cream/30">
            You&apos;ll be asked for an API key (you mint one in step 2) or pick local-only mode.
            Restart Claude Code afterwards.
          </p>
        </div>

        {/* Local-only shortcut */}
        <div className="border border-cream/[0.08] rounded-xl p-5 mb-4">
          <div className="flex items-start gap-4 mb-3">
            <div className="w-9 h-9 rounded-lg bg-cream/[0.04] border border-cream/[0.08] flex items-center justify-center flex-shrink-0">
              <span className="text-cream/60 text-[15px]" aria-hidden>⌘</span>
            </div>
            <div>
              <h3 className="text-cream text-[15px] font-medium mb-0.5">Local-only · no account</h3>
              <p className="text-cream/45 text-[13px]">
                Memories live in <code className="font-mono text-[12px] text-amber/70">~/.spine/memories.db</code>. Skip step 2 entirely.
              </p>
            </div>
          </div>

          <div className="relative">
            <pre className="bg-cream/[0.03] border border-cream/[0.08] rounded-lg px-4 py-3 font-mono text-[12px] text-cream/80 overflow-x-auto">
              {ONE_LINER_LOCAL}
            </pre>
            <button
              onClick={() => copy(ONE_LINER_LOCAL, setCopiedLocal)}
              className={`absolute top-2 right-2 font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 rounded border transition-all duration-200 ${
                copiedLocal
                  ? 'border-emerald-400/40 text-emerald-400 bg-emerald-400/10'
                  : 'border-cream/10 text-cream/40 hover:text-cream/70 hover:border-cream/20'
              }`}
            >
              {copiedLocal ? 'Copied ✓' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Chrome Extension */}
        <div className="border border-cream/[0.08] rounded-xl p-5 mb-4">
          <div className="flex items-start gap-4 mb-3">
            <div className="w-9 h-9 rounded-lg bg-amber/10 border border-amber/20 flex items-center justify-center flex-shrink-0">
              <span className="text-amber text-[16px]" aria-hidden>◎</span>
            </div>
            <div>
              <h3 className="text-cream text-[15px] font-medium mb-0.5">Chrome Extension <span className="text-cream/30 text-[12px] font-normal">(optional)</span></h3>
              <p className="text-cream/45 text-[13px]">For ChatGPT and Gemini capture in the browser. Stack with the MCP install above.</p>
            </div>
          </div>

          <div className="bg-cream/[0.03] border border-cream/[0.08] rounded-lg px-4 py-3">
            <p className="font-mono text-[11px] text-cream/35 mb-2">Dev mode install (until Chrome Web Store approval):</p>
            <ol className="space-y-1.5 text-[13px] text-cream/60">
              <li className="flex gap-2"><span className="text-amber/50 font-mono text-[10px] mt-[3px] flex-shrink-0">1.</span>Download and unzip the extension from your dashboard</li>
              <li className="flex gap-2"><span className="text-amber/50 font-mono text-[10px] mt-[3px] flex-shrink-0">2.</span>Open <code className="font-mono text-[12px] text-amber/70">chrome://extensions</code></li>
              <li className="flex gap-2"><span className="text-amber/50 font-mono text-[10px] mt-[3px] flex-shrink-0">3.</span>Enable <span className="text-cream">Developer mode</span> (top-right toggle)</li>
              <li className="flex gap-2"><span className="text-amber/50 font-mono text-[10px] mt-[3px] flex-shrink-0">4.</span>Click <span className="text-cream">Load unpacked</span> → select the unzipped folder</li>
            </ol>
          </div>
        </div>

        {/* Manual fallback for power users */}
        <button
          type="button"
          onClick={() => setShowManual((v) => !v)}
          className="font-mono text-[10px] uppercase tracking-widest text-cream/35 hover:text-amber transition-colors duration-300"
        >
          {showManual ? '— Hide manual config' : '+ Or paste it manually into ~/.claude/settings.json'}
        </button>

        {showManual && (
          <div className="mt-3 relative">
            <pre className="bg-cream/[0.04] border border-cream/[0.08] rounded-lg px-4 py-4 font-mono text-[11px] text-amber/80 overflow-x-auto whitespace-pre">
              {MCP_SNIPPET}
            </pre>
            <button
              onClick={() => copy(MCP_SNIPPET, setCopiedJson)}
              className={`absolute top-2.5 right-2.5 font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 rounded border transition-all duration-200 ${
                copiedJson
                  ? 'border-emerald-400/40 text-emerald-400 bg-emerald-400/10'
                  : 'border-cream/10 text-cream/40 hover:text-cream/70 hover:border-cream/20'
              }`}
            >
              {copiedJson ? 'Copied ✓' : 'Copy'}
            </button>
            <p className="font-mono text-[10px] text-cream/25 mt-2">
              Merge into <code className="text-cream/40">~/.claude/settings.json</code> then restart Claude Code.
            </p>
          </div>
        )}
      </div>

      <button
        onClick={onNext}
        className="w-full py-3.5 bg-amber text-night font-sans text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity"
      >
        I installed it — next step →
      </button>
    </div>
  );
}

function Step2({ onNext }: { onNext: () => void }) {
  return (
    <div className="space-y-6">
      <p className="text-cream/55 text-sm leading-relaxed">
        Cloud sync gives you cross-device recall, the dashboard, and the Chrome extension. Mint a
        key and the install command on the dashboard does the rest.
      </p>

      <div className="space-y-4">
        <div className="flex gap-3">
          <span className="font-mono text-[10px] text-amber/60 mt-1 flex-shrink-0">1.</span>
          <div>
            <p className="text-cream/75 text-sm mb-2">Mint a key from the dashboard.</p>
            <Link
              href="/dashboard/keys"
              target="_blank"
              className="inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-amber/70 hover:text-amber transition-colors duration-300 border-b border-amber/20 hover:border-amber/50 pb-[1px]"
            >
              Open dashboard/keys →
            </Link>
          </div>
        </div>

        <div className="flex gap-3">
          <span className="font-mono text-[10px] text-amber/60 mt-1 flex-shrink-0">2.</span>
          <div>
            <p className="text-cream/75 text-sm mb-2">
              Right after the key is shown, the dashboard prints a one-line install command with
              the key already filled in. Copy and paste into your terminal.
            </p>
            <div className="bg-cream/[0.03] border border-cream/[0.08] rounded-lg px-4 py-3 font-mono text-[12px] text-cream/60">
              npx -y spine-mcp init --key spine_live_<span className="text-cream/20">••••••••</span>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <span className="font-mono text-[10px] text-amber/60 mt-1 flex-shrink-0">3.</span>
          <div>
            <p className="text-cream/75 text-sm mb-2">
              Already have the Chrome extension? Open it once and paste the same key into the API
              Key field — that&apos;s how ChatGPT and Gemini conversations land in your archive.
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <span className="font-mono text-[10px] text-amber/60 mt-1 flex-shrink-0">4.</span>
          <p className="text-cream/75 text-sm">Restart Claude Code. Spine is live.</p>
        </div>
      </div>

      <button
        onClick={onNext}
        className="w-full py-3.5 bg-amber text-night font-sans text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity"
      >
        Key saved — next step →
      </button>
    </div>
  );
}

function Step3() {
  const [count, setCount] = useState<number | null>(null);

  // Poll memory count every 5 seconds to show live updates.
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch('/api/usage');
        if (!res.ok) return;
        const data = (await res.json()) as { memoryCount?: number };
        if (!cancelled && typeof data.memoryCount === 'number') {
          setCount(data.memoryCount);
        }
      } catch { /* offline */ }
    }

    void poll();
    const id = setInterval(() => void poll(), 5000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <div className="space-y-6">
      <p className="text-cream/55 text-sm leading-relaxed">
        Open Claude, ChatGPT, or Gemini. Have a real conversation. Then watch Spine capture it.
      </p>

      <div className="border border-cream/[0.08] rounded-xl p-5 text-center">
        <p className="font-mono text-[10px] uppercase tracking-widest text-cream/30 mb-3">
          Memories in your archive
        </p>
        <div className="font-serif text-[64px] leading-none text-cream mb-2 transition-all duration-700">
          {count === null ? '—' : count}
        </div>
        <p className="font-mono text-[10px] text-cream/25">
          {count === null ? 'connecting…' : count === 0 ? 'have a conversation to see the first one' : 'updating every 5s'}
        </p>
      </div>

      <div className="space-y-2">
        <Link
          href="/timeline"
          className="flex items-center justify-between w-full border border-cream/10 hover:border-amber/30 rounded-lg px-5 py-3.5 text-left transition-all duration-300 group"
        >
          <div>
            <p className="text-cream/80 text-sm font-medium">Open your Timeline</p>
            <p className="text-cream/35 text-[12px]">See all memories grouped by day</p>
          </div>
          <span className="text-amber/50 group-hover:text-amber transition-colors">→</span>
        </Link>
        <Link
          href="/ask"
          className="flex items-center justify-between w-full border border-cream/10 hover:border-amber/30 rounded-lg px-5 py-3.5 text-left transition-all duration-300 group"
        >
          <div>
            <p className="text-cream/80 text-sm font-medium">Ask your archive</p>
            <p className="text-cream/35 text-[12px]">Cross-AI semantic retrieval</p>
          </div>
          <span className="text-amber/50 group-hover:text-amber transition-colors">→</span>
        </Link>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function InstallPage() {
  const [step, setStep] = useState(1);

  const steps = [
    { n: 1, label: 'Install Spine' },
    { n: 2, label: 'Connect your account' },
    { n: 3, label: 'Watch it work' },
  ];

  return (
    <>
      {/* Atmosphere */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div className="absolute top-0 left-1/4 w-[600px] h-[600px] rounded-full bg-amber/[0.05] blur-[200px]" />
      </div>

      {/* Nav */}
      <header className="px-6 md:px-10 py-5 flex items-center justify-between border-b border-cream/[0.05]">
        <Link href="/" className="flex items-center gap-3">
          <span className="block w-[7px] h-[7px] rounded-full bg-amber ember" aria-hidden />
          <span className="font-serif text-xl text-cream">Spine</span>
        </Link>
        <Link href="/pricing" className="font-mono text-[10px] uppercase tracking-widest text-cream/35 hover:text-amber transition-colors">
          Pricing
        </Link>
      </header>

      <div className="min-h-[calc(100vh-73px)] flex items-start justify-center px-6 pt-12 pb-24">
        <div className="w-full max-w-lg">
          {/* Title */}
          <div className="mb-10 rise rise-1">
            <p className="font-mono text-[10px] uppercase tracking-widest text-amber/55 mb-3">Setup</p>
            <h1 className="font-serif text-4xl md:text-5xl text-cream leading-tight mb-3">
              Running in 3 minutes.
            </h1>
            <p className="text-cream/40 text-sm leading-relaxed">
              One install. Every AI conversation starts building your archive.
            </p>
          </div>

          {/* Step list */}
          <div className="flex gap-4 mb-10">
            {steps.map((s, i) => (
              <div key={s.n} className="flex items-center gap-2 flex-1">
                <button
                  onClick={() => step > s.n && setStep(s.n)}
                  className={`flex items-center gap-2 min-w-0 ${step > s.n ? 'cursor-pointer' : 'cursor-default'}`}
                >
                  <div className={`w-6 h-6 rounded-full border flex items-center justify-center font-mono text-[10px] flex-shrink-0 transition-all duration-500 ${
                    step > s.n
                      ? 'border-amber bg-amber text-night'
                      : step === s.n
                      ? 'border-amber/60 bg-amber/10 text-amber'
                      : 'border-cream/15 text-cream/25'
                  }`}>
                    {step > s.n ? '✓' : s.n}
                  </div>
                  <span className={`font-mono text-[10px] truncate transition-colors duration-300 ${
                    step === s.n ? 'text-cream/70' : step > s.n ? 'text-cream/40' : 'text-cream/20'
                  }`}>
                    {s.label}
                  </span>
                </button>
                {i < steps.length - 1 && (
                  <div className={`flex-1 h-px transition-all duration-500 ${step > s.n ? 'bg-amber/30' : 'bg-cream/10'}`} />
                )}
              </div>
            ))}
          </div>

          {/* Step content */}
          <div className="rise rise-2">
            <div className="mb-6">
              <h2 className="font-serif text-2xl text-cream mb-1">
                {step === 1 && 'Install the capture layer.'}
                {step === 2 && 'Connect your account.'}
                {step === 3 && 'Your first memories.'}
              </h2>
            </div>

            {step === 1 && <Step1 onNext={() => setStep(2)} />}
            {step === 2 && <Step2 onNext={() => setStep(3)} />}
            {step === 3 && <Step3 />}
          </div>
        </div>
      </div>
    </>
  );
}
