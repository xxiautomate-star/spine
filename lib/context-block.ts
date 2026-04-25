// Builds the pre-assembled string block used by /api/recall's `block` field and
// by the MCP `spine_context_for_session` tool. Format is intentionally boring
// markdown so any LLM can parse it without extra instructions.
//
// v1.1 (Round 16): every line now carries provenance —
//   [age:18d confirmed:2026-04-06 src:claude-code]
// so the receiving AI can weight confidence instead of treating all memories
// as equal-authority.

export type BlockMemory = {
  id: string;
  content: string;
  source: string | null;
  createdAt: string;
  lastConfirmedAt?: string | null;
  supersededBy?: string | null;
};

export type BuildOptions = {
  query?: string;
  hint?: string;
  /** ~4 chars per token. Default budget is ~2000 tokens. */
  tokenBudget?: number;
  /** Include provenance tags on each line. Default true. */
  provenance?: boolean;
};

function estChars(tokens: number): number {
  return tokens * 4;
}

function daysBetween(a: number, b: number): number {
  return Math.max(0, Math.floor((a - b) / 86_400_000));
}

function formatProvenance(m: BlockMemory): string {
  const now = Date.now();
  const age = daysBetween(now, new Date(m.createdAt).getTime());
  const bits: string[] = [`age:${age}d`];
  if (m.lastConfirmedAt) {
    bits.push(`confirmed:${m.lastConfirmedAt.slice(0, 10)}`);
  }
  if (m.source) bits.push(`src:${m.source}`);
  if (m.supersededBy) bits.push('superseded');
  return `[${bits.join(' ')}]`;
}

function formatLine(m: BlockMemory, withProvenance: boolean): string {
  const date = m.createdAt.slice(0, 10);
  const src = m.source ? ` · ${m.source}` : '';
  if (!withProvenance) return `- [${date}${src}] ${m.content}`;
  const prov = formatProvenance(m);
  return `- [${date}${src}] ${m.content} ${prov}`;
}

export function buildInjectionBlock(
  memories: BlockMemory[],
  opts: BuildOptions = {}
): string {
  if (memories.length === 0) return '';

  const withProvenance = opts.provenance ?? true;
  const charBudget = estChars(opts.tokenBudget ?? 2000);
  const headerBits: string[] = [`# Spine: ${memories.length} relevant memories`];
  if (opts.hint) headerBits.push(`_hint: ${opts.hint}_`);
  if (opts.query) headerBits.push(`_query: ${opts.query}_`);
  if (withProvenance) {
    headerBits.push('_each line carries [age · confirmed · src] so weight confidence accordingly_');
  }
  const header = headerBits.join('\n');

  const picked: BlockMemory[] = [];
  let used = header.length + 2;
  for (const m of memories) {
    const line = formatLine(m, withProvenance);
    if (used + line.length + 1 > charBudget && picked.length > 0) break;
    picked.push(m);
    used += line.length + 1;
  }

  const body = picked.map((m) => formatLine(m, withProvenance)).join('\n');

  return `${header}\n\n${body}`;
}
