-- ═══════════════════════════════════════════════════════════════════════════
-- CAPACITY — the ODM PMS "CAP" column, for sales. How many open deals a
-- person can carry at once; Resources shows used/max and flips the status to
-- At Capacity when used ≥ max. Editable per person by a sales admin.
-- Run any time after 10-sales-port.sql. Idempotent.
-- ═══════════════════════════════════════════════════════════════════════════

alter table sales.people_detail add column if not exists capacity int not null default 3;

select 'sales.people_detail.capacity ready' as note, count(*) as roster_rows
from sales.people_detail;
