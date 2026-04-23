// Admin authorisation — env-var gated. Comma-separated list of user IDs in
// SPINE_ADMIN_USER_IDS counts as admin. In dev, SPINE_ADMIN_USER_ID (singular)
// is also accepted for convenience.

import { getServerUser } from './supabase-server';

function adminIds(): Set<string> {
  const multi = process.env.SPINE_ADMIN_USER_IDS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  const single = process.env.SPINE_ADMIN_USER_ID?.trim();
  const all = new Set(multi);
  if (single) all.add(single);
  return all;
}

export function isAdminUserId(id: string | null | undefined): boolean {
  if (!id) return false;
  const ids = adminIds();
  if (ids.size === 0) return false;
  return ids.has(id);
}

export async function requireAdmin(): Promise<{ userId: string } | null> {
  const user = await getServerUser();
  if (!user) return null;
  if (!isAdminUserId(user.id)) return null;
  return { userId: user.id };
}
