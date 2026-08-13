-- ═══════════════════════════════════════════════════════════════════════
-- RUN-THIS — everything since the Phase 0 cut-over, one paste. Idempotent.
-- Parts: 12 tasks/LLDs/question-sets · 13 task-gate columns ·
--        14 assistant chats · 15 account plan · 16 company chat scope
-- ═══════════════════════════════════════════════════════════════════════

-- ── PART: 12-phase1.sql ──────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- PHASE 1 — tasks, LLDs, and trainable question sets.
--
-- Run AFTER 10-sales-port.sql (RUN-THIS-phase0.sql). Idempotent.
-- Adds three sales tables; touches nothing in core/pms beyond reads.
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══ TASKS — from company chat, scrum, or by hand ══════════════════════════
create table if not exists sales.tasks (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid references core.orgs(id) on delete cascade,
  deal_id     uuid references sales.deals(id) on delete set null,
  assignee_id uuid references core.people(id) on delete cascade,
  author_id   uuid references core.people(id) on delete set null,
  title       text not null,
  details     text,
  due         date,
  status      text not null default 'open' check (status in ('open','done')),
  source      text not null default 'manual'
                check (source in ('manual','chat','scrum','system')),
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);
create index if not exists tasks_assignee_idx on sales.tasks(assignee_id, status, due);
create index if not exists tasks_org_idx      on sales.tasks(org_id, status);

-- ═══ LLDs — the 30-question Low-Level Design capture (ODM projects) ════════
create table if not exists sales.llds (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references core.orgs(id) on delete cascade,
  deal_id    uuid references sales.deals(id) on delete set null,
  title      text not null,
  answers    jsonb not null default '{}'::jsonb,   -- {questionId: answer}
  status     text not null default 'draft' check (status in ('draft','final')),
  created_by uuid references core.people(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists llds_org_idx on sales.llds(org_id);

-- ═══ QUESTION SETS — trainable; admins edit in Admin ═══════════════════════
create table if not exists sales.question_sets (
  key        text primary key,
  title      text not null,
  questions  jsonb not null default '[]'::jsonb,
  updated_by uuid references core.people(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Seeds are the defaults; on conflict do nothing so admin edits survive re-runs.
insert into sales.question_sets (key, title, questions) values
('company_card', 'Company record — what a complete card must answer', jsonb_build_array(
  'Who is the primary contact, and what is their designation?',
  'Direct phone number and email of the contact?',
  'Which city/state do they operate from?',
  'Which industry/application are they in (client-ID industry list)?',
  'What org size are they (PL/ML/EL/EM/UN/GO)?',
  'What does the company actually do — one factual sentence?',
  'Where did this lead come from (source)?',
  'What is the realistic business potential (₹) and over what horizon?',
  'What payment terms do they expect or usually work on?',
  'Approximate employee count / funding stage?',
  'Billing address (GST-relevant) captured?'
)),
('project_id', 'Project-ID application — the centralised tracking sheet set', jsonb_build_array(
  'Organisation name (auto-filled from the company record)',
  'Priority (P0 urgent / P1 high / P2 normal / P3 low)',
  'Customer SPOC — name, designation, phone',
  'Project type: 01 R&D or 02 SCS/Manufacturing',
  'Project description — what exactly is being built or supplied',
  'Target delivery date',
  'Margin % expected',
  'Expected order value (₹)',
  'Proposed Project Manager',
  'Vendor / Production / Inventory managers (if SCS)'
)),
('boxbuild_criteria', 'Box-build RFQ acceptance criteria — all must pass', jsonb_build_array(
  'Complete BOM received (or buildable from what the client shared)',
  'Enclosure / mechanical drawings or samples received',
  'Volumes and target unit cost stated by the client',
  'Component sourcing feasibility checked (no unobtanium)',
  'Assembly & testing requirements defined',
  'Packaging and dispatch requirements stated'
))
on conflict (key) do nothing;

-- ═══ RLS — same pattern as the rest of sales ═══════════════════════════════
do $$
declare t text;
begin
  foreach t in array array['tasks','llds','question_sets'] loop
    execute format('alter table sales.%I enable row level security', t);
    if not exists (select 1 from pg_policies
                   where schemaname='sales' and tablename=t and policyname=t||'_read') then
      execute format('create policy %I on sales.%I for select to authenticated using (true)', t||'_read', t);
    end if;
    if not exists (select 1 from pg_policies
                   where schemaname='sales' and tablename=t and policyname=t||'_write') then
      execute format(
        'create policy %I on sales.%I for all to authenticated using (true) with check (true)', t||'_write', t);
    end if;
  end loop;
end $$;

grant select, insert, update, delete on sales.tasks, sales.llds, sales.question_sets to authenticated;
revoke all on sales.tasks, sales.llds, sales.question_sets from anon;

drop trigger if exists llds_touch on sales.llds;
create trigger llds_touch before update on sales.llds
  for each row execute function public.touch_updated_at();

select 'sales.tasks' as t, count(*) from sales.tasks union all
select 'sales.llds', count(*) from sales.llds union all
select 'sales.question_sets', count(*) from sales.question_sets;

-- ── PART: 13-task-gate.sql ──────────────────────────────────────────────

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

-- ── PART: 14-chats.sql ──────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- ASSISTANT CHATS — one thread per person per day, browsable date-wise.
-- Run after 10-sales-port.sql. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists sales.chats (
  id         uuid primary key default gen_random_uuid(),
  person_id  uuid not null references core.people(id) on delete cascade,
  on_date    date not null default current_date,
  messages   jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  unique (person_id, on_date)
);
alter table sales.chats enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='sales' and tablename='chats' and policyname='chats_read') then
    create policy chats_read on sales.chats for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='sales' and tablename='chats' and policyname='chats_write') then
    create policy chats_write on sales.chats for all to authenticated using (true) with check (true);
  end if;
end $$;
grant select, insert, update, delete on sales.chats to authenticated;
revoke all on sales.chats from anon;
drop trigger if exists chats_touch on sales.chats;
create trigger chats_touch before update on sales.chats
  for each row execute function public.touch_updated_at();
select 'sales.chats' as t, count(*) from sales.chats;

-- ── PART: 15-account-plan.sql ──────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- ACCOUNT PLAN — the AI-generated staged plan per company (the sales
-- equivalent of the PMS project plan). Stored on sales.org_detail. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════
alter table sales.org_detail
  add column if not exists plan jsonb not null default '{}'::jsonb;
select 'org_detail.plan' as t, count(*) from sales.org_detail;

-- ── PART: 16-company-chat.sql ──────────────────────────────────────────────

-- ═══════════════════════════════════════════════════════════════════════════
-- COMPANY CHAT — sales.chats learns an org scope: org_id null = the personal
-- Assistant thread; org_id set = that company's "Ask the AI" thread.
-- Run after 14-chats.sql. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════
alter table sales.chats
  add column if not exists org_id uuid references core.orgs(id) on delete cascade;
alter table sales.chats drop constraint if exists chats_person_id_on_date_key;
create unique index if not exists chats_person_day_key
  on sales.chats (person_id, on_date) where org_id is null;
create unique index if not exists chats_org_person_day_key
  on sales.chats (org_id, person_id, on_date) where org_id is not null;
select 'sales.chats' as t, count(*) from sales.chats;
