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
