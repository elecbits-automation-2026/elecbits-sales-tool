-- ═══════════════════════════════════════════════════════════════════════════
-- TASK STATES — a task is now: open (not started) → doing (in progress) → done.
-- Existing rows keep working: 'open' already means "not started".
-- Everything else the flow needs (started_at, prep questions, gate Q&A) rides
-- in the existing work/ai jsonb columns, so this is the only change.
-- Run after 13-task-gate.sql. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════
alter table sales.tasks drop constraint if exists tasks_status_check;
alter table sales.tasks add constraint tasks_status_check
  check (status in ('open', 'doing', 'done'));

select status, count(*) from sales.tasks group by status order by 1;
