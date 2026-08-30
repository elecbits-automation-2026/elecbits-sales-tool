-- ═══════════════════════════════════════════════════════════════════════════
-- THE PIPELINE BRAIN — dynamic stages, judged temperature, the commitment
-- alarm, the requirement that feeds sanctioning, and the Scrum Master's
-- attendance ledger. Run after 22-task-stage.sql. Idempotent.
--
-- The model:
--   • Every deal gets its OWN stage plan (every project is different) —
--     sales.deal_stages, same shape the PMS proved with project_stages.
--   • Temperature (cold/warm/hot) is a second axis, judged from evidence,
--     with an append-only history so velocity is measurable.
--   • A deal carries the salesperson's OWN committed next step and deadline;
--     RED is "your committed date passed", not an arbitrary clock.
--   • A request to ULM carries the full requirement analysis as data —
--     ULM reads it through the existing core.intake view (jsonb rides along
--     only if that view is later widened; the text summary always travels).
--   • The Scrum Master records who showed up by the 10:30 cutoff, whether
--     the team scrum happened (transcript = proof), and what was covered.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══ 1. REQUIREMENT ANALYSIS on the request ════════════════════════════════
alter table sales.requests
  add column if not exists requirement jsonb not null default '{}'::jsonb,
  add column if not exists ai          jsonb not null default '{}'::jsonb;

-- ═══ 2. THE DEAL'S OWN STAGE PLAN ══════════════════════════════════════════
create table if not exists sales.deal_stages (
  id         uuid primary key default gen_random_uuid(),
  deal_id    uuid not null references sales.deals(id) on delete cascade,
  seq        int  not null default 0,
  name       text not null,
  status     text not null default 'pending'
               check (status in ('pending','active','done','blocked','skipped')),
  start_on   date,
  end_on     date,
  owner_id   uuid references core.people(id) on delete set null,
  note       text,
  evidence   jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists deal_stages_deal_idx on sales.deal_stages(deal_id, seq);

alter table sales.deals
  add column if not exists plan_summary    text,
  add column if not exists plan_updated_at timestamptz,
  add column if not exists plan_log        jsonb not null default '[]'::jsonb,

-- ═══ 3. TEMPERATURE — judged, with history ═════════════════════════════
  add column if not exists temperature     text not null default 'cold',
  add column if not exists temperature_at  timestamptz,
  add column if not exists temperature_why text,

-- ═══ 4. THE COMMITMENT — next step in the salesperson's own words ══════════
  add column if not exists next_step         text,
  add column if not exists next_step_due     timestamptz,
  add column if not exists next_step_owner   uuid references core.people(id) on delete set null,
  add column if not exists next_step_set_at  timestamptz,
  add column if not exists next_step_done_at timestamptz;

alter table sales.deals drop constraint if exists deals_temperature_check;
alter table sales.deals add constraint deals_temperature_check
  check (temperature in ('cold','warm','hot'));

create table if not exists sales.temperature_moves (
  id        uuid primary key default gen_random_uuid(),
  deal_id   uuid not null references sales.deals(id) on delete cascade,
  from_temp text,
  to_temp   text not null check (to_temp in ('cold','warm','hot','won','lost')),
  why       text,
  evidence  text,
  decided   text not null default 'ai' check (decided in ('ai','human','ai_confirmed')),
  by_id     uuid references core.people(id) on delete set null,
  at        timestamptz not null default now()
);
create index if not exists temperature_moves_deal_idx on sales.temperature_moves(deal_id, at desc);

-- ═══ 5. SCRUM MASTER SESSIONS — attendance is interaction ══════════════════
create table if not exists sales.scrum_sessions (
  id            uuid primary key default gen_random_uuid(),
  person_id     uuid not null references core.people(id) on delete cascade,
  on_date       date not null,
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  on_time       boolean not null default true,     -- started before the 10:30 IST cutoff
  team_scrum    text check (team_scrum is null or team_scrum in ('yes','no')),
  scrum_note_id uuid references sales.scrum_notes(id) on delete set null,  -- transcript proof
  messages      jsonb not null default '[]'::jsonb,
  covered       jsonb not null default '[]'::jsonb, -- [{companyId, dealId, summary, nextStep, due}]
  status        text not null default 'open' check (status in ('open','done')),
  unique (person_id, on_date)
);
create index if not exists scrum_sessions_date_idx on sales.scrum_sessions(on_date desc);

-- ═══ PERMISSIONS ═══════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['deal_stages','temperature_moves','scrum_sessions'] loop
    execute format('alter table sales.%I enable row level security', t);
    if not exists (select 1 from pg_policies
                   where schemaname='sales' and tablename=t and policyname=t||'_read') then
      execute format('create policy %I on sales.%I for select to authenticated using (true)', t||'_read', t);
    end if;
    if not exists (select 1 from pg_policies
                   where schemaname='sales' and tablename=t and policyname=t||'_write') then
      execute format(
        'create policy %I on sales.%I for all to authenticated using (true) with check (true)', t||'_write', t);
    end if;
    execute format('grant select, insert, update, delete on sales.%I to authenticated', t);
    execute format('revoke all on sales.%I from anon', t);
  end loop;
end $$;

select 'sales.deal_stages' as t, count(*) from sales.deal_stages
union all select 'sales.temperature_moves', count(*) from sales.temperature_moves
union all select 'sales.scrum_sessions',   count(*) from sales.scrum_sessions;
-- ═══════════════════════════════════════════════════════════════════════════
-- THE RFQ LINK + THE 4-PHASE PIPELINE. Run after 23-pipeline-brain.sql.
-- Idempotent.
--
--   • The pipeline a salesperson sees is cold → warm → rfq → hot: the deal's
--     temperature, with `rfq` as a real phase between warm and hot.
--   • An RFQ link is a requirement-gathering page the salesperson SENDS TO
--     THE CLIENT: it shows what Elecbits will share back (Quote / LLD, with
--     effort, time and cost) and collects the client's requirement. The
--     public page reads and submits through /api/rfq (service role) — the
--     anon key gets NO grant here.
-- ═══════════════════════════════════════════════════════════════════════════

alter table sales.deals drop constraint if exists deals_temperature_check;
alter table sales.deals add constraint deals_temperature_check
  check (temperature in ('cold','warm','rfq','hot'));

alter table sales.temperature_moves drop constraint if exists temperature_moves_to_temp_check;
alter table sales.temperature_moves add constraint temperature_moves_to_temp_check
  check (to_temp in ('cold','warm','rfq','hot','won','lost'));

create table if not exists sales.rfq_links (
  id             uuid primary key default gen_random_uuid(),  -- the link token
  org_id         uuid not null references core.orgs(id)  on delete cascade,
  deal_id        uuid references sales.deals(id)         on delete set null,
  title          text,
  -- What Elecbits offers back: [{kind:'quote'|'lld', effort:'', time:'', cost:''}]
  offer          jsonb not null default '[]'::jsonb,
  note_to_client text,
  contact_name   text,          -- who at the client this was sent to
  status         text not null default 'created'
                   check (status in ('created','opened','submitted','closed')),
  response       jsonb not null default '{}'::jsonb,   -- what the client filled
  opened_at      timestamptz,
  submitted_at   timestamptz,
  created_by     uuid references core.people(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists rfq_links_org_idx on sales.rfq_links(org_id, created_at desc);

alter table sales.rfq_links enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='sales' and tablename='rfq_links' and policyname='rfq_links_read') then
    create policy rfq_links_read on sales.rfq_links for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='sales' and tablename='rfq_links' and policyname='rfq_links_write') then
    create policy rfq_links_write on sales.rfq_links for all to authenticated using (true) with check (true);
  end if;
end $$;
grant select, insert, update, delete on sales.rfq_links to authenticated;
revoke all on sales.rfq_links from anon;   -- the public page goes through /api/rfq

select 'sales.rfq_links' as t, count(*) from sales.rfq_links;
-- ═══════════════════════════════════════════════════════════════════════════
-- SERVICE-ROLE GRANTS — the public RFQ page's error, fixed at the root.
--
-- /api/rfq talks to PostgREST with the service role. That role bypasses RLS
-- but still needs plain Postgres USAGE on a schema — and `sales`/`core` were
-- created by SQL scripts that granted usage only to `authenticated`, so the
-- public page died with "permission denied for schema sales".
-- Run after 24-rfq-links.sql. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

grant usage on schema sales to service_role;
grant usage on schema core  to service_role;
grant all    on all tables    in schema sales to service_role;
grant select on all tables    in schema core  to service_role;
grant usage  on all sequences in schema sales to service_role;
alter default privileges in schema sales grant all on tables to service_role;

select 'service_role can now reach' as note, count(*) as sales_tables
from information_schema.tables where table_schema = 'sales';
-- ═══════════════════════════════════════════════════════════════════════════
-- THE OVERTAKE — once a deal reaches RFQ, ULM decides how it takes the
-- project over: full overtake (ULM runs it end to end) or semi overtake
-- (sales stays in the loop). Lives on the request ULM already reads through
-- core.intake. Run after 25-service-role-grants.sql. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════
alter table sales.requests
  add column if not exists overtake text not null default 'pending';
alter table sales.requests drop constraint if exists requests_overtake_check;
alter table sales.requests add constraint requests_overtake_check
  check (overtake in ('pending','full','semi'));

select 'sales.requests overtake' as t, count(*) from sales.requests;


-- ═══ 27-capacity.sql ══════════════════════════════════════════════════════
-- The ODM CAP column: open deals a person can carry at once.
alter table sales.people_detail add column if not exists capacity int not null default 3;


-- ═══ 28-task-sources.sql ══════════════════════════════════════════════════
-- New task origins: stage (phase kickoff) and step (generated from the step).
alter table sales.tasks drop constraint if exists tasks_source_check;
alter table sales.tasks add constraint tasks_source_check
  check (source in ('manual','chat','scrum','system','comms','commitment','transcript','stage','step'));
-- ═══════════════════════════════════════════════════════════════════════════
-- THE DMP BRAIN — what the AI learns from the Google Drive DMP folder
-- (Digital Manufacturing Platform), stored as pgvector embeddings.
--
--   • /api/memory crawls the DMP folder, reads every readable file, chunks
--     the text, embeds it (Voyage; VOYAGE_API_KEY in Vercel) and upserts here.
--   • sales.match_memory() serves nearest-neighbour retrieval to the deal
--     copilot and System Memory search. Until embeddings are configured, the
--     full-text index answers instead — the feature degrades, never dies.
--
-- Run any time after 10-sales-port.sql. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists vector;

create table if not exists sales.memory_chunks (
  id          bigint generated always as identity primary key,
  file_id     text not null,             -- Drive file id
  file_name   text not null,
  folder_path text not null default '',  -- e.g. DMP/Processes/PCBA
  chunk_index int  not null default 0,
  content     text not null,
  embedding   vector(512),               -- voyage-3-lite; null until embedded
  modified    text,                      -- Drive modifiedTime, for change detection
  fetched_at  timestamptz not null default now(),
  unique (file_id, chunk_index)
);
create index if not exists memory_chunks_file_idx on sales.memory_chunks(file_id);
create index if not exists memory_chunks_fts_idx on sales.memory_chunks
  using gin (to_tsvector('english', content));
-- The ANN index arrives once rows exist; ivfflat on an empty table is useless.
do $$ begin
  if (select count(*) from sales.memory_chunks) > 100 then
    if not exists (select 1 from pg_indexes where schemaname='sales' and indexname='memory_chunks_vec_idx') then
      create index memory_chunks_vec_idx on sales.memory_chunks
        using ivfflat (embedding vector_cosine_ops) with (lists = 20);
    end if;
  end if;
end $$;

alter table sales.memory_chunks enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='sales' and tablename='memory_chunks' and policyname='memory_chunks_read') then
    create policy memory_chunks_read on sales.memory_chunks for select to authenticated using (true);
  end if;
end $$;
grant select on sales.memory_chunks to authenticated;
grant all on sales.memory_chunks to service_role;
grant usage on all sequences in schema sales to service_role;
revoke all on sales.memory_chunks from anon;

-- Nearest chunks by cosine distance. SECURITY DEFINER so the app can call it
-- through PostgREST rpc while the table itself stays read-only.
create or replace function sales.match_memory(query_embedding vector(512), match_count int default 8)
returns table (file_name text, folder_path text, content text, similarity float)
language sql stable security definer set search_path = sales, public as $$
  select m.file_name, m.folder_path, m.content,
         1 - (m.embedding <=> query_embedding) as similarity
  from sales.memory_chunks m
  where m.embedding is not null
  order by m.embedding <=> query_embedding
  limit greatest(1, least(match_count, 20));
$$;
grant execute on function sales.match_memory(vector, int) to authenticated, service_role;

-- The degraded path: plain full-text search when no embeddings exist yet.
create or replace function sales.search_memory_text(q text, match_count int default 8)
returns table (file_name text, folder_path text, content text, similarity float)
language sql stable security definer set search_path = sales, public as $$
  select m.file_name, m.folder_path, m.content,
         ts_rank(to_tsvector('english', m.content), websearch_to_tsquery('english', q))::float as similarity
  from sales.memory_chunks m
  where to_tsvector('english', m.content) @@ websearch_to_tsquery('english', q)
  order by similarity desc
  limit greatest(1, least(match_count, 20));
$$;
grant execute on function sales.search_memory_text(text, int) to authenticated, service_role;

select 'sales.memory_chunks' as t, count(*) from sales.memory_chunks;
