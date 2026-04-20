// Toolbar popup. Shows queue depth + last sync, lets the user force a flush
// or jump to settings. Also surfaces a hygiene summary read from the
// background's cached chrome.storage.local['spine:hygiene'] — zero extra
// network fetch.

import { readQueue, getSettings, type Settings } from '../common/storage.js';
import type { FlushRequest, FlushResponse } from '../common/messages.js';

// Minimal shape check — avoids importing the full hygiene-storage module
// just for a type guard in the popup. Matches the HygieneState layout.
type CachedSummary = {
  duplicatesPending: number;
  staleCount: number;
};
type CachedState = { summary: CachedSummary | null };

function parseCached(raw: unknown): CachedState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const s = r.summary;
  if (!s || typeof s !== 'object') return { summary: null };
  const sum = s as Record<string, unknown>;
  if (
    typeof sum.duplicatesPending !== 'number' ||
    typeof sum.staleCount !== 'number'
  )
    return { summary: null };
  return {
    summary: {
      duplicatesPending: sum.duplicatesPending,
      staleCount: sum.staleCount,
    },
  };
}

function q<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function renderHygiene(settings: Settings, cached: CachedState | null): void {
  const msg = q('hygieneMsg');
  const statsEl = q('hygieneStats');
  const dupsEl = q('statDups');
  const staleEl = q('statStale');
  const linkEl = q<HTMLAnchorElement>('archiveLink');
  if (!msg || !statsEl || !dupsEl || !staleEl || !linkEl) return;

  const summary = cached?.summary ?? null;

  if (!settings.hygienePoll || !summary) {
    // Nudge is disabled or no background data yet — neutral, not error.
    msg.textContent = 'No data yet.';
    msg.hidden = false;
    statsEl.hidden = true;
    return;
  }

  msg.hidden = true;
  statsEl.hidden = false;
  dupsEl.textContent = String(summary.duplicatesPending);
  staleEl.textContent = String(summary.staleCount);

  const base = settings.endpoint.replace(/\/+$/, '');
  linkEl.onclick = (e) => {
    e.preventDefault();
    void chrome.tabs.create({ url: `${base}/dashboard/hygiene` });
  };
}

async function refresh() {
  const status = q('status');
  if (!status) return;

  const [queue, settings, hygieneBag] = await Promise.all([
    readQueue(),
    getSettings(),
    chrome.storage.local.get('spine:hygiene'),
  ]);

  if (!settings.apiKey) {
    status.textContent = 'No API key yet. Open settings to paste one from your dashboard.';
  } else if (queue.length === 0) {
    status.textContent = 'Up to date. Spine is listening on the sites you enabled.';
  } else {
    status.textContent = `${queue.length} ${queue.length === 1 ? 'memory' : 'memories'} queued for sync.`;
  }

  const cached = parseCached(hygieneBag['spine:hygiene']);
  renderHygiene(settings, cached);
}

document.addEventListener('DOMContentLoaded', () => {
  void refresh();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['spine:hygiene']) void refresh();
  });

  const flush = q<HTMLButtonElement>('flush');
  flush?.addEventListener('click', async () => {
    flush.disabled = true;
    const original = flush.textContent;
    flush.textContent = 'Flushing\u2026';
    try {
      const msg: FlushRequest = { type: 'spine.flush' };
      const res = (await chrome.runtime.sendMessage(msg)) as FlushResponse | undefined;
      const status = q('status');
      if (status) {
        if (res?.ok) status.textContent = `Sent ${res.flushed}.`;
        else status.textContent = res?.error ?? 'Flush failed.';
      }
    } finally {
      flush.disabled = false;
      flush.textContent = original ?? 'Flush queue';
      void refresh();
    }
  });

  const open = q<HTMLButtonElement>('open');
  open?.addEventListener('click', () => {
    void chrome.runtime.openOptionsPage();
  });
});
