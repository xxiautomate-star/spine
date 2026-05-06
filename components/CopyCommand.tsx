'use client';

import { useState } from 'react';

type CopyCommandProps = {
  command: string;
  size?: 'sm' | 'md';
};

export function CopyCommand({ command, size = 'md' }: CopyCommandProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked. Silent fail — user can still triple-click + cmd-c.
    }
  }

  const padding = size === 'sm' ? 'px-4 py-2' : 'px-4 py-2.5';
  const codeSize = size === 'sm' ? 'text-[12px]' : 'text-[13px]';

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`flex items-center gap-3 ${padding} rounded-md text-left w-full transition-all duration-300 hover:translate-y-[-1px]`}
      aria-label={copied ? 'Copied install command' : 'Copy install command'}
      style={{
        background: 'rgba(255, 253, 247, 0.72)',
        border: '1px solid var(--s-vein)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.6)',
      }}
    >
      <span className="font-mono text-[12px] select-none" style={{ color: 'var(--s-ink-ghost)' }}>$</span>
      <code className={`font-mono ${codeSize} truncate`} style={{ color: 'var(--s-gold-deep)' }}>
        {command}
      </code>
      <span
        className="ml-auto font-mono text-[9px] uppercase tracking-widest transition-colors duration-300"
        style={{ color: copied ? 'var(--s-gold-deep)' : 'var(--s-ink-ghost)' }}
        aria-live="polite"
      >
        {copied ? 'copied' : 'copy'}
      </span>
    </button>
  );
}
