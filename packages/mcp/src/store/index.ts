export type MemoryType = 'decision' | 'bug' | 'feature' | 'context' | 'fact';

export type Memory = {
  id: string;
  content: string;
  source: string | null;
  tags: string[];
  type: MemoryType;
  createdAt: string;
  similarity?: number;
};

export type CaptureInput = {
  content: string;
  source?: string | null;
  tags?: string[];
  type?: MemoryType;
};

export type TimelineOpts = {
  from?: string;
  to?: string;
  limit: number;
  type?: MemoryType;
};

export type UsageStats = {
  count: number;
  plan: string;
  limit: number | null;
  pctUsed: number;
  nextReset: string | null;
};

export type HygieneSummary = {
  plan: string;
  duplicatesPending: number;
  staleCount: number;
  clusterCount: number;
  largestCluster: { label: string; size: number } | null;
};

export interface Store {
  capture(input: CaptureInput): Promise<string>;
  captureBulk(inputs: CaptureInput[]): Promise<string[]>;
  recall(query: string, limit: number): Promise<Memory[]>;
  timeline(opts: TimelineOpts): Promise<Memory[]>;
  replay(path: string, limit: number): Promise<Memory[]>;
  forget(id: string): Promise<boolean>;
  usage(): Promise<UsageStats>;
  hygiene(): Promise<HygieneSummary>;
  close(): void;
}
