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
  // Caller importance signal — overrides the auto-scorer at write-time so
  // mid-thread "remember this!" captures rank above noise immediately.
  // Accepts the SignalTier strings, or a numeric 0–1 score.
  importance?: 'high' | 'standard' | 'low' | number;
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

// Weekly multi-session digest rollup (brief 022).
export type WeeklyDigestPayload = {
  themes: string[];
  decisions: string[];
  open_threads: string[];
  commits: string[];
  session_count: number;
  generated_at: string;
};

export type WeeklyDigestResult =
  | {
      ok: true;
      id: string;
      week: string;
      cached: boolean;
      payload: WeeklyDigestPayload;
      markdown: string;
    }
  | {
      ok: false;
      week: string;
      skipped: string;
      error?: string;
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
  weeklyDigest(opts: { week?: string; force?: boolean }): Promise<WeeklyDigestResult>;
  timeline(opts: TimelineOpts): Promise<Memory[]>;
  replay(path: string, limit: number): Promise<Memory[]>;
  forget(id: string): Promise<boolean>;
  usage(): Promise<UsageStats>;
  hygiene(): Promise<HygieneSummary>;
  close(): void;
}
