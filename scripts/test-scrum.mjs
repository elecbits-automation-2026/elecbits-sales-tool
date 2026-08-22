#!/usr/bin/env node
/* Unit tests for the scrum organiser's pure logic — day resolution and the
   offline parser. These are the parts that fail SILENTLY: a task landing on
   the wrong day, or a time window read one-sided, looks like normal output.

   Run: npm run test:scrum   (esbuild comes with vite; no extra dependency)
   Exits 1 on any failure. */
import { build } from "esbuild";
const r = await build({
  entryPoints: ["src/data/scrum.ts"], bundle: true, write: false,
  format: "esm", platform: "neutral",
});
const mod = await import("data:text/javascript;base64," + Buffer.from(r.outputFiles[0].text).toString("base64"));
const { dayFor, addDays, isoDay, fallbackScrum } = mod;

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}` + (ok ? "" : `\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`));
};

// 2026-08-22 is a Saturday.
console.log("\ndayFor — note written Sat 2026-08-22");
eq("no day mentioned",        dayFor("send the quote", "2026-08-22"), "2026-08-22");
eq("tomorrow -> Sun 23",      dayFor("call them tomorrow at 3", "2026-08-22"), "2026-08-23");
eq("monday -> next Mon 24",   dayFor("monday, chase the PO", "2026-08-22"), "2026-08-24");
eq("friday -> next Fri 28",   dayFor("friday review", "2026-08-22"), "2026-08-28");
eq("saturday -> NEXT Sat 29", dayFor("saturday demo", "2026-08-22"), "2026-08-29");
eq("month rollover",          dayFor("tomorrow", "2026-08-31"), "2026-09-01");
eq("year rollover",           dayFor("tomorrow", "2026-12-31"), "2027-01-01");

console.log("\nisoDay");
eq("valid",   isoDay("2026-08-22"), "2026-08-22");
eq("word",    isoDay("tomorrow"), "");
eq("null",    isoDay(null), "");
eq("bad date", isoDay("2026-13-45"), "");

console.log("\nfallbackScrum — offline parse");
const users = [{ id: "u1", name: "Akash Rao" }, { id: "u2", name: "Ankit Shah" }];
const comps = [{ id: "c1", name: "Sunrise Retail Tech", accountOwner: "u1" }];
const out = fallbackScrum(
  "Akash sends Sunrise Retail the quote by 2pm. Ankit calls Nevon tomorrow 12 to 1pm. If they refuse, escalate.",
  "2026-08-22", users, comps);
eq("engine flagged", out.engine, "offline");
eq("two owners matched", out.tasks.length, 2);
eq("'by 2pm' is an END not a start", [out.tasks[0].start, out.tasks[0].end], ["", "14:00"]);
eq("company matched", out.tasks[0].company, "Sunrise Retail Tech");
eq("'tomorrow' on task 2", out.tasks[1].date, "2026-08-23");
eq("'12 to 1pm' window", [out.tasks[1].start, out.tasks[1].end], ["12:00", "13:00"]);

const none = fallbackScrum("nothing actionable here", "2026-08-22", users, comps);
eq("no name -> keeps note as one row", none.tasks.length, 1);
eq("  ...unassigned", none.tasks[0].owner, "");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exitCode = fail ? 1 : 0;
