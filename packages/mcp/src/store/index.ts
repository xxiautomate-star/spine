export type Memory = {
  id: string;
  content: string;
  source: string | null;
  tags: string[];
  createdAt: string;
  similarity?: number;
};

export type CaptureInput = {
  content: string;
  source?: string | null;
  tags?: string[];
};

export type TimelineOpts = {
  from?: string;
  to?: string;
  limit: number;
};

export type UsageStats = {
  count: number;
  plan: string;
  limit: number | null;
  pctUsed: number;
  nextReset: string | null;
};

export interface Store {
  capture(input: CaptureInput): Promise<string>;
  captureBulk(inputs: CaptureInput[]): Promise<string[]>;
  recall(query: string, limit: number): Promise<Memory[]>;
  timeline(opts: TimelineOpts): Promise<Memory[]>;
  forget(id: string): Promise<boolean>;
  usage(): Promise<UsageStats>;
  close(): void;
}
