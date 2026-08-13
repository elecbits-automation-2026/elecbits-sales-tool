-- ═══════════════════════════════════════════════════════════════════════════
-- RUN-THIS — the whole Phase 0 cut-over for eb-core-database-1, one paste.
--
-- Six files concatenated, in dependency order. Every part is idempotent:
-- anything the PMS session already applied is skipped, nothing existing in
-- core / pms is altered. The SQL editor runs this as ONE transaction — if
-- any statement fails, everything rolls back and the database is untouched.
--
--   Part 1  sanction-gate.sql        (PMS repo)  core.tools, sanction gate, ulm schema
--   Part 2  schemas/01-core.sql      (PMS repo)  contacts/documents/events/numbering
--   Part 3  schemas/02-sales.sql     (PMS repo)  leads/quotes/requests + core.intake
--   Part 4  schemas/03-ulm.sql       (PMS repo)  ULM's side of the request contract
--   Part 5  10-sales-port.sql        (this repo) the Sales OS tables + auth + roster RPCs
--   Part 6  11-migrate-blobs.sql     (this repo) sales:* blobs → relational; ends
--                                                with the row-count report — send it back
--
-- AFTER this runs: Settings → API → Exposed schemas → add  core, sales
--                  Authentication → Providers → Email → 'Confirm email' OFF
-- Only then merge the app branch to main.
-- ═══════════════════════════════════════════════════════════════════════════


-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  PART: sanction-gate.sql                                              ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════════
-- THE SANCTION GATE — one project spine, six tools, ULM holds the switch.
--
-- The model this implements:
--
--   Sales raises a project  →  ULM reviews it  →  ULM SANCTIONS it and routes
--   it to exactly one delivery tool (ODM / Box Build / Product).  Only after
--   that does the project appear anywhere else.  ULM can UN-SANCTION at any
--   time and it disappears from the delivery tools again — without being
--   deleted, and without losing a day of its history.
--
-- Two rules make this safe to run against the live app:
--
--   1. NOTHING IS RENAMED, NOTHING IS DROPPED, NOTHING BECOMES REQUIRED.
--      Every change is an added column, an added table, or an added view.
--      `core.projects` keeps every column it has, including the old
--      `sanctioned` boolean the ODM app derives from status. The mirror in
--      src/lib/tableSync.js keeps writing exactly the same columns it writes
--      today and keeps succeeding.
--
--   2. THE ODM APP IS NOT ASKED TO CHANGE. It writes `core.projects`; the
--      new tools read `core.projects`, which is a VIEW over that same physical
--      table. There is no second copy of a project and nothing to keep in
--      sync. Truth has one home.
--
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══ 1. THE SPINE — additive columns on core.projects ════════════════════
-- These are the four facts the company needs about a project that the ODM app
-- alone never had to know: is it sanctioned, who decided that, which delivery
-- tool owns it, and what did it come out of.

alter table core.projects
  -- ULM's decision. This is a STATE, not a derivation. The ODM app's
  -- `sanctioned` boolean stays where it is and keeps meaning what it always
  -- meant to that app ("status is past Planning"); it is no longer what the
  -- rest of the company reads.
  add column if not exists sanction_state    text not null default 'draft',

  -- Which delivery tool owns it once sanctioned.
  add column if not exists kind              text,          -- odm | boxbuild | product

  -- The decision trail, denormalised onto the row so every tool can show
  -- "sanctioned by X on Y" without joining into ULM's schema.
  add column if not exists sanctioned_at     timestamptz,
  add column if not exists sanctioned_by     uuid,
  add column if not exists unsanctioned_at   timestamptz,
  add column if not exists sanction_reason   text,

  -- Lineage: an ODM sample run becomes a Box Build order becomes a Product.
  -- Same customer, same hardware, three projects, one thread.
  add column if not exists parent_id         uuid,

  -- Who raised it, and who owns it commercially. Nullable — nothing enforces
  -- these until the Sales and ULM tools exist to fill them.
  add column if not exists requested_by      uuid,
  add column if not exists requested_at      timestamptz,
  add column if not exists org_id            uuid;

-- The allowed states. Added as NOT VALID first so the constraint applies to
-- new and updated rows immediately without a full-table verification pass
-- against data written before this ran.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'projects_sanction_state_ck') then
    alter table core.projects
      add constraint projects_sanction_state_ck
      check (sanction_state in ('draft','requested','sanctioned','unsanctioned','on_hold','closed'))
      not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_kind_ck') then
    alter table core.projects
      add constraint projects_kind_ck
      check (kind is null or kind in ('odm','boxbuild','product'))
      not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'projects_parent_fk') then
    alter table core.projects
      add constraint projects_parent_fk foreign key (parent_id)
      references core.projects(id) on delete set null not valid;
  end if;
end $$;

-- THE gate every other tool reads. Generated, so it can never disagree with
-- the state, and can never be written by accident — not by the ODM mirror,
-- not by a new tool, not by hand.
alter table core.projects
  add column if not exists is_sanctioned boolean
  generated always as (sanction_state = 'sanctioned') stored;

create index if not exists projects_gate_idx   on core.projects (is_sanctioned, kind);
create index if not exists projects_state_idx  on core.projects (sanction_state);
create index if not exists projects_parent_idx on core.projects (parent_id);

comment on column core.projects.sanctioned is
  'LEGACY / ODM-app only: derived from status <> ''Planning'' by src/lib/tableSync.js. '
  'Do NOT read this outside the ODM app — read is_sanctioned, which reflects ULM''s decision.';
comment on column core.projects.sanction_state is
  'ULM-owned lifecycle: draft → requested → sanctioned ⇄ unsanctioned/on_hold → closed. '
  'Written only through ulm.decide(); never by a delivery tool.';
comment on column core.projects.is_sanctioned is
  'The gate. True only while ULM has the project sanctioned. Generated — never written.';

-- ── Anything born in a delivery tool lands in ULM's inbox ──────────────────
-- The ODM app's mirror inserts project rows without knowing sanction exists.
-- Rather than have those rows sit in 'draft' where nobody looks, stamp them as
-- 'requested' ODM work on the way in. ULM then sanctions or rejects them. A
-- row that arrives with a state already set (i.e. from the ULM tool) is left
-- exactly as it is.
create or replace function public.projects_default_intake() returns trigger
language plpgsql as $$
begin
  if new.sanction_state = 'draft' then
    new.sanction_state := 'requested';
    new.kind           := coalesce(new.kind, 'odm');
    new.requested_at   := coalesce(new.requested_at, now());
  end if;
  return new;
end $$;

drop trigger if exists projects_intake on core.projects;
create trigger projects_intake before insert on core.projects
  for each row execute function public.projects_default_intake();


-- ═══ 2. BACKFILL — the 12 live projects are already real work ══════════════
-- Everything currently in the tool came in through the ODM route and is being
-- delivered today, so it is sanctioned ODM work. Anything still sitting in
-- Planning is treated as raised-but-not-yet-decided, which is exactly what
-- Planning has always meant here.

update core.projects
set kind = coalesce(kind, 'odm')
where kind is null;

update core.projects
set sanction_state = case
      when coalesce(status,'Planning') = 'Planning' then 'requested'
      when status in ('Completed','Delivered','Closed')  then 'closed'
      else 'sanctioned'
    end,
    sanctioned_at = case
      when coalesce(status,'Planning') <> 'Planning' then coalesce(sanctioned_at, created_at)
      else sanctioned_at
    end
where sanction_state = 'draft';


-- ═══ 3. core — the shared façade every tool points at ══════════════════════
-- `core` owns nothing physical for projects. It is the agreed shape of a
-- project, so that when the ODM app's storage eventually changes, five other
-- tools do not have to.

create schema if not exists core;

-- The six tools, as data rather than as if/else in six codebases.
create table if not exists core.tools (
  key         text primary key,          -- 'pms_odm', 'hr', …
  name        text not null,
  sees_kinds  text[]  not null default '{}',   -- {} = every kind
  sees_states text[]  not null default '{sanctioned}',
  sort_order  int     not null default 100
);

insert into core.tools (key, name, sees_kinds, sees_states, sort_order) values
  ('ulm',        'ULM · project acceptance, allocation & architecture', '{}',
     '{draft,requested,sanctioned,unsanctioned,on_hold,closed}', 10),
  ('pms_odm',    'PMS ODM',        '{odm}',      '{sanctioned}', 20),
  ('pms_bb',     'PMS Box Build',  '{boxbuild}', '{sanctioned}', 30),
  ('pms_product','PMS Product',    '{product}',  '{sanctioned}', 40),
  -- HR gets NO project feed. Its subject is the person, not the project; it
  -- reaches projects only through core.staffing (who is booked on what).
  ('hr',         'HR',             '{}',         '{}', 50),
  -- Finance does have a direct relation: money attaches to a project. A PO, an
  -- invoice and a cost line each name one, and none of them may exist before
  -- the project is sanctioned. Closed projects stay visible — the last invoice
  -- always lands after delivery.
  ('finance',    'Finance',        '{}',         '{sanctioned,on_hold,closed}', 60)
on conflict (key) do update
  set name = excluded.name, sees_kinds = excluded.sees_kinds,
      sees_states = excluded.sees_states, sort_order = excluded.sort_order;

-- core.projects IS the physical table now (00-one-structure.sql moved it out of
-- `public`), so there is no view to define — the façade and the storage are
-- the same object. That is the end state this design was always aiming at:
-- one project, one row, one name, and nobody keeping two copies in step.

-- core.people is likewise the roster table itself, not a view over it.

-- WHO IS ON WHAT — the only relation HR actually has to a project.
-- HR's subject is the person: payroll, leave, appraisal, headcount. It does
-- not need a project list, and giving it one would be a permission handed out
-- for no reason. What it does need is effort: which people are booked on live
-- work, in which slot, for how long. That is this view, and nothing more.
--
-- The join runs through app_id because the ODM app's team rows carry its own
-- short project id, not a uuid (see teamRows in src/lib/tableSync.js).
create or replace view core.staffing
with (security_invoker = true) as
select
  ta.id            as assignment_id,
  p.id             as project_id,
  p.project_id     as project_code,
  p.name           as project_name,
  p.kind,
  p.sanction_state,
  p.is_sanctioned  as project_live,
  p.start_date,
  p.deadline,
  ta.slot,
  pr.id            as person_id,
  pr.name          as person_name,
  pr.dept,
  pr.title
from core.assignments ta
join core.projects  p  on p.app_id = ta.project_app_id
left join core.people pr on pr.id = ta.user_id;

comment on view core.staffing is
  'People × projects. HR reads this instead of a project list; the PMS tools '
  'use it for load; Finance uses it to cost a project by effort.';

-- "What can this tool see?" — one function, six answers, zero duplicated
-- filter logic. A tool calls core.visible('pms_bb') and gets its project list.
create or replace function core.visible(tool_key text)
returns setof core.projects
language sql stable security invoker as $$
  select p.* from core.projects p, core.tools t
  where t.key = tool_key
    and p.sanction_state = any (t.sees_states)
    and (cardinality(t.sees_kinds) = 0 or p.kind = any (t.sees_kinds));
$$;

comment on function core.visible(text) is
  'The routing rule, in one place. Sanctioned + matching kind for the three PMS '
  'tools; sanctioned regardless of kind for Finance; everything for ULM; nothing '
  'for HR, which reads core.staffing instead.';


-- ═══ 4. ulm — the ULM tool's own schema ════════════════════════════════════
-- ULM is the only writer of sanction state. The decision LEDGER lives here and
-- is append-only; the state on the project row is a projection of it kept by a
-- trigger, so "current state" is fast and "how did it get here" is complete.

create schema if not exists ulm;

create table if not exists ulm.sanction_events (
  id          uuid primary key default gen_random_uuid(),
  -- ON DELETE SET NULL, not CASCADE, and the project's code kept alongside:
  -- if a project is ever deleted in a delivery tool, the delete still succeeds
  -- (so the ODM app's sync is never rejected) and the decision history
  -- survives it. An audit trail that a project manager can erase is not one.
  project_id  uuid references core.projects(id) on delete set null,
  project_code text,
  action      text not null check (action in
                ('request','sanction','unsanction','hold','resume','route','close','reopen')),
  from_state  text,
  to_state    text not null,
  kind        text,                       -- set/changed by a 'route' or 'sanction'
  reason      text,
  decided_by  uuid,
  decided_at  timestamptz not null default now()
);
create index if not exists sanction_events_project_idx on ulm.sanction_events (project_id, decided_at desc);

comment on table ulm.sanction_events is
  'Append-only. Never UPDATE or DELETE a row here — an un-sanction is a new '
  'event, not an edit of the sanction. This is the audit trail Finance will ask for.';

-- Where a sanctioned project was sent, and to whom.
create table if not exists ulm.allocations (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references core.projects(id) on delete cascade,
  tool_key    text not null references core.tools(key),
  owner_id    uuid,                       -- the PM who takes delivery
  allocated_by uuid,
  allocated_at timestamptz not null default now(),
  released_at  timestamptz,               -- set instead of deleting, on un-sanction
  note         text
);
create unique index if not exists allocations_live_idx
  on ulm.allocations (project_id) where released_at is null;

-- The architecture pass: how a sanctioned project breaks into work.
create table if not exists ulm.work_packages (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references core.projects(id) on delete cascade,
  seq         int  not null default 0,
  title       text not null,
  discipline  text,                       -- hardware | firmware | mechanical | test | …
  tool_key    text references core.tools(key),
  est_days    numeric,
  owner_id    uuid,
  status      text not null default 'planned',
  created_at  timestamptz not null default now()
);
create index if not exists work_packages_project_idx on ulm.work_packages (project_id, seq);

-- ── The one door in and out of sanction ────────────────────────────────────
-- Everything writes state through here, so the ledger can never disagree with
-- the row. Delivery tools do not call this; only the ULM tool does.
create or replace function ulm.decide(
  p_project uuid,
  p_action  text,
  p_kind    text default null,
  p_reason  text default null,
  p_by      uuid default null
) returns core.projects
language plpgsql security definer set search_path = public, ulm, core as $$
declare
  cur  core.projects;
  nxt  text;
begin
  -- Lets the guard trigger below know this write is the sanctioned route in.
  perform set_config('ulm.deciding', '1', true);

  select * into cur from core.projects where id = p_project for update;
  if not found then raise exception 'no such project: %', p_project; end if;

  nxt := case p_action
           when 'request'    then 'requested'
           when 'sanction'   then 'sanctioned'
           when 'unsanction' then 'unsanctioned'
           when 'hold'       then 'on_hold'
           when 'resume'     then 'sanctioned'
           when 'route'      then cur.sanction_state      -- re-route, state unchanged
           when 'close'      then 'closed'
           when 'reopen'     then 'sanctioned'
           else null end;
  if nxt is null then raise exception 'unknown action: %', p_action; end if;

  -- A project cannot be sanctioned into thin air; it has to be routed to a
  -- delivery tool at the moment it is sanctioned.
  if nxt = 'sanctioned' and coalesce(p_kind, cur.kind) is null then
    raise exception 'sanctioning % requires a kind (odm | boxbuild | product)', cur.project_id;
  end if;

  insert into ulm.sanction_events
    (project_id, project_code, action, from_state, to_state, kind, reason, decided_by)
  values (p_project, cur.project_id, p_action, cur.sanction_state, nxt,
          coalesce(p_kind, cur.kind), p_reason, p_by);

  update core.projects set
    sanction_state  = nxt,
    kind            = coalesce(p_kind, kind),
    sanction_reason = coalesce(p_reason, sanction_reason),
    sanctioned_at   = case when nxt = 'sanctioned' then coalesce(sanctioned_at, now()) else sanctioned_at end,
    sanctioned_by   = case when nxt = 'sanctioned' then coalesce(p_by, sanctioned_by)  else sanctioned_by end,
    unsanctioned_at = case when nxt in ('unsanctioned','on_hold') then now() else unsanctioned_at end
  where id = p_project
  returning * into cur;

  -- Allocation follows the decision: sanctioning claims the project for a
  -- tool, un-sanctioning releases it (the row stays, for the history).
  if nxt = 'sanctioned' then
    insert into ulm.allocations (project_id, tool_key, allocated_by)
    select p_project,
           case cur.kind when 'odm' then 'pms_odm' when 'boxbuild' then 'pms_bb' else 'pms_product' end,
           p_by
    where not exists (
      select 1 from ulm.allocations a where a.project_id = p_project and a.released_at is null);
  elsif nxt in ('unsanctioned','closed') then
    update ulm.allocations set released_at = now()
    where project_id = p_project and released_at is null;
  end if;

  return cur;
end $$;

comment on function ulm.decide is
  'The only writer of sanction_state. Records the event, moves the row, and '
  'claims or releases the delivery-tool allocation in one transaction.';

-- ── Make "only ULM decides" true, not just intended ────────────────────────
-- Without this, any tool with an UPDATE grant on core.projects could quietly
-- sanction itself a project and leave no trace in the ledger. This refuses the
-- write unless it came through ulm.decide(). The ODM app never touches
-- sanction_state, so it never meets this trigger.
--
-- For a deliberate manual correction in the SQL editor:
--     set local ulm.override = '1';   -- then your UPDATE, in the same txn
create or replace function public.guard_sanction_state() returns trigger
language plpgsql as $$
begin
  if new.sanction_state is distinct from old.sanction_state
     and coalesce(current_setting('ulm.deciding', true), '') <> '1'
     and coalesce(current_setting('ulm.override', true), '') <> '1'
  then
    raise exception
      'sanction_state is ULM-owned: change it with ulm.decide(project, action), not a direct UPDATE'
      using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists projects_guard_sanction on core.projects;
create trigger projects_guard_sanction before update on core.projects
  for each row execute function public.guard_sanction_state();

-- Backfill the ledger so the 12 live projects have an origin story rather than
-- appearing to have been sanctioned by nobody.
insert into ulm.sanction_events (project_id, project_code, action, from_state, to_state, kind, reason, decided_at)
select p.id, p.project_id, 'sanction', 'requested', 'sanctioned', p.kind,
       'backfilled at sanction-gate rollout', coalesce(p.sanctioned_at, p.created_at)
from core.projects p
where p.sanction_state = 'sanctioned'
  and not exists (select 1 from ulm.sanction_events e where e.project_id = p.id);

insert into ulm.allocations (project_id, tool_key, allocated_at)
select p.id,
       case p.kind when 'odm' then 'pms_odm' when 'boxbuild' then 'pms_bb' else 'pms_product' end,
       coalesce(p.sanctioned_at, p.created_at)
from core.projects p
where p.sanction_state = 'sanctioned'
  and not exists (select 1 from ulm.allocations a where a.project_id = p.id and a.released_at is null);


-- ═══ 5. WHO MAY TOUCH WHAT ═════════════════════════════════════════════════
-- The ODM app ships the anon key in the browser, so nothing here is opened to
-- anon. `core` is readable by a signed-in user; `ulm` is writable only through
-- ulm.decide(), which is SECURITY DEFINER and checks nothing else — so it must
-- stay off the anon role until the ULM tool exists with its own gate.

alter table ulm.sanction_events enable row level security;
alter table ulm.allocations     enable row level security;
alter table ulm.work_packages   enable row level security;
alter table core.tools          enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='core' and tablename='tools' and policyname='tools_read') then
    create policy tools_read on core.tools for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='ulm' and tablename='sanction_events' and policyname='events_read') then
    create policy events_read on ulm.sanction_events for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='ulm' and tablename='allocations' and policyname='alloc_read') then
    create policy alloc_read on ulm.allocations for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='ulm' and tablename='work_packages' and policyname='wp_read') then
    create policy wp_read on ulm.work_packages for select to authenticated using (true);
  end if;
end $$;

grant usage on schema core to authenticated;
grant select on core.tools, core.projects, core.people, core.staffing to authenticated;
grant execute on function core.visible(text) to authenticated;

grant usage on schema ulm to authenticated;
grant select on ulm.sanction_events, ulm.allocations, ulm.work_packages to authenticated;
-- Deliberately NOT granted yet: execute on ulm.decide(). Grant it to the ULM
-- tool's role when that tool ships, not to every signed-in browser:
--   grant execute on function ulm.decide(uuid,text,text,text,uuid) to authenticated;
revoke execute on function ulm.decide(uuid,text,text,text,uuid) from public;

-- NOTE: do NOT add `core` or `ulm` to Settings → API → Exposed schemas until a
-- tool actually needs them over PostgREST. Until then they are reachable only
-- from SQL and from Edge Functions using the service-role key.


-- ═══ 6. WHAT YOU NOW HAVE ══════════════════════════════════════════════════
select t.name as tool, count(v.id) as projects_visible
from core.tools t
left join lateral core.visible(t.key) v on true
group by t.sort_order, t.name
order by t.sort_order;

select project_id, name, kind, sanction_state, is_sanctioned, sanctioned_at::date
from core.projects
order by sanction_state, project_id;

-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  PART: 01-core.sql                                                    ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════════
-- core — the shared spine. Everything every tool agrees on.
--
-- Run order:  sanction-gate.sql  →  01-core.sql  →  02..08 in any order.
--
-- sanction-gate.sql already created core.tools, core.projects, core.people,
-- core.staffing and core.visible(). This adds the rest of the shared spine:
-- the organisations, the contacts, the documents, the cross-tool event log
-- and the document numbering.
--
-- THE RULE THIS SCHEMA EXISTS TO ENFORCE:
--   Every tool may read `core`. NO tool ever reads another tool's schema.
--   When Box Build needs to tell Finance something, it writes core.events —
--   it does not reach into fin.
--
-- Nothing here touches the running ODM app. `core.orgs` is a view over
-- core.orgs, which the app already writes, so customers have one home.
--
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create schema if not exists core;
create extension if not exists pgcrypto;


-- ═══ 0. THE OTHER TWO TOOLS ════════════════════════════════════════════════
-- sanction-gate.sql registered the six tools that consume sanctioned
-- projects. Sales and Management are tools too — they just sit either side of
-- that list. They need to be here because core.tools is also the registry
-- every tool_key column in this design points at, and because core.events
-- refuses an event from a tool it has never heard of.

insert into core.tools (key, name, sees_kinds, sees_states, sort_order) values
  -- Sales sits BEFORE the gate. It sees sanctioned projects because a
  -- salesperson on a customer call needs to know where the work has got to —
  -- but it reads status through core.delivery_status, never a PMS tool.
  ('sales', 'Sales', '{}', '{sanctioned,on_hold,closed}', 5),
  -- Management sits above it and sees everything, including what was rejected.
  ('mgmt',  'Management', '{}',
     '{draft,requested,sanctioned,unsanctioned,on_hold,closed}', 70)
on conflict (key) do update
  set name = excluded.name, sees_kinds = excluded.sees_kinds,
      sees_states = excluded.sees_states, sort_order = excluded.sort_order;


-- ═══ 1. ORGANISATIONS — customers, vendors, partners ═══════════════════════
-- core.orgs is the roster of customers the ODM app has always written (it was
-- public.clients until 00-one-structure.sql moved it). These columns are what
-- the rest of the company needs and the app never had; all nullable, so the
-- app's writes keep working untouched.

alter table core.orgs
  add column if not exists kind        text,        -- customer | vendor | partner | internal
  add column if not exists gstin       text,
  add column if not exists pan         text,
  add column if not exists website     text,
  add column if not exists address     jsonb not null default '{}'::jsonb,
  add column if not exists payment_terms_days int,
  add column if not exists credit_limit numeric(14,2),
  add column if not exists owner_id    uuid,        -- the account manager
  add column if not exists active      boolean not null default true,
  add column if not exists notes       text;

update core.orgs set kind = 'customer' where kind is null;

create index if not exists clients_kind_idx on core.orgs (kind) where active;

comment on table core.orgs is
  'Every company we deal with — customer, vendor, partner. One list, shared by
   Sales, the three PMS tools and Finance. `client_id` is the human-readable
   code the ODM app has always used.';

-- A named human at an organisation. The ODM app keeps a `contact` blob on the
-- project; this is the company-wide address book that Sales and Finance need.
create table if not exists core.contacts (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid references core.orgs(id) on delete cascade,
  name       text not null,
  role       text,
  email      text,
  phone      text,
  is_primary boolean not null default false,
  notes      text,
  created_at timestamptz not null default now()
);
create index if not exists contacts_org_idx on core.contacts (org_id);
create unique index if not exists contacts_primary_idx
  on core.contacts (org_id) where is_primary;


-- ═══ 2. DOCUMENTS — one place that knows where a file lives ════════════════
-- Drive is the store; this is the index. A quote, an LLD, a BOM, a PO, an
-- invoice and a test report all land here, so any tool can find a project's
-- paperwork without knowing which tool produced it.

create table if not exists core.documents (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid references core.projects(id) on delete set null,
  project_code text,
  org_id       uuid references core.orgs(id) on delete set null,
  tool_key     text references core.tools(key),      -- who produced it
  kind         text not null,                        -- lld | bom | quote | po | invoice | report | …
  title        text not null,
  drive_id     text,                                 -- Google Drive file id
  url          text,
  mime         text,
  size_bytes   bigint,
  version      int not null default 1,
  supersedes   uuid references core.documents(id) on delete set null,
  owner_email  text,                                 -- whose Drive it sits in
  uploaded_by  uuid,
  uploaded_at  timestamptz not null default now()
);
create index if not exists documents_project_idx on core.documents (project_id, kind);
create index if not exists documents_drive_idx   on core.documents (drive_id);

comment on table core.documents is
  'The file index, not the files. owner_email records whose Drive actually '
  'holds it, which is what per-person upload attribution produces.';


-- ═══ 3. EVENTS — how tools talk without touching each other ════════════════
-- Box Build finishing a batch is Finance's cue to invoice and HR's cue to
-- free the team. Instead of Box Build writing into fin and hr — which would
-- break the one rule this design has — it writes an event, and whoever cares
-- reads it.

create table if not exists core.events (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  tool_key    text references core.tools(key),
  entity      text not null,          -- 'project' | 'order' | 'invoice' | …
  entity_id   uuid,
  project_id  uuid references core.projects(id) on delete set null,
  verb        text not null,          -- 'created' | 'sanctioned' | 'shipped' | …
  actor_id    uuid,
  payload     jsonb not null default '{}'::jsonb
);
create index if not exists events_project_idx on core.events (project_id, at desc);
create index if not exists events_feed_idx    on core.events (at desc);
create index if not exists events_entity_idx  on core.events (entity, entity_id);

create or replace function core.emit(
  p_tool text, p_entity text, p_entity_id uuid, p_verb text,
  p_project uuid default null, p_actor uuid default null, p_payload jsonb default '{}'::jsonb
) returns bigint
language sql security definer set search_path = core, public as $$
  insert into core.events (tool_key, entity, entity_id, verb, project_id, actor_id, payload)
  values (p_tool, p_entity, p_entity_id, p_verb, p_project, p_actor, p_payload)
  returning id;
$$;

comment on function core.emit is
  'The only sanctioned way for one tool to inform another. Append-only.';


-- ═══ 4. NUMBERING — EB-…, PO-…, INV-… without two people colliding ═════════

create table if not exists core.numbering (
  kind       text primary key,        -- 'project' | 'po' | 'invoice' | 'quote' | …
  prefix     text not null,
  width      int  not null default 4,
  per_year   boolean not null default true,
  last_year  int,
  last_value int  not null default 0
);

insert into core.numbering (kind, prefix, width, per_year) values
  ('project', 'Eb-',  4, false),
  ('quote',   'QT-',  4, true),
  ('po',      'PO-',  4, true),
  ('invoice', 'INV-', 4, true),
  ('grn',     'GRN-', 4, true),
  ('dc',      'DC-',  4, true)
on conflict (kind) do nothing;

create or replace function core.next_number(p_kind text)
returns text
language plpgsql security definer set search_path = core, public as $$
declare n core.numbering; yr int := extract(year from now())::int;
begin
  select * into n from core.numbering where kind = p_kind for update;
  if not found then raise exception 'no numbering series for %', p_kind; end if;

  if n.per_year and coalesce(n.last_year, 0) <> yr then
    update core.numbering set last_year = yr, last_value = 1 where kind = p_kind
      returning * into n;
  else
    update core.numbering set last_value = last_value + 1 where kind = p_kind
      returning * into n;
  end if;

  return n.prefix
       || case when n.per_year then yr::text || '-' else '' end
       || lpad(n.last_value::text, n.width, '0');
end $$;

comment on function core.next_number is
  'SELECT ... FOR UPDATE, so two people clicking at once cannot get INV-0007 twice.';


-- ═══ 5. PERMISSIONS ════════════════════════════════════════════════════════
-- Read for anyone signed in; writes belong to the tool that owns the row, so
-- they are granted per tool as each one ships. Nothing is opened to anon —
-- the ODM app ships the anon key in the browser.

alter table core.contacts  enable row level security;
alter table core.documents enable row level security;
alter table core.events    enable row level security;
alter table core.numbering enable row level security;

do $$
declare t text;
begin
  foreach t in array array['contacts','documents','events','numbering'] loop
    if not exists (select 1 from pg_policies
                   where schemaname='core' and tablename=t and policyname=t||'_read') then
      execute format('create policy %I on core.%I for select to authenticated using (true)', t||'_read', t);
    end if;
  end loop;
end $$;

grant usage on schema core to authenticated;
grant select on all tables in schema core to authenticated;
grant execute on function core.next_number(text) to authenticated;
revoke execute on function core.emit(text,text,uuid,text,uuid,uuid,jsonb) from public;

-- Reminder: do NOT add `core` to Settings → API → Exposed schemas until a tool
-- genuinely needs it over PostgREST.

-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  PART: 02-sales.sql                                                   ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════════
-- sales — everything before there is a project.
--
-- Sales owns the lead, the quote and the ask. It does NOT create projects.
-- The last thing it does is raise a REQUEST, which lands in ULM's inbox; ULM
-- decides. That is the whole reason the sanction gate exists, so this schema
-- has no write path into core.projects at all.
--
-- Requires: 01-core.sql
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create schema if not exists sales;


-- ═══ LEADS ═════════════════════════════════════════════════════════════════
create table if not exists sales.leads (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid references core.orgs(id) on delete set null,
  org_name      text,                       -- before the org exists in core
  contact_id    uuid references core.contacts(id) on delete set null,
  title         text not null,
  source        text,                       -- referral | inbound | outbound | expo | repeat
  stage         text not null default 'new'
                  check (stage in ('new','qualifying','quoted','negotiating','won','lost','parked')),
  expected_kind text check (expected_kind is null or expected_kind in ('odm','boxbuild','product')),
  value_inr     numeric(14,2),
  probability   int check (probability is null or probability between 0 and 100),
  expected_close date,
  owner_id      uuid,                       -- the salesperson
  lost_reason   text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists leads_stage_idx on sales.leads (stage, expected_close);
create index if not exists leads_org_idx   on sales.leads (org_id);

create table if not exists sales.activities (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid references sales.leads(id) on delete cascade,
  at         timestamptz not null default now(),
  kind       text not null,                 -- call | email | meeting | demo | site_visit
  summary    text not null,
  next_step  text,
  next_on    date,
  by_id      uuid
);
create index if not exists activities_lead_idx on sales.activities (lead_id, at desc);


-- ═══ QUOTES ════════════════════════════════════════════════════════════════
create table if not exists sales.quotes (
  id          uuid primary key default gen_random_uuid(),
  quote_no    text unique,                  -- core.next_number('quote')
  lead_id     uuid references sales.leads(id) on delete set null,
  org_id      uuid references core.orgs(id) on delete set null,
  title       text not null,
  kind        text check (kind is null or kind in ('odm','boxbuild','product')),
  qty         int,
  currency    text not null default 'INR',
  subtotal    numeric(14,2) not null default 0,
  tax_pct     numeric(5,2)  not null default 18,
  total       numeric(14,2) not null default 0,
  valid_until date,
  status      text not null default 'draft'
                check (status in ('draft','sent','accepted','rejected','expired','superseded')),
  version     int not null default 1,
  supersedes  uuid references sales.quotes(id) on delete set null,
  document_id uuid references core.documents(id) on delete set null,
  sent_at     timestamptz,
  decided_at  timestamptz,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists quotes_lead_idx on sales.quotes (lead_id);
create index if not exists quotes_status_idx on sales.quotes (status);

create table if not exists sales.quote_lines (
  id         uuid primary key default gen_random_uuid(),
  quote_id   uuid not null references sales.quotes(id) on delete cascade,
  seq        int  not null default 0,
  item       text not null,
  detail     text,
  qty        numeric(12,3) not null default 1,
  uom        text not null default 'nos',
  rate       numeric(14,2) not null default 0,
  amount     numeric(14,2) generated always as (round(qty * rate, 2)) stored
);
create index if not exists quote_lines_quote_idx on sales.quote_lines (quote_id, seq);


-- ═══ THE HANDOFF — the only thing Sales sends onward ═══════════════════════
-- A request is an ASK, not a project. It carries what ULM needs to decide:
-- what the customer wants, by when, at what price, and on what evidence.
-- ULM turns an accepted request into a project; sales never does.

create table if not exists sales.requests (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid references sales.leads(id) on delete set null,
  quote_id      uuid references sales.quotes(id) on delete set null,
  org_id        uuid references core.orgs(id) on delete set null,
  title         text not null,
  summary       text,
  proposed_kind text check (proposed_kind is null or proposed_kind in ('odm','boxbuild','product')),
  qty           int,
  target_date   date,
  value_inr     numeric(14,2),
  po_ref        text,                        -- customer PO, if it already exists
  urgency       text not null default 'normal' check (urgency in ('low','normal','high')),
  status        text not null default 'submitted'
                  check (status in ('draft','submitted','accepted','rejected','withdrawn')),
  -- Filled in by ULM when it accepts: the project this became.
  project_id    uuid references core.projects(id) on delete set null,
  decided_at    timestamptz,
  decided_by    uuid,
  decision_note text,
  submitted_by  uuid,
  submitted_at  timestamptz not null default now()
);
create index if not exists requests_status_idx on sales.requests (status, submitted_at desc);

comment on table sales.requests is
  'Sales'' outbox and ULM''s inbox. The only bridge between the two tools; '
  'sales has no write path into core.projects.';


-- ── How ULM sees it, without reading sales' tables ────────────────────────
-- Sales publishes a view into `core`. ULM reads `core.intake`; it never
-- selects from sales.*. When a decision is made it calls the function below —
-- a contract sales owns — rather than updating sales' table itself.
--
-- This is the pattern for every tool-to-tool link in this design: a core view
-- outward, a function inward, and nothing else.

create or replace view core.intake
with (security_invoker = true) as
select r.id, r.title, r.summary, r.proposed_kind, r.qty, r.target_date,
       r.value_inr, r.po_ref, r.urgency, r.status, r.project_id,
       r.org_id, o.name as org_name,
       r.submitted_by, r.submitted_at, r.decided_at, r.decided_by, r.decision_note
from sales.requests r
left join core.orgs o on o.id = r.org_id;

comment on view core.intake is
  'ULM''s inbox. The only part of the Sales tool anything else can see.';

create or replace function sales.settle_request(
  p_request uuid, p_status text, p_project uuid default null,
  p_note text default null, p_by uuid default null
) returns sales.requests
language plpgsql security definer set search_path = sales, core, public as $$
declare r sales.requests;
begin
  if p_status not in ('accepted','rejected','withdrawn') then
    raise exception 'settle_request: status must be accepted, rejected or withdrawn (got %)', p_status;
  end if;
  update sales.requests set
    status = p_status, project_id = coalesce(p_project, project_id),
    decision_note = coalesce(p_note, decision_note),
    decided_by = coalesce(p_by, decided_by), decided_at = now()
  where id = p_request returning * into r;
  if not found then raise exception 'no such request: %', p_request; end if;

  -- Also move the lead, so the salesperson does not have to remember to.
  if r.lead_id is not null and p_status = 'accepted' then
    update sales.leads set stage = 'won' where id = r.lead_id and stage <> 'won';
  end if;

  perform core.emit('sales', 'request', p_request, p_status, r.project_id, p_by,
                    jsonb_build_object('note', p_note));
  return r;
end $$;

comment on function sales.settle_request is
  'The contract ULM calls to close a request. Sales owns the write; ULM owns '
  'the decision. Grant execute to the ULM tool''s role when it ships.';

revoke execute on function sales.settle_request(uuid,text,uuid,text,uuid) from public;


-- ═══ PERMISSIONS ═══════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['leads','activities','quotes','quote_lines','requests'] loop
    execute format('alter table sales.%I enable row level security', t);
    if not exists (select 1 from pg_policies
                   where schemaname='sales' and tablename=t and policyname=t||'_read') then
      execute format('create policy %I on sales.%I for select to authenticated using (true)', t||'_read', t);
    end if;
  end loop;
end $$;

drop trigger if exists leads_touch on sales.leads;
create trigger leads_touch before update on sales.leads
  for each row execute function public.touch_updated_at();

grant usage on schema sales to authenticated;
grant select on all tables in schema sales to authenticated;
-- Write grants belong to the Sales tool's own role, added when it ships.

-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  PART: 03-ulm.sql                                                     ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════════
-- ulm — project acceptance, allocation and architecture. The gate.
--
-- sanction-gate.sql already created the heart of this schema:
--     ulm.sanction_events   the append-only decision ledger
--     ulm.allocations       which tool a sanctioned project is claimed by
--     ulm.work_packages     the architecture breakdown
--     ulm.decide()          the only writer of sanction state
--
-- This adds what surrounds the decision: the review that justifies it, the
-- risks that qualify it, the capacity it assumes, and one function that turns
-- an accepted Sales request into a real, sanctioned, routed project.
--
-- Requires: sanction-gate.sql, 01-core.sql, 02-sales.sql
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

create schema if not exists ulm;


-- ═══ THE REVIEW — why the answer was yes or no ═════════════════════════════
-- Sanctioning is one row in the ledger. This is the working behind it, so
-- that six months later "why did we take this on at this price" has an answer.

create table if not exists ulm.reviews (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid,                        -- core.intake.id, when it came from Sales
  project_id    uuid references core.projects(id) on delete set null,
  project_code  text,
  proposed_kind text check (proposed_kind is null or proposed_kind in ('odm','boxbuild','product')),

  -- The four questions ULM actually asks.
  feasibility   int check (feasibility  is null or feasibility  between 1 and 5),
  capacity      int check (capacity     is null or capacity     between 1 and 5),
  commercial    int check (commercial   is null or commercial   between 1 and 5),
  strategic     int check (strategic    is null or strategic    between 1 and 5),
  notes         text,

  verdict       text not null default 'pending'
                  check (verdict in ('pending','accept','reject','more_info')),
  reviewed_by   uuid,
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists reviews_verdict_idx on ulm.reviews (verdict, created_at desc);
create index if not exists reviews_project_idx on ulm.reviews (project_id);

create table if not exists ulm.risks (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references core.projects(id) on delete set null,
  project_code text,
  title       text not null,
  detail      text,
  likelihood  int check (likelihood is null or likelihood between 1 and 5),
  impact      int check (impact     is null or impact     between 1 and 5),
  severity    int generated always as (coalesce(likelihood,0) * coalesce(impact,0)) stored,
  mitigation  text,
  owner_id    uuid,
  status      text not null default 'open' check (status in ('open','mitigated','accepted','closed')),
  raised_by   uuid,
  raised_at   timestamptz not null default now(),
  closed_at   timestamptz
);
create index if not exists risks_open_idx on ulm.risks (project_id, status, severity desc);


-- ═══ CAPACITY — what the sanction assumed, before delivery starts ══════════
-- The delivery tools record who actually worked. This records who ULM said
-- would be needed. The gap between the two is the only honest measure of
-- whether the estimate was any good.

create table if not exists ulm.resource_plan (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid references core.projects(id) on delete set null,
  project_code text,
  discipline  text not null,               -- hardware | firmware | mechanical | test | pm
  slot        text,                        -- 'Sr. Hardware Engineer', matching the roster
  person_id   uuid,                        -- if a named person was assumed
  from_date   date,
  to_date     date,
  fte         numeric(4,2) not null default 1.0 check (fte > 0 and fte <= 2),
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists resource_plan_project_idx on ulm.resource_plan (project_id);
create index if not exists resource_plan_window_idx  on ulm.resource_plan (from_date, to_date);

-- Planned effort against booked people, per project. This is the view the
-- ULM dashboard is built on.
create or replace view ulm.load
with (security_invoker = true) as
select p.id           as project_id,
       p.project_id   as project_code,
       p.name,
       p.kind,
       p.sanction_state,
       coalesce(sum(rp.fte), 0)                     as planned_fte,
       (select count(*) from core.staffing s where s.project_id = p.id) as people_booked
from core.projects p
left join ulm.resource_plan rp on rp.project_id = p.id
group by p.id, p.project_id, p.name, p.kind, p.sanction_state;


-- ═══ ACCEPT — one call turns a request into a sanctioned project ═══════════
-- This is the whole ULM workflow in a single transaction: create the project,
-- sanction it, route it to a delivery tool, close the Sales request and tell
-- everyone. Doing it in one place is what stops half-accepted projects — a
-- project row with no sanction, or a sanctioned project Sales still thinks is
-- pending — from existing at all.

create or replace function ulm.accept_request(
  p_request  uuid,
  p_kind     text,
  p_code     text default null,             -- project code; generated if omitted
  p_name     text default null,
  p_deadline date default null,
  p_by       uuid default null,
  p_note     text default null
) returns core.projects
language plpgsql security definer set search_path = ulm, core, sales, public as $$
declare
  req  core.intake;
  proj core.projects;
  code text;
begin
  select * into req from core.intake where id = p_request;
  if not found then raise exception 'no such request: %', p_request; end if;
  if req.project_id is not null then
    raise exception 'request % already became project %', p_request, req.project_id;
  end if;
  if p_kind not in ('odm','boxbuild','product') then
    raise exception 'kind must be odm, boxbuild or product (got %)', p_kind;
  end if;

  code := coalesce(nullif(trim(p_code), ''), core.next_number('project'));

  -- Born already decided: the intake trigger's 'requested' default is
  -- overridden here, because ULM is the thing that decides.
  insert into core.projects
    (project_id, name, client_id, client_name, status, deadline,
     sanction_state, kind, requested_by, requested_at, org_id)
  values
    (code, coalesce(nullif(trim(p_name), ''), req.title),
     (select client_id from core.orgs where id = req.org_id),
     req.org_name, 'Planning', coalesce(p_deadline, req.target_date),
     'requested', p_kind, req.submitted_by, req.submitted_at, req.org_id)
  returning * into proj;

  -- Sanction it through the one door, so the ledger and the row agree.
  proj := ulm.decide(proj.id, 'sanction', p_kind,
                     coalesce(p_note, 'accepted from request ' || p_request::text), p_by);

  -- Close the Sales side through sales' own contract, not by touching its table.
  perform sales.settle_request(p_request, 'accepted', proj.id, p_note, p_by);

  insert into ulm.reviews (request_id, project_id, project_code, proposed_kind,
                           verdict, reviewed_by, reviewed_at, notes)
  values (p_request, proj.id, proj.project_id, p_kind, 'accept', p_by, now(), p_note);

  perform core.emit('ulm', 'project', proj.id, 'sanctioned', proj.id, p_by,
                    jsonb_build_object('kind', p_kind, 'code', proj.project_id));
  return proj;
end $$;

comment on function ulm.accept_request is
  'Request → project → sanction → route → close the request, in one '
  'transaction. Either all of it happened or none of it did.';

revoke execute on function ulm.accept_request(uuid,text,text,text,date,uuid,text) from public;

-- ULM must be able to close a Sales request; that grant is the bridge.
-- Both are SECURITY DEFINER, so this is a contract, not table access.
grant execute on function sales.settle_request(uuid,text,uuid,text,uuid) to postgres;


-- ═══ PERMISSIONS ═══════════════════════════════════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['reviews','risks','resource_plan'] loop
    execute format('alter table ulm.%I enable row level security', t);
    if not exists (select 1 from pg_policies
                   where schemaname='ulm' and tablename=t and policyname=t||'_read') then
      execute format('create policy %I on ulm.%I for select to authenticated using (true)', t||'_read', t);
    end if;
  end loop;
end $$;

grant usage on schema ulm to authenticated;
grant select on all tables in schema ulm to authenticated;
-- Still NOT granted to authenticated: ulm.decide() and ulm.accept_request().
-- They go to the ULM tool's role when that tool ships with its own auth.

-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  PART: 10-sales-port.sql                                              ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

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

-- Their updated_at helper (defined in projects-into-a-real-table.sql; body
-- identical — this only guards against a database where that file never ran).
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

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
    'org_detail','deals','deal_moves','org_activities',
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

-- people_detail is the roster: everyone reads it, but rank changes only move
-- through sales.upsert_person (SECURITY DEFINER) or a sales admin — otherwise
-- any agent could hand themself 'admin' with one direct update.
alter table sales.people_detail enable row level security;
drop policy if exists people_detail_read on sales.people_detail;
create policy people_detail_read on sales.people_detail
  for select to authenticated using (true);
drop policy if exists people_detail_write on sales.people_detail;
create policy people_detail_write on sales.people_detail
  for all to authenticated
  using (sales.is_sales_admin()) with check (sales.is_sales_admin());

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

-- ╔═══════════════════════════════════════════════════════════════════════╗
-- ║  PART: 11-migrate-blobs.sql                                           ║
-- ╚═══════════════════════════════════════════════════════════════════════╝

-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATE — the Sales OS's eleven `sales:*` JSON blobs out of
-- public.collections into the relational core + sales schemas.
--
-- Run AFTER 10-sales-port.sql (which runs after the PMS repo's four files).
--
-- HOW PEOPLE AND ORGS ARE MATCHED (nothing existing is disturbed):
--   people  matched to core.people by lower(email); only when no row matches
--           is a new one inserted — core role 'engineer' (sales rank lives in
--           sales.people_detail, so a sales admin never gains PMS/HR admin
--           rights). Old passwords (pwHash) are dropped: login is Supabase
--           Auth now, and each person's first sign-in claims their row.
--   orgs    matched to core.orgs by lower(name); only when no row matches is
--           a new one inserted. The old EB-C-0001 pseudo-ids land in
--           sales.org_detail.legacy_cid — core.orgs.client_id stays reserved
--           for the official Eb-<industry>-<size>-<serial> IDs.
--
-- Deterministic ids — md5(old_id)::uuid — make every insert idempotent:
-- re-running updates or skips, it never duplicates.
--
-- public.collections is left untouched. It is the rollback.
-- ═══════════════════════════════════════════════════════════════════════════

create temp table if not exists person_map (old_id text primary key, person_id uuid);
create temp table if not exists org_map    (old_id text primary key, org_id uuid);

do $mig$
declare
  j_users     jsonb; j_companies jsonb; j_deals   jsonb; j_kpis    jsonb;
  j_trainings jsonb; j_worklogs  jsonb; j_know    jsonb; j_expenses jsonb;
  j_gates     jsonb; j_scrums    jsonb; j_memory  jsonb;
  u jsonb; c jsonb; d jsonb; h jsonb; a jsonb; t jsonb; w jsonb; k jsonb;
  e jsonb; s jsonb; m jsonb;
  kpi_key text; kpi_row jsonb; gate_key text;
  v_pid uuid; v_oid uuid; i int;
begin
  if to_regclass('public.collections') is null then
    raise notice 'public.collections not found — nothing to migrate.';
    return;
  end if;

  select data into j_users     from public.collections where key = 'sales:users';
  select data into j_companies from public.collections where key = 'sales:companies';
  select data into j_deals     from public.collections where key = 'sales:deals';
  select data into j_kpis      from public.collections where key = 'sales:kpis';
  select data into j_trainings from public.collections where key = 'sales:trainings';
  select data into j_worklogs  from public.collections where key = 'sales:worklogs';
  select data into j_know      from public.collections where key = 'sales:knowledge';
  select data into j_expenses  from public.collections where key = 'sales:expenses';
  select data into j_gates     from public.collections where key = 'sales:gates';
  select data into j_scrums    from public.collections where key = 'sales:scrums';
  select data into j_memory    from public.collections where key = 'sales:memory';

  -- ── 1. PEOPLE ─────────────────────────────────────────────────────────────
  for u in select * from jsonb_array_elements(coalesce(j_users, '[]'::jsonb)) loop
    v_pid := null;
    if coalesce(u->>'email','') <> '' then
      select id into v_pid from core.people
       where lower(email) = lower(u->>'email') limit 1;
    end if;
    if v_pid is null then
      v_pid := md5('sales:person:' || (u->>'id'))::uuid;
      insert into core.people (id, email, name, role, dept, color)
      values (v_pid, nullif(u->>'email',''), u->>'name', 'engineer',
              coalesce(u->>'dept','Sales'), '#2563eb')
      on conflict (id) do nothing;
    end if;
    insert into person_map values (u->>'id', v_pid) on conflict do nothing;

    insert into sales.people_detail (person_id, role, dept, active)
    values (v_pid,
            case when u->>'role' in ('admin','dept_head','agent','finance')
                 then u->>'role' else 'agent' end,
            coalesce(u->>'dept','Sales'),
            coalesce((u->>'active')::boolean, true))
    on conflict (person_id) do update
      set role = excluded.role, dept = excluded.dept, active = excluded.active;
  end loop;

  -- ── 2. ORGS ───────────────────────────────────────────────────────────────
  for c in select * from jsonb_array_elements(coalesce(j_companies, '[]'::jsonb)) loop
    select id into v_oid from core.orgs
     where lower(name) = lower(c->>'name') limit 1;
    if v_oid is null then
      v_oid := md5('sales:org:' || (c->>'id'))::uuid;
      insert into core.orgs (id, name, industry, kind, website, owner_id, active, address)
      values (v_oid, c->>'name', nullif(c->>'industry',''), 'customer',
              nullif(c->>'website',''),
              (select person_id from person_map where old_id = c->>'accountOwner'),
              true,
              case when coalesce(c->>'address','') <> ''
                   then jsonb_build_object('text', c->>'address')
                   else '{}'::jsonb end)
      on conflict (id) do nothing;
    else
      -- org already known to the company spine: only fill gaps, never overwrite
      update core.orgs
         set industry = coalesce(industry, nullif(c->>'industry','')),
             website  = coalesce(website,  nullif(c->>'website','')),
             owner_id = coalesce(owner_id,
                          (select person_id from person_map where old_id = c->>'accountOwner'))
       where id = v_oid;
    end if;
    insert into org_map values (c->>'id', v_oid) on conflict do nothing;

    insert into sales.org_detail
      (org_id, what_they_do, city, source, potential, legacy_cid,
       contact_person, designation, contact_phone, contact_email, custom)
    values (v_oid, nullif(c->>'whatTheyDo',''), nullif(c->>'city',''),
            nullif(c->>'source',''),
            coalesce((c->>'potential')::numeric, 0),
            nullif(c->>'cid',''),
            nullif(c->>'contactPerson',''), nullif(c->>'designation',''),
            nullif(c->>'phone',''), nullif(c->>'email',''),
            coalesce(c->'custom','[]'::jsonb))
    on conflict (org_id) do update
      set what_they_do = excluded.what_they_do, city = excluded.city,
          source = excluded.source, potential = excluded.potential,
          legacy_cid = coalesce(sales.org_detail.legacy_cid, excluded.legacy_cid),
          contact_person = excluded.contact_person, designation = excluded.designation,
          contact_phone = excluded.contact_phone, contact_email = excluded.contact_email,
          custom = excluded.custom;

    -- 2b. the company's activity feed → sales.org_activities
    i := 0;
    for a in select * from jsonb_array_elements(coalesce(c->'activity','[]'::jsonb)) loop
      insert into sales.org_activities (id, org_id, kind, body, author_id, at)
      values (md5('sales:act:' || (c->>'id') || ':' || i)::uuid, v_oid, 'note',
              coalesce(a->>'text',''),
              (select person_id from person_map where old_id = a->>'by'),
              coalesce((a->>'at')::timestamptz, now()))
      on conflict (id) do nothing;
      i := i + 1;
    end loop;
  end loop;

  -- ── 3. DEALS + MOVES ──────────────────────────────────────────────────────
  for d in select * from jsonb_array_elements(coalesce(j_deals, '[]'::jsonb)) loop
    select org_id into v_oid from org_map where old_id = d->>'companyId';
    if v_oid is null then
      raise notice 'deal % skipped — company % not in the blob', d->>'did', d->>'companyId';
      continue;
    end if;
    insert into sales.deals
      (id, code, org_id, owner_id, value, stage, lost, lost_note, created_at, updated_at)
    values (md5('sales:deal:' || (d->>'id'))::uuid,
            coalesce(nullif(d->>'did',''), 'EB-D-' || left(d->>'id', 6)),
            v_oid,
            (select person_id from person_map where old_id = d->>'ownerId'),
            coalesce((d->>'value')::numeric, 0),
            case when d->>'stage' in ('lead','first_meeting','physical_meeting','rfq',
                                      'project_id','pm_added','quote_lld','negotiation',
                                      'closure','po')
                 then d->>'stage' else 'lead' end,
            coalesce((d->>'lost')::boolean, false),
            nullif(d->'lostInfo'->>'summary',''),
            coalesce((d->>'createdAt')::timestamptz, now()),
            coalesce((d->>'updatedAt')::timestamptz, now()))
    on conflict (code) do update
      set stage = excluded.stage, value = excluded.value, lost = excluded.lost,
          lost_note = excluded.lost_note, updated_at = excluded.updated_at;

    i := 0;
    for h in select * from jsonb_array_elements(coalesce(d->'history','[]'::jsonb)) loop
      insert into sales.deal_moves
        (id, deal_id, from_stage, to_stage, summary, facts, risks, next_action,
         transcript, gated, forced, author_id, at)
      values (md5('sales:move:' || (d->>'id') || ':' || i)::uuid,
              md5('sales:deal:' || (d->>'id'))::uuid,
              h->>'from', h->>'to', h->>'summary',
              coalesce(h->'facts','{}'::jsonb),
              coalesce(h->'risks','[]'::jsonb),
              coalesce(h->>'next_action', h->>'nextAction'),
              coalesce(h->'transcript','[]'::jsonb),
              coalesce((h->>'gated')::boolean, false),
              coalesce((h->>'forced')::boolean, false),
              (select person_id from person_map where old_id = h->>'by'),
              coalesce((h->>'at')::timestamptz, now()))
      on conflict (id) do nothing;
      i := i + 1;
    end loop;
  end loop;

  -- ── 4. KPI TARGETS ────────────────────────────────────────────────────────
  -- The blob is one standing set per person (applied monthly); period 'default'.
  for kpi_key, kpi_row in select * from jsonb_each(coalesce(j_kpis, '{}'::jsonb)) loop
    select person_id into v_pid from person_map where old_id = kpi_key;
    if v_pid is null then continue; end if;
    insert into sales.targets (person_id, period, metric, target)
    select v_pid, 'default', m.key, coalesce((kpi_row->>m.key)::numeric, 0)
      from (values ('companies'),('meetings'),('rfqs'),('quotes'),
                   ('pos'),('revenue'),('completeness')) as m(key)
     where kpi_row ? m.key
    on conflict (person_id, period, metric) do update set target = excluded.target;
  end loop;

  -- ── 5. KNOWLEDGE ──────────────────────────────────────────────────────────
  for k in select * from jsonb_array_elements(coalesce(j_know, '[]'::jsonb)) loop
    insert into sales.knowledge (id, title, content, access, created_by, updated_at)
    values (md5('sales:know:' || (k->>'id'))::uuid,
            coalesce(k->>'title','Untitled'), coalesce(k->>'content',''),
            case when k->>'access' in ('all','leadership','admin')
                 then k->>'access' else 'all' end,
            (select person_id from person_map where old_id = k->>'createdBy'),
            coalesce((k->>'updatedAt')::timestamptz, now()))
    on conflict (id) do update
      set title = excluded.title, content = excluded.content,
          access = excluded.access, updated_at = excluded.updated_at;
  end loop;

  -- ── 6. TRAININGS → core.trainings ─────────────────────────────────────────
  -- resource carries the migrated knowledge uuid (as text) so the app keeps
  -- the training ↔ knowledge link.
  for t in select * from jsonb_array_elements(coalesce(j_trainings, '[]'::jsonb)) loop
    select person_id into v_pid from person_map where old_id = t->>'assignedTo';
    if v_pid is null then continue; end if;
    insert into core.trainings (id, user_id, title, resource, due, status, assigned_by)
    values (md5('sales:train:' || (t->>'id'))::uuid, v_pid,
            coalesce(t->>'title','Training'),
            case when coalesce(t->>'knowledgeId','') <> ''
                 then (md5('sales:know:' || (t->>'knowledgeId'))::uuid)::text
                 else null end,
            (t->>'due')::date,
            coalesce(t->>'status','assigned'),
            (select person_id from person_map where old_id = t->>'assignedBy'))
    on conflict (id) do update
      set title = excluded.title, resource = excluded.resource,
          due = excluded.due, status = excluded.status;
  end loop;

  -- ── 7. WORK UPDATES ───────────────────────────────────────────────────────
  for w in select * from jsonb_array_elements(coalesce(j_worklogs, '[]'::jsonb)) loop
    select person_id into v_pid from person_map where old_id = w->>'userId';
    if v_pid is null or coalesce(w->>'date','') = '' then continue; end if;
    insert into sales.work_updates (id, person_id, on_date, note)
    values (md5('sales:log:' || (w->>'id'))::uuid, v_pid, (w->>'date')::date,
            trim(coalesce(nullif(w->>'progress',''), '') ||
              case when coalesce(w->>'companiesWorked','') <> ''
                   then E'\nCompanies: ' || (w->>'companiesWorked') else '' end ||
              case when coalesce(w->>'blockers','') <> ''
                   then E'\nBlockers: ' || (w->>'blockers') else '' end ||
              case when coalesce(w->>'next','') <> ''
                   then E'\nNext: ' || (w->>'next') else '' end))
    on conflict (person_id, on_date) do update set note = excluded.note;
  end loop;

  -- ── 8. TRAVEL / EXPENSES ──────────────────────────────────────────────────
  for e in select * from jsonb_array_elements(coalesce(j_expenses, '[]'::jsonb)) loop
    select person_id into v_pid from person_map where old_id = e->>'userId';
    if v_pid is null then continue; end if;
    insert into sales.travel_requests
      (id, person_id, org_id, purpose, city, from_date, to_date, mode,
       estimate, notes, status, decided_by, decision_note, created_at)
    values (md5('sales:exp:' || (e->>'id'))::uuid, v_pid,
            (select org_id from org_map where old_id = e->>'companyId'),
            coalesce(e->>'purpose',''), nullif(e->>'city',''),
            (nullif(e->>'from',''))::date, (nullif(e->>'to',''))::date,
            nullif(e->>'mode',''),
            coalesce((e->>'estimate')::numeric, 0), nullif(e->>'notes',''),
            case when e->>'status' in ('pending','approved','rejected')
                 then e->>'status' else 'pending' end,
            (select person_id from person_map where old_id = e->>'decidedBy'),
            nullif(e->>'decisionNote',''),
            coalesce((e->>'createdAt')::timestamptz, now()))
    on conflict (id) do update
      set status = excluded.status, decided_by = excluded.decided_by,
          decision_note = excluded.decision_note;
  end loop;

  -- ── 9. SCRUM NOTES ────────────────────────────────────────────────────────
  for s in select * from jsonb_array_elements(coalesce(j_scrums, '[]'::jsonb)) loop
    insert into sales.scrum_notes (id, on_date, raw, organized, author_id, created_at)
    values (md5('sales:scrum:' || (s->>'id'))::uuid,
            coalesce((nullif(s->>'date',''))::date, current_date),
            coalesce(s->>'raw',''),
            jsonb_build_object('tasks', coalesce(s->'tasks','[]'::jsonb),
                               'summary', coalesce(s->>'summary','')),
            (select person_id from person_map where old_id = s->>'userId'),
            coalesce((s->>'createdAt')::timestamptz, now()))
    on conflict (id) do update
      set raw = excluded.raw, organized = excluded.organized;
  end loop;

  -- ── 10. SYSTEM MEMORY (sales-scoped) ──────────────────────────────────────
  for m in select * from jsonb_array_elements(coalesce(j_memory, '[]'::jsonb)) loop
    insert into sales.memory (id, title, content, created_by, updated_at)
    values (md5('sales:mem:' || (m->>'id'))::uuid,
            coalesce(m->>'title','Note'), coalesce(m->>'text',''),
            (select person_id from person_map where old_id = m->>'by'),
            coalesce((m->>'updatedAt')::timestamptz, now()))
    on conflict (id) do update
      set title = excluded.title, content = excluded.content,
          updated_at = excluded.updated_at;
  end loop;

  -- ── 11. GATE CONFIG ───────────────────────────────────────────────────────
  for gate_key in select jsonb_object_keys(coalesce(j_gates, '{}'::jsonb)) loop
    if gate_key in ('lead','first_meeting','physical_meeting','rfq','project_id',
                    'pm_added','quote_lld','negotiation','closure','po') then
      insert into sales.gate_config (stage, requirements)
      values (gate_key, coalesce(j_gates->gate_key, '[]'::jsonb))
      on conflict (stage) do update set requirements = excluded.requirements;
    end if;
  end loop;

  raise notice 'Migration pass complete.';
end $mig$;

drop table if exists person_map;
drop table if exists org_map;

-- ═══ THE REPORT — send these numbers back ═══════════════════════════════════
select 'core.people'           as t, count(*) from core.people            union all
select 'sales.people_detail',        count(*) from sales.people_detail    union all
select 'core.orgs',                  count(*) from core.orgs              union all
select 'sales.org_detail',           count(*) from sales.org_detail       union all
select 'sales.deals',                count(*) from sales.deals            union all
select 'sales.deal_moves',           count(*) from sales.deal_moves       union all
select 'sales.org_activities',       count(*) from sales.org_activities   union all
select 'sales.targets',              count(*) from sales.targets          union all
select 'sales.knowledge',            count(*) from sales.knowledge        union all
select 'core.trainings',             count(*) from core.trainings         union all
select 'sales.work_updates',         count(*) from sales.work_updates     union all
select 'sales.travel_requests',      count(*) from sales.travel_requests  union all
select 'sales.scrum_notes',          count(*) from sales.scrum_notes      union all
select 'sales.memory',               count(*) from sales.memory           union all
select 'sales.gate_config',          count(*) from sales.gate_config
order by 1;
