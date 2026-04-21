import { getApiKey, getApiBase } from './config';

export interface SpineMemory {
  id: string;
  content: string;
  source: string | null;
  tags: string[] | null;
  createdAt: string;
  similarity?: number;
}

export interface CaptureResult {
  id: string;
}

export interface SearchResult {
  memories: SpineMemory[];
}

export class SpineClientError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'SpineClientError';
  }
}

async function apiFetch<T>(
  path: string,
  opts: RequestInit = {}
): Promise<T> {
  const key = getApiKey();
  const base = getApiBase();

  if (!key) {
    throw new SpineClientError('No Spine API key configured. Run: npx @xxi/spine-mcp init');
  }

  const url = `${base}${path}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
      ...opts.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let msg = `Spine API ${res.status}`;
    try {
      const json = JSON.parse(text);
      if (json.error) msg = json.error;
    } catch { /* ignore */ }
    throw new SpineClientError(msg, res.status);
  }

  return res.json() as Promise<T>;
}

export async function capture(
  content: string,
  source: string,
  tags?: string[]
): Promise<CaptureResult> {
  return apiFetch<CaptureResult>('/capture', {
    method: 'POST',
    body: JSON.stringify({ content, source, tags }),
  });
}

export async function search(
  query: string,
  limit = 10
): Promise<SearchResult> {
  return apiFetch<SearchResult>('/recall/raw', {
    method: 'POST',
    body: JSON.stringify({ query, limit }),
  });
}

export async function ping(): Promise<boolean> {
  try {
    await apiFetch('/ping', { method: 'GET' });
    return true;
  } catch {
    return false;
  }
}
