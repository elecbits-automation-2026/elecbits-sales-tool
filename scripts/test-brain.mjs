#!/usr/bin/env node
// The sales brain, end to end — run: node scripts/test-brain.mjs
//
// The thing worth testing here is not retrieval quality, it is the ACCESS
// RULE. The brain now reads the whole company Drive, so a mistake in the
// tier filter does not degrade an answer — it reads a salary out of
// Eb-04-Finance to a salesperson. That failure is silent, permanent and
// discovered by the wrong person.
//
// So: a mock PostgREST and a mock Drive in front of the REAL api/memory.js,
// and the tier rule driven from both ends — who asks, and what comes back.
//
// Nothing here touches the network, Google, or the database.

import http from "node:http";
import crypto from "node:crypto";

/* ── the mock world ────────────────────────────────────────────────────── */
const db = {
  core: { people: [] },
  sales: { people_detail: [], memory_chunks: [], brain_folders: [] },
};

// Drive, as the crawler sees it: top-level folders and their contents.
const drive = {
  folders: [
    { id: "f-dmp", name: "Digital Manufacturing Platform" },
    { id: "f-odm", name: "Eb-02-ODM" },
    { id: "f-fin", name: "Eb-04-Finance" },
    { id: "f-hr", name: "Eb-20-HR and Payroll" },
    { id: "f-new", name: "Eb-21-Misc" },
  ],
  children: {
    "f-dmp": [{ id: "d1", name: "PCBA process.gdoc", mimeType: "application/vnd.google-apps.document", modifiedTime: "t1" }],
    "f-odm": [
      { id: "d2", name: "ODM Capability Deck v4.pptx", mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation", modifiedTime: "t1" },
      { id: "d3", name: "ODM overview.gslides", mimeType: "application/vnd.google-apps.presentation", modifiedTime: "t1" },
    ],
    "f-fin": [{ id: "d4", name: "Salary review 2026.gsheet", mimeType: "application/vnd.google-apps.spreadsheet", modifiedTime: "t1" }],
    "f-hr": [{ id: "d5", name: "Appraisal notes.gdoc", mimeType: "application/vnd.google-apps.document", modifiedTime: "t1" }],
    "f-new": [{ id: "d6", name: "Trade show plan.gdoc", mimeType: "application/vnd.google-apps.document", modifiedTime: "t1" }],
  },
  text: {
    d1: "Standard PCBA turnaround is 18 working days from approved Gerbers.",
    d3: "Elecbits ODM covers design, sourcing, PCBA, firmware and box build.",
    d4: "Rakesh 2400000. Priya 1850000. Review band C.",
    d5: "Appraisal: Ankita exceeded. Increment 12 percent.",
    d6: "Electronica 2026, hall 4. Bring the capability deck.",
  },
};

/* ── mock PostgREST ────────────────────────────────────────────────────── */
const tierOk = (row, tiers) => (tiers || ["all"]).includes(row.tier);

const rpc = {
  search_memory_text: ({ q, match_count, p_tiers }) => {
    const terms = String(q || "").toLowerCase().split(/\s+or\s+|\s+/).filter((w) => w && w !== "or");
    return db.sales.memory_chunks
      .filter((m) => tierOk(m, p_tiers))
      .filter((m) => terms.some((t) => m.content.toLowerCase().includes(t)))
      .slice(0, match_count || 8)
      .map((m) => ({ file_id: m.file_id, file_name: m.file_name, folder_path: m.folder_path, content: m.content, kind: m.kind, similarity: 0.5 }));
  },
  search_memory_files: ({ q, match_count, p_tiers }) => {
    const terms = String(q || "").toLowerCase().split(/\s+or\s+|\s+/).filter((w) => w.length > 2 && w !== "or");
    const seen = new Set();
    const out = [];
    for (const m of db.sales.memory_chunks) {
      if (!tierOk(m, p_tiers) || seen.has(m.file_id)) continue;
      const hay = (m.file_name + " " + m.folder_path).toLowerCase();
      if (!terms.some((t) => hay.includes(t))) continue;
      seen.add(m.file_id);
      out.push({ file_id: m.file_id, file_name: m.file_name, folder_path: m.folder_path, kind: m.kind, mime: m.mime, content: m.content });
    }
    return out.slice(0, match_count || 6);
  },
};

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const send = (code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };

  // Supabase auth: the bearer IS the email, so a test can be any person.
  if (u.pathname === "/auth/v1/user") {
    const t = (req.headers.authorization || "").replace(/^Bearer /i, "");
    if (!t || t === "bad") return send(401, { message: "invalid" });
    return send(200, { id: "u-" + t, email: t });
  }

  const schema = (req.headers["accept-profile"] || "sales").toString();
  const table = u.pathname.replace("/rest/v1/", "").split("?")[0];

  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (table.startsWith("rpc/")) {
      const fn = rpc[table.slice(4)];
      return send(200, fn ? fn(JSON.parse(body || "{}")) : []);
    }
    const rows = (db[schema] || {})[table];
    if (!rows) return send(404, { message: "no such table " + schema + "." + table });

    if (req.method === "POST") {
      const add = JSON.parse(body || "[]");
      (Array.isArray(add) ? add : [add]).forEach((r) => rows.push(r));
      return send(201, []);
    }
    if (req.method === "DELETE" || req.method === "PATCH") {
      const [col, pred] = [...u.searchParams.entries()].find(([k]) => !["select", "limit", "order"].includes(k)) || [];
      const want = String(pred || "").replace(/^eq\./, "");
      if (req.method === "DELETE") {
        for (let i = rows.length - 1; i >= 0; i--) if (String(rows[i][col]) === want) rows.splice(i, 1);
      } else {
        const patch = JSON.parse(body || "{}");
        rows.forEach((r) => { if (String(r[col]) === want) Object.assign(r, patch); });
      }
      return send(200, []);
    }
    // GET with eq. filters
    let out = rows;
    for (const [k, v] of u.searchParams.entries()) {
      if (["select", "limit", "order"].includes(k)) continue;
      if (String(v).startsWith("eq.")) out = out.filter((r) => String(r[k]) === String(v).slice(3));
    }
    return send(200, out);
  });
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;

/* ── mock Google ───────────────────────────────────────────────────────── */
const g = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const send = (b) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(b)); };
  if (u.pathname === "/token") return send({ access_token: "tok", expires_in: 3600 });
  if (u.pathname.includes("/export") || u.searchParams.get("alt") === "media") {
    const id = decodeURIComponent(u.pathname.split("/files/")[1].split(/[/?]/)[0]);
    res.writeHead(drive.text[id] ? 200 : 404); return res.end(drive.text[id] || "");
  }
  const q = u.searchParams.get("q") || "";
  if (q.includes("sharedWithMe")) return send({ files: drive.folders });
  const m = q.match(/'([^']+)' in parents/);
  if (m) return send({ files: drive.children[m[1]] || [] });
  return send({ files: [] });
});
await new Promise((r) => g.listen(0, r));
const GPORT = g.address().port;

process.env.SUPABASE_URL = "http://127.0.0.1:" + PORT;
process.env.SUPABASE_SERVICE_ROLE_KEY = "svc";
process.env.SUPABASE_ANON_KEY = "anon";
process.env.DRIVE_ROOT_FOLDER_ID = "root";
// A REAL key pair, because the JWT is signed locally before Google ever sees
// it — a dummy PEM makes crypto.sign throw and the whole crawl 502s, which
// reads in the results as "the brain found nothing" rather than "the test is
// wrong". Throwaway, generated per run, never leaves this process.
const { privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  client_email: "robot@x.iam.gserviceaccount.com",
  private_key: privateKey,
});
delete process.env.VOYAGE_API_KEY;
delete process.env.DMP_FOLDER_NAME;

// Stub the two things that would leave the machine: Google's token endpoint
// (needs a real RSA key) and the Drive API host.
const realFetch = globalThis.fetch;
globalThis.fetch = (url, init) => {
  const s = String(url);
  if (s.startsWith("https://oauth2.googleapis.com/token")) return realFetch("http://127.0.0.1:" + GPORT + "/token", init);
  if (s.startsWith("https://www.googleapis.com/drive/v3/")) return realFetch(s.replace("https://www.googleapis.com/drive/v3", "http://127.0.0.1:" + GPORT), init);
  if (s.startsWith("https://api.voyageai.com")) throw new Error("no embeddings in this test");
  return realFetch(url, init);
};

const { default: handler } = await import("../api/memory.js");

/* ── harness ───────────────────────────────────────────────────────────── */
let pass = 0, fail = 0;
const results = [];
const check = (name, cond, got) => {
  if (cond) { pass++; results.push(["PASS", name, ""]); }
  else { fail++; results.push(["FAIL", name, JSON.stringify(got)]); }
};
const call = async (query, who) => {
  const res = { statusCode: 0, body: null, setHeader() {},
    status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ query, method: "GET",
    headers: { host: "x", ...(who ? { authorization: "Bearer " + who } : {}) } }, res);
  return res;
};

db.core.people = [
  { id: "p-saurav", email: "saurav@elecbits.in" },
  { id: "p-ankita", email: "ankita@elecbits.in" },
  { id: "p-varun", email: "varun@elecbits.in" },
];
db.sales.people_detail = [
  { person_id: "p-saurav", role: "admin", active: true },
  { person_id: "p-ankita", role: "agent", active: true },
  { person_id: "p-varun", role: "dept_head", active: true },
];

/* 1 — the gate. The corpus is now the company Drive; an open endpoint
       would hand finance and HR to anyone who found the URL. */
{
  check("no token → 401", (await call({ action: "status" })).statusCode === 401);
  check("a rejected token → 401", (await call({ action: "status" }, "bad")).statusCode === 401);
  check("a signed-in person gets in", (await call({ action: "status" }, "ankita@elecbits.in")).statusCode === 200);
  const r = await call({ action: "status" }, "ankita@elecbits.in");
  check("status tells you what YOU can see",
    r.body.you.role === "agent" && JSON.stringify(r.body.you.sees) === JSON.stringify(["all"]), r.body.you);
  const s = await call({ action: "status" }, "saurav@elecbits.in");
  check("…and an admin sees all three tiers",
    JSON.stringify(s.body.you.sees) === JSON.stringify(["all", "leadership", "admin"]), s.body.you);
  const stranger = await call({ action: "status" }, "someone@elsewhere.com");
  check("signed in but not on the roster → the narrowest tier, not a crash",
    stranger.statusCode === 200 && JSON.stringify(stranger.body.you.sees) === JSON.stringify(["all"]), stranger.body.you);
}

/* 2 — the crawl classifies folders by name, and closes the dangerous ones */
{
  const r = await call({ action: "learn" }, "saurav@elecbits.in");
  check("the crawl reaches every shared folder, not just DMP",
    r.body.topFolders === 5, r.body);
  const byName = new Map(db.sales.brain_folders.map((f) => [f.folder, f]));
  check("Finance is closed automatically", byName.get("Eb-04-Finance").tier === "admin", byName.get("Eb-04-Finance"));
  check("HR and Payroll is closed automatically", byName.get("Eb-20-HR and Payroll").tier === "admin", byName.get("Eb-20-HR and Payroll"));
  check("the ODM collateral folder is open", byName.get("Eb-02-ODM").tier === "all", byName.get("Eb-02-ODM"));
  check("a folder with an innocent name is open",
    byName.get("Eb-21-Misc").tier === "all", byName.get("Eb-21-Misc"));
  check("the auto-closed ones say they were guessed, so the guess can be checked",
    /Auto-closed/.test(byName.get("Eb-04-Finance").note || ""), byName.get("Eb-04-Finance").note);
}

/* 3 — an unreadable deck still becomes findable, and says it is unread */
{
  const deck = db.sales.memory_chunks.find((c) => c.file_id === "d2");
  check("a .pptx the crawler cannot open still gets a row", !!deck, null);
  check("…marked kind=file, so nothing can quote from it", deck.kind === "file", deck);
  // Separators are flattened to spaces on purpose: "Eb-02-ODM/ODM-Capability
  // -Deck-v4.pptx" is one token to a tsvector and matches nothing anyone
  // would type. The hyphenated original is still on folder_path/file_name,
  // which is what the ILIKE name search reads.
  check("…carrying its name and folder as searchable WORDS",
    /ODM Capability Deck/i.test(deck.content) && /\bEb 02 ODM\b/.test(deck.content), deck.content);
  check("…while the row keeps the real path, for the link and the name search",
    deck.folder_path === "Eb-02-ODM" && deck.file_name === "ODM Capability Deck v4.pptx", deck);
  const slides = db.sales.memory_chunks.find((c) => c.file_id === "d3");
  check("a NATIVE Google Slides deck is read in full", slides.kind === "text" && /box build/.test(slides.content), slides);
}

/* 4 — THE RULE THAT MATTERS. Same question, different asker. */
{
  const q = "salary or review or band";
  const agent = await call({ action: "search", q }, "ankita@elecbits.in");
  check("an agent asking about salaries gets NOTHING from Finance",
    agent.body.hits.length === 0 && agent.body.files.length === 0, agent.body);
  const admin = await call({ action: "search", q }, "saurav@elecbits.in");
  check("…and an admin asking the same question does",
    admin.body.hits.some((h) => /Salary review/.test(h.file_name)), admin.body.hits.map((h) => h.file_name));
  const hr = await call({ action: "search", q: "appraisal or increment" }, "ankita@elecbits.in");
  check("HR is closed to an agent too", hr.body.hits.length === 0, hr.body.hits);

  const open_ = await call({ action: "search", q: "pcba or turnaround" }, "ankita@elecbits.in");
  check("the collateral an agent SHOULD have still comes back",
    open_.body.hits.some((h) => /PCBA process/.test(h.file_name)), open_.body.hits.map((h) => h.file_name));
  check("…with a Drive link on it", /drive\.google\.com/.test((open_.body.hits[0] || {}).link || ""), open_.body.hits[0]);

  const deck = await call({ action: "search", q: "capability or deck" }, "ankita@elecbits.in");
  check("\"send me the capability deck\" finds the unreadable .pptx by name",
    deck.body.files.some((f) => /Capability Deck/.test(f.file_name)), deck.body.files.map((f) => f.file_name));
  check("…and it is kept OUT of the quotable passages",
    !deck.body.hits.some((h) => h.kind === "file"), deck.body.hits);
  // The row's own content is its filename. Shipping that as `content` is
  // how a model ends up "summarising" a deck it never opened, so the
  // endpoint strips it: a file row is a name and a link, full stop.
  check("…and arrives with no content at all, so nothing can be quoted from it",
    deck.body.files.every((f) => f.content === undefined), deck.body.files);

  /* A readable doc whose text never repeats its own title. Content search
     cannot find it; only the name search can — and what comes back is a
     passage we really did read, so it belongs in hits, not in files. */
  const named = await call({ action: "search", q: "trade or show or plan" }, "ankita@elecbits.in");
  check("a doc found only by its NAME still comes back quotable",
    named.body.hits.some((h) => /Trade show plan/.test(h.file_name) && /Electronica/.test(h.content || "")),
    named.body.hits.map((h) => h.file_name));
  check("…and is not mislabelled as a file we never opened",
    !named.body.files.some((f) => /Trade show plan/.test(f.file_name)), named.body.files);
}

/* 5 — reclassifying reaches the chunks, not just the folder row */
{
  const before = await call({ action: "search", q: "trade or show" }, "ankita@elecbits.in");
  check("Eb-21-Misc is readable while it is open", before.body.hits.length > 0, before.body.hits);

  const denied = await call({ action: "folder", folder: "Eb-21-Misc", tier: "admin" }, "ankita@elecbits.in");
  check("an agent cannot reclassify a folder", denied.statusCode === 403, denied.body);

  await call({ action: "folder", folder: "Eb-21-Misc", tier: "admin" }, "saurav@elecbits.in");
  const after = await call({ action: "search", q: "trade or show" }, "ankita@elecbits.in");
  // The tier is denormalised onto every chunk so retrieval needs no join —
  // which means closing a folder MUST rewrite them, or it is cosmetic.
  check("closing a folder immediately hides its chunks", after.body.hits.length === 0, after.body.hits);
  const admin = await call({ action: "search", q: "trade or show" }, "saurav@elecbits.in");
  check("…and an admin still sees them", admin.body.hits.length > 0, admin.body.hits);
}

/* 6 — a human's decision survives the next crawl */
{
  const r = await call({ action: "learn" }, "saurav@elecbits.in");
  const row = db.sales.brain_folders.find((f) => f.folder === "Eb-21-Misc");
  check("a re-crawl does not reopen a folder an admin closed", row.tier === "admin", row);
  check("…and does not duplicate the folder row",
    db.sales.brain_folders.filter((f) => f.folder === "Eb-21-Misc").length === 1, db.sales.brain_folders.length);
  check("nothing is re-learned when nothing changed", r.body.learned === 0 && r.body.listed === 0, r.body);
  check("…and it reports itself finished rather than looping",
    r.body.remaining === 0 && /Up to date/.test(r.body.note), r.body.note);
}

server.close(); g.close();
for (const [state, name, got] of results) {
  console.log((state === "PASS" ? "  ✓ " : "  ✗ ") + name + (got ? "   → " + got : ""));
}
console.log("\n" + pass + " passed, " + fail + " failed\n");
process.exit(fail ? 1 : 0);
