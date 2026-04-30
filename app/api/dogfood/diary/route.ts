// GET /api/dogfood/diary — admin-only self-audit dashboard for the
// instrumented MCP server (see docs/DOGFOOD_PROTOCOL.md).
//
// Reads the SQLite database produced by `spine-mcp dogfood`, which the
// owner runs locally. Default db path: ~/.spine/dogfood.db. Override
// with the SPINE_DOGFOOD_DB env var if the file lives elsewhere — the
// Next API process and the MCP must share filesystem access (i.e. run
// on the same machine, or mount the same volume).
//
// Auth: same env-gated admin model as the rest of the dashboard. The
// caller must (a) have a Supabase session and (b) carry an id listed in
// SPINE_ADMIN_USER_IDS / SPINE_ADMIN_USER_ID. Otherwise: 401.

import { NextResponse, type NextRequest } from 'next/server';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { requireAdmin } from '@/lib/admin';
import { readDogfoodDiary } from '@/lib/dogfood-diary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DEFAULT_DB_PATH = join(homedir(), '.spine', 'dogfood.db');

export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 401 });
  }

  const days = clampDays(req.nextUrl.searchParams.get('days'));
  const dbPath = process.env.SPINE_DOGFOOD_DB ?? DEFAULT_DB_PATH;

  if (!existsSync(dbPath)) {
    return NextResponse.json(
      {
        error:
          'Dogfood database not found. Run `spine-mcp dogfood` to start ' +
          'recording, then refresh.',
        dbPath,
      },
      { status: 404 }
    );
  }

  try {
    const diary = readDogfoodDiary(dbPath, days);
    return NextResponse.json(
      { ...diary, dbPath, generatedAt: new Date().toISOString() },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Failed to read dogfood database.',
        detail: err instanceof Error ? err.message : String(err),
        dbPath,
      },
      { status: 500 }
    );
  }
}

function clampDays(raw: string | null): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  if (Number.isFinite(n) && n >= 1 && n <= 30) return n;
  return 7;
}
