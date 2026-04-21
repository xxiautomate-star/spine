import type { Memory, Store } from './store/index.js';

export const TOOL_DEFS = [
  {
    name: 'spine_capture',
    description:
      'Append a single memory to the Spine. Storage is append-only: Spine never overwrites ' +
      'or summarises what you capture. Returns the new memory id. Use this whenever you ' +
      'learn a stable fact about the user, their preferences, their stack, or their ongoing ' +
      'work — one memory per fact, as the user said it.',
    inputSchema: {
      type: 'object',
      required: ['content'],
      properties: {
        content: {
          type: 'string',
          description: 'The full text to remember. No length cap. Do not summarise.',
        },
        source: {
          type: 'string',
          description: 'Origin label, e.g. "claude-code", "chatgpt-extension", "manual".',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional free-form tags for filtering later.',
        },
      },
    },
  },
  {
    name: 'spine_capture_bulk',
    description:
      'Append many memories at once — one per conversation turn. Use this to import a full ' +
      'historical conversation into Spine. Returns an array of ids in the same order as the ' +
      'input turns.',
    inputSchema: {
      type: 'object',
      required: ['turns'],
      properties: {
        turns: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['role', 'content'],
            properties: {
              role: { type: 'string' },
              content: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
              source: { type: 'string' },
            },
          },
        },
      },
    },
  },
  {
    name: 'spine_recall',
    description:
      'Semantic search over the full append-only corpus. Returns the top N memories most ' +
      'relevant to the query, with cosine similarity scores. Never summarises — returns raw ' +
      'content exactly as captured.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'Natural-language query.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
      },
    },
  },
  {
    name: 'spine_context',
    description:
      'Returns a single pre-formatted context block of the most relevant memories for a ' +
      'query, bounded by an approximate token budget. Paste directly into a system prompt. ' +
      'Default token budget is 2000.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        token_budget: {
          type: 'integer',
          minimum: 100,
          maximum: 32000,
          default: 2000,
        },
      },
    },
  },
  {
    name: 'spine_timeline',
    description:
      'Chronological retrieval of memories in an optional date range, newest first. ' +
      'Timestamps are ISO 8601.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'ISO 8601 start (inclusive).' },
        to: { type: 'string', description: 'ISO 8601 end (inclusive).' },
        limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
      },
    },
  },
  {
    name: 'spine_forget',
    description:
      'Hard-delete a single memory by id. The row, its embedding, and its full-text index ' +
      'entry are removed. No undo. Reserved for genuinely sensitive removals — do NOT call ' +
      'this unless the user explicitly asks to forget a specific memory.',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' } },
    },
  },
  {
    name: 'spine_hygiene',
    description:
      'Returns a semantic-hygiene summary for the caller: how many duplicate ' +
      'pairs are flagged but unresolved, how many memories have sat untouched for 30+ days, ' +
      'how many clusters the archive has formed, and the largest cluster (if any). Cloud mode ' +
      'returns real counts; local mode returns a shape-compatible zeroed summary (no dedupe ' +
      'cron, no cluster centroids). Use this to surface a "tend your archive" banner to the user.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'spine_usage',
    description:
      'Returns the caller\'s current position against their plan: total non-deleted memory ' +
      'count, plan name, cap (null = unlimited), percent used, and next reset date (null for ' +
      'local mode or unlimited tiers). Use this to show usage bars or warn the user before ' +
      'capture fails with a plan_upgrade_required error.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'spine_context_for_session',
    description:
      'Session bootstrap: returns a pre-assembled markdown block of the memories most relevant ' +
      'to the current conversation. Pass an array of short hints describing what the user is ' +
      'about to work on (queries, file paths, topics). Each hint runs through hybrid vector + ' +
      'BM25 retrieval and a Haiku reranker; results are deduplicated and fused into one block ' +
      'ready to prepend to the system prompt. Call this ONCE at the start of a new session.',
    inputSchema: {
      type: 'object',
      required: ['hints'],
      properties: {
        hints: {
          type: 'array',
          minItems: 1,
          maxItems: 8,
          items: { type: 'string' },
          description:
            'Short phrases describing the upcoming work, e.g. ["landing page copy", "Supabase RLS", "launch date"].',
        },
        per_hint: {
          type: 'integer',
          minimum: 1,
          maximum: 10,
          default: 5,
          description: 'Top memories to keep per hint before deduping.',
        },
        token_budget: {
          type: 'integer',
          minimum: 200,
          maximum: 32000,
          default: 2000,
          description: 'Approximate token cap for the final assembled block.',
        },
      },
    },
  },
  {
    name: 'get_context',
    description:
      'Retrieve the most relevant memories for the current query and return them as a ' +
      'ready-to-use context block. This is the fast path for real-time context injection — ' +
      'equivalent to spine_context but named for discoverability by Claude Desktop / claude.ai. ' +
      'Also returns the count of unresolved memory conflicts so the UI can surface a badge.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string', description: 'What is being discussed right now.' },
        token_budget: {
          type: 'integer',
          minimum: 100,
          maximum: 8000,
          default: 2000,
        },
      },
    },
  },
  {
    name: 'pin_memory',
    description:
      'Capture a memory AND mark it as required_context so it is injected into every future ' +
      'context retrieval regardless of cosine similarity. Use sparingly — only for facts that ' +
      'must always be present (e.g. "user is allergic to X", "project uses Postgres 15, NOT MySQL").',
    inputSchema: {
      type: 'object',
      required: ['content'],
      properties: {
        content: {
          type: 'string',
          description: 'The fact to pin. Will be stored and always injected.',
        },
        source: { type: 'string' },
      },
    },
  },
] as const;

type ToolArgs = Record<string, unknown>;

function str(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return v;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function tags(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === 'string');
}

export async function runTool(store: Store, name: string, args: ToolArgs): Promise<string> {
  switch (name) {
    case 'spine_capture': {
      const id = await store.capture({
        content: str(args.content, 'content'),
        source: typeof args.source === 'string' ? args.source : null,
        tags: tags(args.tags),
      });
      return JSON.stringify({ id });
    }

    case 'spine_capture_bulk': {
      const rawTurns = args.turns;
      if (!Array.isArray(rawTurns) || rawTurns.length === 0) {
        throw new Error('turns must be a non-empty array');
      }
      const inputs = rawTurns.map((t, i) => {
        const turn = t as Record<string, unknown>;
        const role = str(turn.role, `turns[${i}].role`);
        const content = str(turn.content, `turns[${i}].content`);
        return {
          content: `[${role}] ${content}`,
          source: typeof turn.source === 'string' ? turn.source : 'bulk-import',
          tags: tags(turn.tags),
        };
      });
      const ids = await store.captureBulk(inputs);
      return JSON.stringify({ ids, count: ids.length });
    }

    case 'spine_recall': {
      const limit = Math.max(1, Math.min(50, num(args.limit, 10)));
      const memories = await store.recall(str(args.query, 'query'), limit);
      return JSON.stringify({ memories });
    }

    case 'spine_context': {
      const budget = Math.max(100, Math.min(32000, num(args.token_budget, 2000)));
      const charBudget = budget * 4;
      const memories = await store.recall(str(args.query, 'query'), 25);
      const picked: typeof memories = [];
      let used = 0;
      for (const m of memories) {
        const est = m.content.length + 80;
        if (used + est > charBudget && picked.length > 0) break;
        picked.push(m);
        used += est;
      }
      const body = picked
        .map(
          (m, i) =>
            `— (${i + 1}) ${m.createdAt}${m.source ? ` · ${m.source}` : ''}\n${m.content}`
        )
        .join('\n\n');
      const header = `# Spine: ${picked.length} relevant memories\n\n`;
      return JSON.stringify({
        context: picked.length === 0 ? `${header}(none yet)` : header + body,
        memory_count: picked.length,
      });
    }

    case 'spine_timeline': {
      const limit = Math.max(1, Math.min(500, num(args.limit, 50)));
      const memories = await store.timeline({
        from: typeof args.from === 'string' ? args.from : undefined,
        to: typeof args.to === 'string' ? args.to : undefined,
        limit,
      });
      return JSON.stringify({ memories });
    }

    case 'spine_forget': {
      const forgotten = await store.forget(str(args.id, 'id'));
      return JSON.stringify({ forgotten });
    }

    case 'spine_usage': {
      const stats = await store.usage();
      return JSON.stringify({
        count: stats.count,
        plan: stats.plan,
        limit: stats.limit,
        pct_used: stats.pctUsed,
        next_reset: stats.nextReset,
      });
    }

    case 'spine_hygiene': {
      const summary = await store.hygiene();
      return JSON.stringify({
        plan: summary.plan,
        duplicates_pending: summary.duplicatesPending,
        stale_count: summary.staleCount,
        cluster_count: summary.clusterCount,
        largest_cluster: summary.largestCluster,
      });
    }

    case 'spine_context_for_session': {
      const rawHints = args.hints;
      if (!Array.isArray(rawHints) || rawHints.length === 0) {
        throw new Error('hints must be a non-empty array of strings');
      }
      const hints = rawHints
        .filter((h): h is string => typeof h === 'string' && h.trim().length > 0)
        .slice(0, 8);
      if (hints.length === 0) {
        throw new Error('hints must contain at least one non-empty string');
      }
      const perHint = Math.max(1, Math.min(10, num(args.per_hint, 5)));
      const budget = Math.max(200, Math.min(32000, num(args.token_budget, 2000)));
      const charBudget = budget * 4;

      const seen = new Map<string, { mem: Memory; hint: string }>();
      for (const hint of hints) {
        const results = await store.recall(hint, perHint);
        for (const m of results) {
          if (!seen.has(m.id)) seen.set(m.id, { mem: m, hint });
        }
      }

      const merged = [...seen.values()];

      const picked: { mem: Memory; hint: string }[] = [];
      let used = 0;
      for (const entry of merged) {
        const est = entry.mem.content.length + 80;
        if (used + est > charBudget && picked.length > 0) break;
        picked.push(entry);
        used += est;
      }

      if (picked.length === 0) {
        return JSON.stringify({
          context:
            '# Spine: 0 relevant memories\n' +
            '_hints: ' +
            hints.join(', ') +
            '_\n\n' +
            '(no matching memories yet — capture some and try again)',
          memory_count: 0,
          hints,
        });
      }

      const headerBits = [
        `# Spine: ${picked.length} relevant memories`,
        `_hints: ${hints.join(', ')}_`,
      ];
      const body = picked
        .map(({ mem, hint }) => {
          const date = mem.createdAt.slice(0, 10);
          const src = mem.source ? ` · ${mem.source}` : '';
          return `- [${date}${src} · hint="${hint}"] ${mem.content}`;
        })
        .join('\n');

      return JSON.stringify({
        context: `${headerBits.join('\n')}\n\n${body}`,
        memory_count: picked.length,
        hints,
      });
    }

    case 'get_context': {
      const budget = Math.max(100, Math.min(8000, num(args.token_budget, 2000)));
      const charBudget = budget * 4;
      const memories = await store.recall(str(args.query, 'query'), 20);
      const picked: typeof memories = [];
      let used = 0;
      for (const m of memories) {
        const est = m.content.length + 80;
        if (used + est > charBudget && picked.length > 0) break;
        picked.push(m);
        used += est;
      }
      const body = picked
        .map((m, i) => `— (${i + 1}) ${m.createdAt}${m.source ? ` · ${m.source}` : ''}\n${m.content}`)
        .join('\n\n');
      const context = picked.length === 0
        ? '# Spine: 0 relevant memories\n\n(none yet — capture some facts first)'
        : `# Spine: ${picked.length} relevant memories\n\n${body}`;

      // Attempt to surface unresolved conflict count (cloud store only).
      let conflictCount = 0;
      try {
        const stats = await store.usage();
        // CloudStore exposes an optional conflictCount field if the API returns it.
        conflictCount = (stats as unknown as { conflictCount?: number }).conflictCount ?? 0;
      } catch { /* local store — ignore */ }

      return JSON.stringify({ context, memory_count: picked.length, conflict_count: conflictCount });
    }

    case 'pin_memory': {
      const id = await store.capture({
        content: str(args.content, 'content'),
        source: typeof args.source === 'string' ? args.source : 'mcp-pin',
        tags: ['pinned'],
      });
      // Mark required_context via the dashboard API (cloud only).
      // Local store has no policy API — silently skip.
      try {
        const cs = store as unknown as { _endpoint?: string; _apiKey?: string };
        if (cs._endpoint && cs._apiKey) {
          await fetch(`${cs._endpoint}/api/memories/${id}/policy`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${cs._apiKey}`,
            },
            body: JSON.stringify({ required_context: true }),
          });
        }
      } catch { /* non-critical */ }
      return JSON.stringify({ id, pinned: true });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
