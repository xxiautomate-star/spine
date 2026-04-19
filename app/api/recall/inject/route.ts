// Auto-inject endpoint. Used by the browser extension at conversation start.
// Takes an array of hints (page title, first user message, topic), runs recall
// per hint, dedupes, and returns a pre-assembled markdown block that the
// extension can prepend to the user's first message.
//
// Accepts either POST (body) or GET (?hints=a&hints=b&hints=c).

import { NextResponse, type NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/auth';
import { rankMemories } from '@/lib/retrieval';
import { rerank } from '@/lib/rerank';
import { buildInjectionBlock, type BlockMemory } from '@/lib/context-block';
import { embedText } from '@/lib/openai';
import { getSupabase } from '@/lib/supabase';
import { withCors, preflight } from '@/lib/cors';
import { touchRetrieved } from '@/lib/retrieval-touch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return preflight();
}

type Input = {
  hints: string[];
  perHint: number;
  tokenBudget: number;
};

function normalize(raw: { hints?: unknown; per_hint?: unknown; token_budget?: unknown }): Input {
  const hints = Array.isArray(raw.hints)
    ? raw.hints.filter((h): h is string => typeof h === 'string' && h.trim().length > 0).slice(0, 8)
    : [];
  const perHint =
    typeof raw.per_hint === 'number' ? Math.max(1, Math.min(10, Math.floor(raw.per_hint))) : 5;
  const tokenBudget =
    typeof raw.token_budget === 'number'
      ? Math.max(200, Math.min(32000, Math.floor(raw.token_budget)))
      : 2000;
  return { hints, perHint, tokenBudget };
}

type Row = {
  id: string;
  content: string;
  source: string | null;
  tags: string[] | null;
  created_at: string;
  similarity: number;
};

async function recallForFree(
  userId: string,
  hint: string,
  perHint: number
): Promise<BlockMemory[]> {
  const vec = await embedText(hint);
  const supabase = getSupabase();
  if (!supabase) return [];
  const { data } = await supabase.rpc('spine_match_memories', {
    p_user: userId,
    p_query_embedding: vec,
    p_limit: perHint,
  });
  return ((data ?? []) as Row[]).map((r) => ({
    id: r.id,
    content: r.content,
    source: r.source,
    createdAt: r.created_at,
  }));
}

async function recallForPaid(
  userId: string,
  hint: string,
  perHint: number
): Promise<BlockMemory[]> {
  const candidates = await rankMemories(userId, hint, { poolLimit: 15, limit: 15 });
  if (candidates.length === 0) return [];
  try {
    const { picks } = await rerank(hint, candidates, { limit: perHint });
    if (picks.length > 0) {
      const byId = new Map(candidates.map((c) => [c.id, c]));
      return picks
        .map((p) => byId.get(p.id))
        .filter((m): m is NonNullable<typeof m> => Boolean(m))
        .map((m) => ({ id: m.id, content: m.content, source: m.source, createdAt: m.createdAt }));
    }
  } catch {
    /* fall through */
  }
  return candidates
    .slice(0, perHint)
    .map((m) => ({ id: m.id, content: m.content, source: m.source, createdAt: m.createdAt }));
}

async function assemble(
  userId: string,
  plan: 'free' | 'pro' | 'power',
  input: Input
): Promise<{ block: string; memory_count: number; hints: string[] }> {
  const seen = new Map<string, BlockMemory>();
  for (const hint of input.hints) {
    const chunk =
      plan === 'free'
        ? await recallForFree(userId, hint, input.perHint)
        : await recallForPaid(userId, hint, input.perHint);
    for (const m of chunk) {
      if (!seen.has(m.id)) seen.set(m.id, m);
    }
  }
  const memories = [...seen.values()];
  touchRetrieved(userId, memories.map((m) => m.id));
  const block = buildInjectionBlock(memories, {
    hint: input.hints.join(' / '),
    tokenBudget: input.tokenBudget,
  });
  return { block, memory_count: memories.length, hints: input.hints };
}

export async function POST(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth.authed)
    return withCors(NextResponse.json({ error: auth.error }, { status: auth.status }));

  let raw: Record<string, unknown> = {};
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return withCors(NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 }));
  }

  const input = normalize(raw);
  if (input.hints.length === 0) {
    return withCors(NextResponse.json({ error: 'hints is required' }, { status: 400 }));
  }

  try {
    const out = await assemble(auth.authed.userId, auth.authed.plan, input);
    return withCors(NextResponse.json(out));
  } catch (err) {
    return withCors(
      NextResponse.json(
        { error: err instanceof Error ? err.message : 'Inject failed.' },
        { status: 500 }
      )
    );
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireApiKey(req);
  if (!auth.authed)
    return withCors(NextResponse.json({ error: auth.error }, { status: auth.status }));
  const url = new URL(req.url);
  const hints = url.searchParams.getAll('hints');
  const perHint = Number(url.searchParams.get('per_hint') ?? '5');
  const tokenBudget = Number(url.searchParams.get('token_budget') ?? '2000');
  const input = normalize({ hints, per_hint: perHint, token_budget: tokenBudget });
  if (input.hints.length === 0) {
    return withCors(NextResponse.json({ error: 'hints is required' }, { status: 400 }));
  }
  try {
    const out = await assemble(auth.authed.userId, auth.authed.plan, input);
    return withCors(NextResponse.json(out));
  } catch (err) {
    return withCors(
      NextResponse.json(
        { error: err instanceof Error ? err.message : 'Inject failed.' },
        { status: 500 }
      )
    );
  }
}
