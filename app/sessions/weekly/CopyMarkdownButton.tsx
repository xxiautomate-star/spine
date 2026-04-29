'use client';

import { useState } from 'react';

/**
 * Tiny client island for the "copy as markdown" affordance on each
 * weekly-digest card. Using the clipboard API requires a client boundary;
 * keeping it scoped to this button means the surrounding page stays a
 * server component (no client-side data fetching, no hydration cost).
 */
export function CopyMarkdownButton({ markdown }: { markdown: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(markdown);
      setState('copied');
      setTimeout(() => setState('idle'), 1500);
    } catch {
      setState('error');
      setTimeout(() => setState('idle'), 2000);
    }
  }

  const label =
    state === 'copied' ? 'copied ✓' : state === 'error' ? 'copy failed' : 'copy as markdown';
  const colour =
    state === 'copied' ? 'text-amber' : state === 'error' ? 'text-rose-400/70' : 'text-cream/40 hover:text-amber';

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={`font-mono text-[10px] uppercase tracking-widest transition-colors duration-300 ${colour}`}
      aria-label="Copy this weekly digest as markdown"
    >
      {label}
    </button>
  );
}
