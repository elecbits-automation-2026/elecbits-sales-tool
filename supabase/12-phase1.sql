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
