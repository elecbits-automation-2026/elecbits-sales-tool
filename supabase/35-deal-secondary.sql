-- ═══════════════════════════════════════════════════════════════════════════
-- TWO PEOPLE ON A DEAL: a primary and a secondary.
-- Run after 32-deal-contacts.sql. Idempotent. Safe to re-run.
--
-- A deal has had exactly one owner since the beginning, and the pipeline
-- shows you the deals whose owner is you. That is correct for who is
-- ACCOUNTABLE and wrong for who is INVOLVED: the moment a second person is
-- genuinely working an account — a junior shadowing a senior, a handover in
-- progress, two people splitting a large client — one of them cannot see the
-- deal at all. Not "sees it read-only": it is absent from their board.
--
-- So: a second person on the row.
--
--   owner_id            PRIMARY — the person who brought the deal in and is
--                       answerable for it. Unchanged, still the one who
--                       carries it for capacity, for the stale-deal nag and
--                       for every report that asks "whose deal is this".
--   secondary_owner_id  SECONDARY — also working it, and therefore it is on
--                       their board too.
--
-- WHAT THIS IS NOT. It is not a permission grant. Every sales table is
-- `for select to authenticated using (true)` — any signed-in teammate can
-- already read every deal in the database, and the pipeline's "Everyone"
-- toggle shows them. This column decides whose board a deal appears on by
-- default, which is a question about attention, not about secrecy. If deal
-- confidentiality is ever actually wanted, it is an RLS change, and this
-- column would be an input to it rather than the mechanism.
--
-- `on delete set null` matches owner_id: removing somebody from core.people
-- must not take the deal with them. A deal that loses its secondary is still
-- a deal; a deal that loses its primary shows as unassigned and can be
-- claimed in the Deal Room.
-- ═══════════════════════════════════════════════════════════════════════════

alter table sales.deals
  add column if not exists secondary_owner_id uuid references core.people(id) on delete set null;

comment on column sales.deals.secondary_owner_id is
  'The second person working this deal. Primary (owner_id) is accountable and
   carries it for capacity and the stale nag; secondary is involved, and the
   deal shows on their board too. Not a permission — every signed-in user can
   already read every deal; this decides whose board it lands on.';

-- The pipeline asks "which deals are mine" as owner_id = me OR
-- secondary_owner_id = me. The first half has had an index since 10; without
-- the second the OR degrades to a scan once the table is big enough to care.
create index if not exists deals_secondary_owner_idx
  on sales.deals(secondary_owner_id) where secondary_owner_id is not null;

-- Nobody is their own second pair of eyes. Allowing it would make a deal
-- count twice for one person in anything that unions the two columns, and it
-- means nothing in the real world either.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'deals_secondary_not_primary') then
    alter table sales.deals add constraint deals_secondary_not_primary
      check (secondary_owner_id is null or secondary_owner_id is distinct from owner_id);
  end if;
end $$;

select 'deals'                      as t, count(*)::text as n from sales.deals
union all select 'with a secondary', count(*)::text from sales.deals where secondary_owner_id is not null;
