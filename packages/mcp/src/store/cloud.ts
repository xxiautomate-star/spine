import { join } from 'node:path';
import { homedir } from 'node:os';
import { OfflineQueue } from './offline-queue.js';
import type {
  CaptureInput,
  DigestPayload,
  HygieneSummary,
  Memory,
  RecallRecentResult,
  Store,
  TimelineOpts,
  TurnInput,
  UsageStats,
} from './index.js';

function captureInputToWire(input: CaptureInput): Record<string, unknown> {
  const out: Record<string, unknown> = {
    content: input.content,
    source: input.source ?? null,
    tags: input.tags,
    type: input.type,
  };
  if (input.sessionId) out.session_id = input.sessionId;
  if (input.kind) out.kind = input.kind;
  if (input.toolName) out.tool_name = input.toolName;
  if (input.filesTouched && input.filesTouched.length > 0) out.files_touched = input.filesTouched;
  if (input.embedTurns) out.embed_turns = true;
  return out;
}

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
      const data = await this.req<{ id: string }>('/capture', captureInputToWire(input));
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
      const data = await this.req<{ ids: string[] }>('/capture', {
        bulk: inputs.map(captureInputToWire),
      });
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

  async captureTurn(input: TurnInput): Promise<string> {
    const ts = input.ts ?? new Date().toISOString();
    const tagBase = ['session-turn', `session:${input.sessionId.slice(0, 8)}`, `role:${input.role}`];
    if (input.toolName) tagBase.push(`tool:${input.toolName}`);
    return this.capture({
      content: `[${input.role}${input.toolName ? `:${input.toolName}` : ''}] ${input.content}`,
      source: input.source ?? 'claude-code',
      tags: tagBase,
      type: 'context',
      sessionId: input.sessionId,
      kind: 'turn',
      toolName: input.toolName ?? null,
      filesTouched: input.filesTouched,
      embedTurns: input.embedTurns === true,
    });
  }

  async captureDigest(input: DigestPayload): Promise<string> {
    const body = JSON.stringify(
      {
        decisions: input.decisions ?? [],
        state: input.state ?? '',
        open_threads: input.openThreads ?? [],
        mistakes: input.mistakes ?? [],
        files_touched: input.filesTouched ?? [],
        commits: input.commits ?? [],
      },
      null,
      2
    );
    return this.capture({
      content: body,
      source: input.source ?? 'claude-code',
      tags: ['session-digest', `session:${input.sessionId.slice(0, 8)}`, 'digest'],
      type: 'context',
      sessionId: input.sessionId,
      kind: 'digest',
      filesTouched: input.filesTouched,
    });
  }

  async recallRecent(maxTokens: number): Promise<RecallRecentResult> {
    const data = await this.req<{
      context: string;
      sessions_recalled: number;
    }>('/recall/recent', { max_tokens: maxTokens });
    return {
      context: data.context,
      sessionsRecalled: data.sessions_recalled,
    };
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
