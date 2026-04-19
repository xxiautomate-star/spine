// MV3 service worker. Two responsibilities:
//   1. Receive captured memories from content scripts, dedupe via the seen
//      cache, queue them in chrome.storage.local, then flush in batches to
//      /api/capture with exponential backoff.
//   2. Proxy /api/recall/inject calls so content scripts never need the API
//      key directly (key lives only in the worker context here).

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
  SpineMessage,
} from './common/messages.js';

const FLUSH_ALARM = 'spine-flush';
const FLUSH_PERIOD_MIN = 0.5; // 30s
const MAX_BATCH = 25;
const MAX_BACKOFF_MS = 5 * 60_000;

let backoffMs = 0;
let nextAttemptAt = 0;
let flushing = false;

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
    return false;
  }
);

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
  return { ok: true, queued: fresh.length, flushed };
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
