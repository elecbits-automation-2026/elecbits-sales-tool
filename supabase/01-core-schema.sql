-- ═══════════════════════════════════════════════════════════════════════════
-- eb-core-database-1 · STAGE 0 + 1 — the `core` spine and the lock
--
-- From "eb-core-database-1 — one database, six tools" (9 Aug 2026).
-- Run once in the Supabase SQL editor. Idempotent: safe to re-run.
--
-- Touches no existing repository. `public` is FROZEN from the moment this runs:
-- nothing new lands there, and its tables become security_invoker views over
-- core one at a time (stage 4).
--
-- CONVENTIONS ENFORCED HERE (decided once, applied everywhere)
--   1. A tool schema may reference core, never another tool schema.
--   2. Money is numeric(14,2) beside a currency char(3). No floats.
--   3. Instants are timestamptz, dates are date. Never bare timestamp.
--   4. Enumerations are text + check, never Postgres enum types.
--   5. Every table gets id uuid default gen_random_uuid(), created_at, and RLS
--      enabled in the same migration that creates it.
--   6. Nothing in core is hard-deleted — core.events references it. Set
--      archived_at and filter in the view.
--   7. One numbering authority: every Eb- code comes from core.numbering.
-- ═══════════════════════════════════════════════════════════════════════════

create extension if not exists "pgcrypto";
create extension if not exists "citext";

create schema if not exists core;

-- ═══ PEOPLE ════════════════════════════════════════════════════════════════
-- One row per human — staff, contractor, or a client-side engineer who shows
-- up in a MoM. Identity and login only. What they are PAID and their TITLE are
-- HR facts and live in hr.employment / hr.salary, behind a separate lock.
create table if not exists core.people (
  id             uuid primary key default gen_random_uuid(),
  full_name      text not null,
  work_email     citext unique,
  personal_email citext,
  phone          text,
  auth_id        uuid unique references auth.users(id) on delete set null,
  kind           text not null default 'employee'
                   check (kind in ('employee','contractor','intern','external')),
  status         text not null default 'active'
                   check (status in ('active','notice','exited')),
  archived_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index if not exists people_auth_idx on core.people(auth_id);

-- ═══ ORGS ══════════════════════════════════════════════════════════════════
-- Every company we deal with, in any direction. Half your vendors will
-- eventually buy from you; model them separately and you maintain the same
-- GSTIN in two places forever.
create table if not exists core.orgs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  legal_name  text,
  gstin       text,
  country     char(2) not null default 'IN',
  website     text,
  status      text not null default 'active'
                check (status in ('active','dormant','blacklisted')),
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists orgs_name_idx on core.orgs(lower(name));

-- The same company can be a client and a vendor at once.
create table if not exists core.org_roles (
  org_id uuid not null references core.orgs(id) on delete cascade,
  role   text not null check (role in ('client','vendor','partner','prospect')),
  since  date not null default current_date,
  primary key (org_id, role)
);

-- Named humans at an org — for Sales and Finance alike.
create table if not exists core.contacts (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references core.orgs(id) on delete cascade,
  name       text not null,
  title      text,
  email      citext,
  phone      text,
  is_primary boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists contacts_org_idx on core.contacts(org_id);

-- ═══ PROJECTS — the spine ══════════════════════════════════════════════════
-- Only what is true of EVERY project in the company. Twelve columns, and it
-- stays that way. Tool-specific facts go in <tool>.project_detail, keyed on
-- the same id. One project, one id, six different opinions about it.
create table if not exists core.projects (
  id              uuid primary key default gen_random_uuid(),
  code            text unique not null,                 -- from core.numbering
  kind            text not null default 'odm'
                    check (kind in ('odm','boxbuild','product','internal')),
  org_id          uuid references core.orgs(id) on delete set null,
  name            text not null,
  state           text not null default 'lead'
                    check (state in ('lead','won','running','delivered','closed')),
  owner_id        uuid references core.people(id) on delete set null,
  started_on      date,
  due_on          date,
  closed_on       date,
  drive_folder_id text,
  archived_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists projects_org_idx   on core.projects(org_id);
create index if not exists projects_state_idx on core.projects(state);

-- ═══ DOCUMENTS ═════════════════════════════════════════════════════════════
-- Drive stays the file store; this is the index every tool searches.
create table if not exists core.documents (
  id            uuid primary key default gen_random_uuid(),
  drive_file_id text unique,
  name          text,
  mime_type     text,
  drive_path    text,
  project_id    uuid references core.projects(id) on delete set null,
  org_id        uuid references core.orgs(id) on delete set null,
  kind          text,        -- gerber|quote|invoice|payslip|offer|contract_employment…
  uploaded_by   uuid references core.people(id) on delete set null,
  archived_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists documents_project_idx on core.documents(project_id);
create index if not exists documents_kind_idx    on core.documents(kind);

-- ═══ EVENTS ════════════════════════════════════════════════════════════════
-- Append-only company timeline. Every tool writes; nothing updates.
create table if not exists core.events (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor_id    uuid references core.people(id) on delete set null,
  tool        text not null check (tool in ('pms','boxbuild','sales','finance','hr','mgmt')),
  entity_type text,
  entity_id   uuid,
  project_id  uuid references core.projects(id) on delete set null,
  verb        text not null,
  payload     jsonb not null default '{}'::jsonb
);
create index if not exists events_at_idx      on core.events(at desc);
create index if not exists events_project_idx on core.events(project_id);
create index if not exists events_tool_idx    on core.events(tool, at desc);

-- ═══ MEMORY ════════════════════════════════════════════════════════════════
-- Standing rules the assistants read. `scope` keeps one tool's memory out of
-- another tool's prompt.
create table if not exists core.memory (
  id         uuid primary key default gen_random_uuid(),
  scope      text not null default 'company'
               check (scope in ('company','pms','boxbuild','sales','finance','hr','mgmt')),
  title      text not null,
  content    text not null,
  created_by uuid references core.people(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists memory_scope_idx on core.memory(scope);

-- ═══ NUMBERING ═════════════════════════════════════════════════════════════
-- The single authority that mints Eb- codes, so Sales quoting a job and PMS
-- opening it cannot issue the same code twice.
create table if not exists core.numbering (
  prefix   text primary key,
  next_val integer not null default 1
);

create or replace function core.next_code(_prefix text, _width int default 4)
returns text language plpgsql security definer set search_path = core as $$
declare n integer;
begin
  insert into core.numbering (prefix, next_val) values (_prefix, 1)
    on conflict (prefix) do nothing;
  update core.numbering set next_val = next_val + 1
    where prefix = _prefix returning next_val - 1 into n;
  return _prefix || lpad(n::text, _width, '0');
end $$;

-- ═══ THE LOCK ══════════════════════════════════════════════════════════════
-- Six tools x forty tables is a lot of policies, and hand-written policies
-- drift. So the permission question is asked in exactly ONE place, and every
-- policy in every schema is a one-liner that calls it. Change someone's access
-- by updating one row in core.grants; no policy is ever edited to onboard.
create table if not exists core.grants (
  person_id uuid not null references core.people(id) on delete cascade,
  tool      text not null check (tool in ('core','pms','boxbuild','sales','finance','hr','mgmt')),
  level     text not null check (level in ('none','read','write','admin')),
  primary key (person_id, tool)
);

-- The caller's row in the roster, or null if they are not on it.
create or replace function core.me() returns uuid
language sql stable security definer set search_path = core as $$
  select id from core.people where auth_id = auth.uid();
$$;

-- Does the caller hold at least `_level` on `_tool`?
create or replace function core.can(_tool text, _level text) returns boolean
language sql stable security definer set search_path = core as $$
  select exists (
    select 1 from core.grants g
    where g.person_id = core.me() and g.tool = _tool
      and array_position(array['none','read','write','admin'], g.level)
       >= array_position(array['none','read','write','admin'], _level));
$$;

revoke all on function core.me()            from public;
revoke all on function core.can(text,text)  from public;
revoke all on function core.next_code(text,int) from public;
grant execute on function core.me()             to authenticated;
grant execute on function core.can(text,text)   to authenticated;
grant execute on function core.next_code(text,int) to authenticated;

-- ═══ RLS ═══════════════════════════════════════════════════════════════════
-- core is freely readable by anyone on the roster; writes need write on the
-- relevant tool. A table that ships without a policy ships open.
do $$
declare t text;
begin
  foreach t in array array[
    'people','orgs','org_roles','contacts','projects','documents',
    'events','memory','numbering','grants'
  ] loop
    execute format('alter table core.%I enable row level security', t);
    execute format('drop policy if exists %I_read on core.%I', t, t);
    execute format(
      'create policy %I_read on core.%I for select to authenticated using (core.me() is not null)', t, t);
  end loop;
end $$;

-- Writes to the shared spine: any tool with write may create orgs/contacts/
-- projects/documents; events are append-only; grants are admin-only.
do $$
declare t text;
begin
  foreach t in array array['orgs','org_roles','contacts','projects','documents','people'] loop
    execute format('drop policy if exists %I_write on core.%I', t, t);
    execute format(
      'create policy %I_write on core.%I for all to authenticated
         using (core.can(''core'',''write'') or core.can(''core'',''admin''))
         with check (core.can(''core'',''write'') or core.can(''core'',''admin''))', t, t);
  end loop;
end $$;

drop policy if exists events_append on core.events;
create policy events_append on core.events for insert to authenticated
  with check (core.me() is not null);          -- append-only: no update/delete policy

drop policy if exists memory_write on core.memory;
create policy memory_write on core.memory for all to authenticated
  using (core.can('core','admin')) with check (core.can('core','admin'));

drop policy if exists grants_admin on core.grants;
create policy grants_admin on core.grants for all to authenticated
  using (core.can('core','admin')) with check (core.can('core','admin'));

-- ONE EXCEPTION to core being freely readable: payslips, offer letters and
-- employment contracts are visible only to HR admins and the person concerned.
drop policy if exists documents_read on core.documents;
create policy documents_read on core.documents for select to authenticated
  using (
    core.me() is not null
    and (
      coalesce(kind,'') not in ('payslip','offer','contract_employment')
      or core.can('hr','admin')
      or uploaded_by = core.me()
    )
  );

-- ═══ GRANTS (SQL-level, distinct from core.grants) ═════════════════════════
-- RLS decides WHICH rows; PostgREST also needs the underlying privilege.
grant usage on schema core to authenticated;
grant select, insert, update, delete on all tables in schema core to authenticated;
grant usage, select on all sequences in schema core to authenticated;
alter default privileges in schema core
  grant select, insert, update, delete on tables to authenticated;

-- Deliberately NOT granted to anon. While the Sales tool still ships the anon
-- key to the browser, anon must reach nothing in core.
revoke all on all tables in schema core from anon;

-- ═══════════════════════════════════════════════════════════════════════════
-- AFTER RUNNING: add `core` to Supabase → Settings → API → Exposed schemas.
-- Do NOT expose `hr` or `finance` until the Sales tool is off the anon key
-- (stage 5) — see 02-sales-schema.sql.
-- ═══════════════════════════════════════════════════════════════════════════
