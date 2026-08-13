-- ═══════════════════════════════════════════════════════════════════════════
-- ASSISTANT CHATS — one thread per person per day, browsable date-wise.
-- Run after 10-sales-port.sql. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists sales.chats (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references core.people(id) on delete cascade,
  on_date    date not null default current_date,
  messages   jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (person_id, on_date)
);
alter table sales.chats enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='sales' and tablename='chats' and policyname='chats_read') then
    create policy chats_read on sales.chats for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='sales' and tablename='chats' and policyname='chats_write') then
    create policy chats_write on sales.chats for all to authenticated using (true) with check (true);
  end if;
end $$;
grant select, insert, update, delete on sales.chats to authenticated;
revoke all on sales.chats from anon;
drop trigger if exists chats_touch on sales.chats;
create trigger chats_touch before update on sales.chats
  for each row execute function public.touch_updated_at();
select 'sales.chats' as t, count(*) from sales.chats;
