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

/* ─── WHO TO CALL ABOUT THIS PROJECT ───────────────────────────────────────
   The same shape of question, for people. A company's contacts live in
   core.contacts; a deal points at one of them. A deal naming nobody inherits
   the company's primary — right for an account with a single project — and
   the result says `inherited` so the UI can admit it is a fallback rather
   than presenting it as this project's real answer.                       */

export type Contact = {
  id: string; companyId?: string; name?: string; role?: string;
  email?: string; phone?: string; isPrimary?: boolean;
};

export function dealContact(
  deal: (DealLike & { contactId?: string }) | null | undefined,
  comp: { contactPerson?: string; designation?: string; email?: string; phone?: string } | null | undefined,
  contacts?: Contact[] | null,
): (Contact & { inherited: boolean }) | null {
  const list = (contacts || []).filter((c) => c.companyId === (deal ? deal.companyId : ""));
  const own = deal && deal.contactId ? list.find((c) => c.id === deal.contactId) : null;
  if (own) return { ...own, inherited: false };
  const primary = list.find((c) => c.isPrimary) || list[0];
  if (primary) return { ...primary, inherited: true };
  // Nothing in core.contacts yet (migration 32 not run, or a bare company):
  // the company's own denormalised fields still answer the question.
  if (comp && comp.contactPerson) {
    return { id: "", name: comp.contactPerson, role: comp.designation || "",
             email: comp.email || "", phone: comp.phone || "", inherited: true };
  }
  return null;
}

export const contactLine = (c: Contact | null | undefined): string => !c ? "" :
  (c.name || "") + (c.role ? " (" + c.role + ")" : "")
  + (c.email ? " · " + c.email : "") + (c.phone ? " · " + c.phone : "");
