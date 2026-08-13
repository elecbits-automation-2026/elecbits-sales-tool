-- ═══════════════════════════════════════════════════════════════════════════
-- COMPANY CHAT — sales.chats learns an org scope: org_id null = the personal
-- Assistant thread; org_id set = that company's "Ask the AI" thread.
-- Run after 14-chats.sql. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════
alter table sales.chats
  add column if not exists org_id uuid references core.orgs(id) on delete cascade;
alter table sales.chats drop constraint if exists chats_person_id_on_date_key;
create unique index if not exists chats_person_day_key
  on sales.chats (person_id, on_date) where org_id is null;
create unique index if not exists chats_org_person_day_key
  on sales.chats (org_id, person_id, on_date) where org_id is not null;
select 'sales.chats' as t, count(*) from sales.chats;
