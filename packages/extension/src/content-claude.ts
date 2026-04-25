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

// ── Cross-session HUD ─────────────────────────────────────────────────────
// Watches the Claude prompt input. After 800ms idle with >18 chars, checks
// /api/recall/context-match. If a strong match is found, injects a HUD card
// above the input so the user sees "You solved this on Apr 14" before sending.

(function initHud() {
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let lastQuery = '';

  function removeHud() {
    document.getElementById('spine-hud')?.remove();
  }

  async function checkMatch(query: string) {
    if (query === lastQuery) return;
    lastQuery = query;

    // Get settings to find API key + endpoint.
    const storageData = await chrome.storage.sync.get(['spine:settings']);
    const settings = (storageData['spine:settings'] ?? {}) as {
      apiKey?: string;
      endpoint?: string;
      autoInject?: boolean;
    };

    if (!settings.apiKey || !settings.autoInject) return;

    const endpoint = (settings.endpoint ?? 'https://spine.xxiautomate.com').replace(/\/+$/, '');

    try {
      const res = await fetch(`${endpoint}/api/recall/context-match`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify({ query }),
      });

      if (!res.ok) return;
      const data = (await res.json()) as {
        matched: boolean;
        headline?: string;
        snippet?: string;
        source?: string | null;
        createdAt?: string;
        continueUrl?: string;
        confidence?: string;
      };

      if (!data.matched) { removeHud(); return; }

      // Remove existing HUD before injecting new one.
      removeHud();

      const confidenceColor = data.confidence === 'exact' ? '#E89A3C' : '#4A5E7A';
      const borderColor = data.confidence === 'exact'
        ? 'rgba(232,154,60,0.35)' : 'rgba(74,94,122,0.35)';
      const sourceLabel = data.source ?? 'your archive';
      const dateStr = data.createdAt
        ? new Date(data.createdAt).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })
        : '';
      const snippet = (data.snippet ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const continueUrl = data.continueUrl && data.continueUrl !== '#' ? data.continueUrl : null;

      const hudEl = document.createElement('div');
      hudEl.innerHTML = `<div id="spine-hud" style="
        position:fixed;bottom:80px;right:20px;z-index:2147483647;max-width:360px;
        background:rgba(13,12,10,0.97);border:1px solid ${borderColor};
        border-radius:12px;padding:16px;box-shadow:0 8px 40px rgba(0,0,0,0.6);
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        color:#E8E4DD;animation:spineHudIn 0.3s cubic-bezier(0.2,0.7,0.2,1) both;
      ">
        <style>@keyframes spineHudIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}</style>
        <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;">
          <div style="width:6px;height:6px;border-radius:50%;background:${confidenceColor};flex-shrink:0;margin-top:5px;"></div>
          <div>
            <p style="margin:0;font-size:12px;font-weight:600;color:${confidenceColor};">${data.headline ?? 'Prior answer found.'}</p>
            <p style="margin:2px 0 0;font-size:10px;color:rgba(232,228,221,0.3);font-family:monospace;text-transform:uppercase;letter-spacing:0.06em;">${sourceLabel}${dateStr ? ' · ' + dateStr : ''}</p>
          </div>
          <button onclick="document.getElementById('spine-hud').remove()" style="margin-left:auto;flex-shrink:0;background:none;border:none;cursor:pointer;color:rgba(232,228,221,0.3);font-size:18px;line-height:1;padding:0;">×</button>
        </div>
        <p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:rgba(232,228,221,0.75);">${snippet}</p>
        <div style="display:flex;align-items:center;gap:12px;">
          ${continueUrl ? `<a href="${continueUrl}" target="_blank" style="font-size:10px;font-family:monospace;text-transform:uppercase;letter-spacing:0.1em;color:${confidenceColor};text-decoration:none;border-bottom:1px solid rgba(232,154,60,0.3);padding-bottom:1px;">Continue →</a>` : ''}
          <a href="${endpoint}/timeline" target="_blank" style="font-size:10px;font-family:monospace;text-transform:uppercase;letter-spacing:0.1em;color:rgba(232,228,221,0.25);text-decoration:none;">Archive</a>
        </div>
      </div>`;

      document.body.appendChild(hudEl.firstElementChild!);

      // Auto-dismiss after 12s.
      setTimeout(removeHud, 12_000);
    } catch {
      // Network error — fail silently.
    }
  }

  function watchInput() {
    const input = driver.getPromptInput();
    if (!input) return;

    input.addEventListener('input', () => {
      const text = (input.innerText ?? input.textContent ?? '').trim();
      if (debounce) clearTimeout(debounce);
      if (text.length < 18) { removeHud(); return; }
      debounce = setTimeout(() => void checkMatch(text), 800);
    });

    input.addEventListener('keydown', (e: Event) => {
      // Clear HUD when user submits.
      if ((e as KeyboardEvent).key === 'Enter' && !(e as KeyboardEvent).shiftKey) {
        removeHud();
        lastQuery = '';
      }
    });
  }

  // Retry until the input mounts (SPA — may take a moment after navigation).
  let attempts = 0;
  const findInput = setInterval(() => {
    attempts++;
    if (driver.getPromptInput()) { watchInput(); clearInterval(findInput); }
    if (attempts > 30) clearInterval(findInput);
  }, 500);

  // Re-attach on SPA navigation.
  window.addEventListener('popstate', () => {
    clearInterval(findInput);
    removeHud();
    lastQuery = '';
    setTimeout(initHud, 800);
  });
})();

// ── Conflict HUD ──────────────────────────────────────────────────────────────

(function initConflictHud() {
  const CONFLICT_HUD_ID = 'spine-conflict-hud';

  function removeConflictHud() {
    document.getElementById(CONFLICT_HUD_ID)?.remove();
  }

  function showConflictHud(conflicts: { id: string; entity_name?: string; quote_a: string; quote_b: string }[]) {
    removeConflictHud();
    if (conflicts.length === 0) return;

    const c = conflicts[0];
    const entity = c.entity_name ? `<strong>${c.entity_name}</strong> ` : '';
    const quoteA = c.quote_a.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const quoteB = c.quote_b.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const more = conflicts.length > 1 ? `<p style="margin:8px 0 0;font-size:10px;color:rgba(232,228,221,0.25);font-family:monospace;">+${conflicts.length - 1} more conflict${conflicts.length > 2 ? 's' : ''}</p>` : '';

    const el = document.createElement('div');
    el.id = CONFLICT_HUD_ID;
    el.innerHTML = `
      <style>@keyframes spineConflictIn{from{opacity:0;transform:translateX(12px)}to{opacity:1;transform:translateX(0)}}</style>
      <div style="
        position:fixed;top:80px;right:20px;z-index:2147483647;max-width:380px;
        background:rgba(13,12,10,0.97);border:1px solid rgba(232,100,60,0.4);
        border-radius:12px;padding:16px;box-shadow:0 8px 40px rgba(0,0,0,0.7);
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        color:#E8E4DD;animation:spineConflictIn 0.35s cubic-bezier(0.2,0.7,0.2,1) both;
      ">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
          <div style="width:6px;height:6px;border-radius:50%;background:#E8643C;flex-shrink:0;"></div>
          <p style="margin:0;font-size:11px;font-weight:600;color:#E8643C;text-transform:uppercase;letter-spacing:0.08em;font-family:monospace;">Memory conflict</p>
          <button onclick="document.getElementById('${CONFLICT_HUD_ID}').remove()" style="margin-left:auto;background:none;border:none;cursor:pointer;color:rgba(232,228,221,0.3);font-size:18px;line-height:1;padding:0;">×</button>
        </div>
        <p style="margin:0 0 10px;font-size:12px;color:rgba(232,228,221,0.55);">Spine detected a contradiction in ${entity}your memories.</p>
        <div style="background:rgba(232,228,221,0.04);border-radius:8px;padding:10px;margin-bottom:8px;">
          <p style="margin:0 0 2px;font-size:9px;color:rgba(232,228,221,0.3);text-transform:uppercase;letter-spacing:0.1em;font-family:monospace;">Before</p>
          <p style="margin:0;font-size:12px;line-height:1.5;color:rgba(232,228,221,0.65);">"${quoteA}"</p>
        </div>
        <div style="background:rgba(232,228,221,0.04);border-radius:8px;padding:10px;margin-bottom:12px;">
          <p style="margin:0 0 2px;font-size:9px;color:rgba(232,228,221,0.3);text-transform:uppercase;letter-spacing:0.1em;font-family:monospace;">Now</p>
          <p style="margin:0;font-size:12px;line-height:1.5;color:rgba(232,228,221,0.85);">"${quoteB}"</p>
        </div>
        <div style="display:flex;align-items:center;gap:12px;">
          <a href="${window.location.origin.includes('claude.ai') ? 'https://spine.xxiautomate.com' : 'https://spine.xxiautomate.com'}/timeline?conflicts=1" target="_blank" style="font-size:10px;font-family:monospace;text-transform:uppercase;letter-spacing:0.1em;color:#E89A3C;text-decoration:none;border-bottom:1px solid rgba(232,154,60,0.3);padding-bottom:1px;">Resolve →</a>
          <button onclick="document.getElementById('${CONFLICT_HUD_ID}').remove()" style="font-size:10px;font-family:monospace;text-transform:uppercase;letter-spacing:0.1em;color:rgba(232,228,221,0.25);background:none;border:none;cursor:pointer;padding:0;">Dismiss</button>
        </div>
        ${more}
      </div>
    `;

    document.body.appendChild(el);
    setTimeout(removeConflictHud, 18_000);
  }

  // Listen for background messages.
  chrome.runtime.onMessage.addListener((msg: { type?: string; conflicts?: unknown[] }) => {
    if (msg.type === 'spine.conflicts' && Array.isArray(msg.conflicts)) {
      showConflictHud(msg.conflicts as Parameters<typeof showConflictHud>[0]);
    }
  });
})();
