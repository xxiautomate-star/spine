// Permissive CORS for API key-authenticated routes consumed by the browser
// extension. Safe to expose because (a) auth is Bearer API key, not cookie-based
// (no CSRF surface), and (b) each response already scopes data to the caller's
// user via the key.

import { NextResponse } from 'next/server';

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

export function withCors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
