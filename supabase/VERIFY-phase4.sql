-- ═══════════════════════════════════════════════════════════════════════════
-- DID PHASE 4 ACTUALLY LAND? Read-only. Changes nothing. Safe to run anytime.
--
-- RUN-THIS-phase4.sql is one transaction: either all of steps 23–32 applied
-- or none did. But "I ran it" and "it committed" are different claims — a
-- paste that errored on line 400 rolls the whole thing back, and the SQL
-- editor shows the error in a pane that is easy to scroll past.
--
-- This asks the database instead. Every row should read ✓. Any ✗ means that
-- part is not there, whatever the editor said at the time.
-- ═══════════════════════════════════════════════════════════════════════════

with checks(step, object, present) as (

  -- ── 23 · pipeline brain ──────────────────────────────────────────────────
  select 23, 'table  sales.deal_stages',        to_regclass('sales.deal_stages')       is not null
  union all select 23, 'table  sales.temperature_moves', to_regclass('sales.temperature_moves') is not null
  union all select 23, 'table  sales.scrum_sessions',    to_regclass('sales.scrum_sessions')    is not null
  union all select 23, 'column deals.temperature',       to_regclass('sales.deals') is not null and exists (
    select 1 from information_schema.columns where table_schema='sales' and table_name='deals' and column_name='temperature')
  union all select 23, 'column deals.next_step',         exists (
    select 1 from information_schema.columns where table_schema='sales' and table_name='deals' and column_name='next_step')
  union all select 23, 'column requests.requirement',    exists (
    select 1 from information_schema.columns where table_schema='sales' and table_name='requests' and column_name='requirement')

  -- ── 24 · the shareable RFQ link ──────────────────────────────────────────
  union all select 24, 'table  sales.rfq_links',         to_regclass('sales.rfq_links') is not null

  -- ── 25 · service_role grants (the public RFQ page needs these) ───────────
  union all select 25, 'grant  service_role → sales',    has_schema_privilege('service_role','sales','usage')
  union all select 25, 'grant  service_role → rfq_links', to_regclass('sales.rfq_links') is not null
    and has_table_privilege('service_role','sales.rfq_links','select')

  -- ── 26 · the ULM overtake decision ───────────────────────────────────────
  union all select 26, 'column requests.overtake',       exists (
    select 1 from information_schema.columns where table_schema='sales' and table_name='requests' and column_name='overtake')

  -- ── 27 · the CAP column on Resources ─────────────────────────────────────
  union all select 27, 'column people_detail.capacity',  exists (
    select 1 from information_schema.columns where table_schema='sales' and table_name='people_detail' and column_name='capacity')

  -- ── 28 · task origins 'stage' and 'step' ─────────────────────────────────
  union all select 28, 'check  tasks_source_check allows stage/step', exists (
    select 1 from pg_constraint c join pg_class t on t.oid = c.conrelid
     join pg_namespace n on n.oid = t.relnamespace
    where n.nspname='sales' and t.relname='tasks' and c.conname='tasks_source_check'
      and pg_get_constraintdef(c.oid) like '%''step''%')

  -- ── 29 · the DMP brain ───────────────────────────────────────────────────
  union all select 29, 'table  sales.memory_chunks',     to_regclass('sales.memory_chunks') is not null
  union all select 29, 'func   sales.match_memory',      to_regproc('sales.match_memory') is not null

  -- ── 30 · SOP v2.0 ids + the save-progress intake chat ────────────────────
  union all select 30, 'table  sales.sop_counters',      to_regclass('sales.sop_counters')    is not null
  union all select 30, 'func   sales.next_sop_id',       to_regproc('sales.next_sop_id')      is not null
  union all select 30, 'table  sales.intake_sessions',   to_regclass('sales.intake_sessions') is not null

  -- ── 31 · the product name under the company name ─────────────────────────
  union all select 31, 'column deals.product',           exists (
    select 1 from information_schema.columns where table_schema='sales' and table_name='deals' and column_name='product')

  -- ── 32 · a deal's own POC and its own background ─────────────────────────
  union all select 32, 'column deals.contact_id',        exists (
    select 1 from information_schema.columns where table_schema='sales' and table_name='deals' and column_name='contact_id')
  union all select 32, 'column deals.context',           exists (
    select 1 from information_schema.columns where table_schema='sales' and table_name='deals' and column_name='context')
  union all select 32, 'func   sales.upsert_contact',    to_regproc('sales.upsert_contact') is not null
  union all select 32, 'func   sales.delete_contact',    to_regproc('sales.delete_contact') is not null
  union all select 32, 'grant  authenticated → upsert_contact', to_regproc('sales.upsert_contact') is not null
    and has_function_privilege('authenticated','sales.upsert_contact(uuid,uuid,text,text,text,text,boolean,text)','execute')
)
select case when present then '✓' else '✗  MISSING' end as ok,
       step, object
  from checks
 order by step, object;

-- ── And what is actually IN the new columns ────────────────────────────────
-- Zeroes here are not a failure: they mean the schema is ready and nobody has
-- typed anything into it yet. Product names, per-deal POCs and per-deal
-- context are all entered by hand, deal by deal.
select 'deals'                as of_these, count(*) as n from sales.deals
union all select 'with a product name',    count(*) from sales.deals where coalesce(product, '') <> ''
union all select 'with their own POC',     count(*) from sales.deals where contact_id is not null
union all select 'with their own context', count(*) from sales.deals where coalesce(context, '') <> ''
union all select 'contacts on file',       count(*) from core.contacts;
