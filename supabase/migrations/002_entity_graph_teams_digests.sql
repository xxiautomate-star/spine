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
