/* ─── WHICH DEAL DOES THIS BELONG TO? ──────────────────────────────────────
   One company can have several deals running at once — a pilot, a repeat
   order, a different product line — and almost everything the tool records
   (tasks, touches, RFQ links) is stamped with a company AND, usually, a
   deal. The trap is treating "same company" as "same deal".

   It has caught us twice: RFQ badges showed one deal's link on all of a
   company's cards, and the Deal Room listed one deal's tasks under another
   deal's next step — then fed them to the AI as evidence, which duly wrote
   a next step about the wrong product.

   The rule, in one place:
     • a record naming a deal belongs to that deal and no other;
     • a record naming none is company-level, and may stand in for a deal
       only when there is exactly one live deal it could possibly mean.

   The second clause is what keeps a lone-deal company working the way
   people expect (company-level notes show up on the deal) without letting
   anything bleed sideways the moment a second deal opens.               */

export type Scoped = { dealId?: string; companyId?: string };
export type DealLike = { id: string; companyId?: string; lost?: boolean };

export function belongsToDeal(item: Scoped | null | undefined,
                              deal: DealLike | null | undefined,
                              deals?: DealLike[] | null): boolean {
  if (!item || !deal) return false;
  if (item.dealId) return item.dealId === deal.id;
  if (item.companyId && item.companyId !== deal.companyId) return false;
  const live = (deals || []).filter((x) => x.companyId === deal.companyId && !x.lost);
  return live.length <= 1;
}
