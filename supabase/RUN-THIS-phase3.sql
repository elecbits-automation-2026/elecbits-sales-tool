-- ═══════════════════════════════════════════════════════════════════════
-- RUN-THIS — the scrum call, transcripts and client comms. One paste.
-- Idempotent; safe to re-run. Run AFTER the earlier RUN-THIS files.
--   18-scrum-call.sql   meet link, attendance, transcript on a scrum note
--   19-client-comms.sql the touch log + commitments (with backfill)
-- ═══════════════════════════════════════════════════════════════════════

-- ── PART: 18-scrum-call.sql ─────────────────────────────────────────────

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

-- ── PART: 19-client-comms.sql ─────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- CLIENT COMMS — every touch with a client, and every promise made in one.
-- org_activities was already the touch log; it just never knew the direction,
-- the channel, the contact, or the record the touch left behind.
-- Run after 18-scrum-call.sql. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════
alter table sales.org_activities drop constraint if exists org_activities_kind_check;
alter table sales.org_activities add constraint org_activities_kind_check
  check (kind in ('note','call','email','whatsapp','meeting','visit','linkedin','other'));

alter table sales.org_activities
  add column if not exists direction    text not null default 'internal',
  add column if not exists subject      text,
  add column if not exists contact_name text,
  add column if not exists occurred_at  timestamptz,
  add column if not exists deal_id      uuid references sales.deals(id)    on delete set null,
  add column if not exists meeting_id   uuid references sales.meetings(id) on delete set null,
  add column if not exists link         text,
  add column if not exists drive_file   text,
  add column if not exists source       text not null default 'manual',
  add column if not exists ai           jsonb not null default '{}'::jsonb;

alter table sales.org_activities drop constraint if exists org_activities_direction_check;
alter table sales.org_activities add constraint org_activities_direction_check
  check (direction in ('in','out','internal'));

-- `at` has always meant "when it was logged"; occurred_at is when it happened.
update sales.org_activities set occurred_at = at where occurred_at is null;
create index if not exists org_activities_touch_idx
  on sales.org_activities(org_id, occurred_at desc) where kind <> 'note';

-- ═══ COMMITMENTS — a promise is not a task: it has a side, a counterparty,
--     and an outcome that outlives the task that served it. ════════════════
create table if not exists sales.commitments (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references core.orgs(id)         on delete cascade,
  deal_id     uuid references sales.deals(id)                on delete set null,
  activity_id uuid references sales.org_activities(id)       on delete set null,
  meeting_id  uuid references sales.meetings(id)             on delete set null,
  task_id     uuid references sales.tasks(id)                on delete set null,
  side        text not null default 'us'   check (side in ('us','them')),
  what        text not null,
  to_whom     text,
  owner_id    uuid references core.people(id)                on delete set null,
  due         date,
  certainty   text not null default 'promised' check (certainty in ('promised','implied')),
  status      text not null default 'open'
                check (status in ('open','kept','missed','renegotiated','dropped')),
  closed_at   timestamptz,
  closed_note text,
  evidence    text,
  created_by  uuid references core.people(id)                on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists commitments_org_idx   on sales.commitments(org_id, status, due);
create index if not exists commitments_owner_idx on sales.commitments(owner_id, status, due);

alter table sales.commitments enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='sales' and tablename='commitments' and policyname='commitments_read') then
    create policy commitments_read on sales.commitments for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='sales' and tablename='commitments' and policyname='commitments_write') then
    create policy commitments_write on sales.commitments for all to authenticated using (true) with check (true);
  end if;
end $$;
grant select, insert, update, delete on sales.commitments to authenticated;
revoke all on sales.commitments from anon;

-- ═══ BACKFILL — every written-up conversation becomes a touch, so the new
--     timeline is complete from day one and nothing is orphaned. ══════════
insert into sales.org_activities
  (org_id, kind, direction, subject, body, author_id, at, occurred_at, meeting_id, source)
select m.org_id, 'meeting', 'out', coalesce(m.title, 'Client conversation'),
       coalesce(m.raw, ''), m.author_id, m.created_at, m.created_at, m.id, 'writeup'
from sales.meetings m
where not exists (select 1 from sales.org_activities a where a.meeting_id = m.id);

select 'sales.org_activities' as t, count(*) from sales.org_activities
union all select 'sales.commitments', count(*) from sales.commitments;
