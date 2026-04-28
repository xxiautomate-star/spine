-- ============================================================
-- SPINE — CONSOLIDATED MIGRATION FOR DEDICATED SUPABASE PROJECT
-- (FIXED 2026-04-28: bootstrap.sql + migrations 002-017 in order)
-- ============================================================
-- USE: New Supabase project → SQL editor → paste this entire file →
--      Run. Then update Spine env vars (SUPABASE_URL, ANON_KEY,
--      SERVICE_ROLE_KEY) in Coolify.
-- 
-- All statements are idempotent (CREATE IF NOT EXISTS,
-- CREATE OR REPLACE, etc). Safe to re-run.
-- ============================================================

-- ============================================================
-- bootstrap.sql — base schema (memories, profiles, api_keys, waitlist)
-- ============================================================
-- Spine — idempotent bootstrap SQL
-- Paste the entire file into your Supabase SQL editor and click Run.
-- Safe to run on a fresh project or re-run on an existing one.
-- Every statement uses IF NOT EXISTS / CREATE OR REPLACE / DROP IF EXISTS.

-- ---------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------

create extension if not exists vector;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------
-- Schema grants (safe to re-run; no-op if already present)
-- ---------------------------------------------------------------

grant usage on schema public to anon, authenticated;

-- ---------------------------------------------------------------
-- waitlist
-- ---------------------------------------------------------------

create table if not exists public.waitlist (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null,
  tier_interest text,
  use_case      text,
  referrer      text,
  created_at    timestamptz not null default now()
);

alter table public.waitlist enable row level security;

drop policy if exists waitlist_insert_anon on public.waitlist;
create policy waitlist_insert_anon on public.waitlist
  for insert to anon with check (true);

grant insert on public.waitlist to anon;
grant select, insert, update, delete on public.waitlist to authenticated;

-- ---------------------------------------------------------------
-- memories
-- ---------------------------------------------------------------

create table if not exists public.memories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  content    text not null,
  source     text,
  tags       text[] default '{}'::text[],
  embedding  vector(1536),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- Phase 4: tsvector for BM25 hybrid search
alter table public.memories
  add column if not exists content_tsv tsvector
  generated always as (to_tsvector('english', coalesce(content, ''))) stored;

-- Phase 8: hygiene columns
alter table public.memories
  add column if not exists cluster_id        uuid,
  add column if not exists retrieval_count   integer not null default 0,
  add column if not exists last_retrieved_at timestamptz;

create index if not exists memories_embedding_hnsw
  on public.memories using hnsw (embedding vector_cosine_ops);

create index if not exists memories_content_tsv_gin
  on public.memories using gin (content_tsv);

create index if not exists memories_user_created_idx
  on public.memories (user_id, created_at desc);

create index if not exists memories_cluster_idx
  on public.memories (cluster_id);

create index if not exists memories_retrieval_idx
  on public.memories (user_id, last_retrieved_at);

alter table public.memories enable row level security;

drop policy if exists memories_owner_all on public.memories;
create policy memories_owner_all on public.memories
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.memories to authenticated;

-- ---------------------------------------------------------------
-- api_keys
-- ---------------------------------------------------------------

create table if not exists public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  key_hash     text not null unique,
  name         text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists api_keys_user_idx on public.api_keys (user_id);

alter table public.api_keys enable row level security;

drop policy if exists api_keys_owner_all on public.api_keys;
create policy api_keys_owner_all on public.api_keys
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.api_keys to authenticated;

-- ---------------------------------------------------------------
-- profiles  (plan: 'free' | 'pro' | 'power')
-- ---------------------------------------------------------------

create table if not exists public.profiles (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  plan       text not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Phase 6: Stripe billing fields
alter table public.profiles
  add column if not exists stripe_customer_id     text unique,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_price_id        text,
  add column if not exists plan_updated_at        timestamptz;

create index if not exists profiles_stripe_customer_idx
  on public.profiles (stripe_customer_id);

alter table public.profiles enable row level security;

drop policy if exists profiles_owner_read on public.profiles;
create policy profiles_owner_read on public.profiles
  for select using (user_id = auth.uid());

grant select on public.profiles to authenticated;

-- Trigger: insert a free-tier profile row for every new auth user.
create or replace function public.spine_handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists spine_on_auth_user_created on auth.users;
create trigger spine_on_auth_user_created
  after insert on auth.users
  for each row execute function public.spine_handle_new_user();

-- ---------------------------------------------------------------
-- stripe_events  (idempotency log — service role only)
-- ---------------------------------------------------------------

create table if not exists public.stripe_events (
  event_id     text primary key,
  type         text not null,
  received_at  timestamptz not null default now(),
  payload      jsonb
);

alter table public.stripe_events enable row level security;

drop policy if exists stripe_events_deny_all on public.stripe_events;
create policy stripe_events_deny_all on public.stripe_events
  for select using (false);

-- ---------------------------------------------------------------
-- memory_clusters  (Phase 8 hygiene)
-- ---------------------------------------------------------------

create table if not exists public.memory_clusters (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  label      text not null,
  centroid   vector(1536) not null,
  size       integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists memory_clusters_user_idx
  on public.memory_clusters (user_id);

alter table public.memory_clusters enable row level security;

drop policy if exists clusters_owner_all on public.memory_clusters;
create policy clusters_owner_all on public.memory_clusters
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.memory_clusters to authenticated;

-- ---------------------------------------------------------------
-- memory_duplicates  (Phase 8 hygiene)
-- ---------------------------------------------------------------

create table if not exists public.memory_duplicates (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  memory_id_a uuid not null references public.memories(id) on delete cascade,
  memory_id_b uuid not null references public.memories(id) on delete cascade,
  similarity  double precision not null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint memory_duplicates_pair unique (memory_id_a, memory_id_b)
);

create index if not exists memory_duplicates_user_idx
  on public.memory_duplicates (user_id, detected_at desc)
  where resolved_at is null;

alter table public.memory_duplicates enable row level security;

drop policy if exists duplicates_owner_all on public.memory_duplicates;
create policy duplicates_owner_all on public.memory_duplicates
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update, delete on public.memory_duplicates to authenticated;

-- ---------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------

-- Pure vector recall (used by /api/recall/raw)
create or replace function public.spine_match_memories(
  p_user            uuid,
  p_query_embedding vector(1536),
  p_limit           int default 10
)
returns table (
  id         uuid,
  content    text,
  source     text,
  tags       text[],
  created_at timestamptz,
  similarity double precision
)
language sql stable
as $$
  select
    m.id,
    m.content,
    m.source,
    m.tags,
    m.created_at,
    1 - (m.embedding <=> p_query_embedding) as similarity
  from public.memories m
  where m.user_id = p_user
    and m.deleted_at is null
    and m.embedding is not null
  order by m.embedding <=> p_query_embedding
  limit p_limit;
$$;

grant execute on function public.spine_match_memories(uuid, vector, int)
  to authenticated, service_role;

-- Hybrid vector + BM25 candidate fetch (used by /api/recall)
create or replace function public.spine_hybrid_candidates(
  p_user            uuid,
  p_query           text,
  p_query_embedding vector(1536),
  p_limit           int default 30
)
returns table (
  id             uuid,
  content        text,
  source         text,
  tags           text[],
  created_at     timestamptz,
  vec_similarity double precision,
  bm25_rank      double precision
)
language sql stable
as $$
  with vec as (
    select
      m.id,
      1 - (m.embedding <=> p_query_embedding) as sim
    from public.memories m
    where m.user_id = p_user
      and m.deleted_at is null
      and m.embedding is not null
    order by m.embedding <=> p_query_embedding
    limit p_limit
  ),
  bm25 as (
    select
      m.id,
      ts_rank(m.content_tsv, websearch_to_tsquery('english', p_query)) as rank
    from public.memories m
    where m.user_id = p_user
      and m.deleted_at is null
      and m.content_tsv @@ websearch_to_tsquery('english', p_query)
    order by rank desc
    limit p_limit
  ),
  ids as (
    select id from vec
    union
    select id from bm25
  )
  select
    m.id,
    m.content,
    m.source,
    m.tags,
    m.created_at,
    coalesce(vec.sim, 0)::double precision as vec_similarity,
    coalesce(bm25.rank, 0)::double precision as bm25_rank
  from public.memories m
  join ids on ids.id = m.id
  left join vec  on vec.id  = m.id
  left join bm25 on bm25.id = m.id;
$$;

grant execute on function public.spine_hybrid_candidates(uuid, text, vector, int)
  to authenticated, service_role;

-- Nearest cluster centroid (hygiene — cluster assignment)
create or replace function public.spine_nearest_cluster(
  p_user      uuid,
  p_embedding vector(1536)
)
returns table (
  id         uuid,
  label      text,
  similarity double precision
)
language sql stable
as $$
  select
    c.id,
    c.label,
    1 - (c.centroid <=> p_embedding) as similarity
  from public.memory_clusters c
  where c.user_id = p_user
  order by c.centroid <=> p_embedding
  limit 1;
$$;

grant execute on function public.spine_nearest_cluster(uuid, vector)
  to authenticated, service_role;

-- Duplicate pair detection across the full corpus
create or replace function public.spine_detect_duplicates(
  p_user      uuid,
  p_threshold double precision default 0.92,
  p_limit     int default 200
)
returns table (
  memory_id_a uuid,
  memory_id_b uuid,
  similarity  double precision
)
language sql stable
as $$
  select
    m1.id as memory_id_a,
    m2.id as memory_id_b,
    1 - (m1.embedding <=> m2.embedding) as similarity
  from public.memories m1
  join public.memories m2
    on m2.user_id = m1.user_id
   and m2.id > m1.id
  where m1.user_id = p_user
    and m1.deleted_at is null
    and m2.deleted_at is null
    and m1.embedding is not null
    and m2.embedding is not null
    and 1 - (m1.embedding <=> m2.embedding) > p_threshold
  order by 1 - (m1.embedding <=> m2.embedding) desc
  limit p_limit;
$$;

grant execute on function public.spine_detect_duplicates(uuid, double precision, int)
  to authenticated, service_role;

-- Bump retrieval stats (called by /api/recall after returning results)
create or replace function public.spine_touch_retrieved(
  p_user uuid,
  p_ids  uuid[]
)
returns void
language sql
as $$
  update public.memories
  set retrieval_count   = retrieval_count + 1,
      last_retrieved_at = now()
  where user_id = p_user and id = any(p_ids);
$$;

grant execute on function public.spine_touch_retrieved(uuid, uuid[])
  to authenticated, service_role;

-- Atomic cluster size bump on memory join
create or replace function public.spine_increment_cluster_size(
  p_cluster uuid
)
returns void
language sql
as $$
  update public.memory_clusters
  set size       = size + 1,
      updated_at = now()
  where id = p_cluster;
$$;

grant execute on function public.spine_increment_cluster_size(uuid)
  to authenticated, service_role;

-- Per-memory duplicate candidates (called by /api/capture after insert)
create or replace function public.spine_duplicates_for_memory(
  p_user      uuid,
  p_memory_id uuid,
  p_threshold double precision default 0.92,
  p_limit     int default 20
)
returns table (
  other_id   uuid,
  similarity double precision
)
language sql stable
as $$
  with target as (
    select embedding
    from public.memories
    where id = p_memory_id and user_id = p_user and deleted_at is null
    limit 1
  )
  select
    m.id as other_id,
    1 - (m.embedding <=> t.embedding) as similarity
  from public.memories m
  cross join target t
  where m.user_id = p_user
    and m.id <> p_memory_id
    and m.deleted_at is null
    and m.embedding is not null
    and 1 - (m.embedding <=> t.embedding) > p_threshold
  order by m.embedding <=> t.embedding
  limit p_limit;
$$;

grant execute on function public.spine_duplicates_for_memory(uuid, uuid, double precision, int)
  to authenticated, service_role;

-- ============================================================
-- 002_entity_graph_teams_digests.sql
-- ============================================================
-- Migration 002: entity graph, teams, digests, memory visibility.
-- Idempotent — safe to run multiple times.

---------------------------------------------------------------
-- Entity graph
---------------------------------------------------------------

create table if not exists public.entity_nodes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  team_id       uuid,           -- set when promoted to shared team space
  name          text not null,  -- specific: "Roman Puglielli", not "user"
  type          text not null,  -- person | project | tool | concept | decision
  mention_count integer not null default 1,
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  constraint entity_nodes_user_name_type unique (user_id, name, type)
);

create index if not exists entity_nodes_user_idx
  on public.entity_nodes (user_id, mention_count desc);

alter table public.entity_nodes enable row level security;

drop policy if exists entity_nodes_owner_all on public.entity_nodes;
create policy entity_nodes_owner_all on public.entity_nodes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.entity_edges (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  from_node   uuid not null references public.entity_nodes(id) on delete cascade,
  to_node     uuid not null references public.entity_nodes(id) on delete cascade,
  edge_type   text not null,   -- MENTIONED_IN | RELATED_TO | SUPERSEDES
  memory_id   uuid references public.memories(id) on delete set null,
  weight      float not null default 1.0,
  created_at  timestamptz not null default now(),
  constraint entity_edges_unique unique (from_node, to_node, edge_type, memory_id)
);

create index if not exists entity_edges_user_idx
  on public.entity_edges (user_id);
create index if not exists entity_edges_from_idx
  on public.entity_edges (from_node);
create index if not exists entity_edges_to_idx
  on public.entity_edges (to_node);

alter table public.entity_edges enable row level security;

drop policy if exists entity_edges_owner_all on public.entity_edges;
create policy entity_edges_owner_all on public.entity_edges
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

---------------------------------------------------------------
-- Memory visibility flag (private / team)
---------------------------------------------------------------

alter table public.memories
  add column if not exists visibility text not null default 'private';

---------------------------------------------------------------
-- Teams (Power tier only)
---------------------------------------------------------------

create table if not exists public.teams (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  creator_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists teams_creator_idx on public.teams (creator_id);

alter table public.teams enable row level security;

drop policy if exists teams_member_select on public.teams;
create policy teams_member_select on public.teams
  for select using (
    id in (
      select team_id from public.team_members
      where user_id = auth.uid() and joined_at is not null
    )
  );

drop policy if exists teams_creator_all on public.teams;
create policy teams_creator_all on public.teams
  for all using (creator_id = auth.uid()) with check (creator_id = auth.uid());

create table if not exists public.team_members (
  id            uuid primary key default gen_random_uuid(),
  team_id       uuid not null references public.teams(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete cascade,
  invited_email text,
  invite_token  text unique,
  role          text not null default 'member',
  joined_at     timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists team_members_team_idx on public.team_members (team_id);
create index if not exists team_members_user_idx on public.team_members (user_id);
create index if not exists team_members_token_idx on public.team_members (invite_token);

alter table public.team_members enable row level security;

drop policy if exists team_members_self_select on public.team_members;
create policy team_members_self_select on public.team_members
  for select using (
    user_id = auth.uid()
    or team_id in (
      select team_id from public.team_members
      where user_id = auth.uid() and joined_at is not null
    )
  );

---------------------------------------------------------------
-- Daily digests
---------------------------------------------------------------

create table if not exists public.digests (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  date         date not null,
  themes       jsonb not null default '[]',
  decisions    jsonb not null default '[]',
  questions    jsonb not null default '[]',
  nags         jsonb not null default '[]',
  memory_count integer not null default 0,
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),
  constraint digests_user_date unique (user_id, date)
);

create index if not exists digests_user_date_idx
  on public.digests (user_id, date desc);

alter table public.digests enable row level security;

drop policy if exists digests_owner_all on public.digests;
create policy digests_owner_all on public.digests
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.digest_resolutions (
  id          uuid primary key default gen_random_uuid(),
  digest_id   uuid not null references public.digests(id) on delete cascade,
  item_type   text not null,   -- 'question' | 'nag'
  item_index  integer not null,
  resolved_at timestamptz not null default now(),
  constraint digest_resolutions_unique unique (digest_id, item_type, item_index)
);

create index if not exists digest_resolutions_digest_idx
  on public.digest_resolutions (digest_id);

alter table public.digest_resolutions enable row level security;

drop policy if exists digest_resolutions_owner_all on public.digest_resolutions;
create policy digest_resolutions_owner_all on public.digest_resolutions
  for all using (
    digest_id in (
      select id from public.digests where user_id = auth.uid()
    )
  ) with check (
    digest_id in (
      select id from public.digests where user_id = auth.uid()
    )
  );

---------------------------------------------------------------
-- RPC: entity graph for a user (top N nodes + all edges between them)
---------------------------------------------------------------

create or replace function public.spine_entity_graph(
  p_user    uuid,
  p_limit   int default 50
)
returns jsonb
language sql stable
as $$
  with top_nodes as (
    select id, name, type, mention_count, first_seen, last_seen, team_id
    from public.entity_nodes
    where user_id = p_user
    order by mention_count desc, last_seen desc
    limit p_limit
  ),
  top_ids as (select id from top_nodes),
  edges as (
    select e.id, e.from_node, e.to_node, e.edge_type, e.weight, e.memory_id
    from public.entity_edges e
    where e.user_id = p_user
      and e.from_node in (select id from top_ids)
      and e.to_node   in (select id from top_ids)
  )
  select jsonb_build_object(
    'nodes', coalesce((select jsonb_agg(row_to_json(n)) from top_nodes n), '[]'),
    'edges', coalesce((select jsonb_agg(row_to_json(e)) from edges e), '[]')
  );
$$;

grant execute on function public.spine_entity_graph(uuid, int)
  to authenticated, service_role;

-- ============================================================
-- 003_conflicts_decay_merges.sql
-- ============================================================
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

-- ============================================================
-- 004_multi_tenant_orgs.sql
-- ============================================================
-- Migration 004: multi-tenant workspace model.
-- Adds orgs, org_members; scopes every existing table by org_id.
-- Backfills existing users into personal "default" orgs.
-- Idempotent — safe to re-run.

---------------------------------------------------------------
-- Orgs
---------------------------------------------------------------

create table if not exists public.orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique,                  -- e.g. "acme-corp" or "default-<user_id_prefix>"
  owner_id    uuid not null references auth.users(id) on delete cascade,
  plan        text not null default 'free', -- free | pro | team
  -- LemonSqueezy billing
  ls_customer_id      text,
  ls_subscription_id  text,
  ls_variant_id       text,
  ls_status           text,                -- active | cancelled | expired | paused
  -- onboarding
  onboarding_completed_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists orgs_owner_idx on public.orgs (owner_id);
create index if not exists orgs_ls_customer_idx on public.orgs (ls_customer_id) where ls_customer_id is not null;
create index if not exists orgs_ls_sub_idx on public.orgs (ls_subscription_id) where ls_subscription_id is not null;

alter table public.orgs enable row level security;

drop policy if exists orgs_owner_all on public.orgs;
create policy orgs_owner_all on public.orgs
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists orgs_member_select on public.orgs;
create policy orgs_member_select on public.orgs
  for select using (
    id in (select org_id from public.org_members where user_id = auth.uid())
  );

---------------------------------------------------------------
-- Org members
---------------------------------------------------------------

create table if not exists public.org_members (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.orgs(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'member',  -- owner | admin | member | viewer
  joined_at  timestamptz not null default now(),
  constraint org_members_unique unique (org_id, user_id)
);

create index if not exists org_members_user_idx on public.org_members (user_id);
create index if not exists org_members_org_idx  on public.org_members (org_id);

alter table public.org_members enable row level security;

drop policy if exists org_members_member_select on public.org_members;
create policy org_members_member_select on public.org_members
  for select using (
    org_id in (select org_id from public.org_members om2 where om2.user_id = auth.uid())
  );

drop policy if exists org_members_owner_all on public.org_members;
create policy org_members_owner_all on public.org_members
  for all using (
    org_id in (select id from public.orgs where owner_id = auth.uid())
  );

---------------------------------------------------------------
-- org_id helper function (used in RLS policies below)
---------------------------------------------------------------

create or replace function public.my_org_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select org_id from public.org_members where user_id = auth.uid()
$$;

grant execute on function public.my_org_ids() to authenticated;

---------------------------------------------------------------
-- Add org_id to memories
---------------------------------------------------------------

alter table public.memories
  add column if not exists org_id uuid references public.orgs(id) on delete cascade;

create index if not exists memories_org_idx
  on public.memories (org_id, created_at desc)
  where org_id is not null and deleted_at is null;

-- Replace old RLS with org-scoped policy
drop policy if exists memories_owner_all on public.memories;

drop policy if exists memories_org_all on public.memories;
create policy memories_org_all on public.memories
  for all using (
    (org_id is not null and org_id = any(public.my_org_ids()))
    or (org_id is null and user_id = auth.uid())  -- backward compat for un-migrated rows
  )
  with check (
    (org_id is not null and org_id = any(public.my_org_ids()))
    or (org_id is null and user_id = auth.uid())
  );

---------------------------------------------------------------
-- Add org_id to entity_nodes
---------------------------------------------------------------

alter table public.entity_nodes
  add column if not exists org_id uuid references public.orgs(id) on delete cascade;

drop policy if exists entity_nodes_owner_all on public.entity_nodes;

drop policy if exists entity_nodes_org_all on public.entity_nodes;
create policy entity_nodes_org_all on public.entity_nodes
  for all using (
    (org_id is not null and org_id = any(public.my_org_ids()))
    or (org_id is null and user_id = auth.uid())
  )
  with check (
    (org_id is not null and org_id = any(public.my_org_ids()))
    or (org_id is null and user_id = auth.uid())
  );

---------------------------------------------------------------
-- Add org_id to entity_edges
---------------------------------------------------------------

alter table public.entity_edges
  add column if not exists org_id uuid references public.orgs(id) on delete cascade;

drop policy if exists entity_edges_owner_all on public.entity_edges;

drop policy if exists entity_edges_org_all on public.entity_edges;
create policy entity_edges_org_all on public.entity_edges
  for all using (
    (org_id is not null and org_id = any(public.my_org_ids()))
    or (org_id is null and user_id = auth.uid())
  )
  with check (
    (org_id is not null and org_id = any(public.my_org_ids()))
    or (org_id is null and user_id = auth.uid())
  );

---------------------------------------------------------------
-- Add org_id to memory_conflicts
---------------------------------------------------------------

alter table public.memory_conflicts
  add column if not exists org_id uuid references public.orgs(id) on delete cascade;

drop policy if exists conflicts_owner_all on public.memory_conflicts;

drop policy if exists conflicts_org_all on public.memory_conflicts;
create policy conflicts_org_all on public.memory_conflicts
  for all using (
    (org_id is not null and org_id = any(public.my_org_ids()))
    or (org_id is null and user_id = auth.uid())
  )
  with check (
    (org_id is not null and org_id = any(public.my_org_ids()))
    or (org_id is null and user_id = auth.uid())
  );

---------------------------------------------------------------
-- Add org_id to entity_merge_proposals
---------------------------------------------------------------

alter table public.entity_merge_proposals
  add column if not exists org_id uuid references public.orgs(id) on delete cascade;

drop policy if exists merge_proposals_owner_all on public.entity_merge_proposals;

drop policy if exists merge_proposals_org_all on public.entity_merge_proposals;
create policy merge_proposals_org_all on public.entity_merge_proposals
  for all using (
    (org_id is not null and org_id = any(public.my_org_ids()))
    or (org_id is null and user_id = auth.uid())
  )
  with check (
    (org_id is not null and org_id = any(public.my_org_ids()))
    or (org_id is null and user_id = auth.uid())
  );

---------------------------------------------------------------
-- Add org_id to digests
---------------------------------------------------------------

alter table public.digests
  add column if not exists org_id uuid references public.orgs(id) on delete cascade;

---------------------------------------------------------------
-- Profiles: add LemonSqueezy fields + default_org_id
---------------------------------------------------------------

alter table public.profiles
  add column if not exists default_org_id uuid references public.orgs(id) on delete set null;

alter table public.profiles
  add column if not exists ls_customer_id text;

-- Plan on profiles now sourced from the org's plan (denormalised for fast reads)
-- We keep the existing `plan` column and sync it from org plan via webhook.

---------------------------------------------------------------
-- RPC: ensure_default_org — idempotent org bootstrap for new users.
-- Creates a personal org and member row if the user has none.
-- Returns the org_id.
---------------------------------------------------------------

create or replace function public.spine_ensure_default_org(p_user_id uuid)
returns uuid
language plpgsql
security definer
as $$
declare
  v_org_id uuid;
  v_email  text;
  v_name   text;
begin
  -- Check existing ownership
  select id into v_org_id
  from public.orgs
  where owner_id = p_user_id
  limit 1;

  if v_org_id is not null then
    -- Ensure member row exists
    insert into public.org_members (org_id, user_id, role)
    values (v_org_id, p_user_id, 'owner')
    on conflict (org_id, user_id) do nothing;

    -- Sync default_org_id on profile
    update public.profiles
    set default_org_id = v_org_id
    where user_id = p_user_id and (default_org_id is null or default_org_id != v_org_id);

    return v_org_id;
  end if;

  -- Get display name from auth metadata
  select raw_user_meta_data->>'name', email
  into v_name, v_email
  from auth.users
  where id = p_user_id;

  v_name := coalesce(
    nullif(trim(v_name), ''),
    nullif(split_part(v_email, '@', 1), ''),
    'Personal workspace'
  );

  -- Create org
  insert into public.orgs (name, slug, owner_id, plan)
  values (
    v_name,
    'personal-' || left(p_user_id::text, 8),
    p_user_id,
    coalesce((select plan from public.profiles where user_id = p_user_id limit 1), 'free')
  )
  on conflict (slug) do update set updated_at = now()
  returning id into v_org_id;

  -- Create member row
  insert into public.org_members (org_id, user_id, role)
  values (v_org_id, p_user_id, 'owner')
  on conflict (org_id, user_id) do nothing;

  -- Set default on profile
  insert into public.profiles (user_id, default_org_id)
  values (p_user_id, v_org_id)
  on conflict (user_id) do update set default_org_id = v_org_id;

  return v_org_id;
end;
$$;

grant execute on function public.spine_ensure_default_org(uuid) to authenticated, service_role;

---------------------------------------------------------------
-- Backfill: create default orgs for every existing user and
-- set org_id on all their existing rows.
---------------------------------------------------------------

do $$
declare
  r record;
  v_org_id uuid;
begin
  for r in (select id from auth.users) loop
    v_org_id := public.spine_ensure_default_org(r.id);

    -- Backfill memories
    update public.memories
    set org_id = v_org_id
    where user_id = r.id and org_id is null;

    -- Backfill entity_nodes
    update public.entity_nodes
    set org_id = v_org_id
    where user_id = r.id and org_id is null;

    -- Backfill entity_edges
    update public.entity_edges
    set org_id = v_org_id
    where user_id = r.id and org_id is null;

    -- Backfill memory_conflicts
    update public.memory_conflicts
    set org_id = v_org_id
    where user_id = r.id and org_id is null;

    -- Backfill entity_merge_proposals
    update public.entity_merge_proposals
    set org_id = v_org_id
    where user_id = r.id and org_id is null;
  end loop;
end;
$$;

---------------------------------------------------------------
-- Audit log for Team plan — tracks policy changes, member adds/removes.
---------------------------------------------------------------

create table if not exists public.org_audit_log (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.orgs(id) on delete cascade,
  actor_id    uuid not null references auth.users(id) on delete cascade,
  action      text not null,  -- member.invite | member.join | member.remove | policy.change | plan.upgrade
  target_id   uuid,           -- user_id or memory_id being acted on
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists org_audit_log_org_idx on public.org_audit_log (org_id, created_at desc);

alter table public.org_audit_log enable row level security;

drop policy if exists org_audit_log_member_select on public.org_audit_log;
create policy org_audit_log_member_select on public.org_audit_log
  for select using (org_id = any(public.my_org_ids()));

-- ============================================================
-- 005_memory_type.sql
-- ============================================================
-- Add type column to spine_memories for decision / bug / feature / context / fact
ALTER TABLE spine_memories
  ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'context'
  CONSTRAINT spine_memories_type_check
  CHECK (type IN ('decision', 'bug', 'feature', 'context', 'fact'));

CREATE INDEX IF NOT EXISTS spine_memories_type_idx ON spine_memories (user_id, type)
  WHERE deleted_at IS NULL;

-- ============================================================
-- 006_team_visibility.sql
-- ============================================================
-- Round 7: team visibility, project tag, Slack webhook, spine.config support

-- memory visibility: personal (default) | team (org-visible) | org (entire org)
ALTER TABLE spine_memories
  ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'personal'
  CONSTRAINT spine_memories_visibility_check
  CHECK (visibility IN ('personal', 'team', 'org'));

-- project slug tag for cross-project memory graph
ALTER TABLE spine_memories
  ADD COLUMN IF NOT EXISTS project TEXT;

CREATE INDEX IF NOT EXISTS spine_memories_project_idx
  ON spine_memories (user_id, project)
  WHERE deleted_at IS NULL AND project IS NOT NULL;

CREATE INDEX IF NOT EXISTS spine_memories_visibility_idx
  ON spine_memories (org_id, visibility)
  WHERE deleted_at IS NULL AND org_id IS NOT NULL;

-- store Slack webhook per user (for morning briefing)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS slack_webhook TEXT;

-- store briefing preferences
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS briefing_enabled BOOLEAN DEFAULT true;

-- Team memory RLS: allow org members to read team memories
-- The existing 004 policy already allows org_id-scoped reads.
-- We add a supplemental policy so team memories with visibility='team'
-- are readable by org members even if they're not in the SELECT policy.
-- (Existing policy covers this via org_id check — no new policy needed.)

-- update the spine_match_memories RPC to include team memories
-- we create a new overload that also returns org team memories
CREATE OR REPLACE FUNCTION public.spine_match_team_memories(
  p_user          uuid,
  p_org           uuid,
  p_query_embedding vector(1536),
  p_limit         int DEFAULT 10
)
RETURNS TABLE (
  id          uuid,
  user_id     uuid,
  content     text,
  source      text,
  tags        text[],
  type        text,
  project     text,
  visibility  text,
  created_at  timestamptz,
  similarity  float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    m.id, m.user_id, m.content, m.source, m.tags,
    m.type, m.project, m.visibility, m.created_at,
    1 - (m.embedding <=> p_query_embedding) AS similarity
  FROM spine_memories m
  WHERE m.deleted_at IS NULL
    AND (
      m.user_id = p_user
      OR (m.org_id = p_org AND m.visibility = 'team')
    )
  ORDER BY m.embedding <=> p_query_embedding
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.spine_match_team_memories TO service_role;

-- ============================================================
-- 007_fix_and_hybrid.sql
-- ============================================================
-- Migration 007: fix table references from 005/006 (spine_memories → memories)
-- and add full hybrid search infrastructure for Round 8.
-- Idempotent — safe to re-run.

---------------------------------------------------------------
-- 005 columns on correct table
---------------------------------------------------------------

ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'context'
  CONSTRAINT memories_type_check
  CHECK (type IN ('decision', 'bug', 'feature', 'context', 'fact'));

CREATE INDEX IF NOT EXISTS memories_type_idx ON public.memories (user_id, type)
  WHERE deleted_at IS NULL;

---------------------------------------------------------------
-- 006 columns on correct table
---------------------------------------------------------------

ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS visibility TEXT DEFAULT 'personal'
  CONSTRAINT memories_visibility_check
  CHECK (visibility IN ('personal', 'team', 'org'));

ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS project TEXT;

CREATE INDEX IF NOT EXISTS memories_project_idx
  ON public.memories (user_id, project)
  WHERE deleted_at IS NULL AND project IS NOT NULL;

-- No org_id on memories — team visibility via tag 'team' instead.
CREATE INDEX IF NOT EXISTS memories_visibility_idx
  ON public.memories (user_id, visibility)
  WHERE deleted_at IS NULL;

---------------------------------------------------------------
-- Profiles: Slack webhook + briefing toggle (from 006)
---------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS slack_webhook TEXT;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS briefing_enabled BOOLEAN DEFAULT true;

---------------------------------------------------------------
-- Ensure content_tsv generated column exists (schema.sql has it,
-- but guard against fresh installs that skipped it)
---------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'memories'
      AND column_name  = 'content_tsv'
  ) THEN
    ALTER TABLE public.memories
      ADD COLUMN content_tsv tsvector
      GENERATED ALWAYS AS (to_tsvector('english', coalesce(content, ''))) STORED;

    CREATE INDEX IF NOT EXISTS memories_content_tsv_gin
      ON public.memories USING gin (content_tsv);
  END IF;
END$$;

---------------------------------------------------------------
-- Team memory search — no org_id dependency, uses tag 'team'
---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.spine_match_team_memories(
  p_user          uuid,
  p_query_embedding vector(1536),
  p_limit         int DEFAULT 10
)
RETURNS TABLE (
  id          uuid,
  user_id     uuid,
  content     text,
  source      text,
  tags        text[],
  type        text,
  project     text,
  visibility  text,
  created_at  timestamptz,
  similarity  float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    m.id, m.user_id, m.content, m.source, m.tags,
    m.type, m.project, m.visibility, m.created_at,
    1 - (m.embedding <=> p_query_embedding) AS similarity
  FROM public.memories m
  WHERE m.deleted_at IS NULL
    AND (
      m.user_id = p_user
      OR (m.visibility = 'team' AND m.tags @> ARRAY['team'])
    )
  ORDER BY m.embedding <=> p_query_embedding
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.spine_match_team_memories(uuid, vector, int)
  TO authenticated, service_role;

---------------------------------------------------------------
-- Hybrid search with recency decay baked in
-- Returns vec_similarity, bm25_rank, age_days so the app layer
-- can do RRF + decay without a second round-trip.
---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.spine_hybrid_candidates(
  p_user             uuid,
  p_query            text,
  p_query_embedding  vector(1536),
  p_limit            int DEFAULT 30
)
RETURNS TABLE (
  id             uuid,
  content        text,
  source         text,
  tags           text[],
  type           text,
  created_at     timestamptz,
  vec_similarity double precision,
  bm25_rank      double precision
)
LANGUAGE sql STABLE
AS $$
  WITH vec AS (
    SELECT
      m.id,
      1 - (m.embedding <=> p_query_embedding) AS sim
    FROM public.memories m
    WHERE m.user_id = p_user
      AND m.deleted_at IS NULL
      AND m.embedding IS NOT NULL
    ORDER BY m.embedding <=> p_query_embedding
    LIMIT p_limit
  ),
  bm25 AS (
    SELECT
      m.id,
      ts_rank(m.content_tsv, websearch_to_tsquery('english', p_query)) AS rank
    FROM public.memories m
    WHERE m.user_id = p_user
      AND m.deleted_at IS NULL
      AND m.content_tsv @@ websearch_to_tsquery('english', p_query)
    ORDER BY rank DESC
    LIMIT p_limit
  ),
  ids AS (
    SELECT id FROM vec
    UNION
    SELECT id FROM bm25
  )
  SELECT
    m.id,
    m.content,
    m.source,
    m.tags,
    COALESCE(m.type, 'context') AS type,
    m.created_at,
    COALESCE(vec.sim,  0)::double precision AS vec_similarity,
    COALESCE(bm25.rank, 0)::double precision AS bm25_rank
  FROM public.memories m
  JOIN ids      ON ids.id      = m.id
  LEFT JOIN vec  ON vec.id      = m.id
  LEFT JOIN bm25 ON bm25.id    = m.id;
$$;

GRANT EXECUTE ON FUNCTION public.spine_hybrid_candidates(uuid, text, vector, int)
  TO authenticated, service_role;

-- ============================================================
-- 008_memory_graph.sql
-- ============================================================
-- Migration 008: memory graph + retrieval_count for orphan detection
-- Idempotent — safe to re-run.

---------------------------------------------------------------
-- memory_edges: direct memory-to-memory links via shared entities
-- Populated by entity-extractor when a new memory shares entities
-- with existing memories. Used for graph expansion in recall.
---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.memory_edges (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  chunk_id_a       uuid NOT NULL REFERENCES public.memories(id) ON DELETE CASCADE,
  chunk_id_b       uuid NOT NULL REFERENCES public.memories(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL DEFAULT 'entity_linked'
    CONSTRAINT memory_edges_rel_check
    CHECK (relationship_type IN ('entity_linked', 'session_adjacent', 'conflict', 'supersedes')),
  entity_name      TEXT,
  weight           DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chunk_id_a, chunk_id_b, relationship_type)
);

-- Indexes for graph expansion queries (look up by either chunk)
CREATE INDEX IF NOT EXISTS memory_edges_a_user_idx
  ON public.memory_edges (user_id, chunk_id_a);
CREATE INDEX IF NOT EXISTS memory_edges_b_user_idx
  ON public.memory_edges (user_id, chunk_id_b);

ALTER TABLE public.memory_edges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS memory_edges_owner_all ON public.memory_edges;
CREATE POLICY memory_edges_owner_all ON public.memory_edges
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

---------------------------------------------------------------
-- retrieval_count on memories — incremented by retrieval-touch.ts
-- Used to identify orphans (never recalled) for health dashboard.
---------------------------------------------------------------

ALTER TABLE public.memories
  ADD COLUMN IF NOT EXISTS retrieval_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS memories_retrieval_count_idx
  ON public.memories (user_id, retrieval_count)
  WHERE deleted_at IS NULL;

---------------------------------------------------------------
-- memory_graph_neighbors RPC — efficient bilateral edge lookup
-- Returns all memories directly linked to any of the input IDs
-- via memory_edges, excluding IDs already in the seed set.
---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.memory_graph_neighbors(
  p_user     uuid,
  p_seed_ids uuid[],
  p_limit    int DEFAULT 20
)
RETURNS TABLE (
  id               uuid,
  content          text,
  source           text,
  tags             text[],
  created_at       timestamptz,
  relationship_type TEXT,
  entity_name      TEXT,
  weight           double precision
)
LANGUAGE sql STABLE
AS $$
  SELECT DISTINCT ON (m.id)
    m.id,
    m.content,
    m.source,
    m.tags,
    m.created_at,
    e.relationship_type,
    e.entity_name,
    e.weight
  FROM public.memory_edges e
  JOIN public.memories m
    ON (m.id = CASE WHEN e.chunk_id_a = ANY(p_seed_ids) THEN e.chunk_id_b ELSE e.chunk_id_a END)
  WHERE e.user_id = p_user
    AND (e.chunk_id_a = ANY(p_seed_ids) OR e.chunk_id_b = ANY(p_seed_ids))
    AND NOT (m.id = ANY(p_seed_ids))
    AND m.deleted_at IS NULL
    AND m.embedding IS NOT NULL
  ORDER BY m.id, e.weight DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.memory_graph_neighbors(uuid, uuid[], int)
  TO authenticated, service_role;

---------------------------------------------------------------
-- health_stats RPC — single query for /dashboard/health
---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.spine_health_stats(
  p_user uuid
)
RETURNS JSON
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_total          bigint;
  v_by_date        json;
  v_orphan_count   bigint;
  v_edge_count     bigint;
  v_days_covered   int;
  v_coverage_pct   numeric;
BEGIN
  -- Total memories
  SELECT COUNT(*) INTO v_total
  FROM public.memories
  WHERE user_id = p_user AND deleted_at IS NULL;

  -- Per-day counts for last 30 days
  SELECT json_agg(row_to_json(d))
  INTO v_by_date
  FROM (
    SELECT
      date_trunc('day', created_at AT TIME ZONE 'UTC')::date::text AS day,
      COUNT(*)::int AS count
    FROM public.memories
    WHERE user_id = p_user
      AND deleted_at IS NULL
      AND created_at >= NOW() - INTERVAL '30 days'
    GROUP BY 1
    ORDER BY 1
  ) d;

  -- Orphaned chunks: never retrieved AND no entity edges
  SELECT COUNT(*) INTO v_orphan_count
  FROM public.memories m
  WHERE m.user_id = p_user
    AND m.deleted_at IS NULL
    AND COALESCE(m.retrieval_count, 0) = 0
    AND NOT EXISTS (
      SELECT 1 FROM public.memory_edges e
      WHERE e.user_id = p_user
        AND (e.chunk_id_a = m.id OR e.chunk_id_b = m.id)
    );

  -- Total graph edges
  SELECT COUNT(*) INTO v_edge_count
  FROM public.memory_edges
  WHERE user_id = p_user;

  -- Coverage: % of days in last 30 that have at least 1 memory
  SELECT COUNT(DISTINCT date_trunc('day', created_at AT TIME ZONE 'UTC')::date)
  INTO v_days_covered
  FROM public.memories
  WHERE user_id = p_user
    AND deleted_at IS NULL
    AND created_at >= NOW() - INTERVAL '30 days';

  v_coverage_pct := ROUND((v_days_covered::numeric / 30.0) * 100, 1);

  RETURN json_build_object(
    'total',         v_total,
    'by_date',       COALESCE(v_by_date, '[]'::json),
    'orphan_count',  v_orphan_count,
    'edge_count',    v_edge_count,
    'days_covered',  v_days_covered,
    'coverage_pct',  v_coverage_pct
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.spine_health_stats(uuid)
  TO authenticated, service_role;

-- ============================================================
-- 009_multi_repo.sql
-- ============================================================
-- Migration 009: multi-repo reasoning infrastructure
-- spine_dependency_nodes, spine_dependency_edges, spine_session_history
-- Idempotent — safe to re-run.

---------------------------------------------------------------
-- Dependency graph — package-level and file-level nodes
---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.spine_dependency_nodes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  repo       text NOT NULL,
  name       text NOT NULL,
  type       text NOT NULL DEFAULT 'package'
    CONSTRAINT dep_nodes_type_check
    CHECK (type IN ('package', 'file', 'module')),
  version    text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, repo, name, type)
);

CREATE INDEX IF NOT EXISTS dep_nodes_user_repo_idx
  ON public.spine_dependency_nodes (user_id, repo);
CREATE INDEX IF NOT EXISTS dep_nodes_name_idx
  ON public.spine_dependency_nodes (user_id, name);

ALTER TABLE public.spine_dependency_nodes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dep_nodes_owner_all ON public.spine_dependency_nodes;
CREATE POLICY dep_nodes_owner_all ON public.spine_dependency_nodes
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

---------------------------------------------------------------
-- Dependency edges — directed: from_node depends on to_node
---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.spine_dependency_edges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  repo       text NOT NULL,
  from_node  uuid NOT NULL REFERENCES public.spine_dependency_nodes(id) ON DELETE CASCADE,
  to_node    uuid NOT NULL REFERENCES public.spine_dependency_nodes(id) ON DELETE CASCADE,
  dep_type   text NOT NULL DEFAULT 'depends_on'
    CONSTRAINT dep_edges_type_check
    CHECK (dep_type IN ('depends_on', 'devDependency', 'peerDependency', 'imports')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_node, to_node, dep_type)
);

CREATE INDEX IF NOT EXISTS dep_edges_from_idx
  ON public.spine_dependency_edges (user_id, from_node);
CREATE INDEX IF NOT EXISTS dep_edges_to_idx
  ON public.spine_dependency_edges (user_id, to_node);

ALTER TABLE public.spine_dependency_edges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS dep_edges_owner_all ON public.spine_dependency_edges;
CREATE POLICY dep_edges_owner_all ON public.spine_dependency_edges
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

---------------------------------------------------------------
-- Session history — per-conversation query/answer pairs
-- Enables follow-up questions without re-explaining context.
---------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.spine_session_history (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id         uuid NOT NULL,
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  turn_index         integer NOT NULL DEFAULT 0,
  query              text NOT NULL,
  answer             text NOT NULL,
  context_memory_ids uuid[] DEFAULT '{}'::uuid[],
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_history_session_idx
  ON public.spine_session_history (session_id, turn_index);
CREATE INDEX IF NOT EXISTS session_history_user_idx
  ON public.spine_session_history (user_id, created_at DESC);

ALTER TABLE public.spine_session_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS session_history_owner_all ON public.spine_session_history;
CREATE POLICY session_history_owner_all ON public.spine_session_history
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Auto-prune sessions older than 7 days (keep the table lean)
-- Trigger fires on INSERT; deletes rows from same user older than 7 days.
CREATE OR REPLACE FUNCTION public.spine_prune_old_sessions()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM public.spine_session_history
  WHERE user_id = NEW.user_id
    AND created_at < NOW() - INTERVAL '7 days';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS spine_session_prune_trigger ON public.spine_session_history;
CREATE TRIGGER spine_session_prune_trigger
  AFTER INSERT ON public.spine_session_history
  FOR EACH ROW EXECUTE FUNCTION public.spine_prune_old_sessions();

---------------------------------------------------------------
-- spine_repo_hybrid_candidates — hybrid search scoped to one repo
-- Mirrors spine_hybrid_candidates but adds a project filter.
---------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.spine_repo_hybrid_candidates(
  p_user            uuid,
  p_query           text,
  p_query_embedding vector(1536),
  p_project         text,
  p_limit           int DEFAULT 15
)
RETURNS TABLE (
  id             uuid,
  content        text,
  source         text,
  tags           text[],
  type           text,
  project        text,
  created_at     timestamptz,
  vec_similarity double precision,
  bm25_rank      double precision
)
LANGUAGE sql STABLE
AS $$
  WITH vec AS (
    SELECT m.id, 1 - (m.embedding <=> p_query_embedding) AS sim
    FROM public.memories m
    WHERE m.user_id = p_user
      AND m.project = p_project
      AND m.deleted_at IS NULL
      AND m.embedding IS NOT NULL
    ORDER BY m.embedding <=> p_query_embedding
    LIMIT p_limit
  ),
  bm25 AS (
    SELECT m.id,
           ts_rank(m.content_tsv, websearch_to_tsquery('english', p_query)) AS rank
    FROM public.memories m
    WHERE m.user_id = p_user
      AND m.project = p_project
      AND m.deleted_at IS NULL
      AND m.content_tsv @@ websearch_to_tsquery('english', p_query)
    ORDER BY rank DESC
    LIMIT p_limit
  ),
  ids AS (SELECT id FROM vec UNION SELECT id FROM bm25)
  SELECT
    m.id, m.content, m.source, m.tags,
    COALESCE(m.type, 'context') AS type,
    m.project, m.created_at,
    COALESCE(vec.sim,   0)::double precision AS vec_similarity,
    COALESCE(bm25.rank, 0)::double precision AS bm25_rank
  FROM public.memories m
  JOIN ids      ON ids.id   = m.id
  LEFT JOIN vec  ON vec.id   = m.id
  LEFT JOIN bm25 ON bm25.id  = m.id;
$$;

GRANT EXECUTE ON FUNCTION public.spine_repo_hybrid_candidates(uuid, text, vector, text, int)
  TO authenticated, service_role;

-- ============================================================
-- 010_fix_outcomes.sql
-- ============================================================
-- Migration 010: fix outcome feedback loop
-- spine_fix_outcomes: Roman accepts/rejects Spine fixes → drives confidence priors
-- spine_confidence_priors: Bayesian update table, per file-pattern × hypothesis-type

CREATE TABLE IF NOT EXISTS public.spine_fix_outcomes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id        uuid,
  fix_fingerprint   text NOT NULL,   -- hash of hypothesis + file + diff
  file_pattern      text NOT NULL,   -- e.g. '*.tsx', 'api/route.ts', 'components/'
  hypothesis_type   text NOT NULL,   -- e.g. 'missing-null-guard', 'wrong-dep-array'
  outcome           text NOT NULL
    CONSTRAINT outcome_check
    CHECK (outcome IN ('accepted', 'rejected', 'modified', 'deferred')),
  actual_fix        text,            -- what Roman actually committed (if modified)
  confidence_at_time double precision,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fix_outcomes_user_idx
  ON public.spine_fix_outcomes (user_id, hypothesis_type, outcome);
CREATE INDEX IF NOT EXISTS fix_outcomes_file_idx
  ON public.spine_fix_outcomes (user_id, file_pattern);

ALTER TABLE public.spine_fix_outcomes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS fix_outcomes_owner_all ON public.spine_fix_outcomes;
CREATE POLICY fix_outcomes_owner_all ON public.spine_fix_outcomes
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Confidence priors — Bayesian accept/reject counts per (file_pattern, hypothesis_type)
CREATE TABLE IF NOT EXISTS public.spine_confidence_priors (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_pattern     text NOT NULL,
  hypothesis_type  text NOT NULL,
  accept_count     integer NOT NULL DEFAULT 0,
  reject_count     integer NOT NULL DEFAULT 0,
  total_count      integer NOT NULL DEFAULT 0,
  -- modifier: (accept_count + 1) / (total_count + 2)  — Laplace-smoothed
  -- stored for fast lookup; recomputed on each outcome write
  confidence_modifier double precision NOT NULL DEFAULT 0.5,
  last_updated     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, file_pattern, hypothesis_type)
);

CREATE INDEX IF NOT EXISTS priors_user_idx
  ON public.spine_confidence_priors (user_id, file_pattern);

ALTER TABLE public.spine_confidence_priors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS priors_owner_all ON public.spine_confidence_priors;
CREATE POLICY priors_owner_all ON public.spine_confidence_priors
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- RPC: record an outcome + atomically update the prior
CREATE OR REPLACE FUNCTION public.spine_record_fix_outcome(
  p_user           uuid,
  p_fingerprint    text,
  p_file_pattern   text,
  p_hypothesis     text,
  p_outcome        text,
  p_actual_fix     text DEFAULT NULL,
  p_confidence     double precision DEFAULT NULL,
  p_session_id     uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  v_accept int;
  v_reject int;
  v_total  int;
  v_mod    double precision;
BEGIN
  -- Insert outcome row
  INSERT INTO public.spine_fix_outcomes
    (user_id, session_id, fix_fingerprint, file_pattern, hypothesis_type,
     outcome, actual_fix, confidence_at_time)
  VALUES
    (p_user, p_session_id, p_fingerprint, p_file_pattern, p_hypothesis,
     p_outcome, p_actual_fix, p_confidence);

  -- Upsert prior with incremented counts
  INSERT INTO public.spine_confidence_priors
    (user_id, file_pattern, hypothesis_type, accept_count, reject_count,
     total_count, confidence_modifier)
  VALUES (
    p_user, p_file_pattern, p_hypothesis,
    CASE WHEN p_outcome = 'accepted' THEN 1 ELSE 0 END,
    CASE WHEN p_outcome = 'rejected' THEN 1 ELSE 0 END,
    1,
    0.5
  )
  ON CONFLICT (user_id, file_pattern, hypothesis_type) DO UPDATE SET
    accept_count = spine_confidence_priors.accept_count +
      CASE WHEN p_outcome = 'accepted' THEN 1 ELSE 0 END,
    reject_count = spine_confidence_priors.reject_count +
      CASE WHEN p_outcome = 'rejected' THEN 1 ELSE 0 END,
    total_count  = spine_confidence_priors.total_count + 1,
    last_updated = now();

  -- Recompute Laplace-smoothed modifier
  SELECT accept_count, reject_count, total_count
    INTO v_accept, v_reject, v_total
    FROM public.spine_confidence_priors
   WHERE user_id = p_user
     AND file_pattern = p_file_pattern
     AND hypothesis_type = p_hypothesis;

  v_mod := (v_accept + 1.0) / (v_total + 2.0);

  UPDATE public.spine_confidence_priors
     SET confidence_modifier = v_mod
   WHERE user_id = p_user
     AND file_pattern = p_file_pattern
     AND hypothesis_type = p_hypothesis;

  RETURN json_build_object(
    'prior_updated', true,
    'accept_count', v_accept,
    'reject_count', v_reject,
    'total_count', v_total,
    'confidence_modifier', v_mod
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.spine_record_fix_outcome(uuid,text,text,text,text,text,double precision,uuid)
  TO authenticated, service_role;

-- ============================================================
-- 011_labs_spine_waitlist.sql
-- ============================================================
-- Migration 011: Round-15 labs landing — product-prefixed waitlist + recall events.
--
-- Tables:
--   saas_spine_waitlist       — email-only signups from labs.xxiautomate.com/spine
--   saas_spine_recall_events  — per-recall latency + cost log, powers /spine/stats
--
-- Prefix convention matches the AA shared-project consolidation (2026-04-20).

---------------------------------------------------------------
-- Waitlist (labs)
---------------------------------------------------------------

create table if not exists public.saas_spine_waitlist (
  id         uuid primary key default gen_random_uuid(),
  email      text unique not null,
  source     text,             -- utm/referrer label
  referrer   text,             -- Referer header
  user_agent text,
  ip_hash    text,             -- salted hash, never raw IP
  created_at timestamptz not null default now()
);

create index if not exists saas_spine_waitlist_created_idx
  on public.saas_spine_waitlist (created_at desc);

alter table public.saas_spine_waitlist enable row level security;

-- Writes go through service-role API route, not client. No public policies.

---------------------------------------------------------------
-- Recall events — per-recall latency + cost. Used by /api/spine-stats.
---------------------------------------------------------------

create table if not exists public.saas_spine_recall_events (
  id              bigserial primary key,
  user_id         uuid,             -- null for demo/public recall
  is_demo         boolean not null default false,
  query_len       integer,
  result_count    integer,
  latency_ms      integer not null,
  rerank_cost_usd numeric(10,6) not null default 0,
  embed_cost_usd  numeric(10,6) not null default 0,
  plan            text,
  cross_session   boolean not null default false,  -- true when the hit came from >24h prior session
  created_at      timestamptz not null default now()
);

create index if not exists saas_spine_recall_events_created_idx
  on public.saas_spine_recall_events (created_at desc);

create index if not exists saas_spine_recall_events_cross_idx
  on public.saas_spine_recall_events (cross_session, created_at desc);

alter table public.saas_spine_recall_events enable row level security;

-- Writes go through service-role routes only. No public policies.

-- ============================================================
-- 012_v1_1_retrieval.sql
-- ============================================================
-- Migration 012: Round 16 — v1.1 retrieval roadmap + invite flow.
--
-- Published on /spine/log. Each piece here closes one public commitment:
--   1. superseded_by chain          — append-only correction
--   2. last_confirmed_at            — provenance on injection
--   3. session_injections           — per-session de-duplication
--   4. invite_codes                 — rolling-access unblock
--   5. hybrid_candidates_v2         — superseded-aware retrieval

---------------------------------------------------------------
-- 1. Append-only correction chain.
---------------------------------------------------------------

alter table public.memories
  add column if not exists superseded_by uuid references public.memories(id) on delete set null;

create index if not exists memories_superseded_by_idx
  on public.memories (superseded_by)
  where superseded_by is not null;

-- 2. Provenance: when a memory was last re-asserted/confirmed by the user.
alter table public.memories
  add column if not exists last_confirmed_at timestamptz;

update public.memories
  set last_confirmed_at = created_at
  where last_confirmed_at is null;

---------------------------------------------------------------
-- 3. Per-session injection log. A "session" is a client-assigned opaque
--    string (session_id) — the caller decides what counts as one thread.
---------------------------------------------------------------

create table if not exists public.session_injections (
  id           bigserial primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  session_id   text not null,
  memory_id    uuid not null references public.memories(id) on delete cascade,
  fused_score  double precision not null,
  injected_at  timestamptz not null default now()
);

create index if not exists session_injections_lookup_idx
  on public.session_injections (user_id, session_id, memory_id);

create index if not exists session_injections_recent_idx
  on public.session_injections (user_id, session_id, injected_at desc);

alter table public.session_injections enable row level security;

drop policy if exists session_injections_owner_all on public.session_injections;
create policy session_injections_owner_all on public.session_injections
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

---------------------------------------------------------------
-- 4. Invite codes. Admin issues one per waitlist row → email → signup.
---------------------------------------------------------------

create table if not exists public.invite_codes (
  code         text primary key,
  email        text not null,
  waitlist_id  uuid,                      -- saas_spine_waitlist.id if originated there
  issued_by    uuid references auth.users(id) on delete set null,
  issued_at    timestamptz not null default now(),
  redeemed_by  uuid references auth.users(id) on delete set null,
  redeemed_at  timestamptz,
  expires_at   timestamptz,
  plan_grant   text not null default 'pro',  -- what plan the invite bumps them to
  notes        text
);

create index if not exists invite_codes_email_idx
  on public.invite_codes (email);

create index if not exists invite_codes_unredeemed_idx
  on public.invite_codes (issued_at desc)
  where redeemed_at is null;

alter table public.invite_codes enable row level security;
-- Writes go through service-role admin routes only. No public policies.

---------------------------------------------------------------
-- 5. Superseded-aware hybrid candidates.
--    Same shape as spine_hybrid_candidates but:
--      - drops rows where superseded_by points at a memory still live
--      - returns is_superseded + last_confirmed_at for TS-side provenance
---------------------------------------------------------------

create or replace function public.spine_hybrid_candidates_v2(
  p_user            uuid,
  p_query           text,
  p_query_embedding vector(1536),
  p_limit           int default 30
)
returns table (
  id                 uuid,
  content            text,
  source             text,
  tags               text[],
  created_at         timestamptz,
  last_confirmed_at  timestamptz,
  superseded_by      uuid,
  vec_similarity     double precision,
  bm25_rank          double precision
)
language sql stable
as $$
  with vec as (
    select
      m.id,
      1 - (m.embedding <=> p_query_embedding) as sim
    from public.memories m
    where m.user_id = p_user
      and m.deleted_at is null
      and m.embedding is not null
    order by m.embedding <=> p_query_embedding
    limit p_limit
  ),
  bm25 as (
    select
      m.id,
      ts_rank(m.content_tsv, websearch_to_tsquery('english', coalesce(p_query, ''))) as rank
    from public.memories m
    where m.user_id = p_user
      and m.deleted_at is null
      and p_query is not null
      and length(trim(p_query)) > 0
      and m.content_tsv @@ websearch_to_tsquery('english', p_query)
    order by rank desc
    limit p_limit
  ),
  ids as (
    select id from vec
    union
    select id from bm25
  )
  select
    m.id,
    m.content,
    m.source,
    m.tags,
    m.created_at,
    m.last_confirmed_at,
    m.superseded_by,
    coalesce(vec.sim, 0)::double precision as vec_similarity,
    coalesce(bm25.rank, 0)::double precision as bm25_rank
  from public.memories m
  join ids on ids.id = m.id
  left join vec  on vec.id  = m.id
  left join bm25 on bm25.id = m.id;
$$;

grant execute on function public.spine_hybrid_candidates_v2(uuid, text, vector, int)
  to authenticated, service_role;

-- ============================================================
-- 013_scale_proof.sql
-- ============================================================
-- Migration 013: Round 17 — "proof it remembers a million things".
--
-- Adds:
--   1. is_bench flag on memories — separates synthetic scale-test corpus from
--      real user data so /api/spine-stats can filter it out.
--   2. saas_spine_bench_runs — per-scale latency + accuracy snapshots.
--   3. saas_spine_bench_needles — the identifiable memories used in the
--      needle-in-haystack accuracy test, per run.

---------------------------------------------------------------
-- 1. Tag bench memories.
---------------------------------------------------------------

alter table public.memories
  add column if not exists is_bench boolean not null default false;

create index if not exists memories_is_bench_idx
  on public.memories (is_bench)
  where is_bench = true;

---------------------------------------------------------------
-- 2. Bench runs. One row per (scale, run_at).
---------------------------------------------------------------

create table if not exists public.saas_spine_bench_runs (
  id                uuid primary key default gen_random_uuid(),
  scale             integer not null,      -- total memories in the index at test time
  needle_count      integer not null,      -- how many needles were inserted
  query_count       integer not null,      -- how many queries were run
  top_k             integer not null,      -- retrieval limit used
  needles_found     integer not null,      -- out of (needle_count × query_count)
  recall_accuracy   numeric(6,4) not null, -- needles_found / (needle_count × query_count)
  p50_latency_ms    integer not null,
  p95_latency_ms    integer not null,
  p99_latency_ms    integer not null,
  avg_latency_ms    integer not null,
  max_latency_ms    integer not null,
  embed_model       text,
  git_sha           text,
  notes             text,
  created_at        timestamptz not null default now()
);

create index if not exists saas_spine_bench_runs_scale_idx
  on public.saas_spine_bench_runs (scale desc, created_at desc);

alter table public.saas_spine_bench_runs enable row level security;

-- Public read is safe: bench results are publishable. No PII.
drop policy if exists bench_runs_public_read on public.saas_spine_bench_runs;
create policy bench_runs_public_read on public.saas_spine_bench_runs
  for select
  using (true);

---------------------------------------------------------------
-- 3. Bench needles — the identifiable memories we inject and then
--    verify Spine can find again. Kept for forensic inspection.
---------------------------------------------------------------

create table if not exists public.saas_spine_bench_needles (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid references public.saas_spine_bench_runs(id) on delete cascade,
  memory_id    uuid references public.memories(id) on delete set null,
  token        text not null,       -- the unique token embedded in the needle content
  query        text not null,
  rank         integer,             -- 1-indexed position of the needle in the result set, null if not found
  similarity   double precision,
  found        boolean not null,
  created_at   timestamptz not null default now()
);

create index if not exists saas_spine_bench_needles_run_idx
  on public.saas_spine_bench_needles (run_id);

alter table public.saas_spine_bench_needles enable row level security;
-- Service role only — no public policy needed.

-- ============================================================
-- 014_rerank_v2.sql
-- ============================================================
-- Migration 014: Round 18 — hybrid rerank v2 with learned weights + why trace.
--
-- NO STORAGE CHANGES. All of this is ranking infrastructure.
--
-- Adds:
--   1. memories.centrality        — personalized PageRank score, refreshed offline
--   2. spine_rerank_weights       — versioned weight rows from the trainer
--   3. spine_hybrid_candidates_v3 — returns raw per-signal scores (BM25/vec/age/centrality)

---------------------------------------------------------------
-- 1. Centrality column — computed by scripts/compute-centrality.mjs
---------------------------------------------------------------

alter table public.memories
  add column if not exists centrality double precision not null default 0;

create index if not exists memories_centrality_idx
  on public.memories (user_id, centrality desc);

---------------------------------------------------------------
-- 2. Versioned rerank weights.
--    Exactly one row per user_id is active (is_active = true) at a time.
--    Training pipeline writes a new row + flips active atomically.
---------------------------------------------------------------

create table if not exists public.spine_rerank_weights (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid,                           -- null = global default
  bm25_w         double precision not null,
  vec_w          double precision not null,
  recency_w      double precision not null,
  centrality_w  double precision not null,
  bias           double precision not null default 0,
  training_n     integer not null default 0,     -- # training samples
  training_auc   double precision,               -- diagnostic
  model_version  text not null default 'lr-v1',
  is_active      boolean not null default true,
  notes          text,
  created_at     timestamptz not null default now()
);

create unique index if not exists spine_rerank_weights_active_user_idx
  on public.spine_rerank_weights (user_id)
  where is_active = true and user_id is not null;

create unique index if not exists spine_rerank_weights_active_global_idx
  on public.spine_rerank_weights ((true))
  where is_active = true and user_id is null;

-- Seed the default global weights if none exist. Informed priors from the
-- existing RRF-fused path: vector dominates, BM25 is a strong secondary,
-- recency is a light tiebreaker, centrality is a subtle nudge.
insert into public.spine_rerank_weights
  (user_id, bm25_w, vec_w, recency_w, centrality_w, bias, training_n, model_version, notes)
select null, 0.25, 0.55, 0.10, 0.10, 0.0, 0, 'default-v1', 'hand-tuned priors — no training yet'
where not exists (
  select 1 from public.spine_rerank_weights where user_id is null and is_active = true
);

alter table public.spine_rerank_weights enable row level security;

-- Users read their own (or fall back to global).
drop policy if exists rerank_weights_own_or_global_read on public.spine_rerank_weights;
create policy rerank_weights_own_or_global_read on public.spine_rerank_weights
  for select
  using (user_id is null or user_id = auth.uid());

---------------------------------------------------------------
-- 3. Candidates RPC that returns raw signals, NOT pre-fused.
--    TS layer does the fusion so it can apply the active weight row
--    and emit the per-memory why object.
---------------------------------------------------------------

create or replace function public.spine_hybrid_candidates_v3(
  p_user            uuid,
  p_query           text,
  p_query_embedding vector(1536),
  p_limit           int default 40
)
returns table (
  id                 uuid,
  content            text,
  source             text,
  tags               text[],
  created_at         timestamptz,
  last_confirmed_at  timestamptz,
  superseded_by      uuid,
  centrality         double precision,
  vec_similarity     double precision,
  bm25_rank          double precision
)
language sql stable
as $$
  with vec as (
    select
      m.id,
      1 - (m.embedding <=> p_query_embedding) as sim
    from public.memories m
    where m.user_id = p_user
      and m.deleted_at is null
      and m.embedding is not null
    order by m.embedding <=> p_query_embedding
    limit p_limit
  ),
  bm25 as (
    select
      m.id,
      ts_rank(m.content_tsv, websearch_to_tsquery('english', coalesce(p_query, ''))) as rank
    from public.memories m
    where m.user_id = p_user
      and m.deleted_at is null
      and p_query is not null
      and length(trim(p_query)) > 0
      and m.content_tsv @@ websearch_to_tsquery('english', p_query)
    order by rank desc
    limit p_limit
  ),
  ids as (
    select id from vec
    union
    select id from bm25
  )
  select
    m.id,
    m.content,
    m.source,
    m.tags,
    m.created_at,
    m.last_confirmed_at,
    m.superseded_by,
    coalesce(m.centrality, 0)::double precision,
    coalesce(vec.sim, 0)::double precision as vec_similarity,
    coalesce(bm25.rank, 0)::double precision as bm25_rank
  from public.memories m
  join ids on ids.id = m.id
  left join vec  on vec.id  = m.id
  left join bm25 on bm25.id = m.id;
$$;

grant execute on function public.spine_hybrid_candidates_v3(uuid, text, vector, int)
  to authenticated, service_role;

-- ============================================================
-- 015_real_labels.sql
-- ============================================================
-- Migration 015: Round 19 — real labels, not weak supervision.
--
-- Per-candidate recall logging + inferred usage labels + saved weight profiles.
-- Replaces the session_injections-proxy-as-label approach with actual
-- "was this memory surfaced and then cited in the user's next turn" signal.

---------------------------------------------------------------
-- 1. Every /api/search and /api/spine/search hit gets one row.
---------------------------------------------------------------

create table if not exists public.saas_spine_recall_queries (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid,                       -- null for demo/public
  session_id       text,                       -- client-assigned thread identifier
  is_demo          boolean not null default false,
  query            text not null,
  query_hash       text not null,              -- sha256(lower(query)) for dedup + joins
  pool_size        integer not null,
  top_k            integer not null,
  shown_ids        uuid[] not null default '{}'::uuid[],
  provider         text,                       -- cross-encoder provider or null
  weights_snap     jsonb not null,             -- {bm25_w, vec_w, recency_w, centrality_w, bias, model_version}
  latency_ms       integer not null,
  created_at       timestamptz not null default now()
);

create index if not exists recall_queries_user_idx
  on public.saas_spine_recall_queries (user_id, created_at desc);
create index if not exists recall_queries_demo_idx
  on public.saas_spine_recall_queries (is_demo, created_at desc);
create index if not exists recall_queries_session_idx
  on public.saas_spine_recall_queries (user_id, session_id, created_at desc);

alter table public.saas_spine_recall_queries enable row level security;
drop policy if exists recall_queries_owner_read on public.saas_spine_recall_queries;
create policy recall_queries_owner_read on public.saas_spine_recall_queries
  for select using (user_id is null or user_id = auth.uid());

---------------------------------------------------------------
-- 2. Every CANDIDATE (not just the returned top-5) gets one row.
--    This is what the trainer reads — it needs to know what was
--    shown AND what was in the pool but ranked lower.
---------------------------------------------------------------

create table if not exists public.saas_spine_recall_candidates (
  id                 bigserial primary key,
  query_id           uuid not null references public.saas_spine_recall_queries(id) on delete cascade,
  memory_id          uuid,                      -- null-safe: memory may be deleted later
  content_preview    text,                      -- first 160 chars for label inference
  rank_shown         integer,                   -- 1-indexed if shown in top_k, null otherwise
  why_bm25           double precision not null default 0,
  why_vec            double precision not null default 0,
  why_recency        double precision not null default 0,
  why_centrality     double precision not null default 0,
  why_final          double precision not null default 0,
  dominant           text,                      -- bm25 | vec | recency | centrality
  cross_encoder_score double precision,         -- null if fused-only ordering used
  created_at         timestamptz not null default now()
);

create index if not exists recall_candidates_query_idx
  on public.saas_spine_recall_candidates (query_id);
create index if not exists recall_candidates_memory_idx
  on public.saas_spine_recall_candidates (memory_id, created_at desc);

alter table public.saas_spine_recall_candidates enable row level security;
-- Candidates inherit access via their parent query — check via join.
drop policy if exists recall_candidates_owner_read on public.saas_spine_recall_candidates;
create policy recall_candidates_owner_read on public.saas_spine_recall_candidates
  for select using (
    exists (
      select 1 from public.saas_spine_recall_queries q
      where q.id = query_id
        and (q.user_id is null or q.user_id = auth.uid())
    )
  );

---------------------------------------------------------------
-- 3. Labels inferred when the user's next turn cites a shown memory.
--    Signal types:
--      'quoted_phrase' — substring overlap ≥ N words
--      'user_cite'     — explicit UI click / pin (future)
--      'mcp_inject'    — returned by recall and subsequently touched (proxy fallback)
---------------------------------------------------------------

create table if not exists public.saas_spine_recall_labels (
  id           bigserial primary key,
  query_id     uuid not null references public.saas_spine_recall_queries(id) on delete cascade,
  memory_id    uuid,
  was_used     boolean not null,
  signal_type  text not null,
  confidence   double precision not null default 1.0,
  matched_text text,                              -- the phrase that matched, for auditability
  created_at   timestamptz not null default now(),
  unique (query_id, memory_id, signal_type)
);

create index if not exists recall_labels_query_idx
  on public.saas_spine_recall_labels (query_id);
create index if not exists recall_labels_used_idx
  on public.saas_spine_recall_labels (was_used, created_at desc);

alter table public.saas_spine_recall_labels enable row level security;
drop policy if exists recall_labels_owner_read on public.saas_spine_recall_labels;
create policy recall_labels_owner_read on public.saas_spine_recall_labels
  for select using (
    exists (
      select 1 from public.saas_spine_recall_queries q
      where q.id = query_id
        and (q.user_id is null or q.user_id = auth.uid())
    )
  );

---------------------------------------------------------------
-- 4. Weight profiles — users save slider configs from /spine/why.
---------------------------------------------------------------

create table if not exists public.saas_spine_weight_profiles (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  name            text not null,
  bm25_w          double precision not null,
  vec_w           double precision not null,
  recency_w       double precision not null,
  centrality_w    double precision not null,
  bias            double precision not null default 0,
  notes           text,
  created_at      timestamptz not null default now()
);

create unique index if not exists weight_profiles_user_name_idx
  on public.saas_spine_weight_profiles (user_id, name);

alter table public.saas_spine_weight_profiles enable row level security;
drop policy if exists weight_profiles_owner_all on public.saas_spine_weight_profiles;
create policy weight_profiles_owner_all on public.saas_spine_weight_profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

---------------------------------------------------------------
-- 5. Training-data view. Trainer reads this instead of re-assembling joins.
---------------------------------------------------------------

create or replace view public.spine_training_samples as
  select
    q.id                 as query_id,
    q.user_id,
    q.query,
    c.memory_id,
    c.rank_shown,
    c.why_bm25,
    c.why_vec,
    c.why_recency,
    c.why_centrality,
    c.cross_encoder_score,
    coalesce(l.was_used, false) as label,
    coalesce(l.signal_type, 'none') as label_source
  from public.saas_spine_recall_queries q
  join public.saas_spine_recall_candidates c on c.query_id = q.id
  left join lateral (
    select was_used, signal_type
    from public.saas_spine_recall_labels ll
    where ll.query_id = q.id and ll.memory_id = c.memory_id
    order by ll.confidence desc
    limit 1
  ) l on true;

grant select on public.spine_training_samples to authenticated, service_role;

-- ============================================================
-- 016_v2_multimodal_providers_audit.sql
-- ============================================================
-- Migration 016: Spine v2 — multi-modal storage, provider-agnostic embeddings,
-- unified audit trail.
--
-- Three slices of the v2 spec land here:
--   (1) Multi-modal storage. memories.content stays the canonical text payload;
--       new columns describe the *original* artefact when it isn't text. The
--       embedding still comes from a textual representation (caption or
--       extracted text) so the existing 1536-dim retrieval pipeline keeps
--       working unchanged.
--   (7) Provider-agnostic embeddings. Track which provider + model produced
--       each embedding so we can reason about heterogeneity, schedule
--       re-embeds, and enforce dim invariants per provider.
--   (8) Unified audit trail. Single append-only ledger of every read, write,
--       embed, forget. Sits next to the specialised logs (recall_queries,
--       session_injections, org_audit_log) — it is the cross-cut view, not a
--       replacement.
--
-- Idempotent. Safe to re-run.

---------------------------------------------------------------
-- 1. Multi-modal columns on memories.
--    `mime`         — IANA media type (text/plain, image/jpeg, audio/mpeg, …)
--    `content_url`  — signed URL to the original artefact when stored
--                     externally (S3, Backblaze, Supabase Storage). When set,
--                     `content` typically holds a caption / OCR / transcript.
--    `content_size` — bytes of the original artefact, for quota + display.
--    `caption`      — the textual representation that fed the embedding.
--                     Always present when content_url is set; null for plain
--                     text rows (the embedding comes from `content` directly).
---------------------------------------------------------------

alter table public.memories
  add column if not exists mime         text not null default 'text/plain',
  add column if not exists content_url  text,
  add column if not exists content_size bigint,
  add column if not exists caption      text;

-- Cheap filter for "show me only images / only audio" timeline views.
create index if not exists memories_mime_idx
  on public.memories (user_id, mime)
  where deleted_at is null;

comment on column public.memories.mime is
  'IANA media type. text/plain rows store the payload inline in content. Non-text rows store a caption/transcript in content and the original artefact at content_url.';
comment on column public.memories.content_url is
  'External URL to the original artefact for non-text memories. NULL when content holds the payload directly.';
comment on column public.memories.caption is
  'Textual representation that produced the embedding for non-text content. NULL for text/plain memories (their embedding comes from content).';

---------------------------------------------------------------
-- 2. Provider tracking on memories.
--    Each row records the provider + model that produced its embedding so a
--    background job can rebalance the corpus when we change providers, and
--    so /api/audit can answer "which embeddings came from where".
---------------------------------------------------------------

alter table public.memories
  add column if not exists embed_provider text,    -- 'openai' | 'voyage' | 'cohere' | …
  add column if not exists embed_model    text,    -- e.g. 'text-embedding-3-small'
  add column if not exists embed_dims     integer; -- 1536 for v2.0 — invariant for now

create index if not exists memories_embed_provider_idx
  on public.memories (user_id, embed_provider)
  where deleted_at is null and embedding is not null;

-- Backfill existing rows: any row with a non-null embedding came from OpenAI
-- text-embedding-3-small at 1536 dims, since that's the only path that has
-- shipped to date. Skip rows that already have provider info.
update public.memories
   set embed_provider = 'openai',
       embed_model    = 'text-embedding-3-small',
       embed_dims     = 1536
 where embedding is not null
   and embed_provider is null;

comment on column public.memories.embed_provider is
  'Embedding provider that produced this row''s vector. NULL when no embedding has been computed.';

---------------------------------------------------------------
-- 3. Unified audit trail.
--    One row per memory operation. Append-only. Service-role writes; users
--    can read their own (RLS).
--
--    `op` — read | write | embed | delete | reembed
--    `caller` — free-form tag identifying the source: api-key id, mcp client
--               name, 'extension', 'cron-decay', etc. Used to answer
--               "what touched my memories?" in the dashboard.
---------------------------------------------------------------

create table if not exists public.memory_audit (
  id           bigserial primary key,
  user_id      uuid references auth.users(id) on delete cascade,
  org_id       uuid references public.orgs(id) on delete cascade,
  op           text not null,
  memory_id    uuid,                                -- not FK: survives hard delete for forensics
  query        text,                                -- read ops: the query string (truncated)
  caller       text,                                -- key id, integration name, cron job name
  mime         text,                                -- write ops: the mime that landed
  embed_provider text,                              -- embed/reembed ops: which provider was used
  metadata     jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now(),
  constraint memory_audit_op_check check (op in ('read','write','embed','reembed','delete'))
);

create index if not exists memory_audit_user_time_idx
  on public.memory_audit (user_id, created_at desc);

create index if not exists memory_audit_org_time_idx
  on public.memory_audit (org_id, created_at desc)
  where org_id is not null;

create index if not exists memory_audit_memory_idx
  on public.memory_audit (memory_id, created_at desc)
  where memory_id is not null;

create index if not exists memory_audit_op_idx
  on public.memory_audit (user_id, op, created_at desc);

alter table public.memory_audit enable row level security;

drop policy if exists memory_audit_owner_read on public.memory_audit;
create policy memory_audit_owner_read on public.memory_audit
  for select
  using (
    user_id = auth.uid()
    or (org_id is not null and org_id = any(public.my_org_ids()))
  );

-- No write policy — audit rows are inserted by service-role only.

comment on table public.memory_audit is
  'Append-only ledger of every memory operation. Cross-cut view across capture, recall, forget, embed. Survives hard deletes for forensic access.';

---------------------------------------------------------------
-- 4. RPC: stats for /api/audit.
--    Returns per-op counts in a window so the dashboard can render the
--    daily activity strip without reading every row.
---------------------------------------------------------------

create or replace function public.spine_audit_stats(
  p_user uuid,
  p_since timestamptz default (now() - interval '30 days')
)
returns table (
  op             text,
  total          bigint,
  last_at        timestamptz,
  unique_callers bigint
)
language sql stable
as $$
  select
    a.op,
    count(*)::bigint                                  as total,
    max(a.created_at)                                 as last_at,
    count(distinct a.caller)::bigint                  as unique_callers
  from public.memory_audit a
  where a.user_id = p_user
    and a.created_at >= p_since
  group by a.op
  order by a.op;
$$;

grant execute on function public.spine_audit_stats(uuid, timestamptz)
  to authenticated, service_role;

-- ============================================================
-- 017_decisions.sql
-- ============================================================
-- Migration 017: Decisions as a first-class object.
--
-- Memories are raw facts. Decisions are the derived second layer — distilled
-- one-sentence statements ("we picked Coolify over Vercel because of AU
-- region") that supersede each other over time. They are the answer to
-- "what did we decide?" — a question raw memory recall is bad at because
-- decisions are scattered across many conversations.
--
-- Pipeline (lib/decision-extractor.ts):
--   capture/route.ts → fire-and-forget Haiku call → if classified as a
--   decision → insert here. Original memory always retained — decisions are
--   a derived layer, not a replacement.
--
-- Append-only same as everything else in Spine. status transitions are the
-- only mutation: 'active' → 'superseded' (via superseded_by) or 'reverted'.
-- We never delete a decision row; we mark it inert.
--
-- Idempotent.

---------------------------------------------------------------
-- 1. decisions — the derived layer
---------------------------------------------------------------

create table if not exists public.decisions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  org_id            uuid references public.orgs(id) on delete cascade,
  source_memory_id  uuid references public.memories(id) on delete set null,
                                          -- the memory this decision was extracted from.
                                          -- on memory hard-delete (forget) we keep the
                                          -- decision but null the link — the decision
                                          -- itself remains valid even if the original
                                          -- conversation is forgotten.
  statement         text not null,        -- the distilled decision, one sentence
  context           text,                  -- excerpt around the decision (≤500 chars)
  status            text not null default 'active'
                    check (status in ('active','superseded','reverted','pending_review')),
  superseded_by     uuid references public.decisions(id) on delete set null,
  confidence        double precision not null default 0,
                                          -- 0..1, Haiku's self-reported confidence
  tags              text[] default '{}'::text[],
  metadata          jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists decisions_user_status_idx
  on public.decisions (user_id, status, created_at desc);

create index if not exists decisions_source_memory_idx
  on public.decisions (source_memory_id)
  where source_memory_id is not null;

create index if not exists decisions_superseded_by_idx
  on public.decisions (superseded_by)
  where superseded_by is not null;

create index if not exists decisions_org_idx
  on public.decisions (org_id, created_at desc)
  where org_id is not null;

-- Full-text search on statement so /dashboard/decisions can filter by query
-- without leaving Postgres.
alter table public.decisions
  add column if not exists statement_tsv tsvector
  generated always as (to_tsvector('english', coalesce(statement, ''))) stored;

create index if not exists decisions_statement_tsv_gin
  on public.decisions using gin (statement_tsv);

alter table public.decisions enable row level security;

drop policy if exists decisions_owner_all on public.decisions;
create policy decisions_owner_all on public.decisions
  for all
  using (
    user_id = auth.uid()
    or (org_id is not null and org_id = any(public.my_org_ids()))
  )
  with check (
    user_id = auth.uid()
    or (org_id is not null and org_id = any(public.my_org_ids()))
  );

comment on table public.decisions is
  'Derived layer over memories. Each row is a one-sentence decision distilled by Haiku at capture time. Append-only; status transitions are the only mutation.';
comment on column public.decisions.superseded_by is
  'When a later decision overturns this one, that decision''s id goes here and status flips to ''superseded''. Forms a chain — follow superseded_by until null to find the current authoritative decision.';

---------------------------------------------------------------
-- 2. decision_evidence — links between decisions and the memories that
--    support, contradict, or contextualise them.
--    Rationale: a decision often evolves across multiple captures. The
--    source_memory_id on decisions is where it was BORN; this table
--    records every memory that touches it after.
---------------------------------------------------------------

create table if not exists public.decision_evidence (
  id           bigserial primary key,
  decision_id  uuid not null references public.decisions(id) on delete cascade,
  memory_id    uuid not null references public.memories(id) on delete cascade,
  relation     text not null check (relation in ('supports','contradicts','contextualises','supersedes_target')),
  weight       double precision not null default 1.0,
  created_at   timestamptz not null default now(),
  unique (decision_id, memory_id, relation)
);

create index if not exists decision_evidence_decision_idx
  on public.decision_evidence (decision_id);

create index if not exists decision_evidence_memory_idx
  on public.decision_evidence (memory_id);

alter table public.decision_evidence enable row level security;

drop policy if exists decision_evidence_via_decision on public.decision_evidence;
create policy decision_evidence_via_decision on public.decision_evidence
  for select
  using (
    exists (
      select 1 from public.decisions d
      where d.id = decision_id
        and (d.user_id = auth.uid()
             or (d.org_id is not null and d.org_id = any(public.my_org_ids())))
    )
  );

---------------------------------------------------------------
-- 3. RPC: counts for the /dashboard/decisions stats card.
---------------------------------------------------------------

create or replace function public.spine_decision_stats(
  p_user uuid,
  p_since timestamptz default (now() - interval '30 days')
)
returns table (
  status         text,
  total          bigint,
  last_at        timestamptz
)
language sql stable
as $$
  select
    d.status,
    count(*)::bigint           as total,
    max(d.created_at)          as last_at
  from public.decisions d
  where d.user_id = p_user
    and d.created_at >= p_since
  group by d.status
  order by d.status;
$$;

grant execute on function public.spine_decision_stats(uuid, timestamptz)
  to authenticated, service_role;

---------------------------------------------------------------
-- 4. RPC: full-text search over decisions + score.
--    Used by /api/decisions?q=... — keeps the heavy lifting in Postgres.
---------------------------------------------------------------

create or replace function public.spine_search_decisions(
  p_user  uuid,
  p_query text,
  p_limit int default 25
)
returns table (
  id           uuid,
  statement    text,
  context      text,
  status       text,
  confidence   double precision,
  tags         text[],
  source_memory_id uuid,
  superseded_by uuid,
  rank         double precision,
  created_at   timestamptz
)
language sql stable
as $$
  select
    d.id,
    d.statement,
    d.context,
    d.status,
    d.confidence,
    d.tags,
    d.source_memory_id,
    d.superseded_by,
    ts_rank(d.statement_tsv, websearch_to_tsquery('english', coalesce(p_query, ''))) as rank,
    d.created_at
  from public.decisions d
  where d.user_id = p_user
    and (
      p_query is null
      or length(trim(p_query)) = 0
      or d.statement_tsv @@ websearch_to_tsquery('english', p_query)
    )
  order by
    case when p_query is null or length(trim(p_query)) = 0 then 0 else 1 end,
    rank desc,
    d.created_at desc
  limit p_limit;
$$;

grant execute on function public.spine_search_decisions(uuid, text, int)
  to authenticated, service_role;
