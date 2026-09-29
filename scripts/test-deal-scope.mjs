#!/usr/bin/env node
// Which deal does a record belong to? — run: node scripts/test-deal-scope.mjs
//
// This is the rule that decides whether a task, a touch or an RFQ link shows
// up on a given deal, and — the part that actually bit us — whether it is
// fed to the AI as evidence for that deal. Getting it wrong is not a visual
// glitch: the copilot wrote a next step about a client's OTHER product.
//
// Two live deals on one company is the case to hold onto. Everything here
// is that case.

import { belongsToDeal, dealContact, nextStepState } from "../src/lib/scope.ts";

let pass = 0, fail = 0;
const results = [];
const check = (name, cond, got) => {
  if (cond) { pass++; results.push(["PASS", name, ""]); }
  else { fail++; results.push(["FAIL", name, JSON.stringify(got)]); }
};

// Schneider Electric, two deals running at once — the real report.
const SCHNEIDER = "org-schneider", HONEYWELL = "org-honeywell";
const dpb  = { id: "deal-dpb", companyId: SCHNEIDER, lost: false };
const ups  = { id: "deal-ups", companyId: SCHNEIDER, lost: false };
const dead = { id: "deal-old", companyId: SCHNEIDER, lost: true };
const solo = { id: "deal-solo", companyId: HONEYWELL, lost: false };
const both = [dpb, ups, dead, solo];

/* 1 — a record naming a deal belongs to that deal, and to no other */
{
  const t = { dealId: "deal-ups", companyId: SCHNEIDER, title: "chase UPS WiFi dongle" };
  check("a deal's own task shows on that deal", belongsToDeal(t, ups, both), true);
  check("…and NOT on its sibling (the reported bug)", !belongsToDeal(t, dpb, both), belongsToDeal(t, dpb, both));
}

/* 2 — an unbound task with siblings around must not pick a deal */
{
  const t = { dealId: "", companyId: SCHNEIDER, title: "call Schneider about the LLD" };
  check("company-level task is withheld while two deals are live", !belongsToDeal(t, dpb, both), true);
  check("…withheld from the sibling too — not shown twice", !belongsToDeal(t, ups, both), true);
}

/* 3 — but a lone-deal company keeps the helpful fallback */
{
  const t = { dealId: "", companyId: HONEYWELL, title: "send Honeywell the quote" };
  check("company-level task DOES show when there is one live deal", belongsToDeal(t, solo, both), true);
}

/* 4 — lost deals don't count as siblings: closing one restores the fallback */
{
  const onlyLive = [{ id: "deal-a", companyId: SCHNEIDER, lost: false }, dead];
  const t = { dealId: "", companyId: SCHNEIDER };
  check("a lost sibling does not suppress the fallback", belongsToDeal(t, onlyLive[0], onlyLive), true);
}

/* 5 — never cross a company boundary */
{
  const t = { dealId: "", companyId: HONEYWELL };
  check("another company's task never attaches", !belongsToDeal(t, dpb, both), true);
}

/* 6 — an orphaned record (its deal was deleted) behaves like company-level */
{
  const orphan = { dealId: "", companyId: SCHNEIDER };
  check("an orphan stays off a deal that has a live sibling", !belongsToDeal(orphan, ups, both), true);
}

/* 7 — the degenerate inputs the UI will hand it on first paint */
{
  check("no item → false", !belongsToDeal(null, dpb, both), true);
  check("no deal → false", !belongsToDeal({ dealId: "x" }, null, both), true);
  check("no deals list → lone-deal fallback, never a crash", belongsToDeal({ dealId: "" }, dpb, undefined), true);
  check("a record with no company still matches its own deal", belongsToDeal({ dealId: "deal-dpb" }, dpb, both), true);
}

/* 8 — the same rule decides a project's POC: the deal's own person wins,
       and only a company with one project inherits the company contact */
{
  const rakesh = { id: "c-rakesh", companyId: SCHNEIDER, name: "Rakesh", role: "R&D lead", isPrimary: false };
  const priya  = { id: "c-priya",  companyId: SCHNEIDER, name: "Priya",  role: "Procurement", isPrimary: true };
  const people = [rakesh, priya];
  const comp = { id: SCHNEIDER, contactPerson: "Reception", designation: "" };
  const pick = (deal) => dealContact(deal, comp, people);

  check("a deal with its own POC gets that person",
    pick({ ...dpb, contactId: "c-rakesh" }).name === "Rakesh", pick({ ...dpb, contactId: "c-rakesh" }));
  check("…and its sibling gets ITS person, not Rakesh",
    pick({ ...ups, contactId: "c-priya" }).name === "Priya", pick({ ...ups, contactId: "c-priya" }));
  check("a deal naming nobody falls back to the company primary",
    pick(dpb).name === "Priya" && pick(dpb).inherited === true, pick(dpb));
  check("the fallback is flagged inherited, so the UI can say so",
    pick(dpb).inherited === true, pick(dpb));
  check("with no contacts at all, the company's own field answers",
    dealContact(dpb, comp, []).name === "Reception", dealContact(dpb, comp, []));
  check("a contact from another company is never picked",
    dealContact(solo, { id: HONEYWELL }, people) === null, dealContact(solo, { id: HONEYWELL }, people));
}

/* 9 — IS THIS DEAL COMMITTED? The reported bug: a deal with two assigned
       tasks on the board said "nothing committed" directly above them.
       Committed means somebody's name is on live work, with a date. */
{
  const TODAY = "2026-09-29", PAST = "2026-09-01", SOON = "2026-10-01";
  const st = (deal, tasks) => nextStepState(deal, tasks, both, TODAY);
  // Shreya's two tasks on the DPB deal — exactly the screenshot.
  const shreya = [
    { id: "t1", dealId: "deal-dpb", status: "open", assignee: "u-shreya", due: SOON },
    { id: "t2", dealId: "deal-dpb", status: "open", assignee: "u-shreya", due: SOON },
  ];

  check("two assigned tasks → committed, not 'nothing committed'",
    st(dpb, shreya).key === "committed", st(dpb, shreya));
  check("…and it counts them, so the panel can say how many",
    st(dpb, shreya).tasks === 2, st(dpb, shreya));
  check("…and reports the nearest promised date",
    st(dpb, shreya).due === SOON, st(dpb, shreya));
  check("…while the sibling deal stays uncommitted",
    st(ups, shreya).key === "none", st(ups, shreya));

  check("tasks with nobody on them → NOT committed",
    st(dpb, [{ id: "t3", dealId: "deal-dpb", status: "open", due: SOON }]).key === "none",
    st(dpb, [{ id: "t3", dealId: "deal-dpb", status: "open", due: SOON }]));
  check("…and it says how many are unowned, which is the fix to make",
    st(dpb, [{ id: "t3", dealId: "deal-dpb", status: "open" },
             { id: "t4", dealId: "deal-dpb", status: "open" }]).unowned === 2,
    st(dpb, [{ id: "t3", dealId: "deal-dpb", status: "open" }, { id: "t4", dealId: "deal-dpb", status: "open" }]));
  check("one assigned + one unowned is still committed, with the gap named",
    st(dpb, [shreya[0], { id: "t5", dealId: "deal-dpb", status: "open" }]).key === "committed"
      && st(dpb, [shreya[0], { id: "t5", dealId: "deal-dpb", status: "open" }]).unowned === 1,
    st(dpb, [shreya[0], { id: "t5", dealId: "deal-dpb", status: "open" }]));

  check("an assigned task past its date → overdue",
    st(dpb, [{ ...shreya[0], due: PAST }]).key === "overdue", st(dpb, [{ ...shreya[0], due: PAST }]));
  check("…and the overdue date shown is the missed one, not the nearest",
    st(dpb, [{ ...shreya[0], due: PAST }, shreya[1]]).due === PAST,
    st(dpb, [{ ...shreya[0], due: PAST }, shreya[1]]));
  check("an assigned task with no date at all is still a commitment",
    st(dpb, [{ id: "t6", dealId: "deal-dpb", status: "open", assignee: "u-shreya" }]).key === "committed",
    st(dpb, [{ id: "t6", dealId: "deal-dpb", status: "open", assignee: "u-shreya" }]));

  check("done tasks do not hold a deal committed",
    st(dpb, [{ ...shreya[0], status: "done" }]).key === "none", st(dpb, [{ ...shreya[0], status: "done" }]));
  check("…and that case is flagged closedOut, not mistaken for an empty deal",
    st(dpb, [{ ...shreya[0], status: "done" }]).closedOut === true, st(dpb, [{ ...shreya[0], status: "done" }]));
  check("a deal with no tasks at all is not closedOut",
    !st(dpb, []).closedOut, st(dpb, []));

  // The written next step still counts — deals predate assignable tasks.
  const withStep = { ...dpb, nextStep: "Walk Gopinath through the LLD", nextStepDue: SOON };
  check("a written next step alone → committed",
    st(withStep, []).key === "committed" && st(withStep, []).step === true, st(withStep, []));
  check("…past its date → overdue",
    st({ ...withStep, nextStepDue: PAST }, []).key === "overdue", st({ ...withStep, nextStepDue: PAST }, []));
  check("…marked done stops counting",
    st({ ...withStep, nextStepDoneAt: PAST }, []).key === "none", st({ ...withStep, nextStepDoneAt: PAST }, []));
  check("step:false when the commitment comes from tasks only — no phantom parent",
    st(dpb, shreya).step === false, st(dpb, shreya));
  check("a late step outweighs on-time tasks",
    st({ ...withStep, nextStepDue: PAST }, shreya).key === "overdue",
    st({ ...withStep, nextStepDue: PAST }, shreya));

  check("a lost deal is closed, whatever is assigned on it",
    st(dead, [{ ...shreya[0], dealId: "deal-old" }]).key === "closed",
    st(dead, [{ ...shreya[0], dealId: "deal-old" }]));
  check("a won deal is closed too",
    st({ ...dpb, stage: "po" }, shreya).key === "closed", st({ ...dpb, stage: "po" }, shreya));
  check("no deal → a shape, never a crash",
    nextStepState(null, shreya, both, TODAY).key === "none", nextStepState(null, shreya, both, TODAY));
  check("no tasks argument → falls back to the written step, no crash",
    nextStepState(withStep, null, both, TODAY).key === "committed", nextStepState(withStep, null, both, TODAY));

  // The lone-deal company: a company-level task with no dealId still counts.
  check("on a one-deal company an unstamped assigned task commits the deal",
    st(solo, [{ id: "t7", companyId: HONEYWELL, status: "open", assignee: "u-varun", due: SOON }]).key === "committed",
    st(solo, [{ id: "t7", companyId: HONEYWELL, status: "open", assignee: "u-varun", due: SOON }]));
  check("…but on a two-deal company it commits neither",
    st(dpb, [{ id: "t8", companyId: SCHNEIDER, status: "open", assignee: "u-varun", due: SOON }]).key === "none",
    st(dpb, [{ id: "t8", companyId: SCHNEIDER, status: "open", assignee: "u-varun", due: SOON }]));
}

for (const [state, name, got] of results) {
  console.log((state === "PASS" ? "  ✓ " : "  ✗ ") + name + (got ? "   → " + got : ""));
}
console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
