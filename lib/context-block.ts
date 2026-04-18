// Builds the pre-assembled string block used by /api/recall's `block` field and
// by the MCP `spine_context_for_session` tool. Format is intentionally boring
// markdown so any LLM can parse it without extra instructions.

export type BlockMemory = {
  id: string;
  content: string;
  source: string | null;
  createdAt: string;
};

export type BuildOptions = {
  query?: string;
  hint?: string;
  /** ~4 chars per token. Default budget is ~2000 tokens. */
  tokenBudget?: number;
};

function estChars(tokens: number): number {
  return tokens * 4;
}

export function buildInjectionBlock(
  memories: BlockMemory[],
  opts: BuildOptions = {}
): string {
  if (memories.length === 0) return '';

  const charBudget = estChars(opts.tokenBudget ?? 2000);
  const headerBits: string[] = [`# Spine: ${memories.length} relevant memories`];
  if (opts.hint) headerBits.push(`_hint: ${opts.hint}_`);
  if (opts.query) headerBits.push(`_query: ${opts.query}_`);
  const header = headerBits.join('\n');

  const picked: BlockMemory[] = [];
  let used = header.length + 2;
  for (const m of memories) {
    const date = m.createdAt.slice(0, 10);
    const src = m.source ? ` · ${m.source}` : '';
    const line = `- [${date}${src}] ${m.content}`;
    if (used + line.length + 1 > charBudget && picked.length > 0) break;
    picked.push(m);
    used += line.length + 1;
  }

  const body = picked
    .map((m) => {
      const date = m.createdAt.slice(0, 10);
      const src = m.source ? ` · ${m.source}` : '';
      return `- [${date}${src}] ${m.content}`;
    })
    .join('\n');

  return `${header}\n\n${body}`;
}
