-- ═══════════════════════════════════════════════════════════════════════════
-- SCRUM PARITY — bring the sales scrum up to the PMS's shape.
--
-- Three things the PMS scrum produces that sales tasks had nowhere to put:
--
--   steps       the ordered sub-steps of a task ("1. pull the gerber,
--               2. run DRC, 3. save the report"). The organiser already
--               writes them; without a column they were dropped on save.
--   conditions  if/else contingencies as STRUCTURED rows —
--               [{if, then, timeboxMinutes}] — not a sentence. The old flat
--               `condition` string could be shown but never acted on: you
--               cannot count open branches or time-box one from prose.
--   note_no     "Note 1, Note 2…" per day, so a day's notes have a stable
--               human reference. Rides in scrum_notes.organized, so it needs
--               no column — recorded here only because the app now writes it.
--
-- The per-task DATE needed nothing: sales.tasks.due already exists. Until now
-- every task from a scrum was forced onto the note's own day, so "Ankit calls
-- them tomorrow at 3" landed today. That was an application bug, not a schema
-- gap, and it is fixed in the organiser.
--
-- Run AFTER 19-client-comms.sql. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

alter table sales.tasks
  add column if not exists steps      jsonb not null default '[]'::jsonb,
  add column if not exists conditions jsonb not null default '[]'::jsonb;

comment on column sales.tasks.steps is
  'Ordered sub-steps, as written by the scrum organiser. ["pull the gerber", …]';
comment on column sales.tasks.conditions is
  'If/else contingencies: [{"if":"…","then":"…","timeboxMinutes":60}]. '
  'Structured so an open branch can be counted and timed, not just read.';

-- A task raised from a scrum note already records which note (18-scrum-call);
-- these two indexes make "what came out of this note" and "what branches are
-- still open" answerable without a sequential scan.
create index if not exists tasks_conditions_idx
  on sales.tasks using gin (conditions)
  where conditions <> '[]'::jsonb;

select 'sales.tasks.steps'      as t, count(*) from information_schema.columns
  where table_schema = 'sales' and table_name = 'tasks' and column_name = 'steps'
union all
select 'sales.tasks.conditions',      count(*) from information_schema.columns
  where table_schema = 'sales' and table_name = 'tasks' and column_name = 'conditions';
-- Expect 1 and 1.
