-- ═══════════════════════════════════════════════════════════════════════════
-- SERVICE-ROLE GRANTS — the public RFQ page's error, fixed at the root.
--
-- /api/rfq talks to PostgREST with the service role. That role bypasses RLS
-- but still needs plain Postgres USAGE on a schema — and `sales`/`core` were
-- created by SQL scripts that granted usage only to `authenticated`, so the
-- public page died with "permission denied for schema sales".
-- Run after 24-rfq-links.sql. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

grant usage on schema sales to service_role;
grant usage on schema core  to service_role;
grant all    on all tables    in schema sales to service_role;
grant select on all tables    in schema core  to service_role;
grant usage  on all sequences in schema sales to service_role;
alter default privileges in schema sales grant all on tables to service_role;

select 'service_role can now reach' as note, count(*) as sales_tables
from information_schema.tables where table_schema = 'sales';
