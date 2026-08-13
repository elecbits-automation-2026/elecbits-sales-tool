-- ═══════════════════════════════════════════════════════════════════════════
-- eb-core-database-1 · STAGE 2 for Sales — blobs → relational
--
-- Parses the nine sales:* JSON blobs in public.collections into core.* and
-- sales.*, and merges the PMS roster (public.profiles) into core.people.
--
-- Run AFTER 01-core-schema.sql and 02-sales-schema.sql, in the SQL editor.
-- Idempotent: every insert is keyed on a DETERMINISTIC uuid derived from the
-- old text id (md5(old_id)::uuid), so re-running while the app is still live
-- on the blob updates rows instead of duplicating them. public.collections is
-- left untouched — it is the rollback until the cut-over is confirmed.
-- ═══════════════════════════════════════════════════════════════════════════

-- Convenience: the blob for a key, or an empty array/object.
create or replace function pg_temp.blob(_key text, _empty jsonb default '[]'::jsonb)
returns jsonb language sql stable as $$
  select coalesce((select data from public.collections where key = _key), _empty);
$$;

-- Person-FK resolver: the migrated uuid for an old text id, but only if that
-- person actually exists — otherwise null, so a stale reference in a blob
-- becomes a null FK instead of aborting the whole migration.
create or replace function pg_temp.pid(_t text)
returns uuid language sql stable as $$
  select p.id from core.people p
  where _t is not null and _t <> '' and p.id = md5(_t)::uuid;
$$;

-- ═══ 1. PEOPLE ═════════════════════════════════════════════════════════════
-- sales:users → core.people + sales.people_detail + core.grants
insert into core.people (id, full_name, work_email, kind, status)
select md5(u->>'id')::uuid,
       coalesce(nullif(u->>'name',''), split_part(coalesce(u->>'email','?'),'@',1)),
       nullif(lower(coalesce(u->>'email','')), '')::citext,
       'employee',
       case when coalesce((u->>'active')::boolean, true) then 'active' else 'exited' end
from jsonb_array_elements(pg_temp.blob('sales:users')) u
on conflict (id) do update
  set full_name = excluded.full_name,
      work_email = excluded.work_email,
      status = excluded.status;

insert into sales.people_detail (person_id, role, dept)
select md5(u->>'id')::uuid,
       case when u->>'role' in ('admin','dept_head','agent','finance')
            then u->>'role' else 'agent' end,
       coalesce(nullif(u->>'dept',''), 'Sales')
from jsonb_array_elements(pg_temp.blob('sales:users')) u
on conflict (person_id) do update set role = excluded.role, dept = excluded.dept;

-- Grants: the DB-level lock. Admin → admin on core+sales; everyone else write.
insert into core.grants (person_id, tool, level)
select md5(u->>'id')::uuid, t.tool,
       case when u->>'role' = 'admin' then 'admin' else 'write' end
from jsonb_array_elements(pg_temp.blob('sales:users')) u
cross join (values ('core'),('sales')) as t(tool)
on conflict (person_id, tool) do update set level = excluded.level;

-- Merge the PMS roster (if the PMS tables live in this database).
-- profiles.id IS the auth.users id, so it becomes auth_id here.
do $$
begin
  if to_regclass('public.profiles') is not null then
    -- Same human already migrated from the sales blob: link their auth account.
    execute $m$
      update core.people p
         set auth_id = pr.id
        from public.profiles pr
       where p.auth_id is null and pr.email is not null
         and lower(p.work_email::text) = lower(pr.email)
         and not exists (select 1 from core.people x where x.auth_id = pr.id)
    $m$;
    -- PMS-only humans: add them to the shared roster (no sales.people_detail
    -- row, so they do not appear inside the Sales UI).
    execute $m$
      insert into core.people (id, full_name, work_email, auth_id, kind, status)
      select md5('pms:' || pr.id::text)::uuid,
             coalesce(nullif(pr.name,''), split_part(coalesce(pr.email,'?'),'@',1)),
             nullif(lower(coalesce(pr.email,'')),'')::citext,
             pr.id, 'employee', 'active'
        from public.profiles pr
       where pr.email is null
          or not exists (select 1 from core.people p
                          where lower(p.work_email::text) = lower(pr.email))
      on conflict (id) do nothing
    $m$;
  end if;
end $$;

-- ═══ 2. COMPANIES → orgs / roles / contacts / org_detail / activities ══════
insert into core.orgs (id, code, name, website, status)
select md5(c->>'id')::uuid,
       nullif(c->>'cid',''),
       coalesce(nullif(c->>'name',''), '(unnamed)'),
       nullif(c->>'website',''),
       'active'
from jsonb_array_elements(pg_temp.blob('sales:companies')) c
on conflict (id) do update
  set code = excluded.code, name = excluded.name, website = excluded.website;

insert into core.org_roles (org_id, role)
select md5(c->>'id')::uuid, 'prospect'
from jsonb_array_elements(pg_temp.blob('sales:companies')) c
on conflict (org_id, role) do nothing;

insert into core.contacts (id, org_id, name, title, email, phone, is_primary)
select md5((c->>'id') || ':contact')::uuid,
       md5(c->>'id')::uuid,
       c->>'contactPerson',
       nullif(c->>'designation',''),
       nullif(lower(coalesce(c->>'email','')),'')::citext,
       nullif(c->>'phone',''),
       true
from jsonb_array_elements(pg_temp.blob('sales:companies')) c
where nullif(c->>'contactPerson','') is not null
on conflict (id) do update
  set name = excluded.name, title = excluded.title,
      email = excluded.email, phone = excluded.phone;

insert into sales.org_detail
  (org_id, what_they_do, industry, city, address, source, potential,
   account_owner, contact_person, designation, contact_phone, contact_email,
   custom, created_at)
select md5(c->>'id')::uuid,
       nullif(c->>'whatTheyDo',''),
       nullif(c->>'industry',''),
       nullif(c->>'city',''),
       nullif(c->>'address',''),
       nullif(c->>'source',''),
       coalesce(nullif(c->>'potential','')::numeric, 0),
       pg_temp.pid(c->>'accountOwner'),
       nullif(c->>'contactPerson',''),
       nullif(c->>'designation',''),
       nullif(c->>'phone',''),
       nullif(c->>'email',''),
       coalesce(c->'custom','[]'::jsonb),
       coalesce(nullif(c->>'createdAt','')::timestamptz, now())
from jsonb_array_elements(pg_temp.blob('sales:companies')) c
on conflict (org_id) do update
  set what_they_do = excluded.what_they_do, industry = excluded.industry,
      city = excluded.city, address = excluded.address, source = excluded.source,
      potential = excluded.potential, account_owner = excluded.account_owner,
      contact_person = excluded.contact_person, designation = excluded.designation,
      contact_phone = excluded.contact_phone, contact_email = excluded.contact_email,
      custom = excluded.custom;

-- Company activity notes (deterministic id ⇒ re-runs never duplicate)
insert into sales.activities (id, org_id, kind, body, by, at)
select md5((c->>'id') || (a->>'at') || left(coalesce(a->>'text',''),80))::uuid,
       md5(c->>'id')::uuid, 'note',
       coalesce(a->>'text',''),
       pg_temp.pid(a->>'by'),
       coalesce(nullif(a->>'at','')::timestamptz, now())
from jsonb_array_elements(pg_temp.blob('sales:companies')) c,
     jsonb_array_elements(coalesce(c->'activity','[]'::jsonb)) a
where nullif(a->>'text','') is not null
on conflict (id) do nothing;

-- ═══ 3. DEALS + HISTORY ════════════════════════════════════════════════════
insert into sales.deals
  (id, code, org_id, owner_id, value, stage, lost, lost_note, created_at, updated_at)
select md5(d->>'id')::uuid,
       coalesce(nullif(d->>'did',''), 'EB-D-' || left(md5(d->>'id'), 6)),
       md5(d->>'companyId')::uuid,
       pg_temp.pid(d->>'ownerId'),
       coalesce(nullif(d->>'value','')::numeric, 0),
       case when d->>'stage' in ('lead','first_meeting','physical_meeting','rfq',
                                 'project_id','pm_added','quote_lld','negotiation',
                                 'closure','po')
            then d->>'stage' else 'lead' end,
       coalesce((d->>'lost')::boolean, false),
       d->'lostInfo'->>'summary',
       coalesce(nullif(d->>'createdAt','')::timestamptz, now()),
       coalesce(nullif(d->>'updatedAt','')::timestamptz, now())
from jsonb_array_elements(pg_temp.blob('sales:deals')) d
where exists (select 1 from core.orgs o where o.id = md5(d->>'companyId')::uuid)
on conflict (id) do update
  set org_id = excluded.org_id, owner_id = excluded.owner_id,
      value = excluded.value, stage = excluded.stage, lost = excluded.lost,
      lost_note = excluded.lost_note, updated_at = excluded.updated_at;

insert into sales.deal_moves
  (id, deal_id, from_stage, to_stage, summary, facts, risks, next_action,
   transcript, gated, forced, by, at)
select md5((d->>'id') || coalesce(h->>'at','') || coalesce(h->>'to','')
           || left(coalesce(h->>'summary',''),80))::uuid,
       md5(d->>'id')::uuid,
       h->>'from', h->>'to',
       h->>'summary',
       coalesce(h->'facts','{}'::jsonb),
       coalesce(h->'risks','[]'::jsonb),
       h->>'next_action',
       coalesce(h->'transcript','[]'::jsonb),
       coalesce((h->>'gated')::boolean, false),
       coalesce((h->>'forced')::boolean, false),
       pg_temp.pid(h->>'by'),
       coalesce(nullif(h->>'at','')::timestamptz, now())
from jsonb_array_elements(pg_temp.blob('sales:deals')) d,
     jsonb_array_elements(coalesce(d->'history','[]'::jsonb)) h
where exists (select 1 from sales.deals sd where sd.id = md5(d->>'id')::uuid)
on conflict (id) do nothing;

-- ═══ 4. KPI TARGETS (current month) ════════════════════════════════════════
insert into sales.targets (id, person_id, period, metric, target)
select md5(kv.key || m.key || to_char(now(),'YYYY-MM'))::uuid,
       md5(kv.key)::uuid,
       to_char(now(),'YYYY-MM'),
       m.key,
       coalesce(nullif(m.value,'')::numeric, 0)
from jsonb_each(pg_temp.blob('sales:kpis','{}'::jsonb)) kv,
     jsonb_each_text(kv.value) m
where m.key in ('companies','meetings','rfqs','quotes','pos','revenue','completeness')
  and exists (select 1 from core.people p where p.id = md5(kv.key)::uuid)
on conflict (person_id, period, metric) do update set target = excluded.target;

-- ═══ 5. KNOWLEDGE (before trainings, which reference it) ═══════════════════
insert into sales.knowledge (id, title, content, access, created_by, updated_at)
select md5(k->>'id')::uuid,
       coalesce(nullif(k->>'title',''),'(untitled)'),
       coalesce(k->>'content',''),
       case when k->>'access' in ('all','leadership','admin') then k->>'access' else 'all' end,
       pg_temp.pid(k->>'createdBy'),
       coalesce(nullif(k->>'updatedAt','')::timestamptz, now())
from jsonb_array_elements(pg_temp.blob('sales:knowledge')) k
on conflict (id) do update
  set title = excluded.title, content = excluded.content, access = excluded.access;

-- ═══ 6. TRAININGS ══════════════════════════════════════════════════════════
insert into sales.trainings (id, person_id, title, knowledge_id, due, status, assigned_by)
select md5(t->>'id')::uuid,
       md5(t->>'assignedTo')::uuid,
       coalesce(nullif(t->>'title',''),'(untitled)'),
       (select k.id from sales.knowledge k where k.id = md5(t->>'knowledgeId')::uuid),
       nullif(t->>'due','')::date,
       case when t->>'status' in ('assigned','in_progress','done') then t->>'status' else 'assigned' end,
       pg_temp.pid(t->>'assignedBy')
from jsonb_array_elements(pg_temp.blob('sales:trainings')) t
where exists (select 1 from core.people p where p.id = md5(t->>'assignedTo')::uuid)
on conflict (id) do update
  set title = excluded.title, due = excluded.due, status = excluded.status;

-- ═══ 7. WORK UPDATES ═══════════════════════════════════════════════════════
-- The open-ended doc; older structured fields fold into the note.
insert into sales.work_updates (id, person_id, on_date, note, created_at)
select md5(w->>'id')::uuid,
       md5(w->>'userId')::uuid,
       nullif(w->>'date','')::date,
       concat_ws(E'\n\n',
         nullif(w->>'progress',''),
         case when nullif(w->>'blockers','') is not null then 'Blockers: ' || (w->>'blockers') end,
         case when nullif(w->>'next','') is not null then 'Next: ' || (w->>'next') end,
         case when nullif(w->>'companiesWorked','') is not null then 'Companies: ' || (w->>'companiesWorked') end),
       now()
from jsonb_array_elements(pg_temp.blob('sales:worklogs')) w
where nullif(w->>'date','') is not null
  and exists (select 1 from core.people p where p.id = md5(w->>'userId')::uuid)
on conflict (person_id, on_date) do update set note = excluded.note;

-- ═══ 8. EXPENSES → travel_requests ═════════════════════════════════════════
insert into sales.travel_requests
  (id, person_id, org_id, purpose, city, from_date, to_date, mode, estimate,
   notes, status, decided_by, decided_at, decision_note, created_at)
select md5(e->>'id')::uuid,
       md5(e->>'userId')::uuid,
       (select o.id from core.orgs o where o.id = md5(e->>'companyId')::uuid),
       coalesce(nullif(e->>'purpose',''),'(no purpose)'),
       nullif(e->>'city',''),
       nullif(e->>'from','')::date,
       nullif(e->>'to','')::date,
       nullif(e->>'mode',''),
       coalesce(nullif(e->>'estimate','')::numeric, 0),
       nullif(e->>'notes',''),
       case when e->>'status' in ('pending','approved','rejected') then e->>'status' else 'pending' end,
       pg_temp.pid(e->>'decidedBy'),
       nullif(e->>'decidedAt','')::timestamptz,
       nullif(e->>'decisionNote',''),
       coalesce(nullif(e->>'createdAt','')::timestamptz, now())
from jsonb_array_elements(pg_temp.blob('sales:expenses')) e
where exists (select 1 from core.people p where p.id = md5(e->>'userId')::uuid)
on conflict (id) do update
  set status = excluded.status, decided_by = excluded.decided_by,
      decided_at = excluded.decided_at, decision_note = excluded.decision_note;

-- ═══ 9. SCRUM NOTES ════════════════════════════════════════════════════════
insert into sales.scrum_notes (id, on_date, raw, organized, by, created_at)
select md5(s->>'id')::uuid,
       coalesce(nullif(s->>'date','')::date, current_date),
       coalesce(s->>'raw',''),
       jsonb_build_object('tasks', coalesce(s->'tasks','[]'::jsonb),
                          'summary', coalesce(s->>'summary','')),
       pg_temp.pid(s->>'userId'),
       coalesce(nullif(s->>'createdAt','')::timestamptz, now())
from jsonb_array_elements(pg_temp.blob('sales:scrums')) s
on conflict (id) do nothing;

-- ═══ 10. MEMORY → core.memory (scope 'sales') ══════════════════════════════
insert into core.memory (id, scope, title, content, created_by, updated_at)
select md5(m->>'id')::uuid, 'sales',
       coalesce(nullif(m->>'title',''),'(untitled)'),
       coalesce(m->>'text',''),
       pg_temp.pid(m->>'by'),
       coalesce(nullif(m->>'updatedAt','')::timestamptz, now())
from jsonb_array_elements(pg_temp.blob('sales:memory'))  m
on conflict (id) do update
  set title = excluded.title, content = excluded.content, updated_at = excluded.updated_at;

-- ═══ 11. GATE CONFIG ═══════════════════════════════════════════════════════
insert into sales.gate_config (stage, requirements)
select g.key, g.value
from jsonb_each(pg_temp.blob('sales:gates','{}'::jsonb)) g
where g.key in ('lead','first_meeting','physical_meeting','rfq','project_id',
                'pm_added','quote_lld','negotiation','closure','po')
  and jsonb_typeof(g.value) = 'array'
on conflict (stage) do update set requirements = excluded.requirements;

-- ═══ SANITY REPORT ═════════════════════════════════════════════════════════
select 'core.people'        as t, count(*) from core.people
union all select 'sales.people_detail',  count(*) from sales.people_detail
union all select 'core.grants',          count(*) from core.grants
union all select 'core.orgs',            count(*) from core.orgs
union all select 'core.contacts',        count(*) from core.contacts
union all select 'sales.org_detail',     count(*) from sales.org_detail
union all select 'sales.activities',     count(*) from sales.activities
union all select 'sales.deals',          count(*) from sales.deals
union all select 'sales.deal_moves',     count(*) from sales.deal_moves
union all select 'sales.targets',        count(*) from sales.targets
union all select 'sales.knowledge',      count(*) from sales.knowledge
union all select 'sales.trainings',      count(*) from sales.trainings
union all select 'sales.work_updates',   count(*) from sales.work_updates
union all select 'sales.travel_requests',count(*) from sales.travel_requests
union all select 'sales.scrum_notes',    count(*) from sales.scrum_notes
union all select 'core.memory',          count(*) from core.memory
union all select 'sales.gate_config',    count(*) from sales.gate_config
order by 1;
