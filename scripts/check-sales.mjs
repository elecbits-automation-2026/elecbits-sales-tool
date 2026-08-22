#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────────
   Deployment health check for the Sales OS.

   Everything that has actually broken with this tool was a deployment problem,
   not a code problem: an env var set on the wrong Vercel project, a VITE_ var
   added without a redeploy (they are read at BUILD time), a schema missing from
   Exposed schemas, a migration that never ran. All of those look identical from
   the outside — a page that does not work. This turns them into a named cause.

   Deliberately dependency-free: node 18+ has fetch, and a check script that
   needs `npx playwright install chromium` before it can tell you anything is a
   check script nobody runs. It tests the seams, not the pixels.

   USAGE
     node scripts/check-sales.mjs --url https://elecbits-sales-tool.vercel.app
     node scripts/check-sales.mjs --url http://localhost:5173 --db

   FLAGS
     --url  <origin>   what to test (required)
     --db              also test Supabase directly; needs SUPABASE_URL and
                       SUPABASE_ANON_KEY in the environment
     --json            machine-readable report on stdout
     --quiet           only failures

   EXIT
     0  everything passed (warnings allowed)
     1  at least one check failed
     2  the script could not run (bad arguments, host unreachable)
   ───────────────────────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
const flag = (n) => args.includes("--" + n);
const opt = (n, d = "") => {
  const i = args.indexOf("--" + n);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : d;
};

const URL_ = opt("url").replace(/\/+$/, "");
const JSON_OUT = flag("json");
const QUIET = flag("quiet");
const DO_DB = flag("db");

if (!URL_) {
  console.error("Missing --url. Try: node scripts/check-sales.mjs --url https://your-app.vercel.app");
  process.exit(2);
}

/* ── reporting ──────────────────────────────────────────────────────────── */

const results = [];
const C = process.stdout.isTTY && !JSON_OUT
  ? { g: "\x1b[32m", r: "\x1b[31m", y: "\x1b[33m", d: "\x1b[2m", x: "\x1b[0m", b: "\x1b[1m" }
  : { g: "", r: "", y: "", d: "", x: "", b: "" };

function record(name, state, detail, fix) {
  results.push({ name, state, detail, fix });
  if (JSON_OUT) return;
  if (QUIET && state === "pass") return;
  const mark = state === "pass" ? `${C.g}PASS${C.x}`
    : state === "warn" ? `${C.y}WARN${C.x}` : `${C.r}FAIL${C.x}`;
  console.log(`  ${mark}  ${name}${detail ? `  ${C.d}${detail}${C.x}` : ""}`);
  if (fix && state !== "pass") console.log(`        ${C.y}→ ${fix}${C.x}`);
}

const pass = (n, d) => record(n, "pass", d);
const warn = (n, d, f) => record(n, "warn", d, f);
const fail = (n, d, f) => record(n, "fail", d, f);

/* Fetch with a timeout whose timer is always cleared.

   NOT AbortSignal.timeout(): that leaves an armed libuv handle behind, and
   calling process.exit() while one is pending aborts the process on Windows
   ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"). CI then sees
   exit 127 instead of the 0/1 this script exists to report. */
async function timedFetch(url, init = {}, ms = 20000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

async function json(url, init) {
  const r = await timedFetch(url, init);
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* not json */ }
  // An SPA fallback (vite preview, or a catch-all Vercel rewrite) answers 200
  // with index.html for a route that has no function behind it. That is
  // "not deployed", not "not configured" — and the difference is the whole
  // point of this check.
  const html = body === null && /^\s*<!doctype html/i.test(text);
  return { status: r.status, ok: r.ok, body, html };
}

function section(t) { if (!JSON_OUT && !QUIET) console.log(`\n${C.b}${t}${C.x}`); }

/* ── 1. the site itself ─────────────────────────────────────────────────── */

async function checkSite() {
  section("Reaching it");
  let r;
  try {
    r = await timedFetch(URL_);
  } catch (e) {
    fail("site answers", String(e.message || e),
      "Wrong --url, or the deployment is down. Check the Vercel dashboard.");
    return false;
  }
  if (!r.ok) {
    fail("site answers", "HTTP " + r.status, "The origin is up but not serving the app.");
    return false;
  }
  const html = await r.text();
  pass("site answers", "HTTP 200");

  if (/<div id="root">/.test(html)) pass("app shell present");
  else fail("app shell present", "no #root in the HTML",
    "This origin is serving something other than the built app.");

  // The bundle name changes every build; its presence proves a real build.
  const m = html.match(/src="(\/assets\/index-[^"]+\.js)"/);
  if (m) pass("bundle linked", m[1]);
  else warn("bundle linked", "no hashed bundle in index.html",
    "Serving a dev index? A production build emits /assets/index-<hash>.js.");
  return true;
}

/* ── 2. the serverless functions ────────────────────────────────────────── */

async function checkApi() {
  section("Serverless functions");

  // Drive — status is designed to answer without credentials.
  try {
    const { status, body, html } = await json(`${URL_}/api/drive?action=status`);
    if (status === 404 || html) {
      fail("/api/drive deployed", html ? "HTML returned — no function behind this route" : "404",
        "Not deployed at this origin. `vite preview` never serves api/*.js — use `vercel dev`, or test the deployed origin.");
    } else if (body?.connected) {
      pass("/api/drive connected");
    } else {
      warn("/api/drive connected", body?.reason || "not connected",
        "Set GOOGLE_SERVICE_ACCOUNT_JSON and DRIVE_ROOT_FOLDER_ID in Vercel, and share the root folder with the service account's client_email as Editor.");
    }
  } catch (e) {
    fail("/api/drive deployed", String(e.message || e));
  }

  // Fireflies — same shape.
  try {
    const { status, body, html } = await json(`${URL_}/api/fireflies?action=status`);
    if (status === 404 || html) {
      fail("/api/fireflies deployed", html ? "HTML returned — no function behind this route" : "404",
        "Not deployed at this origin. `vite preview` never serves api/*.js — use `vercel dev`, or test the deployed origin.");
    } else if (body?.connected) {
      pass("/api/fireflies connected");
    } else {
      warn("/api/fireflies connected", body?.reason || "not connected",
        "Set FIREFLIES_API_KEY in Vercel. Fireflies API access needs a PAID plan — a free-plan key authenticates but returns nothing.");
    }
  } catch (e) {
    fail("/api/fireflies deployed", String(e.message || e));
  }

  // Claude — probe the contract WITHOUT spending a token: an empty body must
  // be rejected with 400 ("Missing 'prompt' or 'messages'"), while a missing
  // key answers 500. The two are distinguishable, so we learn whether the key
  // is configured without ever running a completion.
  try {
    const { status, body, html } = await json(`${URL_}/api/claude`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (status === 404 || html) {
      fail("/api/claude deployed", html ? "HTML returned — no function behind this route" : "404",
        "Function missing from this deployment. `vite preview` never serves api/*.js — use `vercel dev` locally, or point --url at the deployed origin.");
    } else if (status === 500 && /ANTHROPIC_API_KEY/i.test(body?.error || "")) {
      fail("/api/claude configured", "ANTHROPIC_API_KEY not set",
        "Add ANTHROPIC_API_KEY in Vercel → Settings → Environment Variables (server-only; do NOT prefix with VITE_), then redeploy.");
    } else if (status === 400) {
      pass("/api/claude configured", "key present, contract intact");
    } else {
      warn("/api/claude configured", "unexpected HTTP " + status,
        "The proxy answered something other than the documented 400/500.");
    }
  } catch (e) {
    fail("/api/claude deployed", String(e.message || e));
  }
}

/* ── 3. the database ────────────────────────────────────────────────────── */

async function checkDb() {
  section("Database");
  const url = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  const key = process.env.SUPABASE_ANON_KEY || "";
  if (!url || !key) {
    warn("supabase reachable", "SUPABASE_URL / SUPABASE_ANON_KEY not in env",
      "Export both to run the --db checks. They are the same public values the browser bundle carries.");
    return;
  }
  const h = { apikey: key, Authorization: "Bearer " + key };

  // Both schemas must be in Settings → API → Exposed schemas, or PostgREST
  // answers 404 for every table in them and the app loads empty.
  for (const [schema, table] of [["sales", "deals"], ["core", "people"]]) {
    try {
      const r = await timedFetch(`${url}/rest/v1/${table}?select=id&limit=1`,
        { headers: { ...h, "Accept-Profile": schema } }, 15000);
      if (r.status === 404 || r.status === 406) {
        fail(`schema "${schema}" exposed`, "HTTP " + r.status,
          `Supabase → Settings → API → Exposed schemas: add "${schema}". Also add it to [api].schemas in supabase/config.toml.`);
      } else if (r.status === 401) {
        fail(`schema "${schema}" exposed`, "401 — key rejected", "SUPABASE_ANON_KEY does not belong to this project.");
      } else {
        pass(`schema "${schema}" exposed`, "HTTP " + r.status);
      }
    } catch (e) {
      fail(`schema "${schema}" exposed`, String(e.message || e));
    }
  }

  // The 17-task-states trap: that file is in no RUN-THIS bundle, so a database
  // built only from the bundles rejects the 'doing' status the app writes in
  // seven places. Detect it by asking PostgREST for a row in that state —
  // a working constraint answers 200 with [], a stale one answers 400/500.
  try {
    const r = await timedFetch(`${url}/rest/v1/tasks?select=id&status=eq.doing&limit=1`,
      { headers: { ...h, "Accept-Profile": "sales" } }, 15000);
    if (r.status === 404) {
      warn("sales.tasks exists", "404", "Run RUN-THIS-phase2.sql (part 12-phase1.sql).");
    } else if (r.ok) {
      pass("sales.tasks queryable", "the 'doing' state is addressable");
    } else {
      warn("sales.tasks queryable", "HTTP " + r.status, "Unexpected; check RLS on sales.tasks.");
    }
  } catch (e) {
    warn("sales.tasks queryable", String(e.message || e));
  }
}

/* ── run ────────────────────────────────────────────────────────────────── */

if (!JSON_OUT && !QUIET) {
  console.log(`\n${C.b}Elecbits Sales OS — health check${C.x}`);
  console.log(`${C.d}${URL_}${C.x}`);
}

const reachable = await checkSite();
if (reachable) await checkApi();
if (DO_DB) await checkDb();

const failed = results.filter((r) => r.state === "fail");
const warned = results.filter((r) => r.state === "warn");

if (JSON_OUT) {
  console.log(JSON.stringify({ url: URL_, results, failed: failed.length, warned: warned.length }, null, 2));
} else {
  console.log(`\n${C.b}${results.length - failed.length - warned.length} passed`
    + `, ${warned.length} warning${warned.length === 1 ? "" : "s"}`
    + `, ${failed.length} failed${C.x}`);
  if (failed.length) {
    console.log(`\n${C.r}${C.b}WHAT TO DO${C.x}`);
    for (const f of failed) console.log(`  · ${f.name}: ${f.fix || f.detail}`);
  }
  console.log();
}

// exitCode, not exit(): let node drain its handles and leave cleanly.
process.exitCode = failed.length ? 1 : 0;
