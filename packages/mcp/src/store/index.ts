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
  // Conversation capture (brief 021).
  sessionId?: string | null;
  kind?: 'turn' | 'digest' | null;
  toolName?: string | null;
  filesTouched?: string[];
  embedTurns?: boolean;
};

export type TurnInput = {
  sessionId: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  filesTouched?: string[];
  ts?: string;
  embedTurns?: boolean;
  source?: string;
};

export type DigestPayload = {
  sessionId: string;
  decisions?: string[];
  state?: string;
  openThreads?: string[];
  mistakes?: string[];
  filesTouched?: string[];
  commits?: string[];
  source?: string;
};

export type RecallRecentResult = {
  context: string;
  sessionsRecalled: number;
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
  captureTurn(input: TurnInput): Promise<string>;
  captureDigest(input: DigestPayload): Promise<string>;
  recall(query: string, limit: number): Promise<Memory[]>;
  recallRecent(maxTokens: number): Promise<RecallRecentResult>;
  timeline(opts: TimelineOpts): Promise<Memory[]>;
  replay(path: string, limit: number): Promise<Memory[]>;
  forget(id: string): Promise<boolean>;
  usage(): Promise<UsageStats>;
  hygiene(): Promise<HygieneSummary>;
  close(): void;
}
