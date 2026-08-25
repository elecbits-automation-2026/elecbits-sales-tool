-- ═══════════════════════════════════════════════════════════════════════════
-- THE OVERTAKE — once a deal reaches RFQ, ULM decides how it takes the
-- project over: full overtake (ULM runs it end to end) or semi overtake
-- (sales stays in the loop). Lives on the request ULM already reads through
-- core.intake. Run after 25-service-role-grants.sql. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════
alter table sales.requests
  add column if not exists overtake text not null default 'pending';
alter table sales.requests drop constraint if exists requests_overtake_check;
alter table sales.requests add constraint requests_overtake_check
  check (overtake in ('pending','full','semi'));

select 'sales.requests overtake' as t, count(*) from sales.requests;
