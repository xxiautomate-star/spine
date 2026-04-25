// Public candidates endpoint for /spine/why.
//
// Returns the full pool (up to 20) for a query — each with normalised signals
// and the cross-encoder score — so the browser can recompute the 4-signal
// fusion client-side as sliders move. No server round-trip needed to reorder.
//
// Demo-corpus only. No auth, rate-limited.

import { NextResponse, type NextRequest } from 'next/server';
import { rankMemoriesV2 } from '@/lib/rerank-v2';
import { crossEncoderRerank } from '@/lib/cross-encoder';
import { withCors, preflight } from '@/lib/cors';
import { checkRateLimit } from '@/lib/rate-limit';
import { logRecall, type LoggedCandidate } from '@/lib/recall-log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function OPTIONS() {
  return preflight();
}

function clientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export async function GET(req: NextRequest) {
  const demoUserId = process.env.SPINE_DEMO_USER_ID;
  if (!demoUserId) {
    return withCors(
      NextResponse.json({ error: 'SPINE_DEMO_USER_ID not set' }, { status: 503 })
    );
  }
  if (!checkRateLimit(clientIp(req))) {
    return withCors(NextResponse.json({ error: 'rate limit' }, { status: 429 }));
  }

  const query = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (!query) return withCors(NextResponse.json({ error: 'q required' }, { status: 400 }));
  const poolK = Math.max(1, Math.min(40, Number(req.nextUrl.searchParams.get('pool_k') ?? '20')));

  const t0 = Date.now();
  let ranked;
  try {
    ranked = await rankMemoriesV2(demoUserId, query, { poolLimit: poolK, limit: poolK });
  } catch (err) {
    return withCors(
      NextResponse.json(
        { error: err instanceof Error ? err.message : 'Ranking failed.' },
        { status: 500 }
      )
    );
  }

  // Cross-encoder on the full pool so the /spine/why chart can show all 20
  // cross-encoder scores alongside the slider-reactive fused score.
  let crossScores: Record<string, number> = {};
  let provider: string | null = null;
  let cached = false;
  if (ranked.candidates.length > 0) {
    try {
      const rr = await crossEncoderRerank(
        query,
        ranked.candidates.map((c) => ({
          id: c.id,
          content: c.content,
          source: c.source,
          createdAt: c.createdAt,
        })),
        { limit: ranked.candidates.length }
      );
      provider = rr.provider;
      cached = Boolean(rr.cached);
      for (const p of rr.picks) crossScores[p.id] = p.score;
    } catch {
      // fall through — fused-only is still informative
    }
  }

  const latencyMs = Date.now() - t0;

  const pool = ranked.candidates.map((c) => ({
    id: c.id,
    content: c.content,
    source: c.source,
    tags: c.tags,
    createdAt: c.createdAt,
    supersededBy: c.supersededBy,
    // Normalised signals — client multiplies by slider weights to recompute.
    signals: {
      bm25: c.why.bm25,
      vec: c.why.vec,
      recency: c.why.recency,
      centrality: c.why.centrality,
    },
    fused_final: c.why.final,
    dominant: c.why.dominant,
    cross_encoder_score: crossScores[c.id] ?? null,
  }));

  // Log the pool — same shape as /api/spine/search, so trainer sees
  // candidates from /spine/why traffic too.
  const logged: LoggedCandidate[] = ranked.candidates.map((c) => ({
    ...c,
    crossEncoderScore: crossScores[c.id] ?? null,
  }));
  logRecall({
    userId: null,
    sessionId: req.nextUrl.searchParams.get('session_id'),
    isDemo: true,
    query,
    poolSize: ranked.poolSize,
    topK: ranked.candidates.length,
    shownIds: pool.map((p) => p.id),
    provider,
    weights: ranked.weights,
    latencyMs,
    candidates: logged,
  });

  return withCors(
    NextResponse.json({
      query,
      pool,
      weights: ranked.weights,
      pool_size: ranked.poolSize,
      latency_ms: latencyMs,
      rerank_provider: provider,
      rerank_cached: cached,
    })
  );
}
