// Content script for cursor.sh (Cursor's web presence / docs / playground).
//
// Note: Cursor's primary AI chat lives inside the Electron IDE, which a
// Chrome extension cannot reach. This script captures any web-based chat
// interface at cursor.sh — specifically:
//   - cursor.sh/playground (if/when it ships a web chat)
//   - Any conversation demo at cursor.sh/chat/*
//   - The forum / community at forum.cursor.sh that may embed AI responses
//
// When Cursor ships a progressive-web-app version of the chat panel, these
// selectors will need updating to match that surface's DOM. The adapter is
// intentionally broad to catch whichever structure they land on.
//
// For Cursor IDE captures, users should use the MCP server (xxiautomate-spine)
// which hooks into Cursor's LLM via the ~/.cursor/mcp.json config file —
// same JSON schema as Claude Code.

import { start, type PlatformDriver, type Turn } from './common/capture.js';

const USER_SELS = [
  '[data-role="user"]',
  '[data-author="user"]',
  'div[class*="user-message"]',
  'div[class*="UserMessage"]',
  'div[class*="human-turn"]',
];

const AI_SELS = [
  '[data-role="assistant"]',
  '[data-author="assistant"]',
  'div[class*="ai-message"]',
  'div[class*="AssistantMessage"]',
  'div[class*="bot-message"]',
];

const CONTENT_SELS = ['.prose', '.markdown', '.message-content', 'p'];

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

const driver: PlatformDriver = {
  source: 'cursor.sh',
  enabledKey: 'captureCursor',

  getConversationRoot() {
    return (
      document.querySelector('[data-testid="chat-container"]') ??
      document.querySelector('div[class*="ChatContainer"]') ??
      document.querySelector('main') ??
      document.body
    );
  },

  collectTurns(root: Element): Turn[] {
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
      (document.querySelector('textarea[placeholder*="Ask"], textarea[data-testid*="input"]') as HTMLElement | null) ??
      (document.querySelector('div[contenteditable="true"]') as HTMLElement | null) ??
      (document.querySelector('textarea') as HTMLElement | null)
    );
  },

  getPageHint() {
    const title = document.title.replace(/\s*[-|]\s*Cursor\s*$/i, '').trim();
    if (title && title.toLowerCase() !== 'cursor') return title;
    return 'new cursor conversation';
  },

  isFreshConversation() {
    const root = driver.getConversationRoot();
    if (!root) return true;
    return allOf(root, [...USER_SELS, ...AI_SELS]).length === 0;
  },
};

start(driver);
