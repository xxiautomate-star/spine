// Shared content-script logic. A platform driver supplies CSS selectors and
// a per-turn extractor; this module wires the MutationObserver, batches
// captures, debounces sends, and triggers auto-inject on conversation start.

import type { CaptureRequest, InjectRequest, InjectResponse } from './messages.js';
import { fnv1a64 } from './hash.js';
import { getSettings } from './storage.js';

export type Turn = {
  role: 'user' | 'assistant';
  content: string;
};

export type PlatformDriver = {
  /** Human-readable name written to memory.source. */
  source: string;
  /** Returns the conversation root element to observe, or null if not yet present. */
  getConversationRoot: () => Element | null;
  /** Walks the root and returns every visible turn in DOM order. */
  collectTurns: (root: Element) => Turn[];
  /** Locates the prompt input element to inject context into. */
  getPromptInput: () => HTMLElement | null;
  /** Returns the current page title or topic for inject hints. */
  getPageHint: () => string;
  /** Returns true when the current URL is a fresh conversation (no messages). */
  isFreshConversation: () => boolean;
  /** Toggle controlling whether this platform should capture at all. */
  enabledKey: 'captureChatGPT' | 'captureGemini';
};

const FLUSH_DEBOUNCE_MS = 1500;
const MIN_TURN_CHARS = 4;

export function start(driver: PlatformDriver) {
  let flushTimer: number | undefined;
  let pending: Turn[] = [];
  let observer: MutationObserver | null = null;
  let lastUrl = location.href;
  let injectedForPath: string | null = null;

  function scheduleFlush() {
    if (flushTimer !== undefined) clearTimeout(flushTimer);
    flushTimer = window.setTimeout(flush, FLUSH_DEBOUNCE_MS);
  }

  async function flush() {
    flushTimer = undefined;
    if (pending.length === 0) return;
    const settings = await getSettings();
    if (!settings.apiKey) return;
    if (!settings[driver.enabledKey]) return;

    const memories = pending.map((t) => {
      const content = `${t.role === 'user' ? 'Me' : 'AI'}: ${t.content}`;
      return {
        content,
        source: driver.source,
        tags: [t.role],
        hash: fnv1a64(`${driver.source}|${t.role}|${t.content}`),
      };
    });
    pending = [];

    const msg: CaptureRequest = { type: 'spine.capture', memories };
    try {
      await chrome.runtime.sendMessage(msg);
    } catch (err) {
      console.warn('[spine] capture send failed:', err);
    }
  }

  function scan() {
    const root = driver.getConversationRoot();
    if (!root) return;
    const turns = driver.collectTurns(root);
    for (const t of turns) {
      if (!t.content || t.content.length < MIN_TURN_CHARS) continue;
      pending.push(t);
    }
    if (pending.length > 0) scheduleFlush();
  }

  function attach() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    const root = driver.getConversationRoot();
    const target = root ?? document.body;
    observer = new MutationObserver(() => {
      scan();
      maybeAutoInject();
    });
    observer.observe(target, { childList: true, subtree: true, characterData: true });
    scan();
    void maybeAutoInject();
  }

  async function maybeAutoInject() {
    const settings = await getSettings();
    if (!settings.autoInject || !settings.apiKey) return;
    if (!settings[driver.enabledKey]) return;
    const path = location.pathname;
    if (injectedForPath === path) return;
    if (!driver.isFreshConversation()) return;
    const input = driver.getPromptInput();
    if (!input) return;

    injectedForPath = path;
    const hint = driver.getPageHint();
    if (!hint) return;

    const req: InjectRequest = { type: 'spine.inject', hints: [hint] };
    let res: InjectResponse | undefined;
    try {
      res = (await chrome.runtime.sendMessage(req)) as InjectResponse;
    } catch (err) {
      console.warn('[spine] inject send failed:', err);
      return;
    }
    if (!res?.ok || !res.block) return;
    showInjectPanel(res.block, res.memoryCount ?? 0, input);
  }

  function watchUrl() {
    const tick = () => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        injectedForPath = null;
        attach();
      }
    };
    setInterval(tick, 750);
    window.addEventListener('popstate', tick);
  }

  attach();
  watchUrl();
  window.addEventListener('beforeunload', flush);
}

const PANEL_ID = 'spine-inject-panel';

function showInjectPanel(block: string, memoryCount: number, input: HTMLElement) {
  const existing = document.getElementById(PANEL_ID);
  if (existing) existing.remove();

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  Object.assign(panel.style, {
    position: 'fixed',
    right: '24px',
    bottom: '24px',
    width: '320px',
    padding: '20px 22px',
    background: '#0D0C0A',
    color: '#E8E4DD',
    border: '1px solid rgba(232,154,60,0.28)',
    borderRadius: '14px',
    boxShadow: '0 24px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(232,228,221,0.04)',
    zIndex: '2147483647',
    fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
    fontSize: '13px',
    lineHeight: '1.55',
    transition: 'opacity 480ms ease, transform 480ms ease',
    opacity: '0',
    transform: 'translateY(8px)',
  } as Partial<CSSStyleDeclaration>);

  const title = document.createElement('div');
  title.textContent = 'Spine remembered something';
  Object.assign(title.style, {
    fontFamily: '"Instrument Serif", Georgia, serif',
    fontSize: '20px',
    fontWeight: '400',
    letterSpacing: '0.005em',
    marginBottom: '6px',
  } as Partial<CSSStyleDeclaration>);

  const sub = document.createElement('div');
  sub.textContent = `${memoryCount} ${memoryCount === 1 ? 'memory' : 'memories'} relevant to this chat.`;
  Object.assign(sub.style, {
    color: 'rgba(232,228,221,0.62)',
    marginBottom: '16px',
  } as Partial<CSSStyleDeclaration>);

  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'flex',
    gap: '10px',
  } as Partial<CSSStyleDeclaration>);

  const insert = document.createElement('button');
  insert.textContent = 'Insert into prompt';
  Object.assign(insert.style, {
    flex: '1',
    background: '#E89A3C',
    color: '#0D0C0A',
    border: 'none',
    borderRadius: '8px',
    padding: '10px 14px',
    fontWeight: '600',
    fontSize: '13px',
    fontFamily: 'inherit',
    cursor: 'pointer',
    transition: 'transform 240ms ease, opacity 240ms ease',
  } as Partial<CSSStyleDeclaration>);
  insert.onmouseenter = () => (insert.style.opacity = '0.92');
  insert.onmouseleave = () => (insert.style.opacity = '1');
  insert.onclick = () => {
    injectInto(input, block);
    fade();
  };

  const dismiss = document.createElement('button');
  dismiss.textContent = 'Dismiss';
  Object.assign(dismiss.style, {
    background: 'transparent',
    color: 'rgba(232,228,221,0.62)',
    border: '1px solid rgba(232,228,221,0.16)',
    borderRadius: '8px',
    padding: '10px 14px',
    fontWeight: '500',
    fontSize: '13px',
    fontFamily: 'inherit',
    cursor: 'pointer',
  } as Partial<CSSStyleDeclaration>);
  dismiss.onclick = fade;

  row.append(insert, dismiss);
  panel.append(title, sub, row);
  document.body.appendChild(panel);
  requestAnimationFrame(() => {
    panel.style.opacity = '1';
    panel.style.transform = 'translateY(0)';
  });

  function fade() {
    panel.style.opacity = '0';
    panel.style.transform = 'translateY(8px)';
    setTimeout(() => panel.remove(), 520);
  }
}

function injectInto(input: HTMLElement, block: string) {
  if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
    const next = block + '\n\n' + (input.value ?? '');
    setNativeValue(input, next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    return;
  }
  if (input.isContentEditable) {
    const para = document.createElement('p');
    para.textContent = block;
    input.prepend(para, document.createElement('br'));
    input.dispatchEvent(new InputEvent('input', { bubbles: true }));
    input.focus();
    return;
  }
}

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = Object.getPrototypeOf(el);
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}
