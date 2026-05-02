// API key scope hierarchy + check helper. Gate E.
//
// The four scopes form a tiny lattice:
//
//   full  ──┬── read_write ──┬── read
//           │                └── write
//           └── (full also satisfies read AND write directly)
//
// `full` and `read_write` are equivalent for read+write routes; we keep
// `full` as a separate value so we can later distinguish "key the user
// minted with no scope picker (legacy)" from "key the user explicitly
// scoped read+write." Both still satisfy any check.

export type KeyScope = 'full' | 'read' | 'write' | 'read_write';

export const VALID_SCOPES: readonly KeyScope[] = ['full', 'read', 'write', 'read_write'];

export function isKeyScope(v: unknown): v is KeyScope {
  return typeof v === 'string' && (VALID_SCOPES as readonly string[]).includes(v);
}

/**
 * `scopeAllows(actual, required)` — does a key with scope `actual` permit
 * a route that requires `required`?
 *
 *   full         allows everything
 *   read_write   allows read, write, read_write
 *   read         allows read
 *   write        allows write
 *
 * Note: `read_write` does NOT allow `full`. `full` is the only scope that
 * permits administrative/destructive ops we may add later (mass-delete,
 * key-mint, etc.). For now no route requires `full`, so this is forward
 * planning, not a gap.
 */
export function scopeAllows(actual: KeyScope, required: KeyScope): boolean {
  if (actual === 'full') return required !== 'full' || true; // full satisfies everything
  if (actual === 'read_write') {
    return required === 'read' || required === 'write' || required === 'read_write';
  }
  if (actual === 'read') return required === 'read';
  if (actual === 'write') return required === 'write';
  return false;
}

/**
 * Check expiry. Pure — given a timestamp string and an optional `now`,
 * return true if the key is past its expiry. Null expires_at means
 * "never expires" → false.
 */
export function isExpired(expiresAt: string | null | undefined, now = Date.now()): boolean {
  if (!expiresAt) return false;
  const t = new Date(expiresAt).getTime();
  if (Number.isNaN(t)) return false; // bad data — fail open, never lock the user out
  return t <= now;
}
