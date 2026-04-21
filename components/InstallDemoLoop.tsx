'use client';

import { useState, useEffect } from 'react';

// ── Animated "first capture in 30 seconds" demo ───────────────────────────────
// State machine shows: install → claude code with spine tools → capture →
// "next session" → search → result. Pure CSS transitions, no video.

type Phase =
  | 'install-0'     // terminal idle
  | 'install-1'     // npx command typed
  | 'install-2'     // downloading…
  | 'install-3'     // API key prompt
  | 'install-done'  // configured ✓
  | 'editor-open'   // claude code opens, spine tools visible
  | 'user-typing'   // user types a memory
  | 'capture-flash' // spine capture badge fires
  | 'next-session'  // "next session →" transition
  | 'search-query'  // user types search
  | 'search-result' // result appears
  | 'done';         // pause before loop

const CAPTURE_TEXT = 'Fixed OAuth token refresh bug — clock skew was 40s, tolerance was 30s. Added 60s buffer.';
const SEARCH_QUERY = 'that auth bug we fixed last week';

const PHASE_SEQUENCE: { phase: Phase; durationMs: number }[] = [
  { phase: 'install-0',    durationMs: 500 },
  { phase: 'install-1',    durationMs: 900 },
  { phase: 'install-2',    durationMs: 1200 },
  { phase: 'install-3',    durationMs: 800 },
  { phase: 'install-done', durationMs: 1200 },
  { phase: 'editor-open',  durationMs: 1600 },
  { phase: 'user-typing',  durationMs: 1800 },
  { phase: 'capture-flash',durationMs: 1400 },
  { phase: 'next-session', durationMs: 1200 },
  { phase: 'search-query', durationMs: 1600 },
  { phase: 'search-result',durationMs: 3500 },
  { phase: 'done',         durationMs: 1200 },
];

function phaseIndex(p: Phase): number {
  return PHASE_SEQUENCE.findIndex((s) => s.phase === p);
}

function atLeast(current: Phase, target: Phase): boolean {
  return phaseIndex(current) >= phaseIndex(target);
}

function between(current: Phase, from: Phase, to: Phase): boolean {
  const ci = phaseIndex(current);
  return ci >= phaseIndex(from) && ci <= phaseIndex(to);
}

function Cursor({ active }: { active: boolean }) {
  return (
    <span style={{
      display: 'inline-block', width: 7, height: 13,
      background: active ? 'rgba(232,154,60,0.8)' : 'transparent',
      marginLeft: 1, verticalAlign: 'middle',
      animation: active ? 'blink 1s step-end infinite' : 'none',
    }} />
  );
}

export function InstallDemoLoop() {
  const [phase, setPhase] = useState<Phase>('install-0');

  useEffect(() => {
    let cancelled = false;
    let index = 0;

    async function run() {
      while (!cancelled) {
        const { phase: p, durationMs } = PHASE_SEQUENCE[index % PHASE_SEQUENCE.length];
        setPhase(p);
        await new Promise<void>((r) => setTimeout(r, durationMs));
        if (cancelled) break;
        index = (index + 1) % PHASE_SEQUENCE.length;
      }
    }
    void run();
    return () => { cancelled = true; };
  }, []);

  const showTerminal = !atLeast(phase, 'next-session');
  const showEditor = atLeast(phase, 'editor-open') && !atLeast(phase, 'next-session');
  const showNextSession = atLeast(phase, 'next-session');

  return (
    <>
      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes slideUp { from{opacity:0;transform:translateY(12px)} to{opacity:1;transform:none} }
        @keyframes pulse { 0%,100%{box-shadow:0 0 0 0 rgba(232,154,60,0.4)} 50%{box-shadow:0 0 0 8px rgba(232,154,60,0)} }
        @keyframes flashIn { 0%{opacity:0;transform:scale(0.92)} 20%{opacity:1;transform:scale(1.03)} 100%{opacity:1;transform:scale(1)} }
      `}</style>

      <div style={{ position: 'relative', width: '100%', maxWidth: 520, minHeight: 320 }}>
        {/* Terminal panel */}
        {showTerminal && (
          <div style={{
            position: showEditor ? 'absolute' : 'relative', inset: 0,
            background: '#0a0905', border: '1px solid rgba(232,228,221,0.08)',
            borderRadius: 14, overflow: 'hidden',
            boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
            animation: 'slideUp 0.4s ease',
            zIndex: showEditor ? 0 : 1,
          }}>
            {/* Chrome */}
            <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(232,228,221,0.05)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(255,95,87,0.6)' }} />
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(254,188,46,0.6)' }} />
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(40,200,64,0.6)' }} />
              <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(232,228,221,0.2)', marginLeft: 8 }}>Terminal</span>
            </div>

            {/* Content */}
            <div style={{ padding: '16px 20px', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.7 }}>
              {/* Prompt */}
              <div style={{ color: 'rgba(232,228,221,0.35)' }}>
                <span style={{ color: 'rgba(40,200,64,0.7)' }}>~</span>
                <span style={{ color: 'rgba(232,228,221,0.2)' }}> $ </span>
                {atLeast(phase, 'install-1') && (
                  <span style={{ color: '#E89A3C' }}>npx @xxi/spine-mcp init</span>
                )}
                {phase === 'install-0' && <Cursor active />}
                {phase === 'install-1' && <Cursor active={false} />}
              </div>

              {atLeast(phase, 'install-2') && (
                <div style={{ color: 'rgba(232,228,221,0.3)', animation: 'slideUp 0.3s ease' }}>
                  <div>Need to install the following packages: @xxi/spine-mcp</div>
                  <div>Ok to proceed? (y) <span style={{ color: '#E89A3C' }}>y</span></div>
                  {atLeast(phase, 'install-3') && (
                    <div style={{ color: 'rgba(232,228,221,0.5)', animation: 'slideUp 0.3s ease' }}>
                      <br />
                      <div style={{ color: '#E89A3C' }}>Spine — setup</div>
                      <div style={{ color: 'rgba(232,228,221,0.3)' }}>─────────────</div>
                      <br />
                      <div>Storage mode — [L]ocal or [c]loud? <span style={{ color: '#E89A3C' }}>c</span></div>
                      {atLeast(phase, 'install-done') && (
                        <>
                          <div>Paste your Spine API key: <span style={{ color: '#E89A3C' }}>spine_live_•••••••</span></div>
                          <div style={{ color: 'rgba(40,200,64,0.8)', animation: 'slideUp 0.3s ease' }}>
                            [spine] API key accepted. ✓<br />
                            Config written to ~/.spine/config.json<br />
                            <br />
                            <span style={{ color: 'rgba(232,228,221,0.4)' }}>Add to Claude Code / Cursor MCP settings:</span><br />
                            <span style={{ color: 'rgba(232,154,60,0.7)' }}>{`{"mcpServers":{"spine":{"command":"npx","args":["-y","@xxi/spine-mcp","serve"]}}}`}</span>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Editor panel — Claude Code with Spine tools */}
        {showEditor && (
          <div style={{
            position: 'absolute', inset: 0,
            background: '#0a0905', border: '1px solid rgba(232,228,221,0.08)',
            borderRadius: 14, overflow: 'hidden',
            boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
            animation: 'slideUp 0.5s ease',
            zIndex: 1,
          }}>
            {/* Chrome */}
            <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(232,228,221,0.05)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(255,95,87,0.6)' }} />
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(254,188,46,0.6)' }} />
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(40,200,64,0.6)' }} />
              <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(232,228,221,0.2)', marginLeft: 8 }}>Claude Code</span>
              {/* Spine tool indicator */}
              <div style={{
                marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4,
                padding: '2px 8px', borderRadius: 6,
                background: 'rgba(232,154,60,0.08)', border: '1px solid rgba(232,154,60,0.2)',
              }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#E89A3C', animation: 'pulse 2s infinite' }} />
                <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'rgba(232,154,60,0.7)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Spine · 14 tools</span>
              </div>
            </div>

            {/* Chat area */}
            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Tool list pill */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {['search_memory', 'add_memory', 'get_timeline', 'spine_recall', 'spine_context', '…'].map((t) => (
                  <span key={t} style={{
                    fontFamily: 'monospace', fontSize: 9, padding: '2px 7px',
                    borderRadius: 4, background: 'rgba(232,228,221,0.04)',
                    border: '1px solid rgba(232,228,221,0.08)',
                    color: t.startsWith('search') || t.startsWith('add') || t.startsWith('get')
                      ? 'rgba(232,154,60,0.7)' : 'rgba(232,228,221,0.25)',
                  }}>{t}</span>
                ))}
              </div>

              {/* User input typing */}
              {atLeast(phase, 'user-typing') && (
                <div style={{ animation: 'slideUp 0.4s ease' }}>
                  <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(232,228,221,0.25)', marginBottom: 4 }}>User</div>
                  <div style={{ background: 'rgba(232,228,221,0.04)', border: '1px solid rgba(232,228,221,0.08)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'rgba(232,228,221,0.7)', fontFamily: 'Georgia, serif', lineHeight: 1.5 }}>
                    {CAPTURE_TEXT}
                    <Cursor active={phase === 'user-typing'} />
                  </div>
                </div>
              )}

              {/* Spine capture flash */}
              {atLeast(phase, 'capture-flash') && (
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  padding: '8px 12px', borderRadius: 8,
                  background: 'rgba(232,154,60,0.06)', border: '1px solid rgba(232,154,60,0.25)',
                  animation: 'flashIn 0.3s ease',
                }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#E89A3C' }} />
                  <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(232,154,60,0.8)' }}>
                    spine.add_memory — stored ✓
                  </span>
                  <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(232,228,221,0.2)', marginLeft: 'auto' }}>id: a3f2…</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Next session + search result */}
        {showNextSession && (
          <div style={{
            position: 'relative',
            background: '#0a0905', border: '1px solid rgba(232,228,221,0.08)',
            borderRadius: 14, overflow: 'hidden',
            boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
            animation: 'slideUp 0.5s ease',
          }}>
            {/* Chrome */}
            <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(232,228,221,0.05)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(255,95,87,0.6)' }} />
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(254,188,46,0.6)' }} />
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgba(40,200,64,0.6)' }} />
              <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(232,154,60,0.5)', marginLeft: 8 }}>New session — Claude Code</span>
              <div style={{
                marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4,
                padding: '2px 8px', borderRadius: 6,
                background: 'rgba(232,154,60,0.08)', border: '1px solid rgba(232,154,60,0.2)',
              }}>
                <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#E89A3C' }} />
                <span style={{ fontFamily: 'monospace', fontSize: 9, color: 'rgba(232,154,60,0.7)' }}>Spine connected</span>
              </div>
            </div>

            <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Search query */}
              {atLeast(phase, 'search-query') && (
                <div style={{ animation: 'slideUp 0.4s ease' }}>
                  <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(232,228,221,0.25)', marginBottom: 4 }}>User</div>
                  <div style={{ background: 'rgba(232,228,221,0.04)', border: '1px solid rgba(232,228,221,0.08)', borderRadius: 8, padding: '10px 14px', fontSize: 12, color: 'rgba(232,228,221,0.7)', fontFamily: 'Georgia, serif' }}>
                    {SEARCH_QUERY}
                    <Cursor active={phase === 'search-query'} />
                  </div>
                </div>
              )}

              {/* Tool call */}
              {atLeast(phase, 'search-result') && (
                <>
                  <div style={{
                    padding: '8px 12px', borderRadius: 8,
                    background: 'rgba(232,154,60,0.04)', border: '1px solid rgba(232,154,60,0.15)',
                    animation: 'slideUp 0.3s ease',
                  }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(232,154,60,0.6)' }}>
                      spine.search_memory({'"'}{SEARCH_QUERY}{'"'})
                    </span>
                  </div>

                  <div style={{ animation: 'slideUp 0.4s ease 0.15s both' }}>
                    <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(232,228,221,0.25)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#E89A3C' }} />
                      Claude
                    </div>
                    <div style={{ background: 'rgba(232,228,221,0.03)', borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(232,154,60,0.5)', marginBottom: 6 }}>1 memory · 97% match</div>
                      <p style={{ fontSize: 12, color: 'rgba(232,228,221,0.75)', fontFamily: 'Georgia, serif', lineHeight: 1.6, margin: 0, borderLeft: '2px solid rgba(232,154,60,0.3)', paddingLeft: 10 }}>
                        {CAPTURE_TEXT}
                      </p>
                      <div style={{ marginTop: 12, fontSize: 12, color: 'rgba(232,228,221,0.6)', fontFamily: 'Georgia, serif', lineHeight: 1.6 }}>
                        Based on this, the fix added 60 seconds of clock skew tolerance to the OAuth token refresh. Want me to check if this has been applied in the current branch?
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Timer dots */}
        <div style={{ position: 'absolute', bottom: -28, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 6 }}>
          {(['install', 'editor', 'recall'] as const).map((seg, i) => {
            const active = (i === 0 && !showNextSession) || (i === 1 && showEditor) || (i === 2 && showNextSession);
            return (
              <div key={seg} style={{ width: active ? 16 : 4, height: 4, borderRadius: 2, background: active ? '#E89A3C' : 'rgba(232,228,221,0.12)', transition: 'all 0.4s' }} />
            );
          })}
        </div>
      </div>
    </>
  );
}
