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
        before: { type: 'string', description: 'ISO 8601 upper bound (exclusive). Only return memories created before this date.' },
        after: { type: 'string', description: 'ISO 8601 lower bound (inclusive). Only return memories created after this date.' },
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
      'Given a task description, retrieve the most relevant memories and return them as a ' +
      'ready-to-use context block. Use this at the START of any task — paste the output into ' +
      'your system prompt so Claude has full context on related decisions, bugs, and history. ' +
      'Answers "what do I already know that is relevant to what I am about to do?"',
    inputSchema: {
      type: 'object',
      required: ['task_description'],
      properties: {
        task_description: {
          type: 'string',
          description: 'What you are about to work on, e.g. "fix the OAuth refresh token bug" or "add pagination to the users table".',
        },
        token_budget: {
          type: 'integer',
          minimum: 100,
          maximum: 8000,
          default: 2000,
        },
      },
    },
  },
  // ── Primary discovery-friendly tool names ────────────────────────────────
  // These are the canonical names for new integrations (Claude Code, Cursor,
  // Windsurf, Continue). The spine_* names above remain for backwards compat.
  {
    name: 'search_memory',
    description:
      'Search your Spine memory archive using natural language. Returns the most relevant ' +
      'stored memories ranked by semantic similarity — facts, decisions, code patterns, ' +
      'bug fixes, anything captured from previous sessions. Use this whenever the user asks ' +
      '"do we know anything about X", "what did we decide on Y", or "find the context on Z". ' +
      'Returns content exactly as captured — never summarised or paraphrased.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: {
          type: 'string',
          description: 'Natural-language search query, e.g. "OAuth bug fix last week" or "database schema decisions".',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          default: 10,
          description: 'Maximum number of memories to return.',
        },
      },
    },
  },
  {
    name: 'add_memory',
    description:
      'Permanently store a memory in Spine. The archive is append-only — every memory is kept ' +
      'forever, verbatim, and searchable across all future sessions and AI tools. Returns the ' +
      'new memory id. Use this to remember: architectural decisions, bug fixes and their causes, ' +
      'user preferences, project conventions, API keys or endpoints, anything the user says they ' +
      'want remembered. One memory per fact. Never summarise — store it as the user said it.',
    inputSchema: {
      type: 'object',
      required: ['content'],
      properties: {
        content: {
          type: 'string',
          description: 'The full text to store. No length limit. Do not summarise or compress.',
        },
        type: {
          type: 'string',
          enum: ['decision', 'bug', 'feature', 'context', 'fact'],
          default: 'context',
          description: 'Memory type. decision = architecture/product choice, bug = fix and root cause, feature = new capability, context = background/notes, fact = stable fact about the project or user.',
        },
        source: {
          type: 'string',
          description: 'Where this came from, e.g. "claude-code", "cursor", "manual".',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for grouping and filtering, e.g. ["auth", "postgres"].',
        },
      },
    },
  },
  {
    name: 'get_timeline',
    description:
      'Retrieve stored memories in reverse chronological order (newest first), optionally ' +
      'filtered by date range and/or memory type. Use this to answer "what did we work on last ' +
      'week", "show recent decisions", "list bugs fixed this month". All timestamps ISO 8601 UTC.',
    inputSchema: {
      type: 'object',
      properties: {
        from: {
          type: 'string',
          description: 'ISO 8601 start timestamp (inclusive), e.g. "2026-04-14T00:00:00Z".',
        },
        to: {
          type: 'string',
          description: 'ISO 8601 end timestamp (inclusive).',
        },
        type: {
          type: 'string',
          enum: ['decision', 'bug', 'feature', 'context', 'fact'],
          description: 'Filter to a specific memory type.',
        },
        project: {
          type: 'string',
          description: 'Filter by project tag.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 200,
          default: 20,
          description: 'Maximum number of memories to return.',
        },
      },
    },
  },
  {
    name: 'replay_file',
    description:
      'Given a file path, reconstruct the full decision history for that file — every bug fix, ' +
      'architectural decision, feature addition, and context note ever captured that mentions it. ' +
      'Results are sorted chronologically (oldest first) so you can read them as a narrative. ' +
      'Use this to answer "why was this file built this way?", "what broke here before?", or ' +
      '"show me the history of auth.ts". Combines keyword matching and semantic search.',
    inputSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: {
          type: 'string',
          description: 'File path to replay, e.g. "src/lib/auth.ts" or "app/api/users/route.ts".',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 30,
          description: 'Maximum number of memories to return.',
        },
      },
    },
  },
  {
    name: 'add_team_memory',
    description:
      'Store a memory with team visibility — it will be searchable by all members of your ' +
      'organisation, not just you. Use for shared decisions, architectural mandates, team ' +
      'conventions, and anything the whole team should know. Returns the new memory id.',
    inputSchema: {
      type: 'object',
      required: ['content'],
      properties: {
        content: {
          type: 'string',
          description: 'The memory to share with the team. Store it verbatim — do not summarise.',
        },
        type: {
          type: 'string',
          enum: ['decision', 'bug', 'feature', 'context', 'fact'],
          default: 'decision',
          description: 'Memory type.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for filtering.',
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
  {
    name: 'spine_remember',
    description:
      'Store a memory permanently. Spine is append-only — every memory is kept forever, ' +
      'verbatim, and searchable across all future sessions and AI tools. Use this to remember ' +
      'facts, decisions, preferences, or anything the user wants to persist. One memory per fact. ' +
      'Do not summarise. Returns the new memory id.',
    inputSchema: {
      type: 'object',
      required: ['body'],
      properties: {
        body: {
          type: 'string',
          description: 'The full text to store. No length limit. Do not summarise or compress.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional tags for filtering, e.g. ["auth", "postgres"].',
        },
      },
    },
  },
  // ── Conversation capture (brief 021) ─────────────────────────────────────
  {
    name: 'spine_capture_turn',
    description:
      'Append a single conversation turn to Spine. Designed for the Claude Code ' +
      'UserPromptSubmit / Stop hooks: every user message, assistant reply, and tool ' +
      'invocation can be captured as one row. Append-only — never deletes, never ' +
      'summarises. Turns are stored WITHOUT embeddings by default to keep OpenAI ' +
      'spend bounded on chatty sessions; pass embed_turns=true to opt in for power-' +
      'user semantic search across every word.',
    inputSchema: {
      type: 'object',
      required: ['session_id', 'role', 'content'],
      properties: {
        session_id: {
          type: 'string',
          description: 'Stable per-CLI-session id (Claude Code passes this on every hook).',
        },
        role: {
          type: 'string',
          enum: ['user', 'assistant', 'tool'],
          description: 'Speaker for this turn.',
        },
        content: {
          type: 'string',
          description: 'Full text of the turn. No length cap. Never summarise.',
        },
        tool_name: {
          type: 'string',
          description: 'When role=tool, the name of the tool invoked (e.g. Read, Bash).',
        },
        files_touched: {
          type: 'array',
          items: { type: 'string' },
          description: 'File paths touched by this turn — pulled from tool args when relevant.',
        },
        ts: {
          type: 'string',
          description: 'ISO 8601 timestamp. Defaults to now.',
        },
        embed_turns: {
          type: 'boolean',
          description:
            'Set true to run OpenAI embedding on this turn so it surfaces in semantic search. ' +
            'Default false: turns are recallable via recent-context and timeline, but not by ' +
            'cosine similarity. Cost tradeoff — at ~$0.00002/embed, 1000 turns ≈ $0.02.',
          default: false,
        },
        source: {
          type: 'string',
          description: 'Origin label, defaults to "claude-code".',
        },
      },
    },
  },
  {
    name: 'spine_session_digest',
    description:
      'Write the end-of-session digest as a single JSON-bodied memory. Called once at the ' +
      'SessionEnd hook. Spine NEVER summarises mid-session — this digest is the user/assistant ' +
      'pair telling Spine what mattered, written intentionally. Always embedded. Recalled at ' +
      'next session start by spine_recall_recent. Returns the new memory id.',
    inputSchema: {
      type: 'object',
      required: ['session_id'],
      properties: {
        session_id: {
          type: 'string',
          description: 'Same session id used for spine_capture_turn during this session.',
        },
        decisions: {
          type: 'array',
          items: { type: 'string' },
          description: 'Things locked, killed, or shipped this session — one per item.',
        },
        state: {
          type: 'string',
          description: 'One-paragraph project-state snapshot. What is the world like at session end?',
        },
        open_threads: {
          type: 'array',
          items: { type: 'string' },
          description: 'Unfinished work — paste these into the next session\'s SessionStart.',
        },
        mistakes: {
          type: 'array',
          items: { type: 'string' },
          description: 'Things to never repeat. One per item.',
        },
        files_touched: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files edited/created/deleted this session.',
        },
        commits: {
          type: 'array',
          items: { type: 'string' },
          description: 'Commits shipped this session. Format: "<sha7> <message>".',
        },
        source: {
          type: 'string',
          description: 'Origin label, defaults to "claude-code".',
        },
      },
    },
  },
  {
    name: 'spine_recall_recent',
    description:
      'Returns a single context block summarising the last 1-3 session digests + the most ' +
      'recent session\'s last 50 turns, formatted under a token budget. Drop the output into ' +
      'a SessionStart hook so the next conversation begins where the last one ended. ' +
      'Prioritises digests over turns: if budget is tight, every digest is included (or noted as ' +
      'truncated) before any turn is dropped.',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: {
          type: 'string',
          description: 'Reserved for multi-tenant scoping (single-tenant in v1; safe to omit).',
        },
        max_tokens: {
          type: 'integer',
          minimum: 200,
          maximum: 32000,
          default: 2000,
          description: 'Approximate token cap on the returned context block.',
        },
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
      const memType = ['decision','bug','feature','context','fact'].includes(args.type as string)
        ? (args.type as import('./store/index.js').MemoryType) : 'context' as const;
      const id = await store.capture({
        content: str(args.content, 'content'),
        type: memType,
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
      let memories = await store.recall(str(args.query, 'query'), limit * 3);
      if (typeof args.before === 'string') {
        memories = memories.filter((m) => m.createdAt < (args.before as string));
      }
      if (typeof args.after === 'string') {
        memories = memories.filter((m) => m.createdAt >= (args.after as string));
      }
      return JSON.stringify({ memories: memories.slice(0, limit) });
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
      const taskDesc = typeof args.task_description === 'string' ? args.task_description
        : typeof args.query === 'string' ? args.query  // backward compat
        : str(args.task_description, 'task_description');
      const memories = await store.recall(taskDesc, 20);
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

    // ── Primary-name aliases ───────────────────────────────────────────────
    case 'search_memory': {
      const limit = Math.max(1, Math.min(50, num(args.limit, 10)));
      const memories = await store.recall(str(args.query, 'query'), limit);
      return JSON.stringify({ memories, count: memories.length });
    }

    case 'add_memory': {
      const memType = ['decision','bug','feature','context','fact'].includes(args.type as string)
        ? (args.type as import('./store/index.js').MemoryType)
        : 'context' as const;
      const id = await store.capture({
        content: str(args.content, 'content'),
        type: memType,
        source: typeof args.source === 'string' ? args.source : null,
        tags: tags(args.tags),
      });
      return JSON.stringify({ id, stored: true, type: memType });
    }

    case 'get_timeline': {
      const limit = Math.max(1, Math.min(200, num(args.limit, 20)));
      const memType = ['decision','bug','feature','context','fact'].includes(args.type as string)
        ? (args.type as import('./store/index.js').MemoryType)
        : undefined;
      const projectFilter = typeof args.project === 'string' ? args.project : undefined;
      let memories = await store.timeline({
        from: typeof args.from === 'string' ? args.from : undefined,
        to: typeof args.to === 'string' ? args.to : undefined,
        type: memType,
        limit,
      });
      // Client-side project filter (filter by tag matching project name)
      if (projectFilter) {
        memories = memories.filter((m) => m.tags.some((t) => t === projectFilter));
      }
      return JSON.stringify({ memories, count: memories.length });
    }

    case 'replay_file': {
      const path = str(args.path, 'path');
      const limit = Math.max(1, Math.min(100, num(args.limit, 30)));
      const memories = await store.replay(path, limit);
      const filename = path.split(/[/\\]/).pop() ?? path;
      const header = memories.length === 0
        ? `# Spine Replay: ${filename}\n\nNo memories found for this file yet. Capture some decisions and bugs as you work on it.`
        : `# Spine Replay: ${filename} — ${memories.length} ${memories.length === 1 ? 'memory' : 'memories'} (oldest → newest)`;
      const body = memories.map((m, i) => {
        const date = m.createdAt.slice(0, 10);
        const typeLabel = m.type !== 'context' ? ` [${m.type}]` : '';
        const src = m.source ? ` · ${m.source}` : '';
        return `— (${i + 1}) ${date}${typeLabel}${src}\n${m.content}`;
      }).join('\n\n');
      return JSON.stringify({
        replay: memories.length === 0 ? header : `${header}\n\n${body}`,
        memories,
        count: memories.length,
        path,
      });
    }

    case 'add_team_memory': {
      const memType = ['decision','bug','feature','context','fact'].includes(args.type as string)
        ? (args.type as import('./store/index.js').MemoryType)
        : 'decision' as const;
      const extraTags = ['team', ...(tags(args.tags) ?? [])];
      const id = await store.capture({
        content: str(args.content, 'content'),
        type: memType,
        source: 'team',
        tags: extraTags,
      });
      return JSON.stringify({ id, stored: true, type: memType, visibility: 'team' });
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

    case 'spine_remember': {
      const id = await store.capture({
        content: str(args.body, 'body'),
        type: 'fact',
        source: typeof args.source === 'string' ? args.source : null,
        tags: tags(args.tags),
      });
      return JSON.stringify({ id, stored: true });
    }

    case 'spine_capture_turn': {
      const role = str(args.role, 'role');
      if (role !== 'user' && role !== 'assistant' && role !== 'tool') {
        throw new Error('role must be "user" | "assistant" | "tool"');
      }
      const filesTouched = Array.isArray(args.files_touched)
        ? args.files_touched.filter((f): f is string => typeof f === 'string' && f.length > 0)
        : undefined;
      const id = await store.captureTurn({
        sessionId: str(args.session_id, 'session_id'),
        role,
        content: str(args.content, 'content'),
        toolName: typeof args.tool_name === 'string' ? args.tool_name : undefined,
        filesTouched,
        ts: typeof args.ts === 'string' ? args.ts : undefined,
        embedTurns: args.embed_turns === true,
        source: typeof args.source === 'string' ? args.source : undefined,
      });
      return JSON.stringify({ id, stored: true, role, embedded: args.embed_turns === true });
    }

    case 'spine_session_digest': {
      const arr = (k: unknown): string[] | undefined =>
        Array.isArray(k) ? k.filter((s): s is string => typeof s === 'string') : undefined;
      const id = await store.captureDigest({
        sessionId: str(args.session_id, 'session_id'),
        decisions: arr(args.decisions),
        state: typeof args.state === 'string' ? args.state : undefined,
        openThreads: arr(args.open_threads),
        mistakes: arr(args.mistakes),
        filesTouched: arr(args.files_touched),
        commits: arr(args.commits),
        source: typeof args.source === 'string' ? args.source : undefined,
      });
      return JSON.stringify({ id, stored: true, kind: 'digest' });
    }

    case 'spine_recall_recent': {
      const maxTokens = Math.max(200, Math.min(32000, num(args.max_tokens, 2000)));
      const result = await store.recallRecent(maxTokens);
      return JSON.stringify({
        context: result.context,
        sessions_recalled: result.sessionsRecalled,
      });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
