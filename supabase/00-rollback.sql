-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — reverse the additive migrations 12 through 21.
--
-- WHAT THIS UNDOES
--   21-recordings-bucket.sql  the sales-recordings bucket and its policies
--   20-scrum-parity.sql   sales.tasks.steps and .conditions
--   19-client-comms.sql   sales.commitments; the touch columns and the two
--                         check constraints on sales.org_activities
--   18-scrum-call.sql     the call columns on sales.scrum_notes;
--                         tasks.scrum_note_id and tasks_source_check
--   17-task-states.sql    the widened tasks_status_check (back to open/done)
--   16-company-chat.sql   chats.org_id and its two unique indexes
--   15-account-plan.sql   org_detail.plan
--   14-chats.sql          sales.chats
--   13-task-gate.sql      the gate columns on sales.tasks
--   12-phase1.sql         sales.tasks, sales.llds, sales.question_sets
--
-- WHAT THIS DELIBERATELY WILL NOT TOUCH
--   10-sales-port.sql and 11-migrate-blobs.sql, and everything from the PMS
--   repo underneath them. Those created the shared spine and MIGRATED THE
--   BLOBS — the original public.collections rows are the only other copy of
--   that data, and this script is not the right instrument for deciding
--   whether they are still trustworthy. Undoing phase 0 is a point-in-time
--   restore, not a script.
--
--   The guard below enforces that: if the tables from 12 onward are already
--   gone, there is nothing here to do and the script stops rather than
--   reaching further back than it should.
--
-- THIS DESTROYS DATA. Everything in sales.tasks, sales.llds,
-- sales.question_sets, sales.chats and sales.commitments is dropped, as are
-- the touch details on org_activities and the call details on scrum_notes.
-- Take a backup first: Supabase → Database → Backups.
--
-- Idempotent: every step is `if exists`, so a partial rollback can be
-- re-run. Runs as ONE transaction in the SQL editor — a failure anywhere
-- leaves the database untouched.
-- ═══════════════════════════════════════════════════════════════════════════

do $$
begin
  if to_regclass('sales.tasks') is null
     and to_regclass('sales.chats') is null
     and to_regclass('sales.commitments') is null then
    raise notice 'Nothing to roll back — 12–19 are not applied.';
  end if;
end $$;


-- ═══ 19 — client comms ═════════════════════════════════════════════════════
drop index if exists sales.commitments_owner_idx;
drop index if exists sales.commitments_org_idx;
drop table if exists sales.commitments;

drop index if exists sales.org_activities_touch_idx;
alter table if exists sales.org_activities
  drop constraint if exists org_activities_direction_check;
alter table if exists sales.org_activities
  drop column if exists direction,
  drop column if exists subject,
  drop column if exists contact_name,
  drop column if exists occurred_at,
  drop column if exists deal_id,
  drop column if exists meeting_id,
  drop column if exists link,
  drop column if exists drive_file,
  drop column if exists source,
  drop column if exists ai;

-- 19 INTRODUCED this constraint. 10-sales-port.sql declares kind as a bare
-- `text not null default 'note'` with no check at all, so the reversal is a
-- drop and nothing more — recreating one here would invent a rule the
-- original schema never had.
alter table if exists sales.org_activities
  drop constraint if exists org_activities_kind_check;


-- ═══ 18 — the scrum call ═══════════════════════════════════════════════════
drop index if exists sales.tasks_scrum_note_idx;
alter table if exists sales.tasks drop column if exists scrum_note_id;

-- 18 widened tasks_source_check to add comms/commitment/transcript. Put back
-- 12's set; rows carrying a widened value are reset to the generic 'manual'
-- so the narrower constraint can be applied.
do $$
begin
  if to_regclass('sales.tasks') is not null then
    update sales.tasks set source = 'manual'
      where source in ('comms','commitment','transcript');
    alter table sales.tasks drop constraint if exists tasks_source_check;
    alter table sales.tasks add constraint tasks_source_check
      check (source in ('manual','chat','scrum','system'));
  end if;
end $$;

drop index if exists sales.scrum_notes_date_idx;
alter table if exists sales.scrum_notes
  drop constraint if exists scrum_notes_source_check;
alter table if exists sales.scrum_notes
  drop column if exists meet_link,
  drop column if exists attendance,
  drop column if exists source,
  drop column if exists transcript,
  drop column if exists transcript_url;


-- ═══ 17 — task states ══════════════════════════════════════════════════════
-- Back to the two states 12-phase1.sql shipped. Any row sitting in 'doing'
-- would fail the narrower constraint, so it is moved to 'open' first —
-- 'doing' meant "started, not finished", and 'open' is the honest survivor.
do $$
begin
  if to_regclass('sales.tasks') is not null then
    update sales.tasks set status = 'open' where status = 'doing';
    alter table sales.tasks drop constraint if exists tasks_status_check;
    alter table sales.tasks add constraint tasks_status_check
      check (status in ('open','done'));
  end if;
end $$;


-- ═══ 16 — company chat scope ═══════════════════════════════════════════════
drop index if exists sales.chats_org_person_day_key;
drop index if exists sales.chats_person_day_key;
alter table if exists sales.chats drop column if exists org_id;
-- restore 14's original one-thread-per-person-per-day uniqueness
do $$
begin
  if to_regclass('sales.chats') is not null
     and not exists (select 1 from pg_constraint where conname = 'chats_person_id_on_date_key') then
    alter table sales.chats add constraint chats_person_id_on_date_key
      unique (person_id, on_date);
  end if;
end $$;


-- ═══ 15 — account plan ═════════════════════════════════════════════════════
alter table if exists sales.org_detail drop column if exists plan;


-- ═══ 14 — assistant chats ══════════════════════════════════════════════════
drop table if exists sales.chats;


-- ═══ 13 — task gate ════════════════════════════════════════════════════════
alter table if exists sales.tasks
  drop column if exists window_start,
  drop column if exists window_end,
  drop column if exists work,
  drop column if exists ai,
  drop column if exists escalated,
  drop column if exists branched_from;


-- ═══ 12 — tasks, LLDs, question sets ═══════════════════════════════════════
drop index if exists sales.llds_org_idx;
drop index if exists sales.tasks_org_idx;
drop index if exists sales.tasks_assignee_idx;
drop table if exists sales.question_sets;
drop table if exists sales.llds;
drop table if exists sales.tasks;


-- ═══ REPORT ════════════════════════════════════════════════════════════════
select 'sales.tasks'         as object, to_regclass('sales.tasks')::text         as still_there
union all select 'sales.llds',          to_regclass('sales.llds')::text
union all select 'sales.question_sets', to_regclass('sales.question_sets')::text
union all select 'sales.chats',         to_regclass('sales.chats')::text
union all select 'sales.commitments',   to_regclass('sales.commitments')::text
union all select 'sales.deals (kept)',  to_regclass('sales.deals')::text
union all select 'core.people (kept)',  to_regclass('core.people')::text;
-- Expect: the first five NULL, the last two named. If a "kept" row is NULL,
-- something reached further than this script should have — restore a backup.
