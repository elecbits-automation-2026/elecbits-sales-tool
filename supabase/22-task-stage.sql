-- ═══════════════════════════════════════════════════════════════════════════
-- WHICH STAGE IS THIS TASK PART OF?
--
-- The PMS anchors a task to one of 308 process steps, and the work window then
-- opens with that step's guidance, its entry and exit questions, and the exact
-- file it writes to. A task that knows its step is a task somebody can do
-- without opening Drive first and guessing.
--
-- Sales has ten pipeline stages rather than 308 steps, so the same idea costs
-- one column: which stage of the deal does this task advance. Nullable, because
-- plenty of tasks are admin and belong to no stage — and a forced choice would
-- just be answered wrongly.
--
-- Run AFTER 12-phase1.sql. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

alter table sales.tasks
  add column if not exists stage text;

comment on column sales.tasks.stage is
  'Pipeline stage this task advances — a key from src/data/stages.ts STAGES '
  '(lead, first_meeting, … po). Null means the task belongs to no stage. '
  'Deliberately not a foreign key: the stage list lives in the app, and a '
  'renamed stage should not fail a write.';

create index if not exists tasks_stage_idx
  on sales.tasks (stage, status) where stage is not null;

select 'sales.tasks.stage' as t, count(*) from information_schema.columns
  where table_schema = 'sales' and table_name = 'tasks' and column_name = 'stage';
-- Expect 1.
