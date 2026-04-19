// Discriminated union for chrome.runtime message passing between content
// scripts and the background service worker.

export type CapturedMemory = {
  content: string;
  source: string;
  tags: string[];
  hash: string;
};

export type CaptureRequest = {
  type: 'spine.capture';
  memories: CapturedMemory[];
};

export type CaptureResponse = {
  ok: boolean;
  queued: number;
  flushed: number;
  error?: string;
};

export type InjectRequest = {
  type: 'spine.inject';
  hints: string[];
  perHint?: number;
  tokenBudget?: number;
};

export type InjectResponse = {
  ok: boolean;
  block?: string;
  memoryCount?: number;
  error?: string;
};

export type FlushRequest = { type: 'spine.flush' };

export type FlushResponse = { ok: boolean; flushed: number; error?: string };

export type SpineMessage = CaptureRequest | InjectRequest | FlushRequest;
