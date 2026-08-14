-- ═══════════════════════════════════════════════════════════════════════════
-- THE SCRUM CALL — a note now knows the meeting it came out of: the link,
-- who was on it, and the transcript it was read from. Idempotent.
-- Run after 17-task-states.sql.
-- ═══════════════════════════════════════════════════════════════════════════
alter table sales.scrum_notes
  add column if not exists meet_link      text,
  add column if not exists attendance     jsonb not null default '{}'::jsonb,
  add column if not exists source         text  not null default 'typed',
  add column if not exists transcript     text,
  add column if not exists transcript_url text;

alter table sales.scrum_notes drop constraint if exists scrum_notes_source_check;
alter table sales.scrum_notes add constraint scrum_notes_source_check
  check (source in ('typed','voice','transcript','fireflies','assistant'));

create index if not exists scrum_notes_date_idx on sales.scrum_notes(on_date desc);

-- The back-link: which note raised this task. Without it a note can only show
-- the AI's frozen snapshot, never the live task.
alter table sales.tasks add column if not exists scrum_note_id uuid
  references sales.scrum_notes(id) on delete set null;
create index if not exists tasks_scrum_note_idx on sales.tasks(scrum_note_id);

alter table sales.tasks drop constraint if exists tasks_source_check;
alter table sales.tasks add constraint tasks_source_check
  check (source in ('manual','chat','scrum','system','comms','commitment','transcript'));

select 'sales.scrum_notes' as t, count(*) from sales.scrum_notes;
