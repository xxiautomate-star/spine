-- Migration 003: conflict detection, memory decay, entity merge proposals,
-- team memory policies (required_context), memory archival.
-- Idempotent — safe to run multiple times.

---------------------------------------------------------------
-- Memory lifecycle columns (decay model)
---------------------------------------------------------------

-- last_accessed_at: bumped whenever a memory is surfaced in HUD, searched,
-- or recalled via MCP. Separate from last_retrieved_at (which is purely for
-- the recall rank signal) — this one drives decay.
alter table public.memories
  add column if not exists last_accessed_at timestamptz;

-- archived_at: soft-delete for decay. Memories archived after 60 days of
-- non-access. Different from deleted_at (explicit user action). Recoverable.
alter table public.memories
  add column if not exists archived_at timestamptz;

-- required_context: team owners can pin memories that must be injected into
-- every matching team HUD query regardless of cosine score.
alter table public.memories
  add column if not exists required_context boolean not null default false;

create index if not exists memories_decay_idx
  on public.memories (user_id, last_accessed_at)
  where archived_at is null and deleted_at is null;

create index if not exists memories_archived_idx
  on public.memories (user_id, archived_at)
  where archived_at is not null and deleted_at is null;

---------------------------------------------------------------
-- Memory conflicts
---------------------------------------------------------------

-- A conflict row is created when a new capture contradicts a prior capture
-- on the same entity. The user resolves by choosing keep_latest, keep_both,
-- or merged (manual). Unresolved conflicts surface in the HUD and digest.
create table if not exists public.memory_conflicts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  memory_id_a  uuid not null references public.memories(id) on delete cascade,  -- prior
  memory_id_b  uuid not null references public.memories(id) on delete cascade,  -- new
  entity_name  text,          -- which entity triggered the conflict
  quote_a      text not null, -- verbatim excerpt from the prior memory
  quote_b      text not null, -- verbatim excerpt from the new memory
  resolution   text,          -- NULL | 'keep_latest' | 'keep_both' | 'merged'
  resolved_at  timestamptz,
  created_at   timestamptz not null default now(),
  constraint memory_conflicts_pair unique (memory_id_a, memory_id_b)
);

create index if not exists memory_conflicts_user_idx
  on public.memory_conflicts (user_id, created_at desc)
  where resolution is null;

alter table public.memory_conflicts enable row level security;

drop policy if exists conflicts_owner_all on public.memory_conflicts;
create policy conflicts_owner_all on public.memory_conflicts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

---------------------------------------------------------------
-- Entity merge proposals (disambiguation)
---------------------------------------------------------------

-- Created when two entity nodes have fuzzy-name similarity >= 0.85.
-- Pending proposals appear as a banner in /graph. After merge, the
-- merged node can be un-merged for 7 days via entity_merge_log.
create table if not exists public.entity_merge_proposals (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  node_id_a       uuid not null references public.entity_nodes(id) on delete cascade,
  node_id_b       uuid not null references public.entity_nodes(id) on delete cascade,
  similarity      float not null,
  status          text not null default 'pending',  -- pending | merged | dismissed
  survivor_id     uuid references public.entity_nodes(id), -- node that remains after merge
  can_undo_until  timestamptz,
  created_at      timestamptz not null default now(),
  constraint entity_merge_proposals_pair unique (node_id_a, node_id_b)
);

create index if not exists entity_merge_proposals_user_idx
  on public.entity_merge_proposals (user_id, created_at desc)
  where status = 'pending';

alter table public.entity_merge_proposals enable row level security;

drop policy if exists merge_proposals_owner_all on public.entity_merge_proposals;
create policy merge_proposals_owner_all on public.entity_merge_proposals
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Audit log of merges for undo.
create table if not exists public.entity_merge_log (
  id             uuid primary key default gen_random_uuid(),
  proposal_id    uuid not null references public.entity_merge_proposals(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  survivor_id    uuid not null,
  absorbed_id    uuid not null,
  snapshot_name  text not null,   -- absorbed node's name before merge
  snapshot_type  text not null,   -- absorbed node's type before merge
  merged_at      timestamptz not null default now(),
  undone_at      timestamptz
);

alter table public.entity_merge_log enable row level security;

drop policy if exists merge_log_owner_all on public.entity_merge_log;
create policy merge_log_owner_all on public.entity_merge_log
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

---------------------------------------------------------------
-- RPC: bump last_accessed_at for a set of memory ids.
-- Called by /api/recall/context-match and the MCP recall tool.
---------------------------------------------------------------

create or replace function public.spine_touch_accessed(
  p_user uuid,
  p_ids  uuid[]
)
returns void
language sql
as $$
  update public.memories
  set last_accessed_at = now()
  where user_id = p_user and id = any(p_ids)
    and deleted_at is null and archived_at is null;
$$;

grant execute on function public.spine_touch_accessed(uuid, uuid[])
  to authenticated, service_role;

---------------------------------------------------------------
-- RPC: archive stale memories.
-- Called by the decay script. Returns count archived.
---------------------------------------------------------------

create or replace function public.spine_archive_stale(
  p_user        uuid,
  p_threshold   timestamptz,   -- archive memories not accessed since this date
  p_dry_run     boolean default false
)
returns int
language plpgsql
as $$
declare
  v_count int;
begin
  -- Count memories that are: not deleted, not already archived,
  -- and either never accessed OR last accessed before threshold.
  select count(*) into v_count
  from public.memories
  where user_id = p_user
    and deleted_at is null
    and archived_at is null
    and coalesce(last_accessed_at, created_at) < p_threshold;

  if not p_dry_run then
    update public.memories
    set archived_at = now()
    where user_id = p_user
      and deleted_at is null
      and archived_at is null
      and coalesce(last_accessed_at, created_at) < p_threshold;
  end if;

  return v_count;
end;
$$;

grant execute on function public.spine_archive_stale(uuid, timestamptz, boolean)
  to service_role;
