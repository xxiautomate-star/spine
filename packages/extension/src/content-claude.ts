// Content script for claude.ai.
//
// Claude's DOM structure (as of 2025):
//   Human turns:    [data-testid="human-turn"]
//   AI turns:       [data-testid="assistant-message"]  (also: div.font-claude-message)
//   Streaming flag: button[aria-label*="Stop"] or div[data-testid="streaming-indicator"]
//   Fresh check:    pathname matches /new or no turns present
//   SPA routing:    URL changes without page reload, we watch via interval + popstate
//
// Virtualization hazard: Claude may unload older messages from the DOM for very
// long conversations. We track every seen hash so we never double-capture, and
// flush pending turns aggressively before they scroll out of view.

import { start, type PlatformDriver, type Turn } from './common/capture.js';

// Multiple selector candidates, tried in order — claude.ai's class names rotate.
const HUMAN_SELS = [
  '[data-testid="human-turn"]',
  '[data-testid="user-message"]',
  '[data-testid*="human"]',
  'div[class*="human-turn"]',
];

const AI_SELS = [
  '[data-testid="assistant-message"]',
  '[data-testid*="assistant"]',
  '[data-testid="ai-turn"]',
  'div.font-claude-message',
  'div[class*="assistant"]',
];

// Selectors for the text content inside a turn element.
const CONTENT_SELS = [
  '.font-claude-message',
  '.whitespace-pre-wrap',
  '.markdown-content',
  'p',
];

function firstOf(sels: string[]): Element | null {
  for (const s of sels) {
    const el = document.querySelector(s);
    if (el) return el;
  }
  return null;
}

function allOf(root: Element, sels: string[]): Element[] {
  for (const s of sels) {
    const els = root.querySelectorAll(s);
    if (els.length > 0) return [...els];
  }
  return [];
}

function extractText(el: HTMLElement): string {
  // Try inner content container first to avoid metadata noise.
  for (const sel of CONTENT_SELS) {
    const inner = el.querySelector(sel) as HTMLElement | null;
    if (inner) {
      const text = (inner.innerText ?? inner.textContent ?? '').trim();
      if (text.length > 10) return text;
    }
  }
  return (el.innerText ?? el.textContent ?? '').trim();
}

function isStreaming(): boolean {
  // Claude shows a "Stop" button while generating.
  const stop = document.querySelector(
    'button[aria-label*="Stop"], button[aria-label*="stop"], [data-testid="stop-button"]'
  );
  if (stop) return true;
  const indicator = document.querySelector(
    '[data-testid="streaming-indicator"], [data-is-streaming="true"]'
  );
  return !!indicator;
}

const driver: PlatformDriver = {
  source: 'claude.ai',
  enabledKey: 'captureClaude',

  getConversationRoot() {
    // The stable scroll container — prefer the most specific selector.
    return (
      document.querySelector('[data-testid="conversation-content"]') ??
      document.querySelector('[data-testid="chat-messages-scroll"]') ??
      document.querySelector('div[class*="ConversationContent"]') ??
      document.querySelector('main') ??
      document.body
    );
  },

  collectTurns(root: Element): Turn[] {
    // Don't capture while Claude is still writing — wait for stream to settle.
    if (isStreaming()) return [];

    const out: Turn[] = [];

    const humanEls = allOf(root, HUMAN_SELS);
    for (const el of humanEls) {
      const text = extractText(el as HTMLElement);
      if (text.length < 4) continue;
      out.push({ role: 'user', content: text });
    }

    const aiEls = allOf(root, AI_SELS);
    for (const el of aiEls) {
      const text = extractText(el as HTMLElement);
      if (text.length < 4) continue;
      out.push({ role: 'assistant', content: text });
    }

    // Sort by DOM position to interleave turns correctly.
    out.sort((a, b) => {
      const elA = findTurnElement(root, a.content);
      const elB = findTurnElement(root, b.content);
      if (!elA || !elB) return 0;
      const pos = elA.compareDocumentPosition(elB);
      return pos & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    return out;
  },

  getPromptInput() {
    // Claude's compose area is a ProseMirror contenteditable.
    const pm = document.querySelector(
      'div[contenteditable="true"][data-testid*="prompt"], ' +
      'div.ProseMirror[contenteditable="true"], ' +
      'div[contenteditable="true"][class*="composer"]'
    ) as HTMLElement | null;
    if (pm) return pm;
    return document.querySelector('[contenteditable="true"]') as HTMLElement | null;
  },

  getPageHint() {
    // Claude conversation titles live in the sidebar or the page <title>.
    const title = document.title.replace(/\s*[-|]\s*Claude\s*$/i, '').trim();
    if (title && title.toLowerCase() !== 'claude' && title.toLowerCase() !== 'new conversation') {
      return title;
    }
    const root = driver.getConversationRoot();
    if (root) {
      const firstHuman = firstOf(HUMAN_SELS.map((s) => `${s}`));
      if (firstHuman) {
        const t = extractText(firstHuman as HTMLElement);
        if (t) return t.slice(0, 240);
      }
    }
    return 'new claude conversation';
  },

  isFreshConversation() {
    // /new path or literally zero message turns.
    if (location.pathname === '/new' || location.pathname.endsWith('/new')) return true;
    const root = driver.getConversationRoot();
    if (!root) return true;
    const humanCount = allOf(root, HUMAN_SELS).length;
    const aiCount = allOf(root, AI_SELS).length;
    return humanCount + aiCount === 0;
  },
};

// Helper: find which DOM element corresponds to a given piece of content text.
// Used for sorting turns by DOM position.
function findTurnElement(root: Element, content: string): Element | null {
  const all = root.querySelectorAll([...HUMAN_SELS, ...AI_SELS].join(', '));
  for (const el of all) {
    const text = (el as HTMLElement).innerText ?? (el as HTMLElement).textContent ?? '';
    if (text.includes(content.slice(0, 80))) return el;
  }
  return null;
}

start(driver);
