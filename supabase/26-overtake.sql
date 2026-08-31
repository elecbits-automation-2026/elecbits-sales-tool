-- ═══════════════════════════════════════════════════════════════════════════
-- THE OVERTAKE — once a deal reaches RFQ, ULM decides how it takes the
-- project over: full overtake (ULM runs it end to end) or semi overtake
-- (sales stays in the loop). Run after 25-service-role-grants.sql. Idempotent.
--
-- WHERE IT IS READABLE. The column sits on sales.requests, next to the
-- request ULM reads — but NOT inside it: core.intake selects a fixed column
-- list (id, title, summary, proposed_kind, qty, target_date, value_inr,
-- po_ref, urgency, status, project_id, org_id, org_name, submitted_by,
-- submitted_at, decided_*) and does not include overtake, requirement or ai.
-- So today this is a SALES-SIDE record of ULM's decision, entered from the
-- Sanctioning card; ULM cannot query it through the contract view. Widening
-- core.intake is a change to a shared object and belongs to whoever owns it
-- — do not do it from this repo without agreeing it with the ULM/PMS side.
-- ═══════════════════════════════════════════════════════════════════════════
alter table sales.requests
  add column if not exists overtake text not null default 'pending';
alter table sales.requests drop constraint if exists requests_overtake_check;
alter table sales.requests add constraint requests_overtake_check
  check (overtake in ('pending','full','semi'));

select 'sales.requests overtake' as t, count(*) from sales.requests;
