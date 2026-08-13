-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATE — the Sales OS's eleven `sales:*` JSON blobs out of
-- public.collections into the relational core + sales schemas.
--
-- Run AFTER 10-sales-port.sql (which runs after the PMS repo's four files).
--
-- HOW PEOPLE AND ORGS ARE MATCHED (nothing existing is disturbed):
--   people  matched to core.people by lower(email); only when no row matches
--           is a new one inserted — core role 'engineer' (sales rank lives in
--           sales.people_detail, so a sales admin never gains PMS/HR admin
--           rights). Old passwords (pwHash) are dropped: login is Supabase
--           Auth now, and each person's first sign-in claims their row.
--   orgs    matched to core.orgs by lower(name); only when no row matches is
--           a new one inserted. The old EB-C-0001 pseudo-ids land in
--           sales.org_detail.legacy_cid — core.orgs.client_id stays reserved
--           for the official Eb-<industry>-<size>-<serial> IDs.
--
-- Deterministic ids — md5(old_id)::uuid — make every insert idempotent:
-- re-running updates or skips, it never duplicates.
--
-- public.collections is left untouched. It is the rollback.
-- ═══════════════════════════════════════════════════════════════════════════

create temp table if not exists person_map (old_id text primary key, person_id uuid);
create temp table if not exists org_map    (old_id text primary key, org_id uuid);

do $mig$
declare
  j_users     jsonb; j_companies jsonb; j_deals   jsonb; j_kpis    jsonb;
  j_trainings jsonb; j_worklogs  jsonb; j_know    jsonb; j_expenses jsonb;
  j_gates     jsonb; j_scrums    jsonb; j_memory  jsonb;
  u jsonb; c jsonb; d jsonb; h jsonb; a jsonb; t jsonb; w jsonb; k jsonb;
  e jsonb; s jsonb; m jsonb;
  kpi_key text; kpi_row jsonb; gate_key text;
  v_pid uuid; v_oid uuid; i int;
begin
  if to_regclass('public.collections') is null then
    raise notice 'public.collections not found — nothing to migrate.';
    return;
  end if;

  select data into j_users     from public.collections where key = 'sales:users';
  select data into j_companies from public.collections where key = 'sales:companies';
  select data into j_deals     from public.collections where key = 'sales:deals';
  select data into j_kpis      from public.collections where key = 'sales:kpis';
  select data into j_trainings from public.collections where key = 'sales:trainings';
  select data into j_worklogs  from public.collections where key = 'sales:worklogs';
  select data into j_know      from public.collections where key = 'sales:knowledge';
  select data into j_expenses  from public.collections where key = 'sales:expenses';
  select data into j_gates     from public.collections where key = 'sales:gates';
  select data into j_scrums    from public.collections where key = 'sales:scrums';
  select data into j_memory    from public.collections where key = 'sales:memory';

  -- ── 1. PEOPLE ─────────────────────────────────────────────────────────────
  for u in select * from jsonb_array_elements(coalesce(j_users, '[]'::jsonb)) loop
    v_pid := null;
    if coalesce(u->>'email','') <> '' then
      select id into v_pid from core.people
       where lower(email) = lower(u->>'email') limit 1;
    end if;
    if v_pid is null then
      v_pid := md5('sales:person:' || (u->>'id'))::uuid;
      insert into core.people (id, email, name, role, dept, color)
      values (v_pid, nullif(u->>'email',''), u->>'name', 'engineer',
              coalesce(u->>'dept','Sales'), '#2563eb')
      on conflict (id) do nothing;
    end if;
    insert into person_map values (u->>'id', v_pid) on conflict do nothing;

    insert into sales.people_detail (person_id, role, dept, active)
    values (v_pid,
            case when u->>'role' in ('admin','dept_head','agent','finance')
                 then u->>'role' else 'agent' end,
            coalesce(u->>'dept','Sales'),
            coalesce((u->>'active')::boolean, true))
    on conflict (person_id) do update
      set role = excluded.role, dept = excluded.dept, active = excluded.active;
  end loop;

  -- ── 2. ORGS ───────────────────────────────────────────────────────────────
  for c in select * from jsonb_array_elements(coalesce(j_companies, '[]'::jsonb)) loop
    select id into v_oid from core.orgs
     where lower(name) = lower(c->>'name') limit 1;
    if v_oid is null then
      v_oid := md5('sales:org:' || (c->>'id'))::uuid;
      insert into core.orgs (id, name, industry, kind, website, owner_id, active, address)
      values (v_oid, c->>'name', nullif(c->>'industry',''), 'customer',
              nullif(c->>'website',''),
              (select person_id from person_map where old_id = c->>'accountOwner'),
              true,
              case when coalesce(c->>'address','') <> ''
                   then jsonb_build_object('text', c->>'address')
                   else '{}'::jsonb end)
      on conflict (id) do nothing;
    else
      -- org already known to the company spine: only fill gaps, never overwrite
      update core.orgs
         set industry = coalesce(industry, nullif(c->>'industry','')),
             website  = coalesce(website,  nullif(c->>'website','')),
             owner_id = coalesce(owner_id,
                          (select person_id from person_map where old_id = c->>'accountOwner'))
       where id = v_oid;
    end if;
    insert into org_map values (c->>'id', v_oid) on conflict do nothing;

    insert into sales.org_detail
      (org_id, what_they_do, city, source, potential, legacy_cid,
       contact_person, designation, contact_phone, contact_email, custom)
    values (v_oid, nullif(c->>'whatTheyDo',''), nullif(c->>'city',''),
            nullif(c->>'source',''),
            coalesce((c->>'potential')::numeric, 0),
            nullif(c->>'cid',''),
            nullif(c->>'contactPerson',''), nullif(c->>'designation',''),
            nullif(c->>'phone',''), nullif(c->>'email',''),
            coalesce(c->'custom','[]'::jsonb))
    on conflict (org_id) do update
      set what_they_do = excluded.what_they_do, city = excluded.city,
          source = excluded.source, potential = excluded.potential,
          legacy_cid = coalesce(sales.org_detail.legacy_cid, excluded.legacy_cid),
          contact_person = excluded.contact_person, designation = excluded.designation,
          contact_phone = excluded.contact_phone, contact_email = excluded.contact_email,
          custom = excluded.custom;

    -- 2b. the company's activity feed → sales.org_activities
    i := 0;
    for a in select * from jsonb_array_elements(coalesce(c->'activity','[]'::jsonb)) loop
      insert into sales.org_activities (id, org_id, kind, body, author_id, at)
      values (md5('sales:act:' || (c->>'id') || ':' || i)::uuid, v_oid, 'note',
              coalesce(a->>'text',''),
              (select person_id from person_map where old_id = a->>'by'),
              coalesce((a->>'at')::timestamptz, now()))
      on conflict (id) do nothing;
      i := i + 1;
    end loop;
  end loop;

  -- ── 3. DEALS + MOVES ──────────────────────────────────────────────────────
  for d in select * from jsonb_array_elements(coalesce(j_deals, '[]'::jsonb)) loop
    select org_id into v_oid from org_map where old_id = d->>'companyId';
    if v_oid is null then
      raise notice 'deal % skipped — company % not in the blob', d->>'did', d->>'companyId';
      continue;
    end if;
    insert into sales.deals
      (id, code, org_id, owner_id, value, stage, lost, lost_note, created_at, updated_at)
    values (md5('sales:deal:' || (d->>'id'))::uuid,
            coalesce(nullif(d->>'did',''), 'EB-D-' || left(d->>'id', 6)),
            v_oid,
            (select person_id from person_map where old_id = d->>'ownerId'),
            coalesce((d->>'value')::numeric, 0),
            case when d->>'stage' in ('lead','first_meeting','physical_meeting','rfq',
                                      'project_id','pm_added','quote_lld','negotiation',
                                      'closure','po')
                 then d->>'stage' else 'lead' end,
            coalesce((d->>'lost')::boolean, false),
            nullif(d->'lostInfo'->>'summary',''),
            coalesce((d->>'createdAt')::timestamptz, now()),
            coalesce((d->>'updatedAt')::timestamptz, now()))
    on conflict (code) do update
      set stage = excluded.stage, value = excluded.value, lost = excluded.lost,
          lost_note = excluded.lost_note, updated_at = excluded.updated_at;

    i := 0;
    for h in select * from jsonb_array_elements(coalesce(d->'history','[]'::jsonb)) loop
      insert into sales.deal_moves
        (id, deal_id, from_stage, to_stage, summary, facts, risks, next_action,
         transcript, gated, forced, author_id, at)
      values (md5('sales:move:' || (d->>'id') || ':' || i)::uuid,
              md5('sales:deal:' || (d->>'id'))::uuid,
              h->>'from', h->>'to', h->>'summary',
              coalesce(h->'facts','{}'::jsonb),
              coalesce(h->'risks','[]'::jsonb),
              coalesce(h->>'next_action', h->>'nextAction'),
              coalesce(h->'transcript','[]'::jsonb),
              coalesce((h->>'gated')::boolean, false),
              coalesce((h->>'forced')::boolean, false),
              (select person_id from person_map where old_id = h->>'by'),
              coalesce((h->>'at')::timestamptz, now()))
      on conflict (id) do nothing;
      i := i + 1;
    end loop;
  end loop;

  -- ── 4. KPI TARGETS ────────────────────────────────────────────────────────
  -- The blob is one standing set per person (applied monthly); period 'default'.
  for kpi_key, kpi_row in select * from jsonb_each(coalesce(j_kpis, '{}'::jsonb)) loop
    select person_id into v_pid from person_map where old_id = kpi_key;
    if v_pid is null then continue; end if;
    insert into sales.targets (person_id, period, metric, target)
    select v_pid, 'default', m.key, coalesce((kpi_row->>m.key)::numeric, 0)
      from (values ('companies'),('meetings'),('rfqs'),('quotes'),
                   ('pos'),('revenue'),('completeness')) as m(key)
     where kpi_row ? m.key
    on conflict (person_id, period, metric) do update set target = excluded.target;
  end loop;

  -- ── 5. KNOWLEDGE ──────────────────────────────────────────────────────────
  for k in select * from jsonb_array_elements(coalesce(j_know, '[]'::jsonb)) loop
    insert into sales.knowledge (id, title, content, access, created_by, updated_at)
    values (md5('sales:know:' || (k->>'id'))::uuid,
            coalesce(k->>'title','Untitled'), coalesce(k->>'content',''),
            case when k->>'access' in ('all','leadership','admin')
                 then k->>'access' else 'all' end,
            (select person_id from person_map where old_id = k->>'createdBy'),
            coalesce((k->>'updatedAt')::timestamptz, now()))
    on conflict (id) do update
      set title = excluded.title, content = excluded.content,
          access = excluded.access, updated_at = excluded.updated_at;
  end loop;

  -- ── 6. TRAININGS → core.trainings ─────────────────────────────────────────
  -- resource carries the migrated knowledge uuid (as text) so the app keeps
  -- the training ↔ knowledge link.
  for t in select * from jsonb_array_elements(coalesce(j_trainings, '[]'::jsonb)) loop
    select person_id into v_pid from person_map where old_id = t->>'assignedTo';
    if v_pid is null then continue; end if;
    insert into core.trainings (id, user_id, title, resource, due, status, assigned_by)
    values (md5('sales:train:' || (t->>'id'))::uuid, v_pid,
            coalesce(t->>'title','Training'),
            case when coalesce(t->>'knowledgeId','') <> ''
                 then (md5('sales:know:' || (t->>'knowledgeId'))::uuid)::text
                 else null end,
            (t->>'due')::date,
            coalesce(t->>'status','assigned'),
            (select person_id from person_map where old_id = t->>'assignedBy'))
    on conflict (id) do update
      set title = excluded.title, resource = excluded.resource,
          due = excluded.due, status = excluded.status;
  end loop;

  -- ── 7. WORK UPDATES ───────────────────────────────────────────────────────
  for w in select * from jsonb_array_elements(coalesce(j_worklogs, '[]'::jsonb)) loop
    select person_id into v_pid from person_map where old_id = w->>'userId';
    if v_pid is null or coalesce(w->>'date','') = '' then continue; end if;
    insert into sales.work_updates (id, person_id, on_date, note)
    values (md5('sales:log:' || (w->>'id'))::uuid, v_pid, (w->>'date')::date,
            trim(coalesce(nullif(w->>'progress',''), '') ||
              case when coalesce(w->>'companiesWorked','') <> ''
                   then E'\nCompanies: ' || (w->>'companiesWorked') else '' end ||
              case when coalesce(w->>'blockers','') <> ''
                   then E'\nBlockers: ' || (w->>'blockers') else '' end ||
              case when coalesce(w->>'next','') <> ''
                   then E'\nNext: ' || (w->>'next') else '' end))
    on conflict (person_id, on_date) do update set note = excluded.note;
  end loop;

  -- ── 8. TRAVEL / EXPENSES ──────────────────────────────────────────────────
  for e in select * from jsonb_array_elements(coalesce(j_expenses, '[]'::jsonb)) loop
    select person_id into v_pid from person_map where old_id = e->>'userId';
    if v_pid is null then continue; end if;
    insert into sales.travel_requests
      (id, person_id, org_id, purpose, city, from_date, to_date, mode,
       estimate, notes, status, decided_by, decision_note, created_at)
    values (md5('sales:exp:' || (e->>'id'))::uuid, v_pid,
            (select org_id from org_map where old_id = e->>'companyId'),
            coalesce(e->>'purpose',''), nullif(e->>'city',''),
            (nullif(e->>'from',''))::date, (nullif(e->>'to',''))::date,
            nullif(e->>'mode',''),
            coalesce((e->>'estimate')::numeric, 0), nullif(e->>'notes',''),
            case when e->>'status' in ('pending','approved','rejected')
                 then e->>'status' else 'pending' end,
            (select person_id from person_map where old_id = e->>'decidedBy'),
            nullif(e->>'decisionNote',''),
            coalesce((e->>'createdAt')::timestamptz, now()))
    on conflict (id) do update
      set status = excluded.status, decided_by = excluded.decided_by,
          decision_note = excluded.decision_note;
  end loop;

  -- ── 9. SCRUM NOTES ────────────────────────────────────────────────────────
  for s in select * from jsonb_array_elements(coalesce(j_scrums, '[]'::jsonb)) loop
    insert into sales.scrum_notes (id, on_date, raw, organized, author_id, created_at)
    values (md5('sales:scrum:' || (s->>'id'))::uuid,
            coalesce((nullif(s->>'date',''))::date, current_date),
            coalesce(s->>'raw',''),
            jsonb_build_object('tasks', coalesce(s->'tasks','[]'::jsonb),
                               'summary', coalesce(s->>'summary','')),
            (select person_id from person_map where old_id = s->>'userId'),
            coalesce((s->>'createdAt')::timestamptz, now()))
    on conflict (id) do update
      set raw = excluded.raw, organized = excluded.organized;
  end loop;

  -- ── 10. SYSTEM MEMORY (sales-scoped) ──────────────────────────────────────
  for m in select * from jsonb_array_elements(coalesce(j_memory, '[]'::jsonb)) loop
    insert into sales.memory (id, title, content, created_by, updated_at)
    values (md5('sales:mem:' || (m->>'id'))::uuid,
            coalesce(m->>'title','Note'), coalesce(m->>'text',''),
            (select person_id from person_map where old_id = m->>'by'),
            coalesce((m->>'updatedAt')::timestamptz, now()))
    on conflict (id) do update
      set title = excluded.title, content = excluded.content,
          updated_at = excluded.updated_at;
  end loop;

  -- ── 11. GATE CONFIG ───────────────────────────────────────────────────────
  for gate_key in select jsonb_object_keys(coalesce(j_gates, '{}'::jsonb)) loop
    if gate_key in ('lead','first_meeting','physical_meeting','rfq','project_id',
                    'pm_added','quote_lld','negotiation','closure','po') then
      insert into sales.gate_config (stage, requirements)
      values (gate_key, coalesce(j_gates->gate_key, '[]'::jsonb))
      on conflict (stage) do update set requirements = excluded.requirements;
    end if;
  end loop;

  raise notice 'Migration pass complete.';
end $mig$;

drop table if exists person_map;
drop table if exists org_map;

-- ═══ THE REPORT — send these numbers back ═══════════════════════════════════
select 'core.people'           as t, count(*) from core.people            union all
select 'sales.people_detail',        count(*) from sales.people_detail    union all
select 'core.orgs',                  count(*) from core.orgs              union all
select 'sales.org_detail',           count(*) from sales.org_detail       union all
select 'sales.deals',                count(*) from sales.deals            union all
select 'sales.deal_moves',           count(*) from sales.deal_moves       union all
select 'sales.org_activities',       count(*) from sales.org_activities   union all
select 'sales.targets',              count(*) from sales.targets          union all
select 'sales.knowledge',            count(*) from sales.knowledge        union all
select 'core.trainings',             count(*) from core.trainings         union all
select 'sales.work_updates',         count(*) from sales.work_updates     union all
select 'sales.travel_requests',      count(*) from sales.travel_requests  union all
select 'sales.scrum_notes',          count(*) from sales.scrum_notes      union all
select 'sales.memory',               count(*) from sales.memory           union all
select 'sales.gate_config',          count(*) from sales.gate_config
order by 1;
