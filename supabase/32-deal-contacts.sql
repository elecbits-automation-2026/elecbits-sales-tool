-- ═══════════════════════════════════════════════════════════════════════════
-- A DEAL'S OWN PEOPLE AND ITS OWN BACKGROUND. Run after 31-deal-product.sql.
-- Idempotent.
--
-- One company, several projects, different people on each: the R&D lead on
-- the patient monitor is not the procurement manager on the repeat order.
-- Until now the tool held exactly ONE contact per company
-- (sales.org_detail.contact_person and friends), so every deal on an account
-- showed the same name, and there was nowhere to say who this project's
-- person actually is.
--
-- core.contacts has been sitting here since phase 0 for exactly this —
-- many people per org, one flagged primary — and org_detail's own comment
-- says it is "canonical from Phase 1". This is Phase 1 for contacts.
--
--   • deals.contact_id  → which of the company's people owns THIS project
--   • deals.context     → what this project is, in the salesperson's words;
--                         the AI reads it so it stops describing a sibling
--                         project when asked about this one
--
-- The existing single contact is copied into core.contacts as each org's
-- primary, so nothing is lost and nobody has to retype. org_detail keeps its
-- columns: they stay the company-wide default for correspondence that is not
-- about one project.
-- ═══════════════════════════════════════════════════════════════════════════

alter table sales.deals add column if not exists contact_id uuid
  references core.contacts(id) on delete set null;
alter table sales.deals add column if not exists context text;

create index if not exists deals_contact_idx on sales.deals(contact_id);

comment on column sales.deals.contact_id is
  'The client-side person for THIS deal, from core.contacts. Null means fall
   back to the company primary — correct for a company with one project.';
comment on column sales.deals.context is
  'What this project is, in the salesperson''s own words. Read by every
   deal-level AI prompt so a company with several projects does not get
   answers about the wrong one.';

-- Backfill: the company's existing single contact becomes its primary in
-- core.contacts. Only for orgs that have no contact rows at all, so re-runs
-- and any contacts the PMS created are left alone.
insert into core.contacts (org_id, name, role, email, phone, is_primary, notes)
select d.org_id,
       nullif(btrim(d.contact_person), ''),
       nullif(btrim(d.designation), ''),
       nullif(btrim(d.contact_email), ''),
       nullif(btrim(d.contact_phone), ''),
       true,
       'Carried over from the company record when per-deal contacts arrived.'
  from sales.org_detail d
 where nullif(btrim(d.contact_person), '') is not null
   and not exists (select 1 from core.contacts c where c.org_id = d.org_id);

-- ── WRITING TO core.contacts ───────────────────────────────────────────────
-- core is the company's, not this tool's: it is SELECT-only for `authenticated`
-- ("writes belong to the tool that owns the row, granted per tool as each one
-- ships" — phase 0, part 5). So sales writes contacts the same way it writes
-- the roster: through a SECURITY DEFINER function it owns, never by opening
-- the shared table up. Any signed-in sales user may manage a client's
-- contacts; that is ordinary account work, not an admin act.

create or replace function sales.upsert_contact(
  p_id      uuid,
  p_org     uuid,
  p_name    text,
  p_role    text    default null,
  p_email   text    default null,
  p_phone   text    default null,
  p_primary boolean default false,
  p_notes   text    default null
) returns uuid
language plpgsql security definer set search_path = core, sales, public as $$
declare v_id uuid;
begin
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'a contact needs a name';
  end if;
  if not exists (select 1 from core.orgs o where o.id = p_org) then
    raise exception 'no such company';
  end if;

  -- One primary per org is a unique partial index; stand the old one down
  -- first so promoting a new primary is not a constraint violation.
  if p_primary then
    update core.contacts set is_primary = false
     where org_id = p_org and is_primary and (p_id is null or id <> p_id);
  end if;

  if p_id is null then
    insert into core.contacts (org_id, name, role, email, phone, is_primary, notes)
    values (p_org, btrim(p_name), nullif(btrim(p_role), ''), nullif(btrim(p_email), ''),
            nullif(btrim(p_phone), ''), coalesce(p_primary, false), nullif(btrim(p_notes), ''))
    returning id into v_id;
  else
    update core.contacts
       set name       = btrim(p_name),
           role       = nullif(btrim(p_role), ''),
           email      = nullif(btrim(p_email), ''),
           phone      = nullif(btrim(p_phone), ''),
           is_primary = coalesce(p_primary, false),
           notes      = nullif(btrim(p_notes), '')
     where id = p_id and org_id = p_org
    returning id into v_id;
    if v_id is null then raise exception 'no such contact on this company'; end if;
  end if;
  return v_id;
end $$;

-- Deleting a contact leaves every deal that pointed at it intact: the FK is
-- ON DELETE SET NULL, so those deals fall back to the company primary.
create or replace function sales.delete_contact(p_id uuid, p_org uuid)
returns boolean
language plpgsql security definer set search_path = core, sales, public as $$
begin
  delete from core.contacts where id = p_id and org_id = p_org;
  return found;
end $$;

revoke all on function sales.upsert_contact(uuid,uuid,text,text,text,text,boolean,text) from public, anon;
revoke all on function sales.delete_contact(uuid,uuid) from public, anon;
grant execute on function sales.upsert_contact(uuid,uuid,text,text,text,text,boolean,text) to authenticated;
grant execute on function sales.delete_contact(uuid,uuid) to authenticated;

select 'core.contacts'      as t, count(*) from core.contacts
union all
select 'deals with a contact', count(*) from sales.deals where contact_id is not null
union all
select 'deals with context',   count(*) from sales.deals where context is not null and context <> '';
