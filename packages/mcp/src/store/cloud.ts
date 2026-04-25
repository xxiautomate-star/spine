import { join } from 'node:path';
import { homedir } from 'node:os';
import { OfflineQueue } from './offline-queue.js';
import type {
  CaptureInput,
  HygieneSummary,
  Memory,
  Store,
  TimelineOpts,
  UsageStats,
} from './index.js';

export class CloudStore implements Store {
  private readonly queue: OfflineQueue;

  constructor(private readonly apiBase: string, private readonly apiKey: string) {
    const queuePath = join(homedir(), '.spine', 'offline_queue.db');
    this.queue = new OfflineQueue(queuePath);
  }

  private async req<T>(path: string, body: unknown, method: 'GET' | 'POST' = 'POST'): Promise<T> {
    const res = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: method === 'GET' ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      throw new Error(`Spine API ${path} returned ${res.status}: ${msg.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

  private async flushQueue(): Promise<void> {
    if (this.queue.size() === 0) return;
    const pending = this.queue.drain();
    try {
      if (pending.length === 1) {
        await this.req<{ id: string }>('/capture', pending[0]);
      } else {
        await this.req<{ ids: string[] }>('/capture', { bulk: pending });
      }
      this.queue.clear();
      console.error('[spine] flushed ' + pending.length + ' offline-queued memories');
    } catch {
      // flush failed — keep in queue, retry on next call
    }
  }

  private isNetworkError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    const msg = err.message.toLowerCase();
    return (
      msg.includes('fetch') ||
      msg.includes('network') ||
      msg.includes('econnrefused') ||
      msg.includes('enotfound') ||
      msg.includes('etimedout') ||
      // 5xx server errors are also treated as transient
      /returned 5\d\d/.test(msg)
    );
  }

  async capture(input: CaptureInput): Promise<string> {
    await this.flushQueue();
    try {
      const data = await this.req<{ id: string }>('/capture', input);
      return data.id;
    } catch (err) {
      if (this.isNetworkError(err)) {
        const id = this.queue.push(input);
        console.error('[spine] offline — queued memory ' + id);
        return id;
      }
      throw err;
    }
  }

  async captureBulk(inputs: CaptureInput[]): Promise<string[]> {
    if (inputs.length === 0) return [];
    await this.flushQueue();
    try {
      const data = await this.req<{ ids: string[] }>('/capture', { bulk: inputs });
      return data.ids;
    } catch (err) {
      if (this.isNetworkError(err)) {
        const ids = inputs.map((i) => this.queue.push(i));
        console.error('[spine] offline — queued ' + ids.length + ' memories');
        return ids;
      }
      throw err;
    }
  }

  async recall(query: string, limit: number): Promise<Memory[]> {
    const data = await this.req<{ memories: Memory[] }>('/recall', { query, limit });
    return data.memories;
  }

  async timeline(opts: TimelineOpts): Promise<Memory[]> {
    const data = await this.req<{ memories: Memory[] }>('/timeline', opts);
    return data.memories;
  }

  async replay(path: string, limit: number): Promise<Memory[]> {
    const data = await this.req<{ memories: Memory[] }>('/replay', { path, limit });
    return data.memories;
  }

  async forget(id: string): Promise<boolean> {
    const data = await this.req<{ forgotten: boolean }>('/forget', { id });
    return data.forgotten;
  }

  async usage(): Promise<UsageStats> {
    return this.req<UsageStats>('/usage', null, 'GET');
  }

  async hygiene(): Promise<HygieneSummary> {
    return this.req<HygieneSummary>('/hygiene/summary', null, 'GET');
  }

  close(): void {
    this.queue.close();
  }
}
