// Sliding-window in-memory rate limiter, keyed on caller-supplied
// identifier (IP, user ID, or composite). Default ceiling is 5/min —
// the right size for waitlist signups, demo searches, and other
// public unauthenticated endpoints. /api/capture passes a higher
// ceiling because legitimate MCP traffic bursts to dozens of writes
// per active minute (one per prompt-response turn).

const hits = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const DEFAULT_MAX_PER_WINDOW = 5;

export function checkRateLimit(key: string, maxPerWindow: number = DEFAULT_MAX_PER_WINDOW): boolean {
  const now = Date.now();
  const prev = hits.get(key) ?? [];
  const recent = prev.filter((t) => now - t < WINDOW_MS);
  if (recent.length >= maxPerWindow) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5_000) {
    const cutoff = now - WINDOW_MS;
    for (const [k, arr] of hits) {
      const kept = arr.filter((t) => t >= cutoff);
      if (kept.length === 0) hits.delete(k);
      else hits.set(k, kept);
    }
  }
  return true;
}
