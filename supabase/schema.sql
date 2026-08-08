-- Elecbits Sales OS — Supabase schema
-- Run this once in the Supabase SQL Editor (Dashboard → SQL Editor → New query).
--
-- Storage model: one "collections" table. Each collection the app uses
-- (sales:users, sales:companies, sales:deals, sales:kpis, sales:trainings,
-- sales:worklogs, sales:knowledge, sales:expenses, sales:gates) is a single row
-- whose `data` column holds the whole JSON value (an array or an object).

create table if not exists public.collections (
  key        text primary key,
  data       jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

-- Table-level privileges. RLS policies (below) decide which *rows* a role can
-- touch, but the role must also be GRANTed access to the table itself.
--
-- The app uses real per-user auth: everyone signs in with their own Supabase
-- Auth email + password, so the browser talks to Supabase as the `authenticated`
-- role. We therefore restrict grants + policies to `authenticated` — the anon
-- key alone (without a valid login) can no longer read or write the workspace.
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on public.collections to authenticated, service_role;

alter table public.collections enable row level security;

-- Drop older policy names (from earlier revisions) so re-running is idempotent.
drop policy if exists "authenticated read"   on public.collections;
drop policy if exists "authenticated insert" on public.collections;
drop policy if exists "authenticated update" on public.collections;
drop policy if exists "authenticated delete" on public.collections;
drop policy if exists "public read"   on public.collections;
drop policy if exists "public insert" on public.collections;
drop policy if exists "public update" on public.collections;
drop policy if exists "public delete" on public.collections;

create policy "authenticated read"
  on public.collections for select
  to authenticated using (true);

create policy "authenticated insert"
  on public.collections for insert
  to authenticated with check (true);

create policy "authenticated update"
  on public.collections for update
  to authenticated using (true) with check (true);

create policy "authenticated delete"
  on public.collections for delete
  to authenticated using (true);
