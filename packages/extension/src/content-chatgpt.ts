// Content script for chatgpt.com / chat.openai.com.
// ChatGPT renders each turn under [data-message-author-role] with a sibling
// content container. The conversation is wrapped in a stable scroll container
// (#main, with a 'main' role); we observe the document and scope per scan.
//
// Driver is exported for selector-regression unit tests in
// extension-harness/src/drivers/. If a future ChatGPT redesign changes the
// turn selector, those tests fail loudly — production capture would otherwise
// silently drop to zero.

import { start, type PlatformDriver, type Turn } from './common/capture.js';

const TURN_SEL = '[data-message-author-role]';

export const chatgptDriver: PlatformDriver = {
  source: 'chatgpt',
  enabledKey: 'captureChatGPT',

  getConversationRoot() {
    return document.querySelector('main') ?? document.body;
  },

  collectTurns(root) {
    const out: Turn[] = [];
    const turns = root.querySelectorAll(TURN_SEL);
    for (const el of turns) {
      const role = el.getAttribute('data-message-author-role');
      if (role !== 'user' && role !== 'assistant') continue;
      const text = extractText(el as HTMLElement);
      if (!text) continue;
      out.push({ role, content: text });
    }
    return out;
  },

  getPromptInput() {
    const ta = document.querySelector('textarea#prompt-textarea') as HTMLTextAreaElement | null;
    if (ta) return ta;
    const editor = document.querySelector('div#prompt-textarea[contenteditable="true"]') as HTMLElement | null;
    if (editor) return editor;
    return document.querySelector('[contenteditable="true"]') as HTMLElement | null;
  },

  getPageHint() {
    const title = document.title.replace(/\s*[-|]\s*ChatGPT\s*$/i, '').trim();
    if (title && title.toLowerCase() !== 'chatgpt') return title;
    const firstUser = document.querySelector('[data-message-author-role="user"]');
    if (firstUser) {
      const text = extractText(firstUser as HTMLElement);
      if (text) return text.slice(0, 240);
    }
    return 'new chatgpt conversation';
  },

  isFreshConversation() {
    if (location.pathname === '/' || location.pathname === '/c') return true;
    const turns = document.querySelectorAll(TURN_SEL);
    return turns.length === 0;
  },
};

function extractText(el: HTMLElement): string {
  const inner = el.querySelector('.markdown, [data-message-id] .whitespace-pre-wrap, .whitespace-pre-wrap');
  const node = (inner ?? el) as HTMLElement;
  return (node.innerText ?? node.textContent ?? '').trim();
}

start(chatgptDriver);
