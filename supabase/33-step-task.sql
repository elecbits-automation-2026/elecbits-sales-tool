-- ═══════════════════════════════════════════════════════════════════════════
-- THE COMMITTED STEP IS A TASK, NOT A SENTENCE ABOUT ONE.
-- Run after 32-deal-contacts.sql. Idempotent.
--
-- deals.next_step has always held the commitment as free text, and the task
-- that carries it has always been a separate row. The only thing joining
-- them was their TITLE: on completion the app looked for a task whose text
-- matched the step and marked the step done.
--
-- Matching two records by their wording was never going to hold. "Suggest
-- tasks" is explicitly allowed to reword a vague title, and the moment it
-- did, the join broke — silently. The deal went on advertising a commitment
-- whose task no longer existed under that name, with its own stale date,
-- and nothing could ever close it. One live deal was found showing
-- "Send introductory mail to Chinmay · by 2 Oct" above its only real task,
-- "Send follow-up email with demo agenda…", overdue since 26 Sept.
--
-- So the deal points at the task by id. One record, one date, renameable
-- without consequence.
--
-- next_step / next_step_due stay, as a denormalised copy kept in step with
-- the task — the pipeline table, the board cards and the Scrum Master all
-- read them, and none of those should have to join to tasks to print a line.
-- ═══════════════════════════════════════════════════════════════════════════

alter table sales.deals add column if not exists next_step_task_id uuid
  references sales.tasks(id) on delete set null;

create index if not exists deals_next_step_task_idx on sales.deals(next_step_task_id);

comment on column sales.deals.next_step_task_id is
  'The task that IS this deal''s committed next step. ON DELETE SET NULL: a
   deleted task leaves the deal with no commitment, which is the truth.
   next_step / next_step_due are a copy of that task''s title and date, kept
   in step by the app so list views need no join.';

-- Backfill: where a deal has a step and exactly ONE open task whose title
-- matches it, adopt that task. Deliberately conservative — ambiguity is
-- left for a person to resolve in the deal room, because guessing here
-- would attach the commitment to the wrong piece of work, which is the
-- failure this column exists to end.
with norm as (
  select d.id as deal_id, t.id as task_id,
         count(*) over (partition by d.id) as hits
    from sales.deals d
    join sales.tasks t
      on (t.deal_id = d.id or (t.deal_id is null and t.org_id = d.org_id))
     and t.status <> 'done'
     and lower(regexp_replace(t.title, '[^a-zA-Z0-9]+', ' ', 'g'))
       = lower(regexp_replace(d.next_step, '[^a-zA-Z0-9]+', ' ', 'g'))
   where d.next_step is not null and d.next_step <> ''
     and d.next_step_done_at is null
     and d.next_step_task_id is null
)
update sales.deals d
   set next_step_task_id = n.task_id
  from norm n
 where n.deal_id = d.id and n.hits = 1;

select 'deals with a committed step'        as t, count(*) from sales.deals
 where next_step is not null and next_step <> '' and next_step_done_at is null
union all
select 'now pointing at their task', count(*) from sales.deals where next_step_task_id is not null
union all
select 'still text-only (resolve in the deal room)', count(*) from sales.deals
 where next_step is not null and next_step <> '' and next_step_done_at is null
   and next_step_task_id is null;
