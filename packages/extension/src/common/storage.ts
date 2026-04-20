// Typed wrappers over chrome.storage.sync. Settings live across devices for
// the signed-in Chrome profile; the queue/seen-id caches live in chrome.storage.local
// because they are device-specific and can grow.

export type Settings = {
  apiKey: string;
  endpoint: string;
  captureChatGPT: boolean;
  captureGemini: boolean;
  autoInject: boolean;
  // Hygiene nudge — periodically polls /api/hygiene/summary on tab
  // focus and paints a badge dot when duplicate or stale memories need
  // attention. Defaults OFF; user flips it from the options page.
  hygienePoll: boolean;
};

export const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  endpoint: 'https://spine.xxiautomate.com',
  captureChatGPT: true,
  captureGemini: true,
  autoInject: true,
  hygienePoll: false,
};

const SETTINGS_KEY = 'spine_settings_v1';
const QUEUE_KEY = 'spine_queue_v1';
const SEEN_KEY = 'spine_seen_v1';

export async function getSettings(): Promise<Settings> {
  const out = await chrome.storage.sync.get(SETTINGS_KEY);
  const raw = (out[SETTINGS_KEY] ?? {}) as Partial<Settings>;
  return { ...DEFAULT_SETTINGS, ...raw };
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: next });
  return next;
}

export type QueuedMemory = {
  content: string;
  source: string;
  tags: string[];
  hash: string;
  queuedAt: number;
};

export async function readQueue(): Promise<QueuedMemory[]> {
  const out = await chrome.storage.local.get(QUEUE_KEY);
  return (out[QUEUE_KEY] ?? []) as QueuedMemory[];
}

export async function writeQueue(items: QueuedMemory[]): Promise<void> {
  await chrome.storage.local.set({ [QUEUE_KEY]: items });
}

export async function appendToQueue(items: QueuedMemory[]): Promise<void> {
  if (items.length === 0) return;
  const current = await readQueue();
  await writeQueue([...current, ...items]);
}

const SEEN_CAP = 5000;

export async function readSeen(): Promise<Set<string>> {
  const out = await chrome.storage.local.get(SEEN_KEY);
  const arr = (out[SEEN_KEY] ?? []) as string[];
  return new Set(arr);
}

export async function writeSeen(seen: Set<string>): Promise<void> {
  let arr = [...seen];
  if (arr.length > SEEN_CAP) arr = arr.slice(arr.length - SEEN_CAP);
  await chrome.storage.local.set({ [SEEN_KEY]: arr });
}
