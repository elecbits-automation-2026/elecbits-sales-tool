-- ═══════════════════════════════════════════════════════════════════════════
-- TASK SOURCES — the check constraint meets the new task origins.
-- 'stage' = raised automatically when a deal reaches a phase (kickoff);
-- 'step'  = generated from the committed next step ("generate the task").
-- Without this, saving either kind fails the tasks_source_check and the red
-- "A save failed" toast fires. Run any time after 18-scrum-call.sql. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

alter table sales.tasks drop constraint if exists tasks_source_check;
alter table sales.tasks add constraint tasks_source_check
  check (source in ('manual','chat','scrum','system','comms','commitment','transcript','stage','step'));

select 'tasks_source_check widened' as note;
