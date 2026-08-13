-- ═══════════════════════════════════════════════════════════════════════════
-- ACCOUNT PLAN — the AI-generated staged plan per company (the sales
-- equivalent of the PMS project plan). Stored on sales.org_detail. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════
alter table sales.org_detail
  add column if not exists plan jsonb not null default '{}'::jsonb;
select 'org_detail.plan' as t, count(*) from sales.org_detail;
