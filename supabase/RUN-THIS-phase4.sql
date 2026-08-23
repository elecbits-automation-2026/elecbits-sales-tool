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
