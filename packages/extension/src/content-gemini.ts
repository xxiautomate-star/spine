// Content script for gemini.google.com.
// Gemini wraps user turns in <user-query> and model turns in <model-response>.
// The composer is a contenteditable rich-textarea inside <input-area>.
//
// Driver is exported for selector-regression unit tests in
// extension-harness/src/drivers/. See content-chatgpt.ts for rationale.

import { start, type PlatformDriver, type Turn } from './common/capture.js';

const USER_SEL = 'user-query, [data-test-id="user-query"]';
const MODEL_SEL = 'model-response, [data-test-id="model-response"]';

export const geminiDriver: PlatformDriver = {
  source: 'gemini',
  enabledKey: 'captureGemini',

  getConversationRoot() {
    return (
      document.querySelector('chat-window, main, [role="main"]') ?? document.body
    );
  },

  collectTurns(root) {
    const out: Turn[] = [];
    const all = root.querySelectorAll(`${USER_SEL}, ${MODEL_SEL}`);
    for (const el of all) {
      const tag = (el.tagName || '').toLowerCase();
      const role: Turn['role'] = tag.includes('user') ? 'user' : 'assistant';
      const text = extractText(el as HTMLElement);
      if (!text) continue;
      out.push({ role, content: text });
    }
    return out;
  },

  getPromptInput() {
    const rich = document.querySelector(
      'rich-textarea .ql-editor, rich-textarea [contenteditable="true"]'
    ) as HTMLElement | null;
    if (rich) return rich;
    return document.querySelector('[contenteditable="true"]') as HTMLElement | null;
  },

  getPageHint() {
    const title = document.title.replace(/\s*[-|]\s*Gemini\s*$/i, '').trim();
    if (title && title.toLowerCase() !== 'gemini') return title;
    const firstUser = document.querySelector(USER_SEL);
    if (firstUser) {
      const t = extractText(firstUser as HTMLElement);
      if (t) return t.slice(0, 240);
    }
    return 'new gemini conversation';
  },

  isFreshConversation() {
    const turns = document.querySelectorAll(`${USER_SEL}, ${MODEL_SEL}`);
    return turns.length === 0;
  },
};

function extractText(el: HTMLElement): string {
  return (el.innerText ?? el.textContent ?? '').trim();
}

start(geminiDriver);
