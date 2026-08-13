-- ═══════════════════════════════════════════════════════════════════════════
-- TASK GATE — the PMS's AI-gated closure, on sales.tasks. Idempotent.
-- work = the evidence form; ai = the gate's verdict; escalated feeds KPI.
-- ═══════════════════════════════════════════════════════════════════════════
alter table sales.tasks
  add column if not exists window_start text,
  add column if not exists window_end   text,
  add column if not exists work         jsonb not null default '{}'::jsonb,
  add column if not exists ai           jsonb not null default '{}'::jsonb,
  add column if not exists escalated    boolean not null default false,
  add column if not exists branched_from uuid references sales.tasks(id) on delete set null;
select 'sales.tasks columns' as t, count(*) from information_schema.columns
 where table_schema='sales' and table_name='tasks';
