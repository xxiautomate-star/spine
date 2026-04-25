// MV3 service worker. Three responsibilities:
//   1. Receive captured memories from content scripts, dedupe via the seen
//      cache, queue them in chrome.storage.local, then flush in batches to
//      /api/capture with exponential backoff.
//   2. Proxy /api/recall/inject calls so content scripts never need the API
//      key directly (key lives only in the worker context here).
//   3. Hygiene nudge (SPINE_HYGIENE_POLL flag, default OFF): poll
//      /api/hygiene/summary on tab focus, apply amber badge dot when
//      duplicate or stale memories need attention.

import {
  appendToQueue,
  readQueue,
  writeQueue,
  readSeen,
  writeSeen,
  getSettings,
  type QueuedMemory,
} from './common/storage.js';
import type {
  CaptureRequest,
  CaptureResponse,
  InjectRequest,
  InjectResponse,
  FlushRequest,
  FlushResponse,
  HygienePollRequest,
  HygienePollResponse,
  SpineMessage,
} from './common/messages.js';
import { createChromeHygieneStore } from './hygiene-storage.js';
import { deriveBadge, applyBadge } from './hygiene-badge.js';
import { createHygienePoller, type PollOutcome } from './hygiene-poller.js';

const FLUSH_ALARM = 'spine-flush';
const FLUSH_PERIOD_MIN = 0.5; // 30s
const MAX_BATCH = 25;
const MAX_BACKOFF_MS = 5 * 60_000;
const SESSION_KEY = 'spine:session_count';

let backoffMs = 0;
let nextAttemptAt = 0;
let flushing = false;

// In-memory session counter — persisted to chrome.storage.session so it
// survives service-worker restarts within the same browser session.
let sessionCaptured = 0;

async function initSessionCount() {
  try {
    const stored = await chrome.storage.session.get(SESSION_KEY);
    sessionCaptured = typeof stored[SESSION_KEY] === 'number' ? stored[SESSION_KEY] : 0;
    await paintBadgeCount();
  } catch {
    // chrome.storage.session may not be available in older builds.
  }
}

async function incrementSession(n: number) {
  if (n <= 0) return;
  sessionCaptured += n;
  try {
    await chrome.storage.session.set({ [SESSION_KEY]: sessionCaptured });
  } catch { /* session storage unavailable */ }
  await paintBadgeCount();
}

async function paintBadgeCount() {
  const text = sessionCaptured > 0 ? String(sessionCaptured) : '';
  await Promise.all([
    chrome.action.setBadgeText({ text }),
    chrome.action.setBadgeBackgroundColor({ color: '#E89A3C' }),
    chrome.action.setBadgeTextColor?.({ color: '#0D0C0A' }).catch(() => void 0),
  ]);
}

void initSessionCount();

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: FLUSH_PERIOD_MIN });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(FLUSH_ALARM, { periodInMinutes: FLUSH_PERIOD_MIN });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FLUSH_ALARM) {
    void flushQueue();
  }
});

chrome.runtime.onMessage.addListener(
  (msg: SpineMessage, _sender, sendResponse: (r: unknown) => void) => {
    if (msg.type === 'spine.capture') {
      void handleCapture(msg).then(sendResponse);
      return true;
    }
    if (msg.type === 'spine.inject') {
      void handleInject(msg).then(sendResponse);
      return true;
    }
    if (msg.type === 'spine.flush') {
      void handleFlush(msg).then(sendResponse);
      return true;
    }
    if (msg.type === 'spine.hygiene.poll') {
      void handleHygienePoll(msg).then(sendResponse);
      return true;
    }
    return false;
  }
);

// ── Hygiene poll ──────────────────────────────────────────────────────────

const hygieneStorage = createChromeHygieneStore();
let hygienePoller: ReturnType<typeof createHygienePoller> | null = null;

async function getHygienePoller() {
  if (hygienePoller) return hygienePoller;
  const settings = await getSettings();
  hygienePoller = createHygienePoller({
    apiBase: settings.endpoint.replace(/\/+$/, ''),
    apiKey: settings.apiKey || null,
    storage: hygieneStorage,
    onSummary: (summary) => {
      void applyBadge(deriveBadge(summary));
    },
  });
  return hygienePoller;
}

// Repaint badge from persisted state on every worker cold-start.
void hygieneStorage.get().then((s) => applyBadge(deriveBadge(s.summary)));

// Sync badge + invalidate cached poller when settings change.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes['spine:hygiene']) {
    const next = changes['spine:hygiene'].newValue as { summary?: unknown } | undefined;
    void applyBadge(
      deriveBadge((next?.summary ?? null) as Parameters<typeof deriveBadge>[0])
    );
  }
  if (area === 'sync') hygienePoller = null;
});

async function handleHygienePoll(
  _msg: HygienePollRequest
): Promise<HygienePollResponse> {
  const settings = await getSettings();
  if (!settings.hygienePoll) {
    // Flag is off — clear badge in case it was previously set.
    await applyBadge(deriveBadge(null));
    return { outcome: 'disabled' };
  }
  const poller = await getHygienePoller();
  const outcome: PollOutcome = await poller.poll();
  if (outcome !== 'fetched') {
    const state = await hygieneStorage.get();
    await applyBadge(deriveBadge(state.summary));
  }
  return { outcome };
}

// ── Memory capture ────────────────────────────────────────────────────────

async function handleCapture(msg: CaptureRequest): Promise<CaptureResponse> {
  const seen = await readSeen();
  const fresh = msg.memories.filter((m) => !seen.has(m.hash));
  if (fresh.length === 0) return { ok: true, queued: 0, flushed: 0 };

  for (const m of fresh) seen.add(m.hash);
  await writeSeen(seen);

  const now = Date.now();
  const queued: QueuedMemory[] = fresh.map((m) => ({ ...m, queuedAt: now }));
  await appendToQueue(queued);

  const flushed = await flushQueue();
  if (flushed > 0) {
    await incrementSession(flushed);
    // Async: check for new conflicts after capture settled (~4s for Haiku to run)
    setTimeout(() => void checkAndBroadcastConflicts(), 4500);
  }
  return { ok: true, queued: fresh.length, flushed };
}

async function checkAndBroadcastConflicts(): Promise<void> {
  try {
    const settings = await getSettings();
    if (!settings.apiKey) return;

    const res = await fetch(
      `${trimEnd(settings.endpoint, '/')}/api/conflicts?limit=5`,
      { headers: { Authorization: `Bearer ${settings.apiKey}` } }
    );
    if (!res.ok) return;

    const data = (await res.json()) as { conflicts?: { id: string; entity_name?: string; quote_a: string; quote_b: string }[] };
    const conflicts = data.conflicts ?? [];
    if (conflicts.length === 0) return;

    // Broadcast to all claude.ai tabs
    const tabs = await chrome.tabs.query({ url: ['*://claude.ai/*', '*://chatgpt.com/*', '*://v0.dev/*'] });
    for (const tab of tabs) {
      if (tab.id == null) continue;
      chrome.tabs.sendMessage(tab.id, {
        type: 'spine.conflicts',
        conflicts,
      }).catch(() => void 0);
    }
  } catch {
    // Swallow — non-critical
  }
}

async function handleFlush(_msg: FlushRequest): Promise<FlushResponse> {
  try {
    const flushed = await flushQueue();
    return { ok: true, flushed };
  } catch (err) {
    return { ok: false, flushed: 0, error: errMsg(err) };
  }
}

async function flushQueue(): Promise<number> {
  if (flushing) return 0;
  if (Date.now() < nextAttemptAt) return 0;

  flushing = true;
  let total = 0;
  try {
    const settings = await getSettings();
    if (!settings.apiKey) return 0;

    while (true) {
      const queue = await readQueue();
      if (queue.length === 0) break;

      const batch = queue.slice(0, MAX_BATCH);
      const url = `${trimEnd(settings.endpoint, '/')}/api/capture`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify({
          bulk: batch.map((b) => ({ content: b.content, source: b.source, tags: b.tags })),
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`capture ${res.status}: ${body.slice(0, 200)}`);
      }

      const remaining = queue.slice(batch.length);
      await writeQueue(remaining);
      total += batch.length;
      backoffMs = 0;
      nextAttemptAt = 0;

      if (remaining.length === 0) break;
    }
  } catch (err) {
    backoffMs = backoffMs === 0 ? 5_000 : Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    nextAttemptAt = Date.now() + backoffMs;
    console.warn('[spine] flush failed, retrying in', backoffMs, 'ms:', errMsg(err));
  } finally {
    flushing = false;
  }
  return total;
}

async function handleInject(msg: InjectRequest): Promise<InjectResponse> {
  try {
    const settings = await getSettings();
    if (!settings.apiKey) return { ok: false, error: 'No API key configured.' };
    if (!settings.autoInject) return { ok: false, error: 'Auto-inject disabled.' };
    if (!msg.hints || msg.hints.length === 0)
      return { ok: false, error: 'No hints provided.' };

    const url = `${trimEnd(settings.endpoint, '/')}/api/recall/inject`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        hints: msg.hints,
        per_hint: msg.perHint ?? 5,
        token_budget: msg.tokenBudget ?? 2000,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `inject ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = (await res.json()) as { block?: string; memory_count?: number };
    return { ok: true, block: data.block ?? '', memoryCount: data.memory_count ?? 0 };
  } catch (err) {
    return { ok: false, error: errMsg(err) };
  }
}

function trimEnd(s: string, ch: string): string {
  let end = s.length;
  while (end > 0 && s[end - 1] === ch) end--;
  return s.slice(0, end);
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
