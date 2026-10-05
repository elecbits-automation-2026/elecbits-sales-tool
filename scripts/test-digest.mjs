#!/usr/bin/env node
// The daily digest, end to end — run: node scripts/test-digest.mjs
//
// This is the one feature nobody can check by clicking around: it runs on a
// cron, with the service role, and the only way to see it is to receive the
// mail. So a mock PostgREST and a mock mail transport stand in front of the
// REAL api/digest.js handler, and the whole thing is driven through them.
//
// Nothing here touches the network, the database, or anyone's inbox.

import http from "node:http";

/* ── the mock database ─────────────────────────────────────────────────── */
const db = { core: { people: [], orgs: [] }, sales: { people_detail: [], tasks: [], deals: [] } };

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const schema = (req.headers["accept-profile"] || "sales").toString();
  // The handler only ever reads: /rest/v1/<table>?select=...
  const table = u.pathname.replace("/rest/v1/", "").split("?")[0];
  const rows = (db[schema] || {})[table];
  res.writeHead(rows ? 200 : 404, { "Content-Type": "application/json" });
  res.end(JSON.stringify(rows || { message: "no such table " + schema + "." + table }));
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;

process.env.SUPABASE_URL = "http://127.0.0.1:" + PORT;
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
process.env.CRON_SECRET = "cron-secret";
// No RESEND_API_KEY and no INBOX_OAUTH_*: the sender stays "none", so every
// run renders without delivering. Exactly the state the tool ships in.

const { default: handler } = await import("../api/digest.js");

/* ── the harness ───────────────────────────────────────────────────────── */
let pass = 0, fail = 0;
const results = [];
const check = (name, cond, got) => {
  if (cond) { pass++; results.push(["PASS", name, ""]); }
  else { fail++; results.push(["FAIL", name, JSON.stringify(got)]); }
};

const call = async (query, headers = {}) => {
  const res = { statusCode: 0, body: null, setHeader() {},
    status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ query, headers: { host: "x", ...headers }, method: "GET" }, res);
  return res;
};
const CRON = { authorization: "Bearer cron-secret" };

// Today, in IST, the way the handler computes it.
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const shift = (n) => {
  const d = new Date(Date.now() + n * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
};
const YESTERDAY = shift(-1), TOMORROW = shift(1);

/* ── the world ─────────────────────────────────────────────────────────── */
db.core.people = [
  { id: "p-shreya", name: "Shreya Rao", email: "shreya@elecbits.in" },
  { id: "p-nikhil", name: "Nikhil Jain", email: "nikhil@elecbits.in" },
  { id: "p-gone",   name: "Former Person", email: "gone@elecbits.in" },
  { id: "p-nomail", name: "No Address", email: "" },
];
db.sales.people_detail = [
  { person_id: "p-shreya", active: true }, { person_id: "p-nikhil", active: true },
  { person_id: "p-gone", active: false },  { person_id: "p-nomail", active: true },
];
db.core.orgs = [{ id: "o-schneider", name: "Schneider Electric" }, { id: "o-tesla", name: "Tesla" }];
db.sales.deals = [
  { id: "d-ups", product: "UPS wifi dongle", did: "EB-C-26-0007-D01", org_id: "o-schneider" },
  { id: "d-dpb", product: "DPB Architecture", did: "EB-C-26-0007-D02", org_id: "o-schneider" },
  { id: "d-bare", product: "", did: "EB-C-26-0009-D01", org_id: "o-tesla" },
];
const T = (o) => ({ status: "open", due: null, deal_id: null, done_at: null, ...o });
db.sales.tasks = [
  // Shreya: one overdue and one due today on DIFFERENT Schneider projects,
  // one due today on Tesla, one future, one already done.
  T({ id: "t1", title: "Chase the BOM", assignee_id: "p-shreya", org_id: "o-schneider", deal_id: "d-ups", due: YESTERDAY }),
  T({ id: "t2", title: "Send the LLD", assignee_id: "p-shreya", org_id: "o-schneider", deal_id: "d-dpb", due: today }),
  T({ id: "t3", title: "Book the demo", assignee_id: "p-shreya", org_id: "o-tesla", deal_id: "d-bare", due: today }),
  T({ id: "t4", title: "Draft the quote", assignee_id: "p-shreya", org_id: "o-schneider", deal_id: "d-ups", due: TOMORROW }),
  T({ id: "t5", title: "Call Gopinath", assignee_id: "p-shreya", org_id: "o-schneider", deal_id: "d-ups", due: today, status: "done", done_at: today }),
  // Nikhil: nothing due. He must not be mailed.
  T({ id: "t6", title: "Tidy the folder", assignee_id: "p-nikhil", org_id: "o-tesla", due: TOMORROW }),
  // Someone off the roster, and someone with no address.
  T({ id: "t7", title: "Ghost work", assignee_id: "p-gone", org_id: "o-tesla", due: today }),
  T({ id: "t8", title: "Unreachable", assignee_id: "p-nomail", org_id: "o-tesla", due: today }),
  // Unassigned: nobody to mail.
  T({ id: "t9", title: "Nobody's", assignee_id: null, org_id: "o-tesla", due: today }),
];

/* 1 — the gate. An endpoint that mails the whole team must not be open. */
{
  check("no bearer → 401", (await call({ when: "morning" })).statusCode === 401);
  check("wrong secret → 401", (await call({ when: "morning" }, { authorization: "Bearer nope" })).statusCode === 401);
  check("the cron secret gets in", (await call({ when: "morning" }, CRON)).statusCode === 200);
  check("a bad 'when' is refused", (await call({ when: "lunchtime" }, CRON)).statusCode === 400);
  check("status needs no auth — it leaks nothing", (await call({ action: "status" })).statusCode === 200);
}

/* 2 — morning: who gets one, and who deliberately does not */
{
  const r = await call({ when: "morning", preview: "1" }, CRON);
  const to = r.body.digests.map((x) => x.to);
  check("only people with something owed today are mailed",
    to.length === 1 && to[0] === "shreya@elecbits.in", to);
  check("nobody is mailed an empty digest", !to.includes("nikhil@elecbits.in"), to);
  check("an inactive person is skipped entirely",
    !to.includes("gone@elecbits.in") && !JSON.stringify(r.body.errors || []).includes("Former"), r.body.errors);
  check("a rostered person with no address is reported, not silently dropped",
    (r.body.errors || []).some((e) => e.includes("No Address")), r.body.errors);
  check("preview sends nothing", r.body.preview === true && !r.body.digests.some((d) => d.sent));
  check("…and says so when no transport is set up", r.body.sender === "none", r.body.sender);

  // Shreya owes three: one from yesterday and two dated today. The task she
  // finished today and the one dated tomorrow are neither of them owed.
  const d = r.body.digests[0];
  check("the subject counts what is OWED — overdue plus due today",
    d.subject === "Today: 3 tasks · 1 overdue", d.subject);
  check("…which is three of her five open-or-closed tasks", d.count === 3, d.count);
  check("a task already closed today is not owed", !d.html.includes("Call Gopinath"), null);
  check("a task dated tomorrow is not owed either",
    d.subject.includes("3 tasks") && !d.subject.includes("4 tasks"), d.subject);
}

/* 3 — morning body: grouped by PROJECT, which is the whole point */
{
  const { html } = (await call({ when: "morning", preview: "1" }, CRON)).body.digests[0];
  check("the overdue one is called overdue", html.includes("overdue"), null);
  check("tasks are grouped under their project, not listed flat",
    html.includes("Schneider Electric · UPS wifi dongle") && html.includes("Schneider Electric · DPB Architecture"), null);
  check("two projects on one client are told apart",
    html.indexOf("UPS wifi dongle") !== html.indexOf("DPB Architecture"), null);
  check("a deal with no product name falls back to its id",
    html.includes("Tesla · EB-C-26-0009-D01"), null);
  check("what is coming is included, so it reads as a day plan",
    html.includes("Draft the quote"), null);
  check("the already-done task is not on the morning list",
    !html.includes("Call Gopinath"), null);
  check("the person is greeted by first name only",
    html.includes("Good morning, Shreya") && !html.includes("Good morning, Shreya Rao"), null);
}

/* 4 — evening: the recap counts only what TODAY asked for */
{
  const r = await call({ when: "evening", preview: "1" }, CRON);
  const d = r.body.digests.find((x) => x.to === "shreya@elecbits.in");
  check("the recap counts today's tasks, done and not",
    d.subject === "Today's recap: 1 of 3 closed", d.subject);
  check("yesterday's overdue task is not in today's recap",
    !d.html.includes("Chase the BOM"), null);
  check("tomorrow's task is not in today's recap",
    !d.html.includes("Draft the quote"), null);
  check("what is still open is NAMED, not just counted",
    d.html.includes("Send the LLD") && d.html.includes("Book the demo"), null);
  check("what closed is named too", d.html.includes("Call Gopinath"), null);
  check("nobody with nothing due today gets a recap",
    !r.body.digests.some((x) => x.to === "nikhil@elecbits.in"), r.body.digests.map((x) => x.to));
}

/* 5 — the all-clear reads differently from a bad day */
{
  const saved = db.sales.tasks;
  db.sales.tasks = [T({ id: "z1", title: "One thing", assignee_id: "p-nikhil", org_id: "o-tesla", due: today, status: "done", done_at: today })];
  const d = (await call({ when: "evening", preview: "1" }, CRON)).body.digests[0];
  check("everything closed → the subject says so", d.subject === "Today's recap: 1 of 1 closed", d.subject);
  check("…and the body says it in words", d.html.includes("all of it"), null);
  const m = (await call({ when: "morning", preview: "1" }, CRON)).body;
  check("a day with nothing owed sends no morning mail at all", m.digests.length === 0, m.digests);
  db.sales.tasks = saved;
}

/* 6 — the hostile and the empty */
{
  const saved = db.sales.tasks;
  db.sales.tasks = [T({ id: "x1", title: '<script>alert("xss")</script> & "quoted"', assignee_id: "p-shreya", org_id: "o-schneider", deal_id: "d-ups", due: today })];
  const { html } = (await call({ when: "morning", preview: "1" }, CRON)).body.digests[0];
  check("a task title cannot inject script into the mail",
    !html.includes("<script>") && html.includes("&lt;script&gt;"), null);
  check("ampersands and quotes survive as text", html.includes("&amp;") && html.includes("&quot;"), null);

  db.sales.tasks = [];
  const empty = (await call({ when: "morning", preview: "1" }, CRON)).body;
  check("no tasks at all → nobody mailed, no crash", empty.digests.length === 0 && empty.people === 0, empty);
  db.sales.tasks = saved;
}

/* 7 — status tells the operator exactly what is missing */
{
  const s = (await call({ action: "status" })).body;
  check("status reports no sender until one is configured", s.sender === "none" && !s.ready, s);
  check("…and names both ways to fix it",
    /RESEND_API_KEY/.test(s.senderHelp) && /for=digest/.test(s.senderHelp), s.senderHelp);
  check("…including the variable to paste the token into",
    /DIGEST_OAUTH_REFRESH_TOKEN/.test(s.senderHelp), s.senderHelp);
  check("status confirms the reads are wired", s.reads === "ok", s.reads);
  check("status reports the cron secret", s.cronSecret === "set", s.cronSecret);
}

/* 8 — the sending address is its own decision, not the reading mailbox's */
{
  const keep = { ...process.env };
  process.env.INBOX_OAUTH_CLIENT_ID = "id"; process.env.INBOX_OAUTH_CLIENT_SECRET = "secret";
  process.env.INBOX_OAUTH_REFRESH_TOKEN = "read-token";
  process.env.INBOX_GMAIL_USER = "clients@elecbits.in";

  let s = (await call({ action: "status" })).body;
  check("with only the reading mailbox set, it sends as that",
    s.sender === "gmail" && s.sendsAs === "clients@elecbits.in", s.sendsAs);

  process.env.DIGEST_GMAIL_USER = "ankita.shrivastava@elecbits.in";
  process.env.DIGEST_OAUTH_REFRESH_TOKEN = "send-token";
  s = (await call({ action: "status" })).body;
  check("a digest mailbox overrides it — choosing a sender does not choose an inbox",
    s.sendsAs === "ankita.shrivastava@elecbits.in", s.sendsAs);

  delete process.env.INBOX_GMAIL_USER; delete process.env.INBOX_OAUTH_REFRESH_TOKEN;
  s = (await call({ action: "status" })).body;
  check("the digest sends with no reading mailbox configured at all",
    s.sender === "gmail" && s.sendsAs === "ankita.shrivastava@elecbits.in", s);

  for (const k of ["INBOX_OAUTH_CLIENT_ID", "INBOX_OAUTH_CLIENT_SECRET", "INBOX_OAUTH_REFRESH_TOKEN",
                   "INBOX_GMAIL_USER", "DIGEST_GMAIL_USER", "DIGEST_OAUTH_REFRESH_TOKEN"]) {
    if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k];
  }
}

/* 9 — a live send that reaches one inbox, not the whole team */
{
  const keep = process.env.DIGEST_ONLY_TO;
  process.env.DIGEST_ONLY_TO = "ankita.shrivastava@elecbits.in";
  const mod = await import("../api/digest.js?onlyto");   // ONLY_TO is read at import
  const res = { statusCode: 0, body: null, setHeader() {},
    status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await mod.default({ query: { when: "morning" }, headers: { host: "x", ...CRON }, method: "GET" }, res);
  const b2 = res.body;
  check("with the filter on, a real run holds everyone not on the list",
    b2.held === b2.digests.length && b2.digests.every((x) => x.held === "DIGEST_ONLY_TO"), b2.digests);
  check("…but still builds their digest, so the run shows who WOULD be mailed",
    b2.digests.length > 0 && b2.digests.every((x) => x.subject), b2.digests);
  check("the response names the filter — it cannot be left on unnoticed",
    JSON.stringify(b2.onlyTo) === JSON.stringify(["ankita.shrivastava@elecbits.in"]), b2.onlyTo);

  const st = { statusCode: 0, body: null, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await mod.default({ query: { action: "status" }, headers: { host: "x" }, method: "GET" }, st);
  check("status shouts about the filter", /TESTING FILTER IS ON/.test(st.body.onlyToWarning || ""), st.body.onlyToWarning);
  if (keep === undefined) delete process.env.DIGEST_ONLY_TO; else process.env.DIGEST_ONLY_TO = keep;
}

server.close();
for (const [state, name, got] of results) {
  console.log((state === "PASS" ? "  ✓ " : "  ✗ ") + name + (got ? "   → " + got : ""));
}
console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
