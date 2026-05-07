'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SetupData {
  org_id: string;
  user_email: string;
  api_key: string | null;
  key_created: boolean;
  memory_count: number;
}

type Step = 1 | 2 | 3;

// ── Helpers ───────────────────────────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={copy}
      className="font-mono text-[9px] uppercase tracking-widest text-cream/30 hover:text-amber transition-colors duration-200 border border-cream/[0.08] hover:border-amber/30 px-2.5 py-1 rounded"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function CodeLine({ children, copyValue }: { children: React.ReactNode; copyValue?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 bg-[#0a0905] border border-cream/[0.07] rounded-lg px-4 py-3">
      <code className="font-mono text-[13px] text-amber/80 flex-1 select-all">{children}</code>
      {copyValue && <CopyButton value={copyValue} />}
    </div>
  );
}

// 30-second Loom embed shown the first time a user lands on the success
// step ("Spine is awake."). Closes the "did it really work?" gap by
// showing the loop the user just completed — capture in Claude, recall
// pulled it back. The Loom ID is read from a public env var so Roman can
// swap the recording without a code change. If the env is unset, we
// render a styled placeholder rather than a broken iframe.
const LOOM_EMBED_ID = process.env.NEXT_PUBLIC_LOOM_FIRST_CAPTURE_ID ?? '';

function FirstCaptureLoom() {
  if (LOOM_EMBED_ID) {
    return (
      <div className="relative w-full overflow-hidden rounded-xl border border-cream/[0.08] bg-[#0a0905]" style={{ aspectRatio: '16 / 9' }}>
        <iframe
          src={`https://www.loom.com/embed/${LOOM_EMBED_ID}?hideEmbedTopBar=true&hide_speed=true&hide_share=true`}
          title="Spine — capture, then recall"
          allow="fullscreen"
          frameBorder={0}
          className="absolute inset-0 w-full h-full"
        />
      </div>
    );
  }
  // Placeholder — soft, clearly non-broken, sized exactly the same as
  // the live iframe will be so the layout never reflows when the env
  // var lands.
  return (
    <div
      className="relative w-full overflow-hidden rounded-xl border border-cream/[0.08] flex items-center justify-center"
      style={{
        aspectRatio: '16 / 9',
        background:
          'linear-gradient(180deg, rgba(232,154,60,0.04) 0%, rgba(13,12,10,0.6) 100%)',
      }}
    >
      <div className="text-center px-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-amber/55 mb-3">
          30-second walkthrough · arriving soon
        </p>
        <p className="font-serif text-cream/85 text-2xl leading-tight max-w-md mx-auto">
          Capture in Claude. Recall it back. The whole loop in half a minute.
        </p>
        <p className="mt-4 font-mono text-[10px] tracking-widest text-cream/30">
          (set NEXT_PUBLIC_LOOM_FIRST_CAPTURE_ID to embed)
        </p>
      </div>
    </div>
  );
}

function StepDot({ n, current }: { n: Step; current: Step }) {
  const done = n < current;
  const active = n === current;
  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center font-mono text-[10px] transition-all duration-500 ${
          done
            ? 'bg-amber text-night'
            : active
            ? 'border-2 border-amber text-amber'
            : 'border border-cream/[0.12] text-cream/25'
        }`}
      >
        {done ? '✓' : n}
      </div>
      <span
        className={`font-mono text-[10px] uppercase tracking-widest transition-colors duration-300 ${
          active ? 'text-cream/65' : done ? 'text-cream/35' : 'text-cream/20'
        }`}
      >
        {n === 1 ? 'Install MCP' : n === 2 ? 'Add Extension' : 'First capture'}
      </span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function OnboardingClient({ email }: { email: string }) {
  const [step, setStep] = useState<Step>(1);
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [captureCount, setCaptureCount] = useState(0);
  const [captured, setCaptured] = useState(false);
  const [pollActive, setPollActive] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Store API key in sessionStorage the moment we receive it
  useEffect(() => {
    fetch('/api/onboarding/setup')
      .then((r) => r.json())
      .then((data: SetupData) => {
        setSetup(data);
        setCaptureCount(data.memory_count);
        if (data.api_key) {
          sessionStorage.setItem('spine_onboarding_key', data.api_key);
        }
      })
      .catch(() => null)
      .finally(() => setLoading(false));
  }, []);

  const storedKey = setup?.api_key ?? (typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('spine_onboarding_key') : null);

  // Poll for first capture on step 3
  const pollCaptures = useCallback(() => {
    if (pollRef.current) return;
    setPollActive(true);
    pollRef.current = setInterval(() => {
      fetch('/api/onboarding/setup')
        .then((r) => r.json())
        .then((data: SetupData) => {
          setCaptureCount(data.memory_count);
          if (data.memory_count > 0) {
            setCaptured(true);
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
          }
        })
        .catch(() => null);
    }, 3000);
  }, []);

  useEffect(() => {
    if (step === 3 && !captured) pollCaptures();
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [step, captured, pollCaptures]);

  const initCommand = `npx spine-mcp init`;
  const fullInitCommand = storedKey
    ? `SPINE_API_KEY=${storedKey} npx spine-mcp init`
    : initCommand;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0D0C0A] flex items-center justify-center">
        <div className="w-[7px] h-[7px] rounded-full bg-amber animate-pulse" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0D0C0A] text-[#E8E4DD] flex flex-col">
      {/* Header */}
      <header className="px-6 md:px-10 py-5 flex items-center justify-between border-b border-cream/[0.05]">
        <div className="flex items-center gap-3">
          <span className="block w-[7px] h-[7px] rounded-full bg-amber" />
          <span className="font-serif text-xl text-cream">Spine</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-[10px] text-cream/25 hidden sm:block">{email}</span>
          <Link href="/timeline" className="font-mono text-[10px] uppercase tracking-widest text-cream/30 hover:text-cream/60 transition-colors">
            Skip →
          </Link>
        </div>
      </header>

      {/* Progress */}
      <div className="px-6 md:px-10 py-6 border-b border-cream/[0.05]">
        <div className="max-w-2xl flex items-center gap-6 md:gap-10">
          {([1, 2, 3] as Step[]).map((n, i) => (
            <div key={n} className="flex items-center gap-3 md:gap-6">
              {i > 0 && <div className={`w-8 md:w-16 h-px ${n <= step ? 'bg-amber/40' : 'bg-cream/[0.08]'}`} />}
              <StepDot n={n} current={step} />
            </div>
          ))}
        </div>
      </div>

      {/* Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">
        <div className="w-full max-w-xl">
          {/* Step 1: MCP Install */}
          {step === 1 && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-amber/55 mb-6">Step 1 of 3</p>
              <h1 className="font-serif text-4xl text-cream leading-tight mb-4">
                Install the MCP server.
              </h1>
              <p className="text-cream/55 text-[15px] leading-relaxed mb-10">
                One command wires Spine into Claude Code, Claude Desktop, Cursor, and any other MCP-compatible AI.
                Your memories sync automatically after that.
              </p>

              {storedKey && (
                <div className="mb-6 p-4 border border-amber/20 rounded-xl bg-amber/[0.03]">
                  <p className="font-mono text-[9px] uppercase tracking-widest text-amber/55 mb-3">Your API key (shown once — save it)</p>
                  <div className="flex items-center justify-between gap-3">
                    <code className="font-mono text-[12px] text-amber break-all flex-1">
                      {apiKeyVisible ? storedKey : storedKey.slice(0, 18) + '••••••••••••••••••••'}
                    </code>
                    <div className="flex gap-2 flex-shrink-0">
                      <button
                        onClick={() => setApiKeyVisible(!apiKeyVisible)}
                        className="font-mono text-[9px] uppercase tracking-wider text-cream/30 hover:text-cream/60 transition-colors"
                      >
                        {apiKeyVisible ? 'Hide' : 'Show'}
                      </button>
                      <CopyButton value={storedKey} />
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-3 mb-10">
                <p className="font-mono text-[10px] text-cream/25 uppercase tracking-widest">Run in your terminal</p>
                <CodeLine copyValue={initCommand}>{initCommand}</CodeLine>
                <p className="font-mono text-[9px] text-cream/20">
                  When prompted for an API key, paste:{' '}
                  <code className="text-amber/50">{storedKey ? storedKey.slice(0, 20) + '…' : 'the key shown above'}</code>
                </p>
              </div>

              <div className="space-y-3 mb-10 text-[13px] text-cream/40">
                <p>
                  <span className="text-cream/60">What this does:</span> registers Spine as a local MCP server.
                  Claude Code will automatically call <code className="font-mono text-amber/50">spine_capture</code> to save facts and
                  <code className="font-mono text-amber/50"> get_context</code> at session start.
                </p>
                <p>
                  After running, restart Claude. New tools appear in the inspector:
                  <span className="text-cream/55 font-mono text-[12px]"> spine_capture, get_context, pin_memory, spine_recall</span>
                </p>
              </div>

              <button
                onClick={() => setStep(2)}
                className="group flex items-center gap-3 font-serif text-lg text-amber hover:text-cream transition-colors duration-300"
              >
                Done — continue to extension
                <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
              </button>
            </div>
          )}

          {/* Step 2: Extension */}
          {step === 2 && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-amber/55 mb-6">Step 2 of 3</p>
              <h1 className="font-serif text-4xl text-cream leading-tight mb-4">
                Install the browser extension.
              </h1>
              <p className="text-cream/55 text-[15px] leading-relaxed mb-10">
                The extension captures your Claude.ai, ChatGPT, and Gemini conversations automatically —
                no copy-paste. It also surfaces a context HUD when you start a new message on a familiar topic.
              </p>

              <div className="space-y-4 mb-10">
                {/* Chrome */}
                <a
                  href="https://chrome.google.com/webstore/detail/spine-memory-layer/pending"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-4 p-5 border border-cream/[0.1] rounded-xl hover:border-amber/30 hover:bg-amber/[0.02] transition-all duration-300"
                >
                  <div className="w-10 h-10 rounded-full bg-cream/[0.05] flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="rgba(232,228,221,0.4)" strokeWidth="1.5"/>
                      <circle cx="12" cy="12" r="4" fill="#E89A3C" opacity="0.8"/>
                      <path d="M12 8h8M7 16l-4 6M17 16l4 6" stroke="rgba(232,228,221,0.3)" strokeWidth="1.5" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-cream/80 font-medium text-[15px]">Chrome Web Store</p>
                    <p className="font-mono text-[10px] text-cream/30 mt-0.5">Chrome · Edge · Brave · Arc</p>
                  </div>
                  <span className="font-mono text-[10px] text-amber/50 group-hover:text-amber transition-colors">Install →</span>
                </a>

                {/* Firefox */}
                <a
                  href="https://addons.mozilla.org/en-US/firefox/addon/spine-memory-layer"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex items-center gap-4 p-5 border border-cream/[0.1] rounded-xl hover:border-amber/30 hover:bg-amber/[0.02] transition-all duration-300"
                >
                  <div className="w-10 h-10 rounded-full bg-cream/[0.05] flex items-center justify-center flex-shrink-0">
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="rgba(232,228,221,0.4)" strokeWidth="1.5"/>
                      <path d="M8 12c0-2.2 1.8-4 4-4" stroke="#E89A3C" strokeWidth="1.5" strokeLinecap="round" opacity="0.8"/>
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-cream/80 font-medium text-[15px]">Firefox Add-ons</p>
                    <p className="font-mono text-[10px] text-cream/30 mt-0.5">Firefox</p>
                  </div>
                  <span className="font-mono text-[10px] text-amber/50 group-hover:text-amber transition-colors">Install →</span>
                </a>
              </div>

              <div className="mb-10 p-4 bg-cream/[0.02] border border-cream/[0.06] rounded-xl text-[13px] text-cream/45 space-y-2">
                <p>After installing:</p>
                <ol className="list-decimal list-inside space-y-1.5 text-cream/35">
                  <li>Click the Spine icon in your toolbar</li>
                  <li>
                    Enter your API key:{' '}
                    <code className="font-mono text-amber/50 text-[11px]">
                      {storedKey ? storedKey.slice(0, 20) + '…' : 'from step 1'}
                    </code>
                  </li>
                  <li>Set server URL: <code className="font-mono text-amber/50 text-[11px]">https://spine.xxiautomate.com</code></li>
                </ol>
              </div>

              <div className="flex items-center gap-6">
                <button
                  onClick={() => setStep(3)}
                  className="group flex items-center gap-3 font-serif text-lg text-amber hover:text-cream transition-colors duration-300"
                >
                  Extension installed →
                </button>
                <button
                  onClick={() => setStep(3)}
                  className="font-mono text-[10px] uppercase tracking-wider text-cream/25 hover:text-cream/45 transition-colors"
                >
                  Skip for now
                </button>
              </div>
            </div>
          )}

          {/* Step 3: First capture */}
          {step === 3 && (
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-amber/55 mb-6">Step 3 of 3</p>
              {!captured ? (
                <>
                  <h1 className="font-serif text-4xl text-cream leading-tight mb-4">
                    Now give Spine something to remember.
                  </h1>
                  <p className="text-cream/55 text-[15px] leading-relaxed mb-10">
                    Open Claude Code and say something worth keeping — your stack, your project, a decision you just made.
                    Claude will call <code className="font-mono text-amber/60 text-[13px]">spine_capture</code> automatically.
                    Or trigger it manually:
                  </p>

                  <div className="space-y-3 mb-8">
                    <p className="font-mono text-[10px] text-cream/25 uppercase tracking-widest">In Claude Code, try:</p>
                    <CodeLine copyValue='Remember: I use Next.js 15, Supabase, and Tailwind for all projects.'>"Remember: I use Next.js 15, Supabase, and Tailwind for all projects."</CodeLine>
                    <p className="font-mono text-[9px] text-cream/20">Claude will call spine_capture with this fact. You can also just work normally — it captures on its own.</p>
                  </div>

                  {/* Pulsing waiting indicator */}
                  <div className="flex items-center gap-4 py-6 border-y border-cream/[0.06]">
                    <div className="relative">
                      <div className="w-3 h-3 rounded-full bg-amber/40 animate-ping absolute" />
                      <div className="w-3 h-3 rounded-full bg-amber" />
                    </div>
                    <div>
                      <p className="font-mono text-[11px] text-cream/50">
                        Waiting for your first memory…
                      </p>
                      {captureCount > 0 && (
                        <p className="font-mono text-[10px] text-amber mt-0.5">{captureCount} captured so far</p>
                      )}
                    </div>
                    {pollActive && (
                      <span className="ml-auto font-mono text-[9px] text-cream/20 animate-pulse">checking every 3s</span>
                    )}
                  </div>

                  <div className="mt-8 space-y-3 text-[13px] text-cream/35">
                    <p>
                      <span className="text-cream/50">No Claude Code?</span> Use the browser extension on claude.ai,
                      or call the API directly:
                    </p>
                    <div className="bg-[#0a0905] border border-cream/[0.06] rounded-lg p-4">
                      <code className="font-mono text-[11px] text-cream/40 break-all">
                        curl -X POST https://spine.xxiautomate.com/api/capture \<br />
                        &nbsp;&nbsp;-H &quot;Authorization: Bearer {storedKey ? storedKey.slice(0, 20) + '…' : 'YOUR_KEY'}&quot; \<br />
                        &nbsp;&nbsp;-d &apos;&#123;&quot;content&quot;:&quot;I use Next.js for all projects&quot;&#125;&apos;
                      </code>
                    </div>
                  </div>
                </>
              ) : (
                /* Success */
                <div>
                  <div className="mb-8 flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-amber/15 border border-amber/30 flex items-center justify-center flex-shrink-0">
                      <span className="text-amber text-xl">✓</span>
                    </div>
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-widest text-amber mb-1">Memory captured</p>
                      <p className="font-serif text-2xl text-cream">Spine is awake.</p>
                    </div>
                  </div>

                  <p className="text-cream/55 text-[15px] leading-relaxed mb-8">
                    Your first memory is stored. Every session from here builds on the last —
                    context that would otherwise vanish now compounds.
                  </p>

                  <FirstCaptureLoom />

                  <div className="space-y-3 mt-10 mb-10 p-5 border border-cream/[0.08] rounded-xl">
                    <p className="font-mono text-[10px] uppercase tracking-widest text-cream/25 mb-4">What happens next</p>
                    {[
                      ['Every session', 'Claude calls get_context at startup — relevant memories appear in its system prompt automatically.'],
                      ['Conflict detection', 'When you say something that contradicts a prior memory, an HUD appears in your browser with both versions.'],
                      ['Weekly digest', 'Every Monday morning: what you captured, what conflicts you resolved, which memories are going stale.'],
                    ].map(([title, desc]) => (
                      <div key={title} className="flex gap-3 py-3 border-b border-cream/[0.05] last:border-0">
                        <span className="text-amber/50 flex-shrink-0 mt-0.5">—</span>
                        <div>
                          <p className="text-cream/70 text-[13px] font-medium mb-0.5">{title}</p>
                          <p className="text-cream/35 text-[12px] leading-relaxed">{desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-col sm:flex-row gap-4">
                    <Link
                      href="/timeline"
                      className="group inline-flex items-center gap-3 px-6 py-3 bg-amber text-night font-mono text-[11px] uppercase tracking-widest hover:bg-cream transition-colors duration-300"
                    >
                      Open your archive
                      <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
                    </Link>
                    <Link
                      href="/proof/compaction"
                      className="inline-flex items-center gap-2 px-6 py-3 border border-cream/[0.12] text-cream/55 font-mono text-[11px] uppercase tracking-widest hover:border-amber/40 hover:text-cream/80 transition-all duration-300"
                    >
                      See why this matters →
                    </Link>
                    <Link
                      href="/pricing"
                      className="inline-flex items-center gap-2 px-6 py-3 border border-cream/[0.12] text-cream/55 font-mono text-[11px] uppercase tracking-widest hover:border-cream/30 hover:text-cream/80 transition-all duration-300"
                    >
                      Upgrade to Pro →
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Bottom ambient glow */}
      <div className="pointer-events-none fixed bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-amber/[0.04] blur-[120px] rounded-full" />
    </div>
  );
}
