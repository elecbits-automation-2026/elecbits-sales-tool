#!/usr/bin/env node
// The RFQ link token, end to end — run: node scripts/test-rfq-token.mjs
//
// api/rfq.js is the ONLY door the client's browser uses, and it is the piece
// nobody can exercise by clicking around: it needs the service role, a real
// link row, and a client on the other end. So this harness stands a mock
// PostgREST in front of the REAL handler and drives the whole token
// lifecycle through it — open, fill, submit, come back, apply for
// sanctioning — plus the races and the hostile payloads.
//
// Nothing here touches the network or the real database. The mock speaks
// only the slice of PostgREST the handler uses, including the jsonb filter
// `response->_sanction=is.null` that makes the sanction claim atomic.

import http from "node:http";
import { randomUUID } from "node:crypto";

/* ── the mock database ─────────────────────────────────────────────────── */

const db = {
  core:  { orgs: [] },
  sales: { rfq_links: [], deals: [], org_detail: [], requests: [] },
};

const getPath = (row, path) => path.reduce((v, k) => (v == null ? v : v[k]), row);

// One PostgREST filter: `id=eq.x`, `response->_sanction=is.null`.
function matches(row, key, spec) {
  const path = key.includes("->") ? key.split("->").map((s) => s.replace(/^>/, "")) : [key];
  const v = getPath(row, path);
  if (spec === "is.null") return v == null;
  if (spec.startsWith("eq.")) return String(v) === spec.slice(3);
  throw new Error("mock: unsupported filter " + key + "=" + spec);
}

function selectRows(schema, table, params) {
  const rows = db[schema][table] || [];
  return rows.filter((r) =>
    [...params.entries()].every(([k, v]) => k === "select" || matches(r, k, v)));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (code, body) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };

  // The caller-verification endpoint api/register.js uses.
  if (url.pathname === "/auth/v1/user") {
    const auth = req.headers.authorization || "";
    return auth === "Bearer good-token"
      ? send(200, { id: "11111111-1111-1111-1111-111111111111", email: "sales@elecbits.in" })
      : send(401, { message: "invalid token" });
  }

  const m = url.pathname.match(/^\/rest\/v1\/(\w+)$/);
  if (!m) return send(404, { message: "no route" });
  const table = m[1];
  const schema = (req.headers["accept-profile"] || req.headers["content-profile"] || "sales");
  if (!db[schema] || !db[schema][table]) return send(404, { message: "no table " + schema + "." + table });

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const params = url.searchParams;
    try {
      if (req.method === "GET") return send(200, selectRows(schema, table, params));
      if (req.method === "PATCH") {
        const hits = selectRows(schema, table, params);
        const patch = JSON.parse(body || "{}");
        hits.forEach((r) => Object.assign(r, patch));
        return send(200, hits);            // Prefer: return=representation
      }
      if (req.method === "POST") {
        const row = { id: randomUUID(), ...JSON.parse(body || "{}") };
        db[schema][table].push(row);
        return send(201, [row]);
      }
      return send(405, { message: "method" });
    } catch (e) { return send(500, { message: String(e.message || e) }); }
  });
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;

/* ── boot the handlers against the mock (env is read at import time) ───── */

process.env.SUPABASE_URL = "http://127.0.0.1:" + PORT;
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
process.env.SUPABASE_ANON_KEY = "test-anon";
delete process.env.GOOGLE_SERVICE_ACCOUNT_JSON;   // register: "not configured"
delete process.env.DRIVE_ROOT_FOLDER_ID;

const { default: rfq } = await import("../api/rfq.js");
const { default: register } = await import("../api/register.js");

const call = async (handler, { method = "GET", query = {}, body = null, headers = {} }) => {
  let out = { code: 0, json: null };
  const res = {
    status(c) { out.code = c; return this; },
    json(j) { out.json = j; return this; },
  };
  await handler({ method, query, body, headers }, res);
  return out;
};

/* ── the fixtures: one client, one deal, one link ──────────────────────── */

const ORG = randomUUID(), DEAL = randomUUID(), LEGACY_ORG = randomUUID();
db.core.orgs.push({ id: ORG, name: "Sunrise Meditech", client_id: "EB-C-26-0007" });
db.core.orgs.push({ id: LEGACY_ORG, name: "Old Co", client_id: null });
db.sales.org_detail.push({ org_id: LEGACY_ORG, legacy_cid: "Eb-06-ML-0031" });
db.sales.deals.push({ id: DEAL, code: "EB-C-26-0007-D01" });

const newLink = (over = {}) => {
  const l = {
    id: randomUUID(), org_id: ORG, deal_id: DEAL, title: "RFQ — Sunrise Meditech",
    offer: [], note_to_client: "Great speaking today.", contact_name: "Dr. Rao",
    status: "created", response: {}, opened_at: null, submitted_at: null,
    created_by: "sales-person-uuid", ...over,
  };
  db.sales.rfq_links.push(l);
  return l;
};

/* ── the assertions ───────────────────────────────────────────────────── */

let pass = 0, fail = 0;
const results = [];
function check(name, cond, got) {
  if (cond) { pass++; results.push(["PASS", name, ""]); }
  else { fail++; results.push(["FAIL", name, typeof got === "string" ? got : JSON.stringify(got)]); }
}

/* 1 — a tampered token is refused before anything is read */
{
  const r = await call(rfq, { query: { id: "not-a-uuid" } });
  check("malformed token → 400, no DB touched", r.code === 400, r);
}

/* 2 — a well-formed token that belongs to nothing */
{
  const r = await call(rfq, { query: { id: randomUUID() } });
  check("unknown token → 404 (guessing a uuid buys nothing)", r.code === 404, r);
}

/* 3 — opening the link: identity resolves, and the open is recorded */
{
  const l = newLink();
  const r = await call(rfq, { query: { id: l.id } });
  check("GET returns the company name", r.json?.company === "Sunrise Meditech", r.json);
  check("GET carries the official Client ID", r.json?.clientId === "EB-C-26-0007", r.json);
  check("GET carries the Deal ID (code, not uuid)", r.json?.dealId === "EB-C-26-0007-D01", r.json);
  check("first view flips status created → opened", l.status === "opened", l.status);
  check("opened_at is stamped", !!l.opened_at, l.opened_at);
}

/* 4 — a legacy client still gets an ID on the page */
{
  const l = newLink({ org_id: LEGACY_ORG, deal_id: null });
  const r = await call(rfq, { query: { id: l.id } });
  check("legacy client falls back to the recorded legacy ID", r.json?.clientId === "Eb-06-ML-0031", r.json);
}

/* 5 — progress is written as they type, and the sales side can read it */
{
  const l = newLink();
  await call(rfq, { query: { id: l.id } });
  for (const n of [1, 2, 3]) {
    await call(rfq, {
      method: "POST", query: { id: l.id },
      body: { partial: true, response: { name: "Dr. Rao", need: "Patient monitor", _answered: n, _total: 9 } },
    });
  }
  check("partial saves land on the token's row", l.response._answered === 3, l.response);
  check("partial save does NOT flip status to submitted", l.status === "opened", l.status);
  const pct = Math.round((l.response._answered / l.response._total) * 100);
  check("sales side can compute a live fill % (33%)", pct === 33, pct);

  // The client closes the tab and comes back to the same link.
  const back = await call(rfq, { query: { id: l.id } });
  check("reopening mid-form offers a resume point", back.json?.saved?.answered === 3, back.json?.saved);
  check("reopening hands back what they already typed", back.json?.saved?.answers?.need === "Patient monitor", back.json?.saved);
}

/* 5b — a never-opened link offers nothing to resume */
{
  const l = newLink();
  const r = await call(rfq, { query: { id: l.id } });
  check("a fresh link has no resume point", r.json?.saved === null, r.json?.saved);
}

/* 6 — submit, then come back to the link */
{
  const l = newLink();
  await call(rfq, { query: { id: l.id } });
  const r = await call(rfq, {
    method: "POST", query: { id: l.id },
    body: { response: { name: "Anita Rao", need: "Monitor", services: ["PCB design"], _answered: 9, _total: 9 } },
  });
  check("submit → ok", r.code === 200 && r.json?.ok, r);
  check("submit flips status to submitted", l.status === "submitted", l.status);
  check("submitted_at is stamped", !!l.submitted_at, l.submitted_at);
  const back = await call(rfq, { query: { id: l.id } });
  check("returning to the link reports submitted", back.json?.submitted === true, back.json);
  check("returning client is greeted by name", back.json?.respondent === "Anita", back.json);
  check("sanction not yet applied", back.json?.sanction === false, back.json);
  check("a submitted link offers no form resume (sanctioning takes over)", back.json?.saved === null, back.json?.saved);
}

/* 7 — sanctioning is gated on the requirement being in */
{
  const l = newLink();
  const r = await call(rfq, { method: "POST", query: { id: l.id }, body: { sanction: true, post: {} } });
  check("sanction before submit → 409", r.code === 409, r);
}

/* 8 — the sanction files into the ULM pipe, exactly once */
{
  const before = db.sales.requests.length;
  const l = newLink({ status: "submitted", response: { name: "Anita Rao", need: "Monitor", services: ["PCB design"] } });
  const r = await call(rfq, {
    method: "POST", query: { id: l.id },
    body: { sanction: true, post: { projectName: "Monitor v1", kickoff: "October", decider: "Dr. Rao" } },
  });
  check("sanction → ok", r.code === 200 && r.json?.ok, r);
  const filed = db.sales.requests.slice(before);
  check("exactly one sales.requests row filed", filed.length === 1, filed.length);
  check("filed under the salesperson who made the link", filed[0]?.submitted_by === "sales-person-uuid", filed[0]?.submitted_by);
  check("the request is traceable back to the token", filed[0]?.requirement?.rfq_link === l.id, filed[0]?.requirement);
  check("the request carries the deal it belongs to", filed[0]?.requirement?.deal_id === DEAL, filed[0]?.requirement);
  check("the basics reached ULM", /Monitor v1/.test(filed[0]?.summary || ""), filed[0]?.summary);
  check("the link is stamped _sanction", !!l.response._sanction, l.response);

  const again = await call(rfq, { method: "POST", query: { id: l.id }, body: { sanction: true, post: {} } });
  check("applying twice → already, no second row", again.json?.already === true && db.sales.requests.length === before + 1, {
    already: again.json, rows: db.sales.requests.length - before });

  const back = await call(rfq, { query: { id: l.id } });
  check("reopening after sanction reports it", back.json?.sanction === true, back.json);
}

/* 9 — two clients hitting Apply at the same moment */
{
  const before = db.sales.requests.length;
  const l = newLink({ status: "submitted", response: { name: "Anita" } });
  await Promise.all([
    call(rfq, { method: "POST", query: { id: l.id }, body: { sanction: true, post: { projectName: "A" } } }),
    call(rfq, { method: "POST", query: { id: l.id }, body: { sanction: true, post: { projectName: "B" } } }),
  ]);
  check("concurrent sanction files ONE row (atomic claim)", db.sales.requests.length === before + 1,
    db.sales.requests.length - before);
}

/* 10 — a re-submit must not erase the stamp (it would re-open the window) */
{
  const l = newLink({ status: "submitted", response: { name: "Anita" } });
  await call(rfq, { method: "POST", query: { id: l.id }, body: { sanction: true, post: {} } });
  const stamp = l.response._sanction;
  await call(rfq, { method: "POST", query: { id: l.id }, body: { response: { name: "Anita", need: "changed my mind" } } });
  check("re-submit preserves the sanction stamp", !!l.response._sanction && l.response._sanction.at === stamp.at, l.response);
  check("re-submit still records the new answers", l.response.need === "changed my mind", l.response);
}

/* 11 — the client's browser is untrusted input */
{
  const l = newLink({ status: "submitted", response: { name: 12345, services: "not-an-array" } });
  const r = await call(rfq, { query: { id: l.id } });
  check("hostile response types do not 502 the page", r.code === 200, r);
  const s = await call(rfq, { method: "POST", query: { id: l.id }, body: { sanction: true, post: { projectName: "x" } } });
  check("hostile response types do not break the sanction", s.code === 200, s);
}
{
  const l = newLink();
  const huge = { need: "x".repeat(41000) };
  const r = await call(rfq, { method: "POST", query: { id: l.id }, body: { response: huge } });
  check("oversized payload → 413, row untouched", r.code === 413 && !l.response.need, r.code);
}
{
  const l = newLink({ status: "closed" });
  const r = await call(rfq, { method: "POST", query: { id: l.id }, body: { response: { need: "late" } } });
  check("a closed link refuses new input", r.code === 409, r);
}

/* 12 — the register endpoint is not public */
{
  const anon = await call(register, { query: { action: "status" } });
  check("/api/register without a token → 401", anon.code === 401, anon);
  const bad = await call(register, { query: { action: "status" }, headers: { authorization: "Bearer wrong" } });
  check("/api/register with a bad token → 401", bad.code === 401, bad);
  const good = await call(register, { query: { action: "status" }, headers: { authorization: "Bearer good-token" } });
  check("/api/register with a valid token → 200", good.code === 200, good);
  check("status reports Drive not configured here", good.json?.connected === false, good.json);
}

/* ── report ───────────────────────────────────────────────────────────── */

server.close();
const w = Math.max(...results.map((r) => r[1].length));
for (const [state, name, got] of results) {
  console.log((state === "PASS" ? "  ✓ " : "  ✗ ") + name.padEnd(w) + (got ? "   → " + got : ""));
}
console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
