const hits = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;

export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const prev = hits.get(ip) ?? [];
  const recent = prev.filter((t) => now - t < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
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
