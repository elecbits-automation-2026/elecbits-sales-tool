-- ═══════════════════════════════════════════════════════════════════════════
-- SOP v2.0 IDs + CHAT-BASED CLIENT INTAKE. Run after 29-memory-vectors.sql.
-- Idempotent.
--
--   • EbSOP_ProjectCreationandIDCreation_v2.0: every family mints
--     EB-<FAMILY>-YY-nnnn independently; the serial resets each January;
--     nnnn 0000 is reserved for internal use so counting starts at 0001.
--     Derived IDs append one suffix to the FULL parent — a deal under
--     EB-C-26-0007 is EB-C-26-0007-D01, never a fresh serial.
--   • The Eb-Master_Register Google Sheet stays the ID authority across
--     tools (XoR mints into the same register): the app reads the sheet's
--     max serial first and passes it as p_floor, so this counter can only
--     ever move ABOVE what the register already holds.
--   • sales.intake_sessions is the save-progress store for the chat that
--     creates a client: the conversation, the extracted fields and the
--     state key persist after every exchange, so "save the chat till
--     whatever you know" is one row, resumable by anyone on the roster.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists sales.sop_counters (
  family text not null,             -- 'EB-C', 'EB-P', …
  yy     text not null,             -- '26' — a new row each January = the reset
  last   int  not null default 0,
  primary key (family, yy)
);
alter table sales.sop_counters enable row level security;
-- No policies on purpose: only the SECURITY DEFINER mint below touches it.

create or replace function sales.next_sop_id(p_family text, p_floor int default 0)
returns text
language plpgsql security definer set search_path = sales, pg_temp
as $$
declare
  v_yy text := to_char(now(), 'YY');
  v_n  int;
begin
  insert into sales.sop_counters as c (family, yy, last)
  values (upper(p_family), v_yy, greatest(coalesce(p_floor, 0), 0) + 1)
  on conflict (family, yy) do update
    set last = greatest(c.last, coalesce(p_floor, 0)) + 1
  returning last into v_n;
  return upper(p_family) || '-' || v_yy || '-' || lpad(v_n::text, 4, '0');
end $$;
grant execute on function sales.next_sop_id(text, int) to authenticated;

create table if not exists sales.intake_sessions (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid references core.people(id) on delete set null,
  org_id     uuid references core.orgs(id)   on delete set null,  -- set once created
  status     text not null default 'draft'
               check (status in ('draft','created','discarded')),
  state      text not null default 'company',    -- the chat's current step key
  data       jsonb not null default '{}'::jsonb, -- everything known so far
  messages   jsonb not null default '[]'::jsonb, -- the conversation itself
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists intake_sessions_status_idx
  on sales.intake_sessions(status, updated_at desc);

alter table sales.intake_sessions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='sales' and tablename='intake_sessions' and policyname='intake_read') then
    create policy intake_read on sales.intake_sessions for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='sales' and tablename='intake_sessions' and policyname='intake_write') then
    create policy intake_write on sales.intake_sessions for all to authenticated using (true) with check (true);
  end if;
end $$;
grant select, insert, update, delete on sales.intake_sessions to authenticated;
revoke all on sales.intake_sessions from anon;

select 'sales.sop_counters' as t, count(*) from sales.sop_counters
union all
select 'sales.intake_sessions', count(*) from sales.intake_sessions;
