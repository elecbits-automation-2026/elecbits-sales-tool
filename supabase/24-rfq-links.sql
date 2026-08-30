-- ═══════════════════════════════════════════════════════════════════════════
-- THE RFQ LINK + THE 4-PHASE PIPELINE. Run after 23-pipeline-brain.sql.
-- Idempotent.
--
--   • The pipeline a salesperson sees is cold → warm → rfq → hot: the deal's
--     temperature, with `rfq` as a real phase between warm and hot.
--   • An RFQ link is a requirement-gathering page the salesperson SENDS TO
--     THE CLIENT: it shows what Elecbits will share back (Quote / LLD, with
--     effort, time and cost) and collects the client's requirement. The
--     public page reads and submits through /api/rfq (service role) — the
--     anon key gets NO grant here.
-- ═══════════════════════════════════════════════════════════════════════════

-- Normalize BEFORE constraining: older flows wrote values like 'won' into
-- deals.temperature. A closed-won deal reads as 'hot' (its phase comes from
-- stage='po' anyway); anything else unknown starts over at 'cold'.
update sales.deals
   set temperature = case when stage = 'po' then 'hot' else 'cold' end
 where temperature is not null
   and temperature not in ('cold','warm','rfq','hot');

alter table sales.deals drop constraint if exists deals_temperature_check;
alter table sales.deals add constraint deals_temperature_check
  check (temperature in ('cold','warm','rfq','hot'));

alter table sales.temperature_moves drop constraint if exists temperature_moves_to_temp_check;
alter table sales.temperature_moves add constraint temperature_moves_to_temp_check
  check (to_temp in ('cold','warm','rfq','hot','won','lost'));

create table if not exists sales.rfq_links (
  id             uuid primary key default gen_random_uuid(),  -- the link token
  org_id         uuid not null references core.orgs(id)  on delete cascade,
  deal_id        uuid references sales.deals(id)         on delete set null,
  title          text,
  -- What Elecbits offers back: [{kind:'quote'|'lld', effort:'', time:'', cost:''}]
  offer          jsonb not null default '[]'::jsonb,
  note_to_client text,
  contact_name   text,          -- who at the client this was sent to
  status         text not null default 'created'
                   check (status in ('created','opened','submitted','closed')),
  response       jsonb not null default '{}'::jsonb,   -- what the client filled
  opened_at      timestamptz,
  submitted_at   timestamptz,
  created_by     uuid references core.people(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists rfq_links_org_idx on sales.rfq_links(org_id, created_at desc);

alter table sales.rfq_links enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='sales' and tablename='rfq_links' and policyname='rfq_links_read') then
    create policy rfq_links_read on sales.rfq_links for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='sales' and tablename='rfq_links' and policyname='rfq_links_write') then
    create policy rfq_links_write on sales.rfq_links for all to authenticated using (true) with check (true);
  end if;
end $$;
grant select, insert, update, delete on sales.rfq_links to authenticated;
revoke all on sales.rfq_links from anon;   -- the public page goes through /api/rfq

select 'sales.rfq_links' as t, count(*) from sales.rfq_links;
