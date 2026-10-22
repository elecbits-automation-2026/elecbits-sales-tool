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
export type DealLike = { id: string; companyId?: string; lost?: boolean; stage?: string };

/* LIVE means still being worked: not lost, and not already won. A finished
   deal is not a candidate for anything new, so it must not make a company
   look ambiguous — one open project beside three closed-won ones is still
   one project as far as "which could this mean?" is concerned. */
export const liveDeals = (companyId: string | undefined,
                          deals?: DealLike[] | null): DealLike[] =>
  (deals || []).filter((x) => x.companyId === companyId && !x.lost && x.stage !== "po");

export function belongsToDeal(item: Scoped | null | undefined,
                              deal: DealLike | null | undefined,
                              deals?: DealLike[] | null): boolean {
  if (!item || !deal) return false;
  if (item.dealId) return item.dealId === deal.id;
  if (item.companyId && item.companyId !== deal.companyId) return false;
  return liveDeals(deal.companyId, deals).length <= 1;
}

/* The same question asked forwards, at WRITE time: a task is being raised
   against a company — which project does it obviously mean? Exactly one
   live project, and there is no guessing involved. Two or more and we must
   not choose; "" files it company-wide and the deal room asks.

   This has to agree with belongsToDeal or the tool contradicts itself:
   writing would pick a deal that reading then refuses to show. Hence one
   definition of live, used by both. */
export const soleDealId = (companyId: string | undefined,
                           deals?: DealLike[] | null): string => {
  if (!companyId) return "";
  const live = liveDeals(companyId, deals);
  return live.length === 1 ? live[0].id : "";
};

/* ─── WHICH PROJECT DID THEY MEAN? ─────────────────────────────────────────
   soleDealId answers "is there only one it could be?". This answers the
   harder half: somebody SAID which one, in prose, and we have to find it.

   "for the hmi project with Schneider Electric" names a project as plainly
   as a human could. Until this existed the scrum organiser could only
   resolve the company, so the task was filed company-wide — and on a client
   with several live projects, company-wide means it appears in none of
   their deal rooms. The one place it was needed was the one place it went
   missing.

   Matched in descending order of how certain each signal is:
     1. the deal CODE, said outright (EB-D-0013)
     2. the product name, whole
     3. distinctive WORDS of the product — "the dongle", "hmi", "ipc".
        Scored, because "UPS Wifi Dongle" and "UPS Controller" share a word
        and the winner has to be the one that shares more.

   A tie returns null, and that is the point rather than a shortfall: two
   projects equally named is not something to guess at. The caller leaves
   the task company-wide and the UI asks.                                  */

const normWords = (s: unknown): string[] =>
  String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);

// Words that identify no project: every deal is a "project" for a "client".
const VAGUE = new Set(["project", "deal", "the", "and", "for", "with", "our", "new",
  "client", "customer", "account", "work", "job", "phase", "stage", "poc", "pilot"]);

/* A real deal row, as the app holds it: the identity fields, the two people
   on it, and the names a human would use for it. Separate aliases describe
   separate QUESTIONS — belongsToDeal needs none of this — but the object
   answering them is one object, and typing it as less than it is means
   every caller that asks two questions of the same deal has to cast. */
export type Named = DealLike & Owned & { did?: string; product?: string };

export function matchDeal(text: unknown, deals: Named[] | null | undefined,
                          companyId: string | undefined): Named | null {
  const live = liveDeals(companyId, deals || []) as Named[];
  if (!live.length) return null;
  if (live.length === 1) return live[0];

  const words = normWords(text);
  if (!words.length) return null;
  const hay = " " + words.join(" ") + " ";

  // 1. the code, said outright. Unambiguous by construction.
  const byCode = live.find((d) => d.did && hay.includes(" " + normWords(d.did).join(" ") + " "));
  if (byCode) return byCode;

  // 2 & 3. score on product words. A whole-name hit outranks word hits
  //        because it cannot be a coincidence of one shared term.
  let best: Named | null = null, bestScore = 0, tied = false;
  for (const d of live) {
    const pWords = normWords(d.product).filter((w) => w.length > 1 && !VAGUE.has(w));
    if (!pWords.length) continue;
    const whole = normWords(d.product).join(" ");
    let score = whole && hay.includes(" " + whole + " ") ? 100 + pWords.length : 0;
    if (!score) score = pWords.filter((w) => hay.includes(" " + w + " ")).length;
    if (!score) continue;
    if (score > bestScore) { best = d; bestScore = score; tied = false; }
    else if (score === bestScore) tied = true;
  }
  return tied ? null : best;
}

/* ─── WHOSE DEAL IS THIS? ──────────────────────────────────────────────────
   A deal carries two people: a PRIMARY, who brought it in and is answerable
   for it, and an optional SECONDARY, who is also working it.

   The distinction is deliberate and the two halves are not interchangeable:

     onDeal()   "is this person involved?" — either of them. This is what
                decides whose board the deal appears on, who the Deal Room
                lets act, and what the person filter matches.
     ownerId    "who is answerable?" — the primary alone. Capacity, the
                stale-deal nag and anything that asks whose number this is
                stay on one person, because a count that both people carry
                is a count that neither of them does.

   One definition, used by everything that asks. The reason it lives here
   rather than inline is the same reason belongsToDeal does: the first time
   this was two different expressions in two files, one of them will be
   updated and the other will quietly keep showing the old answer.

   Self-pairing is treated as no secondary, mirroring the CHECK constraint
   in 35-deal-secondary.sql — otherwise one person appears twice in anything
   that unions the two columns.                                            */

export type Owned = { ownerId?: string | null; secondaryOwnerId?: string | null };

export const dealPeople = (d: Owned | null | undefined): string[] => {
  const primary = (d && d.ownerId) || "";
  const second = (d && d.secondaryOwnerId) || "";
  return [primary, second === primary ? "" : second].filter(Boolean) as string[];
};

export const onDeal = (d: Owned | null | undefined, userId: string | undefined | null): boolean =>
  !!userId && dealPeople(d).includes(userId);

/** True when ANY of these people is on the deal — the pipeline's scope test. */
export const onDealAny = (d: Owned | null | undefined, userIds: Iterable<string>): boolean => {
  const people = dealPeople(d);
  if (!people.length) return false;
  for (const id of userIds) if (id && people.includes(id)) return true;
  return false;
};

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

/* ─── IS THIS DEAL COMMITTED? ──────────────────────────────────────────────
   "Committed" is not a field somebody remembers to fill in. It is what the
   board already shows: somebody's name against live work, with a date.

     • a live task with an assignee            → committed
     • live tasks, but nobody assigned to any  → NOT committed
     • no live tasks at all                    → NOT committed
     • any promised date already past          → overdue

   What is outstanding on a committed deal is the UPDATE — whether the work
   got done — and that closes in My Tasks, where the evidence is checked.

   There WAS a second idea here: deals.next_step, the commitment as a
   sentence, living beside the tasks and counting towards this verdict in
   its own right. It is gone. Adding a step and adding a task were the same
   act described twice, and the two descriptions drifted — a deal was found
   advertising "Send introductory mail to Chinmay · by 2 Oct" above its only
   real task, overdue since 26 Sept. One concept: the next action on a deal
   is a task on that deal.

   Scoping is belongsToDeal's, so a sibling project's tasks never make this
   deal look committed.                                                    */

export type CommitTask = Scoped & { status?: string; assignee?: string; due?: string };
export type CommitDeal = DealLike & { stage?: string };
export type CommitState = {
  key: "closed" | "committed" | "overdue" | "none";
  tasks: number;      // assigned, still-live tasks carrying it
  late: number;       // promised dates already past
  unowned: number;    // live tasks with nobody on them
  due: string;        // the date that governs — the earliest late one, else the nearest
  closedOut?: boolean; // every task done, nothing owed next
};

const isoToday = (): string => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export function nextStepState(
  d: CommitDeal | null | undefined,
  tasks?: CommitTask[] | null,
  deals?: DealLike[] | null,
  today?: string,
): CommitState {
  const base: CommitState = { key: "none", tasks: 0, late: 0, unowned: 0, due: "" };
  if (!d) return base;
  if (d.lost || d.stage === "po") return { ...base, key: "closed" };

  const now   = today || isoToday();
  const mine  = (tasks || []).filter((t) => belongsToDeal(t, d, deals));
  const live  = mine.filter((t) => t.status !== "done");
  const owned = live.filter((t) => !!t.assignee);

  const dates = owned.map((t) => t.due).filter(Boolean).sort() as string[];
  const late  = dates.filter((x) => x < now);

  if (owned.length) {
    return {
      key: late.length ? "overdue" : "committed",
      tasks: owned.length,
      late: late.length,
      unowned: live.length - owned.length,
      due: late.length ? late[0] : dates[0] || "",
    };
  }
  // Work on the board that nobody owns is the commonest reason a deal is
  // not committed, and a different problem from an empty board — so the
  // caller can say which.
  return { ...base, unowned: live.length, closedOut: live.length === 0 && mine.length > 0 };
}
