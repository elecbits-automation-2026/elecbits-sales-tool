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
-- Login is handled inside the app against the sales:users table (email +
-- password hash) — there is no Supabase Auth session — so the browser talks to
-- Supabase with the public `anon` role. We therefore grant + allow `anon` (and
-- `authenticated`, harmless). This makes the whole collections table
-- readable/writable by anyone with the anon key and the site URL — acceptable
-- for an internal tool. Keep the deployment URL private; the app's own login
-- gates the UI, and passwords are stored only as salted hashes.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on public.collections to anon, authenticated, service_role;

alter table public.collections enable row level security;

-- Drop every policy name we've used across revisions so re-running is idempotent.
drop policy if exists "authenticated read"   on public.collections;
drop policy if exists "authenticated insert" on public.collections;
drop policy if exists "authenticated update" on public.collections;
drop policy if exists "authenticated delete" on public.collections;
drop policy if exists "public read"   on public.collections;
drop policy if exists "public insert" on public.collections;
drop policy if exists "public update" on public.collections;
drop policy if exists "public delete" on public.collections;

create policy "public read"
  on public.collections for select
  to anon, authenticated using (true);

create policy "public insert"
  on public.collections for insert
  to anon, authenticated with check (true);

create policy "public update"
  on public.collections for update
  to anon, authenticated using (true) with check (true);

create policy "public delete"
  on public.collections for delete
  to anon, authenticated using (true);
