// POST /api/debug
// Full debugging pipeline: stack trace → root cause → failure modes → fixes → repro.
// Long-running (up to 30s on real repos). Requires ANTHROPIC_API_KEY.

import { NextRequest, NextResponse } from 'next/server';
import { getServerUser, getServerSupabase } from '@/lib/supabase-server';
import { withCors, preflight } from '@/lib/cors';
import { reasonTrace } from '@/lib/trace-reasoner';
import { simulateFailurePath } from '@/lib/failure-path-simulator';
import { generateFixCandidates } from '@/lib/fix-candidate-generator';
import { generateReproInstructions } from '@/lib/repro-instructions';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function OPTIONS() {
  return preflight();
}

export async function POST(req: NextRequest) {
  const supabase = await getServerSupabase();
  const user = await getServerUser();
  if (!supabase || !user) {
    return withCors(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  let body: { stack_trace?: string; bug_report?: string; repo_root?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return withCors(NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }));
  }

  const stackTrace = typeof body.stack_trace === 'string' ? body.stack_trace.trim() : '';
  const bugReport = typeof body.bug_report === 'string' ? body.bug_report.trim() : '';
  const repoRoot = typeof body.repo_root === 'string' ? body.repo_root : process.cwd();

  if (!stackTrace && !bugReport) {
    return withCors(
      NextResponse.json({ error: 'stack_trace or bug_report required' }, { status: 400 })
    );
  }

  const started = Date.now();

  // Step 1: Trace analysis
  const traceResult = stackTrace
    ? await reasonTrace(user.id, stackTrace, repoRoot)
    : {
        errorMessage: bugReport,
        errorType: 'BugReport',
        frames: [],
        errorSite: null,
        rootCauseFrame: null,
        badValue: null,
        dataFlow: [],
        fixHint: '',
        rawSynthesis: '',
        latencyMs: 0,
      };

  // Step 2: Failure path simulation
  const effectiveBugReport = bugReport || `${traceResult.errorType}: ${traceResult.errorMessage}`;
  const failurePath = await simulateFailurePath(user.id, effectiveBugReport, repoRoot);

  // Step 3: Fix candidates
  const fixes = await generateFixCandidates(
    user.id,
    effectiveBugReport,
    failurePath.failureModes,
    repoRoot
  );

  // Step 4: Repro instructions
  const repro = await generateReproInstructions(traceResult, failurePath, fixes.bestFix);

  return withCors(
    NextResponse.json({
      trace: traceResult,
      failure_path: failurePath,
      fixes: fixes.candidates,
      best_fix: fixes.bestFix,
      repro,
      total_latency_ms: Date.now() - started,
    })
  );
}
