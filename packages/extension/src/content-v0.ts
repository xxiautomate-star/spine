// Content script for v0.dev (Vercel's AI UI generator).
//
// v0 DOM structure:
//   User turns:   div[data-role="user"] or div[class*="user-message"]
//   AI turns:     div[data-role="assistant"] or div[class*="assistant-message"]
//   Also handles the streaming state via absence of the "Regenerate" button.
//   URL format:   /chat/<id> or / for the composer
//
// v0 uses React streaming, so we must not capture until the "Regenerate" or
// "Copy" button appears on the last message (stream done signal).

import { start, type PlatformDriver, type Turn } from './common/capture.js';

const USER_SELS = [
  '[data-role="user"]',
  '[data-message-role="user"]',
  'div[class*="UserMessage"]',
  'div[class*="user-message"]',
];

const AI_SELS = [
  '[data-role="assistant"]',
  '[data-message-role="assistant"]',
  'div[class*="AssistantMessage"]',
  'div[class*="assistant-message"]',
  'div[class*="model-message"]',
];

const CONTENT_SELS = ['.prose', '.markdown', 'p', 'pre'];

function extractText(el: HTMLElement): string {
  for (const sel of CONTENT_SELS) {
    const inner = el.querySelector(sel) as HTMLElement | null;
    if (inner) {
      const text = (inner.innerText ?? inner.textContent ?? '').trim();
      if (text.length > 5) return text;
    }
  }
  return (el.innerText ?? el.textContent ?? '').trim();
}

function allOf(root: Element, sels: string[]): Element[] {
  for (const s of sels) {
    const els = root.querySelectorAll(s);
    if (els.length > 0) return [...els];
  }
  return [];
}

function isStreaming(): boolean {
  // v0 shows a spinner or "Stop generating" while active.
  const stop = document.querySelector(
    'button[aria-label*="Stop"], button[aria-label*="stop generating"]'
  );
  if (stop) return true;
  // Spinner class heuristic.
  return !!document.querySelector('[class*="spinner"], [class*="loading"][aria-busy="true"]');
}

const driver: PlatformDriver = {
  source: 'v0.dev',
  enabledKey: 'captureV0',

  getConversationRoot() {
    return (
      document.querySelector('[data-testid="chat-messages"]') ??
      document.querySelector('div[class*="ChatMessages"]') ??
      document.querySelector('main') ??
      document.body
    );
  },

  collectTurns(root: Element): Turn[] {
    if (isStreaming()) return [];
    const out: Turn[] = [];

    for (const el of allOf(root, USER_SELS)) {
      const text = extractText(el as HTMLElement);
      if (text.length >= 4) out.push({ role: 'user', content: text });
    }
    for (const el of allOf(root, AI_SELS)) {
      const text = extractText(el as HTMLElement);
      if (text.length >= 4) out.push({ role: 'assistant', content: text });
    }
    return out;
  },

  getPromptInput() {
    return (
      (document.querySelector('textarea[placeholder*="Message"], textarea[aria-label*="prompt"]') as HTMLElement | null) ??
      (document.querySelector('textarea') as HTMLElement | null)
    );
  },

  getPageHint() {
    const title = document.title.replace(/\s*[-|]\s*v0\s*$/i, '').trim();
    if (title && title.toLowerCase() !== 'v0') return title;
    const root = driver.getConversationRoot();
    if (root) {
      const first = allOf(root, USER_SELS)[0];
      if (first) return extractText(first as HTMLElement).slice(0, 240);
    }
    return 'new v0 conversation';
  },

  isFreshConversation() {
    if (location.pathname === '/' || location.pathname === '') return true;
    const root = driver.getConversationRoot();
    if (!root) return true;
    return allOf(root, [...USER_SELS, ...AI_SELS]).length === 0;
  },
};

start(driver);
