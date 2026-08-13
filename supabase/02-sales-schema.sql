-- ═══════════════════════════════════════════════════════════════════════════
-- eb-core-database-1 · the `sales` tool schema
--
-- Pipeline in front of the spine. Depends on `core` only — never on another
-- tool schema (convention 1). Run 01-core-schema.sql first.
--
-- WHAT MOVED WHERE, from today's public.collections JSON blobs:
--   sales:companies  → core.orgs + core.org_roles('prospect'/'client')
--                      + core.contacts + sales.org_detail (sales-only facts)
--   sales:deals      → sales.deals
--   deal history     → sales.deal_moves  (+ a core.events row per move)
--   sales:activities → sales.activities
--   sales:kpis       → sales.targets
--   sales:knowledge  → sales.knowledge
--   sales:memory     → core.memory (scope = 'sales')
--   sales:scrums     → sales.scrum_notes
--   sales:gates      → sales.gate_config
--   sales:worklogs   → sales.work_updates
--   sales:expenses   → sales.travel_requests here (the ASK); the money itself
--                      becomes a finance.expenses row once spent (stage 3).
--   sales:users      → core.people + core.grants  (no sales-owned user table)
-- ═══════════════════════════════════════════════════════════════════════════

create schema if not exists sales;

-- ═══ PEOPLE DETAIL ═════════════════════════════════════════════════════════
-- The sales tool's opinion of a person — same pattern as org_detail below.
-- `role` is the app's vocabulary (admin / dept_head / agent / finance); the
-- database-level lock is still core.grants, this only drives the UI.
create table if not exists sales.people_detail (
  person_id  uuid primary key references core.people(id) on delete cascade,
  role       text not null default 'agent'
               check (role in ('admin','dept_head','agent','finance')),
  dept       text default 'Sales',
  created_at timestamptz not null default now()
);


-- ═══ ORG DETAIL ════════════════════════════════════════════════════════════
-- The artifact defines <tool>.project_detail for project facts only one tool
-- cares about. Sales needs the same escape hatch for ORGS: `source`,
-- `potential`, `what_they_do` and the free-form custom fields are sales
-- opinions about a company and would fail core's "would all six tools mean the
-- same thing by it?" test. Same pattern, keyed on core.orgs.id.
create table if not exists sales.org_detail (
  org_id        uuid primary key references core.orgs(id) on delete cascade,
  what_they_do  text,
  industry      text,
  city          text,
  address       text,
  source        text,                                  -- inbound / referral / cold
  potential     numeric(14,2) not null default 0,      -- annual, INR
  currency      char(3) not null default 'INR',
  account_owner uuid references core.people(id) on delete set null,
  -- Primary contact, denormalised for Phase 0 so the app edits one row.
  -- core.contacts stays the canonical index (the migration writes both);
  -- Phase 1's HubSpot-style record moves contact editing onto core.contacts.
  contact_person text,
  designation    text,
  contact_phone  text,
  contact_email  text,
  custom        jsonb not null default '[]'::jsonb,    -- [{k,v}] every minute detail
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists org_detail_owner_idx on sales.org_detail(account_owner);

-- ═══ DEALS ═════════════════════════════════════════════════════════════════
-- project_id is the handover. Winning a deal is ONE UPDATE that fills it in —
-- not a re-entry of the client into the PMS.
create table if not exists sales.deals (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null,                     -- core.next_code('EB-D-')
  org_id     uuid not null references core.orgs(id) on delete cascade,
  project_id uuid references core.projects(id) on delete set null,
  owner_id   uuid references core.people(id) on delete set null,
  value      numeric(14,2) not null default 0,
  currency   char(3) not null default 'INR',
  stage      text not null default 'lead'
               check (stage in ('lead','first_meeting','physical_meeting','rfq',
                                'project_id','pm_added','quote_lld','negotiation',
                                'closure','po')),
  lost       boolean not null default false,
  lost_note  text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists deals_org_idx     on sales.deals(org_id);
create index if not exists deals_owner_idx   on sales.deals(owner_id);
create index if not exists deals_project_idx on sales.deals(project_id);
create index if not exists deals_open_idx    on sales.deals(stage) where lost = false;

-- Every stage move, with what the AI gate extracted. Keep the transcript: it is
-- the audit trail AND the raw material for contribution scoring.
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
  gated       boolean not null default false,          -- cleared the AI gate
  forced      boolean not null default false,          -- admin bypass, on record
  by          uuid references core.people(id) on delete set null,
  at          timestamptz not null default now()
);
create index if not exists deal_moves_deal_idx on sales.deal_moves(deal_id, at desc);

-- ═══ ACTIVITIES ════════════════════════════════════════════════════════════
-- Calls, emails, meetings, visits — against a deal or an org.
create table if not exists sales.activities (
  id         uuid primary key default gen_random_uuid(),
  deal_id    uuid references sales.deals(id) on delete cascade,
  org_id     uuid references core.orgs(id) on delete cascade,
  kind       text not null default 'note'
               check (kind in ('note','call','email','meeting','visit')),
  body       text not null,
  by         uuid references core.people(id) on delete set null,
  at         timestamptz not null default now(),
  -- the artifact says "against a deal or an org"; enforce that at least one is
  -- present, or the row is unreachable from either side.
  constraint activities_target check (deal_id is not null or org_id is not null)
);
create index if not exists activities_deal_idx on sales.activities(deal_id, at desc);
create index if not exists activities_org_idx  on sales.activities(org_id, at desc);

-- ═══ QUOTES ════════════════════════════════════════════════════════════════
-- Versioned; the PDF lives in Drive, the metadata lives here.
create table if not exists sales.quotes (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references sales.deals(id) on delete cascade,
  version     integer not null default 1,
  amount      numeric(14,2) not null default 0,
  currency    char(3) not null default 'INR',
  margin_pct  numeric(5,2),
  valid_until date,
  status      text not null default 'draft'
                check (status in ('draft','sent','accepted','rejected','expired')),
  document_id uuid references core.documents(id) on delete set null,
  sent_to     uuid references core.contacts(id) on delete set null,
  created_by  uuid references core.people(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (deal_id, version)
);

-- ═══ TARGETS ═══════════════════════════════════════════════════════════════
-- Per-person, per-period numbers — the input to mgmt, and to HR reviews.
-- Normalised so a new metric needs no DDL and history survives month to month.
create table if not exists sales.targets (
  id        uuid primary key default gen_random_uuid(),
  person_id uuid not null references core.people(id) on delete cascade,
  period    text not null default to_char(now(), 'YYYY-MM'),
  metric    text not null
              check (metric in ('companies','meetings','rfqs','quotes','pos',
                                'revenue','completeness')),
  target    numeric(14,2) not null default 0,
  set_by    uuid references core.people(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (person_id, period, metric)
);
create index if not exists targets_period_idx on sales.targets(period);

-- ═══ PARTNERS ══════════════════════════════════════════════════════════════
-- Tier and agreement for orgs playing the `partner` role.
create table if not exists sales.partners (
  org_id      uuid primary key references core.orgs(id) on delete cascade,
  tier        text check (tier in ('bronze','silver','gold','strategic')),
  agreement_document_id uuid references core.documents(id) on delete set null,
  commission_pct numeric(5,2),
  since       date,
  created_at  timestamptz not null default now()
);

-- ═══ KNOWLEDGE ═════════════════════════════════════════════════════════════
-- Product/service collateral the sales assistant answers from. Deliberately NOT
-- core.memory: this carries per-row access levels, and core.memory is standing
-- rules injected into prompts.
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

-- ═══ TRAININGS ═════════════════════════════════════════════════════════════
-- Parked in sales until the hr schema exists (the ideal model homes training
-- there); moving it later is one INSERT..SELECT because the shape matches.
create table if not exists sales.trainings (
  id           uuid primary key default gen_random_uuid(),
  person_id    uuid not null references core.people(id) on delete cascade,
  title        text not null,
  knowledge_id uuid references sales.knowledge(id) on delete set null,
  due          date,
  status       text not null default 'assigned'
                 check (status in ('assigned','in_progress','done')),
  assigned_by  uuid references core.people(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- ═══ DAILY SCRUM ═══════════════════════════════════════════════════════════
create table if not exists sales.scrum_notes (
  id         uuid primary key default gen_random_uuid(),
  on_date    date not null default current_date,
  raw        text not null,
  organized  jsonb not null default '{}'::jsonb,       -- AI-extracted tasks
  by         uuid references core.people(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists scrum_notes_date_idx on sales.scrum_notes(on_date desc);

-- ═══ WORK UPDATES ══════════════════════════════════════════════════════════
-- The daily discipline strip. One per person per day, enforced. Mirrors the
-- live PMS's public.work_updates: the AI scores each update against the
-- person's KPIs and leaves feedback + which KPIs the day actually served.
create table if not exists sales.work_updates (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references core.people(id) on delete cascade,
  on_date    date not null default current_date,
  note       text not null,
  score      int,                                    -- AI: 0–100 vs the KPI block
  feedback   text,                                   -- AI: one-paragraph coaching
  kpi_hits   jsonb not null default '[]'::jsonb,     -- AI: which KPIs this day served
  created_at timestamptz not null default now(),
  unique (person_id, on_date)
);
alter table sales.work_updates add column if not exists score    int;
alter table sales.work_updates add column if not exists feedback text;
alter table sales.work_updates add column if not exists kpi_hits jsonb not null default '[]'::jsonb;

-- ═══ MEETINGS — brainstorming / MoM, replicated from the live PMS set ══════
-- Same structure as public.meetings + meeting_ideas / _decisions / _challenges,
-- but sales-scoped: a session happens against a client (and optionally a deal).
-- Ideas are credited per person and become the contribution score; challenges
-- carry an honest solved/open/watching status; decisions carry an owner.
create table if not exists sales.meetings (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references core.orgs(id) on delete cascade,
  deal_id    uuid references sales.deals(id) on delete set null,
  on_date    date not null default current_date,
  title      text,
  attendees  jsonb not null default '[]'::jsonb,     -- names; people ids where known
  raw        text,                                   -- what was said, as typed/dictated
  by         uuid references core.people(id) on delete set null,
  by_name    text,
  created_at timestamptz not null default now()
);
create index if not exists meetings_org_idx  on sales.meetings(org_id, on_date desc);
create index if not exists meetings_deal_idx on sales.meetings(deal_id);

create table if not exists sales.meeting_ideas (
  id         uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references sales.meetings(id) on delete cascade,
  seq        int not null default 0,
  by         uuid references core.people(id) on delete set null,
  by_name    text,
  idea       text not null,
  impact     text,                                   -- changed approach / saved time / caught risk / lifted quality
  value      int check (value between 1 and 5),      -- how much it actually helped
  why        text
);
create index if not exists meeting_ideas_meeting_idx on sales.meeting_ideas(meeting_id);
create index if not exists meeting_ideas_by_idx      on sales.meeting_ideas(by);

create table if not exists sales.meeting_decisions (
  id         uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references sales.meetings(id) on delete cascade,
  seq        int not null default 0,
  what       text not null,
  owner      uuid references core.people(id) on delete set null,
  owner_name text
);
create index if not exists meeting_decisions_meeting_idx on sales.meeting_decisions(meeting_id);

create table if not exists sales.meeting_challenges (
  id         uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references sales.meetings(id) on delete cascade,
  seq        int not null default 0,
  challenge  text not null,
  action     text,
  status     text not null default 'open'
               check (status in ('solved','open','watch'))
);
create index if not exists meeting_challenges_meeting_idx on sales.meeting_challenges(meeting_id);

-- ═══ TRAVEL REQUESTS ═══════════════════════════════════════════════════════
-- The ASK, which is a sales workflow. Once the money is actually spent it
-- becomes a finance.expenses row (stage 3) — sales asks, finance pays.
-- The date window doubles as an availability signal: who is on the road when.
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
  currency      char(3) not null default 'INR',
  notes         text,
  status        text not null default 'pending'
                  check (status in ('pending','approved','rejected')),
  decided_by    uuid references core.people(id) on delete set null,
  decided_at    timestamptz,
  decision_note text,
  created_at    timestamptz not null default now()
);
create index if not exists travel_window_idx on sales.travel_requests(from_date, to_date);

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

-- ═══ updated_at ════════════════════════════════════════════════════════════
create or replace function sales.touch() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array['org_detail','deals','knowledge'] loop
    execute format('drop trigger if exists %I_touch on sales.%I', t, t);
    execute format('create trigger %I_touch before update on sales.%I
                      for each row execute function sales.touch()', t, t);
  end loop;
end $$;

-- ═══ RLS ═══════════════════════════════════════════════════════════════════
-- Every policy is a one-liner calling core.can(). NOTE the (select …) wrapper:
-- it makes Postgres evaluate the check ONCE per query as an InitPlan instead of
-- once per row. Calling core.can() bare — as the proposal's examples do — is
-- correct but turns into a per-row function call on large scans.
do $$
declare t text;
begin
  foreach t in array array[
    'people_detail','org_detail','deals','deal_moves','activities','quotes','targets',
    'partners','knowledge','trainings','scrum_notes','work_updates','travel_requests','gate_config',
    'meetings','meeting_ideas','meeting_decisions','meeting_challenges'
  ] loop
    execute format('alter table sales.%I enable row level security', t);
    execute format('drop policy if exists %I_read  on sales.%I', t, t);
    execute format('drop policy if exists %I_write on sales.%I', t, t);
    execute format(
      'create policy %I_read on sales.%I for select to authenticated
         using ((select core.can(''sales'',''read'')))', t, t);
    execute format(
      'create policy %I_write on sales.%I for all to authenticated
         using ((select core.can(''sales'',''write'')))
         with check ((select core.can(''sales'',''write'')))', t, t);
  end loop;
end $$;

-- Your own work update is yours to write even without tool-wide write.
drop policy if exists work_updates_own on sales.work_updates;
create policy work_updates_own on sales.work_updates for all to authenticated
  using (person_id = (select core.me())) with check (person_id = (select core.me()));

-- Leadership-only knowledge stays leadership-only.
drop policy if exists knowledge_read on sales.knowledge;
create policy knowledge_read on sales.knowledge for select to authenticated
  using (
    (select core.can('sales','read'))
    and (access = 'all'
         or (access = 'leadership' and (select core.can('sales','admin')))
         or (access = 'admin'      and (select core.can('sales','admin'))))
  );

grant usage on schema sales to authenticated;
grant select, insert, update, delete on all tables in schema sales to authenticated;
grant usage, select on all sequences in schema sales to authenticated;
alter default privileges in schema sales
  grant select, insert, update, delete on tables to authenticated;
revoke all on all tables in schema sales from anon;

-- ═══ FIRST-RUN BOOTSTRAP ═══════════════════════════════════════════════════
-- On a brand-new database the roster is empty, and RLS would stop the very
-- first signed-in user from inserting themselves. This SECURITY DEFINER RPC
-- makes the first authenticated caller the admin — and only ever the first:
-- once core.people has a row, it degrades to returning core.me().
create or replace function sales.bootstrap_first_admin(_name text default null)
returns uuid language plpgsql security definer set search_path = core, sales, public as $$
declare pid uuid; em text;
begin
  if exists (select 1 from core.people) then
    return core.me();
  end if;
  select email into em from auth.users where id = auth.uid();
  if em is null then return null; end if;
  insert into core.people (full_name, work_email, auth_id)
  values (coalesce(nullif(_name,''), split_part(em,'@',1)), lower(em)::citext, auth.uid())
  returning id into pid;
  insert into core.grants (person_id, tool, level)
  values (pid,'core','admin'), (pid,'sales','admin');
  insert into sales.people_detail (person_id, role) values (pid, 'admin');
  return pid;
end $$;
revoke all on function sales.bootstrap_first_admin(text) from public;
grant execute on function sales.bootstrap_first_admin(text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- ⚠  STAGE 5 PRECONDITION
-- This schema is unreachable from the Sales app until it stops authenticating
-- against its own sales:users rows and moves to Supabase Auth — everything
-- here is gated on core.me(), which resolves through auth.uid().
--
-- Until that lands, do NOT add `hr` or `finance` to Supabase → Exposed schemas:
-- the Sales app still ships the anon key to every visitor of its URL.
-- ═══════════════════════════════════════════════════════════════════════════
