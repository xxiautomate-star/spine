import { NextResponse, type NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const result = await requireApiKey(req);
  if (!result.authed) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, user_id: result.authed.userId });
}
