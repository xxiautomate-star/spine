import type {
  CaptureInput,
  HygieneSummary,
  Memory,
  Store,
  TimelineOpts,
  UsageStats,
} from './index.js';

export class CloudStore implements Store {
  constructor(private readonly apiBase: string, private readonly apiKey: string) {}

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

  async capture(input: CaptureInput): Promise<string> {
    const data = await this.req<{ id: string }>('/capture', input);
    return data.id;
  }

  async captureBulk(inputs: CaptureInput[]): Promise<string[]> {
    if (inputs.length === 0) return [];
    const data = await this.req<{ ids: string[] }>('/capture', { bulk: inputs });
    return data.ids;
  }

  async recall(query: string, limit: number): Promise<Memory[]> {
    const data = await this.req<{ memories: Memory[] }>('/recall', { query, limit });
    return data.memories;
  }

  async timeline(opts: TimelineOpts): Promise<Memory[]> {
    const data = await this.req<{ memories: Memory[] }>('/timeline', opts);
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
    /* no-op: cloud store has no local handles to release */
  }
}
