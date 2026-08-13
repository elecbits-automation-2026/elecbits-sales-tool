-- ═══════════════════════════════════════════════════════════════════════════
-- sales port — the live Sales OS's tables, CONFORMED to the PMS session's
-- architecture in eb-core-database-1.
--
-- PREREQUISITES (from the elecbits-pms-odm2 repo, supabase/…, in this order —
-- all idempotent):
--   1. sanction-gate.sql        core.tools / staffing / projects sanction cols
--   2. schemas/01-core.sql      core.contacts / documents / events / numbering
--   3. schemas/02-sales.sql     sales.leads / activities / quotes / requests
--                               + core.intake + sales.settle_request()
--   4. schemas/03-ulm.sql       ULM's side of the request contract
--
-- WHAT THIS FILE ADDS (and only adds — nothing of theirs is altered):
--   • the current app's working tables, prefixed nothing, schema `sales`
--   • two serial series in THEIR core.numbering (client 781, project 1877)
--   • write policies: their 02-sales granted read-only pending "when the tool
--     ships" — it ships now
--
-- CONFORMANCE DECISIONS (why some earlier tables are gone):
--   • people        → core.people as-is (id + nullable auth_id, linked on
--                     signup by THEIR public.handle_new_user). Sales-side
--                     role/dept/active live in sales.people_detail; the
--                     core role stays 'engineer' so sales admins never gain
--                     PMS/HR/Finance is_admin() rights.
--   • companies     → core.orgs as-is (client_id already holds the official
--                     Eb- IDs; industry/org_size/website/owner_id/kind are
--                     theirs). Sales-only facts go in sales.org_detail.
--   • trainings     → core.trainings reused (user_id / title / resource /
--                     due / status / assigned_by). No new table.
--   • activities    → named sales.org_activities: THEIR sales.activities
--                     (lead-based) already exists and stays untouched.
--   • memory        → sales.memory, NOT core.memory: core.memory is injected
--                     into the PMS assistant's prompts, so sales notes there
--                     would leak into ODM answers.
--   • quotes        → theirs (sales.quotes + quote_lines), used from Phase 2.
--   • RFQ → project → THEIR contract: sales.requests → core.intake →
--                     ulm / sales.settle_request(). No parallel queue.
--
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create schema if not exists sales;

-- ═══ PEOPLE DETAIL — the sales tool's opinion of a person ══════════════════
create table if not exists sales.people_detail (
  person_id  uuid primary key references core.people(id) on delete cascade,
  role       text not null default 'agent'
               check (role in ('admin','dept_head','agent','finance')),
  dept       text default 'Sales',
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- ═══ ORG DETAIL — sales-only facts about a company ═════════════════════════
-- industry / org_size / website / owner_id / kind live on core.orgs.
create table if not exists sales.org_detail (
  org_id         uuid primary key references core.orgs(id) on delete cascade,
  what_they_do   text,
  city           text,
  source         text,
  potential      numeric(14,2) not null default 0,
  legacy_cid     text,                     -- the old EB-C-0001 pseudo-id
  contact_person text,                     -- P0 denormalised primary contact;
  designation    text,                     -- core.contacts is canonical from
  contact_phone  text,                     -- Phase 1
  contact_email  text,
  custom         jsonb not null default '[]'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ═══ DEALS — the live 10-stage pipeline ════════════════════════════════════
-- THEIR sales.leads is the lean forward-model funnel; this is the pipeline the
-- deployed app runs on today. Phase 1 decides whether they merge; until then a
-- deal that reaches RFQ raises a sales.requests row (their contract) for ULM.
create table if not exists sales.deals (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null,
  org_id     uuid not null references core.orgs(id) on delete cascade,
  owner_id   uuid references core.people(id) on delete set null,
  value      numeric(14,2) not null default 0,
  currency   text not null default 'INR',
  stage      text not null default 'lead'
               check (stage in ('lead','first_meeting','physical_meeting','rfq',
                                'project_id','pm_added','quote_lld','negotiation',
                                'closure','po')),
  lost       boolean not null default false,
  lost_note  text,
  request_id uuid,                          -- → sales.requests once RFQ raised
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists deals_org_idx2   on sales.deals(org_id);
create index if not exists deals_owner_idx2 on sales.deals(owner_id);
create index if not exists deals_open_idx2  on sales.deals(stage) where lost = false;

create table if not exists sales.deal_moves (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references sales.deals(id) on delete cascade,
  from_stage  text,
  to_stage    text,
  summary     text,
  facts       jsonb not null default '{}'::jsonb,
  risks       jsonb not null default '[]'::jsonb,
  next_action text,
  transcript  jsonb not null default '[]'::jsonb,
  gated       boolean not null default false,
  forced      boolean not null default false,
  author_id   uuid references core.people(id) on delete set null,
  at          timestamptz not null default now()
);
create index if not exists deal_moves_deal_idx2 on sales.deal_moves(deal_id, at);

-- ═══ ORG ACTIVITIES — company notes (their sales.activities is lead-based) ═
create table if not exists sales.org_activities (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references core.orgs(id) on delete cascade,
  kind       text not null default 'note'
               check (kind in ('note','call','email','meeting','visit')),
  body       text not null,
  author_id  uuid references core.people(id) on delete set null,
  at         timestamptz not null default now()
);
create index if not exists org_activities_org_idx on sales.org_activities(org_id, at);

-- ═══ TARGETS ═══════════════════════════════════════════════════════════════
create table if not exists sales.targets (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references core.people(id) on delete cascade,
  period     text not null,
  metric     text not null
               check (metric in ('companies','meetings','rfqs','quotes','pos',
                                 'revenue','completeness')),
  target     numeric(14,2) not null default 0,
  set_by     uuid references core.people(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (person_id, period, metric)
);

-- ═══ KNOWLEDGE ═════════════════════════════════════════════════════════════
create table if not exists sales.knowledge (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  content    text not null,
  access     text not null default 'all'
               check (access in ('all','leadership','admin')),
  created_by uuid references core.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ═══ WORK UPDATES — AI-scored, mirroring pms.work_updates ═════════════════
create table if not exists sales.work_updates (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references core.people(id) on delete cascade,
  on_date    date not null default current_date,
  note       text not null,
  score      int,
  feedback   text,
  kpi_hits   jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (person_id, on_date)
);

-- ═══ TRAVEL REQUESTS ═══════════════════════════════════════════════════════
create table if not exists sales.travel_requests (
  id            uuid primary key default gen_random_uuid(),
  person_id     uuid not null references core.people(id) on delete cascade,
  org_id        uuid references core.orgs(id) on delete set null,
  purpose       text not null,
  city          text,
  from_date     date,
  to_date       date,
  mode          text,
  estimate      numeric(14,2) not null default 0,
  notes         text,
  status        text not null default 'pending'
                  check (status in ('pending','approved','rejected')),
  decided_by    uuid references core.people(id) on delete set null,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now()
);

-- ═══ SCRUM NOTES ═══════════════════════════════════════════════════════════
create table if not exists sales.scrum_notes (
  id         uuid primary key default gen_random_uuid(),
  on_date    date not null default current_date,
  raw        text not null,
  organized  jsonb not null default '{}'::jsonb,
  author_id  uuid references core.people(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ═══ MEMORY — sales-scoped assistant context ═══════════════════════════════
create table if not exists sales.memory (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  content    text not null,
  created_by uuid references core.people(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ═══ GATE CONFIG ═══════════════════════════════════════════════════════════
create table if not exists sales.gate_config (
  stage        text primary key
                 check (stage in ('lead','first_meeting','physical_meeting','rfq',
                                  'project_id','pm_added','quote_lld','negotiation',
                                  'closure','po')),
  requirements jsonb not null default '[]'::jsonb,
  updated_by   uuid references core.people(id) on delete set null,
  updated_at   timestamptz not null default now()
);

-- ═══ MEETINGS — brainstorming per client, mirroring pms.meetings ═══════════
create table if not exists sales.meetings (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references core.orgs(id) on delete cascade,
  deal_id    uuid references sales.deals(id) on delete set null,
  on_date    date not null default current_date,
  title      text,
  attendees  jsonb not null default '[]'::jsonb,
  raw        text,
  author_id  uuid references core.people(id) on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists sales.meeting_ideas (
  id         uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references sales.meetings(id) on delete cascade,
  seq        int not null default 0,
  author_id  uuid references core.people(id) on delete set null,
  by_name    text,
  idea       text not null,
  impact     text,
  value      int check (value between 1 and 5),
  why        text
);
create table if not exists sales.meeting_decisions (
  id         uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references sales.meetings(id) on delete cascade,
  seq        int not null default 0,
  what       text not null,
  owner_id   uuid references core.people(id) on delete set null,
  owner_name text
);
create table if not exists sales.meeting_challenges (
  id         uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references sales.meetings(id) on delete cascade,
  seq        int not null default 0,
  challenge  text not null,
  action     text,
  status     text not null default 'open'
               check (status in ('solved','open','watch'))
);

-- ═══ AUTH LINK — sign-up adopts the roster row ═════════════════════════════
-- Their fix-resource-creation.sql established this (auth_id + adopt-by-email),
-- but 00-one-structure.sql later replaced public.handle_new_user with a
-- version that blind-inserts a new core.people row. That breaks BOTH tools'
-- "admin adds the email first, the person's first sign-in claims the row"
-- flow. This restores their own earlier behaviour, ported to core.people —
-- for an email nobody rostered it does exactly what the current version does.
alter table core.people add column if not exists auth_id uuid;
create unique index if not exists people_auth_id_key
  on core.people (auth_id) where auth_id is not null;

-- Rows that came from a sign-up have an id that IS an auth user id — say so.
update core.people p
   set auth_id = p.id
 where p.auth_id is null
   and exists (select 1 from auth.users u where u.id = p.id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = core, public as $$
declare existing core.people%rowtype; cnt int;
begin
  -- Someone already rostered this email (PMS resource or sales user): this
  -- sign-up is their login arriving. Keep their row, record the login.
  select * into existing from core.people
   where auth_id is null and email is not null
     and lower(email) = lower(new.email)
   limit 1;

  if found then
    update core.people
       set auth_id = new.id,
           name = coalesce(nullif(name, ''),
                           new.raw_user_meta_data->>'name',
                           new.raw_user_meta_data->>'full_name',
                           split_part(new.email, '@', 1))
     where id = existing.id;
    return new;
  end if;

  -- Nobody was expecting them — same behaviour as the current trigger.
  select count(*) into cnt from core.people;
  insert into core.people (id, auth_id, email, name, role, color)
  values (new.id, new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name',
                   new.raw_user_meta_data->>'name',
                   split_part(new.email, '@', 1)),
          case when cnt = 0 then 'superadmin' else 'engineer' end,
          '#2563eb')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ═══ ROSTER MANAGEMENT — the sanctioned inward path ════════════════════════
-- core.people writes are own-row or core-admin only, and sales admins are
-- deliberately 'engineer' in core (no PMS/HR admin bleed). So roster edits go
-- through SECURITY DEFINER functions that check the SALES role instead —
-- the architecture's "function inward" rule.
create or replace function sales.is_sales_admin() returns boolean
language sql stable security definer set search_path = sales, core, public as $$
  select exists (
    select 1 from sales.people_detail d
    join core.people p on p.id = d.person_id
    where coalesce(p.auth_id, p.id) = auth.uid()
      and d.role in ('admin','dept_head') and d.active
  ) or public.is_admin();
$$;

create or replace function sales.upsert_person(
  p_id     uuid,
  p_name   text,
  p_email  text,
  p_role   text    default 'agent',
  p_dept   text    default 'Sales',
  p_active boolean default true
) returns uuid
language plpgsql security definer set search_path = core, sales, public as $$
declare v_id uuid;
begin
  if p_role not in ('admin','dept_head','agent','finance') then
    raise exception 'unknown sales role: %', p_role;
  end if;

  if not sales.is_sales_admin() then
    -- First-run bootstrap: while the sales roster is empty, a signed-in user
    -- may enrol only themself (the app makes them admin).
    if exists (select 1 from sales.people_detail) then
      raise exception 'only a sales admin can manage the sales roster';
    end if;
    if lower(coalesce(p_email,'')) is distinct from
       lower((select u.email from auth.users u where u.id = auth.uid())) then
      raise exception 'bootstrap may only enrol your own email';
    end if;
  end if;

  -- Find the person: by id, else by email (adopting a row PMS or a sign-up
  -- already created), else a brand-new roster row awaiting sign-up.
  select id into v_id from core.people where id = p_id;
  if v_id is null and coalesce(p_email,'') <> '' then
    select id into v_id from core.people
     where lower(email) = lower(p_email) limit 1;
  end if;

  if v_id is null then
    v_id := coalesce(p_id, gen_random_uuid());
    insert into core.people (id, email, name, role, color)
    values (v_id, p_email, p_name, 'engineer', '#2563eb')
    on conflict (id) do nothing;
  else
    update core.people
       set name  = coalesce(nullif(p_name,  ''), name),
           email = coalesce(nullif(p_email, ''), email)
     where id = v_id;               -- core role deliberately untouched
  end if;

  insert into sales.people_detail (person_id, role, dept, active)
  values (v_id, p_role, coalesce(p_dept, 'Sales'), coalesce(p_active, true))
  on conflict (person_id) do update
    set role = excluded.role, dept = excluded.dept, active = excluded.active;

  return v_id;
end $$;

create or replace function sales.remove_person(p_id uuid) returns void
language plpgsql security definer set search_path = sales, core, public as $$
begin
  if not sales.is_sales_admin() then
    raise exception 'only a sales admin can manage the sales roster';
  end if;
  -- Off the sales roster only — the core row (and everything it owns across
  -- tools) stays.
  delete from sales.people_detail where person_id = p_id;
end $$;

revoke all on function sales.is_sales_admin() from public;
revoke all on function sales.upsert_person(uuid,text,text,text,text,boolean) from public;
revoke all on function sales.remove_person(uuid) from public;
grant execute on function sales.is_sales_admin() to authenticated;
grant execute on function sales.upsert_person(uuid,text,text,text,text,boolean) to authenticated;
grant execute on function sales.remove_person(uuid) to authenticated;

-- ═══ NUMBERING — two serial series in THEIR mint ═══════════════════════════
-- core.next_number('client_serial') → '781', '782', … (width 1 = no padding);
-- the app composes Eb-<industry>-<size>-<serial> around it. Seeded above every
-- serial observed in the Client ID + Project Tracking sheets (12 Aug 2026).
-- Adjust: update core.numbering set last_value = N-1 where kind = '...';
insert into core.numbering (kind, prefix, width, per_year, last_value) values
  ('client_serial',  '', 1, false, 780),
  ('project_serial', '', 1, false, 1876)
on conflict (kind) do nothing;

-- ═══ PERMISSIONS — their pattern, plus the writes ("when it ships" = now) ══
do $$
declare t text;
begin
  foreach t in array array[
    'people_detail','org_detail','deals','deal_moves','org_activities',
    'targets','knowledge','work_updates','travel_requests','scrum_notes',
    'memory','gate_config','meetings','meeting_ideas','meeting_decisions',
    'meeting_challenges',
    -- their tables, now getting their deferred write policies:
    'leads','activities','quotes','quote_lines','requests'
  ] loop
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
  end loop;
end $$;

grant usage on schema sales to authenticated;
grant select, insert, update, delete on all tables in schema sales to authenticated;
grant usage, select on all sequences in schema sales to authenticated;
alter default privileges in schema sales
  grant select, insert, update, delete on tables to authenticated;
revoke all on all tables in schema sales from anon;

-- updated_at maintenance (their public.touch_updated_at, from 02-sales)
drop trigger if exists org_detail_touch on sales.org_detail;
create trigger org_detail_touch before update on sales.org_detail
  for each row execute function public.touch_updated_at();
drop trigger if exists deals_touch2 on sales.deals;
create trigger deals_touch2 before update on sales.deals
  for each row execute function public.touch_updated_at();
