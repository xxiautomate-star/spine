// Public search endpoint for /spine live demo + transparency.
//
// Runs the full v2 ranker (4-signal fusion + cross-encoder) against the
// demo corpus (SPINE_DEMO_USER_ID). Response includes:
//
//   memories: top-5 with per-memory `why` trace and cross-encoder score
//   competitors: next 3 candidates that the ranker beat (with their whys)
//   weights: the active weight row the ranker used
//   latency_ms: end-to-end
//
// No auth. Rate-limited by client IP.

import { NextResponse, type NextRequest } from 'next/server';
import { rankMemoriesV2 } from '@/lib/rerank-v2';
import { crossEncoderRerank } from '@/lib/cross-encoder';
import { withCors, preflight } from '@/lib/cors';
import { checkRateLimit } from '@/lib/rate-limit';
import { logRecallEvent } from '@/lib/recall-telemetry';

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
      NextResponse.json(
        { error: 'Demo not configured. Set SPINE_DEMO_USER_ID on the server.' },
        { status: 503 }
      )
    );
  }

  const ip = clientIp(req);
  if (!checkRateLimit(ip)) {
    return withCors(
      NextResponse.json({ error: 'Too many requests. Try again in a minute.' }, { status: 429 })
    );
  }

  const query = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (!query) {
    return withCors(NextResponse.json({ error: 'q is required.' }, { status: 400 }));
  }
  const topK = Math.max(1, Math.min(10, Number(req.nextUrl.searchParams.get('top_k') ?? '5')));
  const poolK = Math.max(topK, Math.min(40, Number(req.nextUrl.searchParams.get('pool_k') ?? '20')));

  const t0 = Date.now();

  let ranked;
  try {
    ranked = await rankMemoriesV2(demoUserId, query, {
      poolLimit: poolK,
      limit: poolK,
    });
  } catch (err) {
    return withCors(
      NextResponse.json(
        { error: err instanceof Error ? err.message : 'Ranking failed.' },
        { status: 500 }
      )
    );
  }

  if (ranked.candidates.length === 0) {
    return withCors(
      NextResponse.json({
        query,
        memories: [],
        competitors: [],
        weights: ranked.weights,
        pool_size: 0,
        latency_ms: Date.now() - t0,
        rerank_provider: null,
      })
    );
  }

  // Cross-encoder rerank on the top-20 (or fewer) before returning top-K.
  let crossPicks: Array<{ id: string; score: number }> = [];
  let provider: string | null = null;
  let cached = false;
  try {
    const rr = await crossEncoderRerank(
      query,
      ranked.candidates.map((c) => ({
        id: c.id,
        content: c.content,
        source: c.source,
        createdAt: c.createdAt,
      })),
      { limit: topK + 3 } // keep 3 extra for competitors
    );
    crossPicks = rr.picks;
    provider = rr.provider;
    cached = Boolean(rr.cached);
  } catch (e) {
    // Fall back to fused-only ordering
    console.warn('[spine-search] cross-encoder failed:', (e as Error).message);
  }

  const byId = new Map(ranked.candidates.map((c) => [c.id, c]));
  let ordered = ranked.candidates; // default order
  if (crossPicks.length > 0) {
    // Merge cross-encoder score with the why trace; final field updated.
    const crossById = new Map(crossPicks.map((p) => [p.id, p.score]));
    ordered = ranked.candidates
      .map((c) => {
        const x = crossById.get(c.id);
        if (x === undefined) return null;
        return {
          ...c,
          why: { ...c.why, final: x, dominant: c.why.dominant },
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);
    ordered.sort((a, b) => b.why.final - a.why.final);
  }

  const top = ordered.slice(0, topK);
  const competitors = ordered.slice(topK, topK + 3).map((c) => ({
    id: c.id,
    content: c.content.slice(0, 160) + (c.content.length > 160 ? '…' : ''),
    why: c.why,
  }));

  const latencyMs = Date.now() - t0;

  logRecallEvent({
    userId: null,
    isDemo: true,
    queryLen: query.length,
    hits: top.map((c) => ({ id: c.id, createdAt: c.createdAt })),
    latencyMs,
    plan: 'demo-v2',
  });

  return withCors(
    NextResponse.json({
      query,
      memories: top.map((c) => ({
        id: c.id,
        content: c.content,
        source: c.source,
        tags: c.tags,
        createdAt: c.createdAt,
        lastConfirmedAt: c.lastConfirmedAt,
        supersededBy: c.supersededBy,
        why: c.why,
      })),
      competitors,
      weights: ranked.weights,
      pool_size: ranked.poolSize,
      latency_ms: latencyMs,
      rerank_provider: provider,
      rerank_cached: cached,
    })
  );
}
