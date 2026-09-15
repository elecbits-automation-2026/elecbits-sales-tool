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

import { belongsToDeal } from "../src/lib/scope.ts";

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

for (const [state, name, got] of results) {
  console.log((state === "PASS" ? "  ✓ " : "  ✗ ") + name + (got ? "   → " + got : ""));
}
console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
