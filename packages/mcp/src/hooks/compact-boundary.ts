// compact-boundary — drain Claude's about-to-be-lost context into Spine
// BEFORE the SDK compacts.
//
// Per Anthropic Agent SDK v0.29 (2026-05-02): an `agent.on('compact_boundary')`
// event fires when the runtime is about to summarise + drop turns from
// the active context window. The handler receives the turns that are
// about to vanish.
//
// Spine's job: capture every word of those turns into the user's memory
// store BEFORE compaction runs. The user-facing demo:
//
//   1. Run a long conversation that hits the compaction threshold
//   2. Watch the `compact_boundary` event fire live
//   3. Claude loses the early turns (its own summary replaces them)
//   4. Spine still has every word — query and prove it back
//
// That's the moat. "Most AI compacts. Spine doesn't."
//
// USAGE — wire into any Claude Agent SDK consumer:
//
//   import { Agent } from '@anthropic-ai/claude-agent-sdk';
//   import { wireCompactBoundary } from 'spine-mcp/hooks/compact-boundary';
//
//   const agent = new Agent({ apiKey: ... });
//   wireCompactBoundary(agent, { spineApiKey: process.env.SPINE_API_KEY });
//
// The hook is a STUB — it has the wire-up shape but isn't validated
// against a live SDK v0.29 because we don't have the SDK installed in
// this package. The shape is forward-compat: if the SDK's event payload
// structure changes, only the `extractTurns` adapter needs updating.

import { spineCapture } from './_capture-client.js';

/**
 * Minimal interface we expect from an Anthropic Agent SDK instance.
 * Kept narrow on purpose — we don't want to take a hard dependency
 * on a specific SDK version. Any object with an `on` event-emitter
 * method satisfies it.
 */
export interface AgentLike {
  on(
    event: 'compact_boundary',
    handler: (payload: CompactBoundaryPayload) => void | Promise<void>
  ): void;
}

/**
 * Inferred shape of the `compact_boundary` payload as of SDK v0.29.
 * Update when the SDK's published types are stable. The defensive
 * extractTurns() below copes with field renames as long as the
 * payload still carries an array of turn-like objects somewhere.
 */
export interface CompactBoundaryPayload {
  // SDK v0.29 alpha: `messages` array containing the to-be-dropped turns.
  // Each entry has `role` ('user' | 'assistant' | 'tool_use' | etc) and
  // `content` (string or content-block array).
  messages?: Array<{
    role: string;
    content: string | Array<{ type: string; text?: string }>;
  }>;
  // Some intermediate releases used `turns` instead of `messages`.
  turns?: Array<{ role: string; content: unknown }>;
  // Metadata the SDK exposes about the upcoming compaction.
  reason?: string;
  conversation_id?: string;
  session_id?: string;
}

export interface WireOptions {
  /** Spine API key (`spine_live_...`). Required — no fallback. */
  spineApiKey: string;
  /** Override the Spine API base. Defaults to https://spine.xxiautomate.com. */
  spineBaseUrl?: string;
  /** Tag every captured turn with this for later filtering. Default: `source:compact_boundary` */
  sourceTag?: string;
  /** Optional logger; defaults to console.error so the host process sees it. */
  logger?: (msg: string, err?: unknown) => void;
}

/**
 * Convert the SDK's payload into a flat array of plain-text turn strings.
 * Tolerant of v0.29 vs v0.28 vs hypothetical v0.30 — picks whichever array
 * the payload actually carries, then flattens content blocks.
 */
function extractTurns(payload: CompactBoundaryPayload): string[] {
  const raw = payload.messages ?? payload.turns ?? [];
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t.content === 'string') {
      out.push(`[${t.role}] ${t.content}`);
      continue;
    }
    if (Array.isArray(t.content)) {
      const text = t.content
        .map((b) => {
          if (typeof b === 'string') return b;
          if (b && typeof b === 'object' && 'text' in b && typeof b.text === 'string') {
            return b.text;
          }
          return '';
        })
        .filter(Boolean)
        .join('\n');
      if (text) out.push(`[${t.role}] ${text}`);
    }
  }
  return out;
}

/**
 * Wire the compact_boundary hook on an SDK Agent instance.
 *
 * The handler is best-effort: if the Spine API is unreachable or returns
 * an error, we log and move on. We do NOT block the SDK's compaction —
 * blocking would change the agent's behaviour and risk the user noticing
 * a stall.
 */
export function wireCompactBoundary(
  agent: AgentLike,
  opts: WireOptions
): void {
  const sourceTag = opts.sourceTag ?? 'source:compact_boundary';
  const log = opts.logger ?? ((m, e) => console.error(`[spine/compact_boundary] ${m}`, e));

  agent.on('compact_boundary', async (payload) => {
    try {
      const turns = extractTurns(payload);
      if (turns.length === 0) {
        log('no extractable turns in payload — skipped');
        return;
      }
      const sessionId = payload.session_id ?? payload.conversation_id ?? null;
      // Bulk capture — one round-trip, one row per turn. Each row tagged
      // so the user can later filter "what did Spine save just before
      // Claude compacted in this session?"
      await spineCapture({
        apiKey: opts.spineApiKey,
        baseUrl: opts.spineBaseUrl,
        bulk: turns.map((content) => ({
          content,
          type: 'context',
          tags: [sourceTag, ...(sessionId ? [`session:${sessionId}`] : [])],
          ...(sessionId ? { session_id: sessionId, kind: 'turn' } : {}),
        })),
      });
      log(`captured ${turns.length} turns before compaction (session=${sessionId ?? 'unknown'})`);
    } catch (err) {
      log('hook failed — non-fatal, compaction proceeds:', err);
    }
  });
}
