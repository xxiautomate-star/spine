// Content script for codeium.com (Codeium Windsurf / web chat surfaces).
//
// Codeium's web chat at codeium.com/chat uses a standard React SPA pattern.
// Windsurf IDE chat is Electron-based (same limitation as Cursor IDE — use
// the MCP server for IDE session capture instead).
//
// This script covers:
//   - codeium.com/chat
//   - windsurf.codeium.com (if they ship a web version)
//   - Any *.codeium.com surface with a message thread DOM

import { start, type PlatformDriver, type Turn } from './common/capture.js';

const USER_SELS = [
  '[data-message-author="user"]',
  '[data-role="user"]',
  'div[class*="UserMessage"]',
  'div[class*="user-turn"]',
  'div[class*="human-message"]',
  '[aria-label*="Your message"]',
];

const AI_SELS = [
  '[data-message-author="assistant"]',
  '[data-role="assistant"]',
  'div[class*="AssistantMessage"]',
  'div[class*="ai-message"]',
  'div[class*="windsurf-message"]',
  'div[class*="codeium-message"]',
];

const CONTENT_SELS = ['.markdown-body', '.prose', '.message-text', 'p', 'pre'];

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
  return !!(
    document.querySelector('button[aria-label*="Stop"], [class*="StreamingIndicator"]') ??
    document.querySelector('[aria-busy="true"][class*="message"]')
  );
}

const driver: PlatformDriver = {
  source: 'codeium.com',
  enabledKey: 'captureCodeium',

  getConversationRoot() {
    return (
      document.querySelector('[data-testid="message-list"]') ??
      document.querySelector('div[class*="MessageList"]') ??
      document.querySelector('div[class*="ChatThread"]') ??
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
      (document.querySelector(
        'textarea[placeholder*="Ask"], textarea[data-testid*="input"], div[contenteditable="true"][class*="editor"]'
      ) as HTMLElement | null) ??
      (document.querySelector('textarea') as HTMLElement | null) ??
      (document.querySelector('div[contenteditable="true"]') as HTMLElement | null)
    );
  },

  getPageHint() {
    const title = document.title.replace(/\s*[-|]\s*(Codeium|Windsurf)\s*$/i, '').trim();
    if (title && !['codeium', 'windsurf'].includes(title.toLowerCase())) return title;
    const root = driver.getConversationRoot();
    if (root) {
      const first = allOf(root, USER_SELS)[0];
      if (first) return extractText(first as HTMLElement).slice(0, 240);
    }
    return 'new codeium conversation';
  },

  isFreshConversation() {
    const root = driver.getConversationRoot();
    if (!root) return true;
    return allOf(root, [...USER_SELS, ...AI_SELS]).length === 0;
  },
};

start(driver);
