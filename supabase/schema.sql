-- Elecbits Sales OS — Supabase schema
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
--
-- Storage model: one "collections" table. Each collection the app uses
-- (crm-clients, crm-projects, crm-users, crm-leads, crm-tasks, crm-work-updates)
-- is a single row whose `data` column holds the whole JSON list. This mirrors
-- the app's loadList(key) / saveList(key, list) interface 1:1.

create table if not exists public.collections (
  key        text primary key,
  data       jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- Table-level privileges. RLS policies (below) decide which *rows* a role can
-- touch, but the role must also be GRANTed access to the table itself. Supabase
-- usually auto-grants these; grant them explicitly so it never depends on that.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.collections to authenticated, service_role;

-- Row Level Security: block anonymous access; allow any signed-in user to read
-- and write. (This is prototype-grade — the app enforces per-role/department
-- visibility on the client. A future hardening step is per-collection or
-- per-row policies; see README.)
alter table public.collections enable row level security;

drop policy if exists "authenticated read"   on public.collections;
drop policy if exists "authenticated insert" on public.collections;
drop policy if exists "authenticated update" on public.collections;

create policy "authenticated read"
  on public.collections for select
  to authenticated using (true);

create policy "authenticated insert"
  on public.collections for insert
  to authenticated with check (true);

create policy "authenticated update"
  on public.collections for update
  to authenticated using (true) with check (true);
