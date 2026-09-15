-- ═══════════════════════════════════════════════════════════════════════════
-- WHAT THE DEAL IS FOR. Run after 30-sop-ids.sql. Idempotent.
--
-- One company can have several deals running at once — a pilot, a repeat
-- order, a different product line. On a board they all render as the same
-- company name, and the only thing telling them apart is the deal code,
-- which nobody reads as meaning. `product` is the two or three words a
-- salesperson would actually say: "patient monitor", "BLDC controller".
--
-- Deliberately free text and deliberately short: it is a label for humans
-- scanning a column, not a taxonomy. Nothing branches on it.
-- ═══════════════════════════════════════════════════════════════════════════

alter table sales.deals add column if not exists product text;

comment on column sales.deals.product is
  'Two or three words naming what this deal is for — shown under the company
   name wherever deals are listed, so several live deals on one account are
   told apart at a glance. Free text; no logic depends on it.';

select 'sales.deals product' as t,
       count(*) filter (where product is not null and product <> '') as labelled,
       count(*) as total
from sales.deals;
