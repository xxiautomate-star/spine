'use client';

import { useState } from 'react';

const MCP_CONFIG = `{
  "mcpServers": {
    "spine": {
      "command": "npx",
      "args": ["-y", "@spine/mcp"],
      "env": {
        "SPINE_API_KEY": "get yours at spine.xxiautomate.com/dashboard/keys"
      }
    }
  }
}`;

const CLAUDE_CODE_PATH = '~/.claude/mcp.json';
const CLAUDE_DESKTOP_PATH = '~/Library/Application Support/Claude/claude_desktop_config.json';

export function TrialCTA() {
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<'claude-code' | 'claude-desktop'>('claude-code');

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(MCP_CONFIG);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: select the text
    }
  }

  const configPath = tab === 'claude-code' ? CLAUDE_CODE_PATH : CLAUDE_DESKTOP_PATH;

  return (
    <div className="border border-cream/10 rounded-xl overflow-hidden bg-cream/[0.02]">
      {/* Header */}
      <div className="px-6 md:px-8 pt-8 pb-6 border-b border-cream/5">
        <p className="font-mono text-[11px] uppercase tracking-widest text-amber mb-3">
          One-click install
        </p>
        <h3 className="font-serif font-normal text-2xl md:text-3xl text-cream mb-3">
          Running in your Claude in 2 minutes.
        </h3>
        <p className="text-cream/60 text-sm leading-relaxed max-w-xl">
          Copy the config, paste it into your Claude config file, restart. Your AI immediately
          has access to the full <code className="font-mono text-[12px] text-amber/80">spine_remember</code> and{' '}
          <code className="font-mono text-[12px] text-amber/80">spine_recall</code> tools.
        </p>
      </div>

      {/* Steps */}
      <div className="px-6 md:px-8 py-6 space-y-6">

        {/* Step 1: get key */}
        <div className="flex gap-4 items-start">
          <span className="flex-shrink-0 w-6 h-6 rounded-full border border-amber/40 flex items-center justify-center font-mono text-[10px] text-amber">
            1
          </span>
          <div className="flex-1">
            <p className="text-cream text-sm font-medium mb-1">
              Get your API key from the dashboard
            </p>
            <a
              href="/dashboard/keys"
              className="inline-block font-mono text-[11px] text-amber/80 hover:text-amber transition-colors underline underline-offset-4 decoration-amber/30"
            >
              spine.xxiautomate.com/dashboard/keys →
            </a>
          </div>
        </div>

        {/* Step 2: pick client + copy config */}
        <div className="flex gap-4 items-start">
          <span className="flex-shrink-0 w-6 h-6 rounded-full border border-amber/40 flex items-center justify-center font-mono text-[10px] text-amber">
            2
          </span>
          <div className="flex-1">
            <p className="text-cream text-sm font-medium mb-3">
              Add to your Claude config file
            </p>

            {/* Client tabs */}
            <div className="flex gap-1 mb-3">
              {(['claude-code', 'claude-desktop'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 rounded border transition-colors duration-200 ${
                    tab === t
                      ? 'border-amber/40 bg-amber/10 text-amber'
                      : 'border-cream/10 text-cream/40 hover:text-cream/60'
                  }`}
                >
                  {t === 'claude-code' ? 'Claude Code' : 'Claude Desktop'}
                </button>
              ))}
            </div>

            <p className="font-mono text-[10px] text-cream/30 mb-2">
              Paste into: <span className="text-cream/50">{configPath}</span>
            </p>

            {/* Config block */}
            <div className="relative">
              <pre className="bg-cream/[0.04] border border-cream/10 rounded-lg px-4 py-4 font-mono text-[12px] text-cream/70 leading-relaxed overflow-x-auto whitespace-pre">
                <span className="text-cream/30 select-none">{'{'}</span>{'\n'}
                {'  '}<span className="text-sky-400">"mcpServers"</span>
                <span className="text-cream/30">: {'{'}</span>{'\n'}
                {'    '}<span className="text-sky-400">"spine"</span>
                <span className="text-cream/30">: {'{'}</span>{'\n'}
                {'      '}<span className="text-sky-400">"command"</span>
                <span className="text-cream/30">: </span>
                <span className="text-amber">"npx"</span>
                <span className="text-cream/30">,</span>{'\n'}
                {'      '}<span className="text-sky-400">"args"</span>
                <span className="text-cream/30">: [</span>
                <span className="text-amber">"-y"</span>
                <span className="text-cream/30">, </span>
                <span className="text-amber">"@spine/mcp"</span>
                <span className="text-cream/30">],</span>{'\n'}
                {'      '}<span className="text-sky-400">"env"</span>
                <span className="text-cream/30">: {'{'}</span>{'\n'}
                {'        '}<span className="text-sky-400">"SPINE_API_KEY"</span>
                <span className="text-cream/30">: </span>
                <span className="text-emerald-400">"spine_live_..."</span>{'\n'}
                {'      '}<span className="text-cream/30">{'}'}</span>{'\n'}
                {'    '}<span className="text-cream/30">{'}'}</span>{'\n'}
                {'  '}<span className="text-cream/30">{'}'}</span>{'\n'}
                <span className="text-cream/30">{'}'}</span>
              </pre>
              <button
                onClick={handleCopy}
                className={`absolute top-3 right-3 font-mono text-[10px] uppercase tracking-wider px-3 py-1.5 rounded border transition-all duration-200 ${
                  copied
                    ? 'border-emerald-400/40 text-emerald-400 bg-emerald-400/10'
                    : 'border-cream/10 text-cream/40 hover:text-cream/70 hover:border-cream/20'
                }`}
              >
                {copied ? 'Copied ✓' : 'Copy'}
              </button>
            </div>
          </div>
        </div>

        {/* Step 3: restart + verify */}
        <div className="flex gap-4 items-start">
          <span className="flex-shrink-0 w-6 h-6 rounded-full border border-amber/40 flex items-center justify-center font-mono text-[10px] text-amber">
            3
          </span>
          <div className="flex-1">
            <p className="text-cream text-sm font-medium mb-1">
              Restart Claude, then verify
            </p>
            <p className="text-cream/50 text-sm leading-relaxed">
              Ask Claude:{' '}
              <span className="font-mono text-[12px] text-amber/80 bg-cream/5 px-1.5 py-0.5 rounded">
                "What do you know about me?"
              </span>
              {' '}— Spine will recall your memories and reply with them.
            </p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="px-6 md:px-8 py-4 border-t border-cream/5 bg-cream/[0.01] flex items-center justify-between gap-4">
        <p className="font-mono text-[10px] text-cream/25">
          npx pulls the latest @spine/mcp from npm. Node 18+ required.
        </p>
        <a
          href="/dashboard/keys"
          className="flex-shrink-0 text-sm font-semibold text-amber hover:opacity-80 transition-opacity"
        >
          Get your key →
        </a>
      </div>
    </div>
  );
}
