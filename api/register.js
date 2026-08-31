// The master register + the client/deal folders — the XoR sales tool's
// filing algorithm, ported. One Google Sheet ("Eb-Master_Register", tabs
// Clients and Deals, headers on row 2, data from row 3) is the company-wide
// ID authority; Drive folders hang off it, never the other way round.
//
// SOP v2.0, Law 6: the register row comes BEFORE the folder. Every write
// here follows XoR's append → verify → repair shape: append the row, read
// the column back, and if the row didn't land, append once more. Only then
// is the folder created, and the folder's link written back into the row.
// (When the register sheet itself is unreachable the folder is still
// created — a sales tool that can't file paperwork must not lose the
// client — and the caller gets a warning to surface.)
//
//   GET  /api/register?action=status            → what's configured/found
//   GET  /api/register?action=peek&family=EB-C  → { max } serial this year,
//                                                 read from the Clients tab —
//                                                 the floor for next_sop_id()
//   POST /api/register?action=client  {clientId, legacyId, name, sector,
//        orgSize, status?, addedBy, poc, notes?}
//        → Clients row + "<clientId> — <name>" folder + link-back
//   POST /api/register?action=deal    {dealId, clientId, clientName,
//        dealName, status?, value, currency?, owner, dateOpened, notes?,
//        brief?}
//        → Deals row + deal folder inside the client folder + a seeded
//          "00 — Deal brief" file + link-back
//
// Every action — reads included — requires a signed-in Sales OS user: the
// register is the company-wide ID authority, and an unauthenticated write
// (or even a peek that feeds the mint's floor) would let anyone on the
// internet poison the serial space. The browser sends the person's own
// Supabase JWT; this function verifies it against /auth/v1/user, the same
// pattern as api/admin-users.js.
//
// Env (same service account as /api/drive, same Supabase pair as admin-users):
//   GOOGLE_SERVICE_ACCOUNT_JSON   the key file (JSON or base64)
//   DRIVE_ROOT_FOLDER_ID          where client folders live
//   MASTER_REGISTER_ID            the sheet's id (optional — found by name)
//   MASTER_REGISTER_NAME          default "Eb-Master_Register"
//   SUPABASE_URL + SUPABASE_ANON_KEY   to verify the caller's JWT

import crypto from "node:crypto";

const SB_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const SB_ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

async function verifiedCaller(req) {
  const auth = req.headers.authorization || "";
  if (!auth.toLowerCase().startsWith("bearer ") || !SB_URL || !SB_ANON) return null;
  try {
    const r = await fetch(SB_URL + "/auth/v1/user", { headers: { apikey: SB_ANON, authorization: auth } });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id ? u : null;
  } catch { return null; }
}

const SCOPE = "https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets";
const REGISTER_NAME = process.env.MASTER_REGISTER_NAME || "Eb-Master_Register";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";

function fixPem(k) {
  if (!k || k.includes("\n")) return k;
  const m = k.match(/-----BEGIN PRIVATE KEY-----(.*)-----END PRIVATE KEY-----/s);
  if (!m) return k;
  const body = m[1].replace(/\s+/g, "");
  return "-----BEGIN PRIVATE KEY-----\n" + body.replace(/(.{64})/g, "$1\n").trim() + "\n-----END PRIVATE KEY-----\n";
}
function tryParse(text) {
  try {
    const sa = JSON.parse(text);
    if (!(sa.client_email && sa.private_key)) return null;
    sa.private_key = fixPem(sa.private_key);
    return sa;
  } catch (e) { return null; }
}
function serviceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  const t = raw.trim();
  if (!t.startsWith("{")) {
    try { return tryParse(Buffer.from(t, "base64").toString("utf8")); } catch (e) { return null; }
  }
  return tryParse(t)
      || tryParse(t.replace(/(-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----)/,
                            (s) => s.replace(/\r?\n/g, "\\n")))
      || tryParse(t.replace(/\r?\n/g, ""));
}
const b64url = (buf) => Buffer.from(buf).toString("base64url");
async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email, scope: SCOPE, aud: "https://oauth2.googleapis.com/token",
    iat: now, exp: now + 3600,
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(header + "." + claims);
  const jwt = header + "." + claims + "." + b64url(signer.sign(sa.private_key));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("token: " + (j.error_description || j.error || r.status));
  return j.access_token;
}

const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

async function gdrive(token, path, params, init = {}) {
  const url = new URL("https://www.googleapis.com/drive/v3/" + path);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const r = await fetch(url, {
    ...init,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const j = await r.json();
  if (!r.ok) throw new Error("drive: " + (j.error?.message || r.status));
  return j;
}
async function gsheets(token, sid, path, params, init = {}) {
  const url = new URL("https://sheets.googleapis.com/v4/spreadsheets/" + encodeURIComponent(sid) + path);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const r = await fetch(url, {
    ...init,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const j = await r.json();
  if (!r.ok) throw new Error("sheets: " + (j.error?.message || r.status));
  return j;
}

// The register sheet: explicit id wins, else found by name anywhere the
// service account can see. XoR cached the discovery in xor.settings; here a
// name search per invocation is cheap enough and needs no state.
async function findRegister(token) {
  const explicit = process.env.MASTER_REGISTER_ID;
  if (explicit) return { id: explicit, name: REGISTER_NAME };
  const l = await gdrive(token, "files", {
    q: `name = '${esc(REGISTER_NAME)}' and mimeType = '${SHEET_MIME}' and trashed = false`,
    fields: "files(id,name)", pageSize: "3",
    supportsAllDrives: "true", includeItemsFromAllDrives: "true",
  });
  return (l.files && l.files[0]) || null;
}

// One column, data rows only (row 3 down — row 1 is the title band, row 2
// the headers, exactly the EbMaster_Register_v2.0 layout).
async function readCol(token, sid, tab, col) {
  const j = await gsheets(token, sid, "/values/" + encodeURIComponent(`${tab}!${col}3:${col}`), {});
  return (j.values || []).map((r) => String(r[0] || "").trim());
}

// XoR lib/register.ts: append, then VERIFY the row landed, then repair with
// one more append if it did not. Returns the 1-based sheet row of the id.
// The repair fires only when the first append did NOT confirm a landing
// (network cut mid-call) — re-appending a write Sheets already confirmed
// would guarantee a duplicate row, the one thing worse than a missing one.
async function appendVerified(token, sid, tab, idValue, rowValues) {
  const append = () => gsheets(token, sid,
    "/values/" + encodeURIComponent(`${tab}!A3`) + ":append",
    { valueInputOption: "USER_ENTERED", insertDataOption: "INSERT_ROWS" },
    { method: "POST", body: JSON.stringify({ values: [rowValues] }) });
  const find = async () => {
    const col = await readCol(token, sid, tab, "A");
    const i = col.lastIndexOf(idValue);
    return i === -1 ? 0 : i + 3;
  };
  let landed = false;
  try {
    const r = await append();
    landed = !!(r.updates && r.updates.updatedRange);
  } catch (e) { /* the verify read decides */ }
  let row = await find();
  if (!row && !landed) { await append(); row = await find(); }  // the one repair attempt
  if (!row) throw new Error("register append could not be verified on " + tab);
  return row;
}

async function updateCell(token, sid, tab, cell, value) {
  await gsheets(token, sid, "/values/" + encodeURIComponent(`${tab}!${cell}`),
    { valueInputOption: "USER_ENTERED" },
    { method: "PUT", body: JSON.stringify({ values: [[value]] }) });
}

async function findFolder(token, root, name) {
  const byName = `name = '${esc(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const under = await gdrive(token, "files", {
    q: `'${esc(root)}' in parents and ` + byName,
    fields: "files(id,name,webViewLink)", supportsAllDrives: "true", includeItemsFromAllDrives: "true",
  });
  if (under.files && under.files.length) return under.files[0];
  const anywhere = await gdrive(token, "files", {
    q: byName, fields: "files(id,name,webViewLink)", pageSize: "10",
    supportsAllDrives: "true", includeItemsFromAllDrives: "true",
  });
  return (anywhere.files && anywhere.files[0]) || null;
}
// A client folder is "<clientId> — <name>", but an id-prefix match also
// counts: renames of the human half must not orphan the deals inside. The
// fallback stays scoped to the root and demands a word boundary after the
// id — otherwise "EB-C-26-0001" would happily match the DEAL folder
// "EB-C-26-0001-D01" (its own child) or a same-named folder anywhere else.
async function findClientFolder(token, root, clientId, clientName) {
  const exact = await findFolder(token, root, clientId + " — " + (clientName || ""));
  if (exact) return exact;
  const l = await gdrive(token, "files", {
    q: `'${esc(root)}' in parents and name contains '${esc(clientId)}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    fields: "files(id,name,webViewLink)", pageSize: "10",
    supportsAllDrives: "true", includeItemsFromAllDrives: "true",
  });
  return (l.files || []).find((f) => f.name === clientId || f.name.startsWith(clientId + " ")) || null;
}
async function createFolder(token, parent, name) {
  return gdrive(token, "files", { fields: "id,name,webViewLink", supportsAllDrives: "true" }, {
    method: "POST",
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parent] }),
  });
}
async function writeFile(token, parent, fileName, content) {
  const boundary = "eb" + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: fileName, parents: [parent] });
  const payload =
    "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + meta + "\r\n" +
    "--" + boundary + "\r\nContent-Type: text/markdown; charset=UTF-8\r\n\r\n" + (content || "") + "\r\n" +
    "--" + boundary + "--";
  const r = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink",
    { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "multipart/related; boundary=" + boundary }, body: payload });
  const j = await r.json();
  if (!r.ok) throw new Error("upload: " + (j.error?.message || r.status));
  return j;
}

const linkOf = (f) => f.webViewLink || ("https://drive.google.com/drive/folders/" + f.id);
const S = (v) => String(v == null ? "" : v).trim();
// Cell guard: USER_ENTERED makes Sheets execute anything starting with
// = + - @ as a formula. A leading apostrophe forces text (and is hidden),
// so user-typed values can never plant IMPORTXML/WEBSERVICE in the shared
// register. Server-generated values (dates, links) skip this on purpose.
const C = (v) => { const s = S(v); return /^[=+\-@\t\r]/.test(s) ? "'" + s : s; };

export default async function handler(req, res) {
  const sa = serviceAccount();
  const root = process.env.DRIVE_ROOT_FOLDER_ID;
  const action = (req.query.action || "status").toString();

  // Signed-in Sales OS users only — for every action. The peek feeds the
  // mint's floor and the writes ARE the ID authority; neither is public.
  if (!(await verifiedCaller(req))) {
    return res.status(401).json({ error: "Sign in required (send your Supabase JWT as a Bearer token)." });
  }

  if (action === "status") {
    let sheet = null;
    if (sa) {
      try { sheet = await findRegister(await accessToken(sa)); } catch (e) { /* reported as not found */ }
    }
    return res.status(200).json({
      connected: !!(sa && root),
      register: sheet ? { found: true, id: sheet.id, name: sheet.name || REGISTER_NAME } : { found: false, name: REGISTER_NAME },
      service_account_json: sa ? "ok" : (process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? "unparseable" : "missing"),
      root_folder_id: root ? "set" : "missing",
    });
  }
  if (!sa || !root) {
    return res.status(501).json({ error: "Register not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON and DRIVE_ROOT_FOLDER_ID in Vercel." });
  }

  try {
    const token = await accessToken(sa);

    // peek: the highest serial the register already holds for this family
    // and year — the floor next_sop_id() must clear. The register is the
    // authority; the DB counter only ever moves above it.
    if (action === "peek") {
      const family = S(req.query.family || "EB-C").toUpperCase();
      const reg = await findRegister(token);
      if (!reg) return res.status(200).json({ max: 0, register: false });
      const yy = new Date().getFullYear().toString().slice(-2);
      const re = new RegExp("^" + family.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "-" + yy + "-(\\d{4})$");
      const tab = family.startsWith("EB-D") ? "Deals" : "Clients";
      let max = 0;
      for (const v of await readCol(token, reg.id, tab, "A")) {
        const m = v.match(re);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      }
      return res.status(200).json({ max, register: true });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
    const b = req.body || {};
    const warnings = [];

    if (action === "client") {
      const clientId = S(b.clientId);
      const name = S(b.name);
      if (!clientId || !name) return res.status(400).json({ error: "clientId and name required" });

      // Law 6: register row first…
      let registered = false, duplicate = false, row = 0;
      const reg = await findRegister(token);
      if (reg) {
        try {
          const colA = await readCol(token, reg.id, "Clients", "A");
          const at = colA.lastIndexOf(clientId);
          duplicate = at !== -1;
          if (duplicate) row = at + 3;   // so a retry still repairs the link-back
          else {
            row = await appendVerified(token, reg.id, "Clients", clientId, [
              clientId, C(b.legacyId), C(name), C(b.sector), C(b.orgSize),
              C(b.status) || "Active", "", new Date().toISOString().slice(0, 10),
              C(b.addedBy), C(b.poc), C(b.notes),
            ]);
            registered = true;
          }
        } catch (e) {
          // Law 6, hard: the register is REACHABLE but would not take the
          // row — creating a folder for an ID the authority never recorded
          // is exactly what the law forbids. Fail so the caller retries.
          return res.status(502).json({ error: "register append failed on Clients for " + clientId + ": " + String(e.message || e), registered: false, warnings });
        }
      } else {
        warnings.push("Master register sheet '" + REGISTER_NAME + "' not found — share it with " + sa.client_email);
      }

      // …then the folder, and the link written back into the row.
      let folder = null;
      try {
        folder = (await findClientFolder(token, root, clientId, name)) || (await createFolder(token, root, clientId + " — " + name));
      } catch (e) { warnings.push("folder: " + String(e.message || e)); }
      if (folder && reg && row) {
        try { await updateCell(token, reg.id, "Clients", "G" + row, linkOf(folder)); }
        catch (e) { warnings.push("link-back: " + String(e.message || e)); }
      }
      return res.status(200).json({
        ok: true, registered, duplicate,
        folderId: folder ? folder.id : null, folderLink: folder ? linkOf(folder) : null,
        warnings,
      });
    }

    if (action === "deal") {
      const dealId = S(b.dealId);
      const clientId = S(b.clientId);
      if (!dealId) return res.status(400).json({ error: "dealId required" });

      let registered = false, duplicate = false, row = 0;
      const reg = await findRegister(token);
      if (reg) {
        try {
          const colA = await readCol(token, reg.id, "Deals", "A");
          const at = colA.lastIndexOf(dealId);
          duplicate = at !== -1;
          if (duplicate) row = at + 3;   // so a retry still repairs the link-back
          else {
            row = await appendVerified(token, reg.id, "Deals", dealId, [
              dealId, clientId, C(b.dealName), C(b.status) || "Open",
              C(b.value), C(b.currency) || "INR", C(b.owner),
              C(b.dateOpened) || new Date().toISOString().slice(0, 10),
              "", "", "", "", C(b.notes),
            ]);
            registered = true;
          }
        } catch (e) {
          // Same Law-6 hard stop as the client branch: reachable register,
          // unrecorded ID → no folder, retryable error.
          return res.status(502).json({ error: "register append failed on Deals for " + dealId + ": " + String(e.message || e), registered: false, warnings });
        }
      } else {
        warnings.push("Master register sheet '" + REGISTER_NAME + "' not found — share it with " + sa.client_email);
      }

      // The deal folder lives INSIDE the client folder; the brief file is
      // "the information inside" the SOP asks for, seeded at birth.
      let folder = null;
      try {
        const clientFolder = clientId
          ? (await findClientFolder(token, root, clientId, S(b.clientName))) || (await createFolder(token, root, clientId + " — " + S(b.clientName)))
          : null;
        const parent = clientFolder ? clientFolder.id : root;
        folder = (await findFolder(token, parent, dealId));
        if (folder) {
          // findFolder can match anywhere; only trust a hit under the parent.
          const check = await gdrive(token, "files/" + encodeURIComponent(folder.id), { fields: "id,parents", supportsAllDrives: "true" });
          if (!(check.parents || []).includes(parent)) folder = null;
        }
        if (!folder) {
          folder = await createFolder(token, parent, dealId);
          if (b.brief) await writeFile(token, folder.id, "00 — Deal brief.md", String(b.brief).slice(0, 60000));
        }
      } catch (e) { warnings.push("folder: " + String(e.message || e)); }
      if (folder && reg && row) {
        try { await updateCell(token, reg.id, "Deals", "L" + row, linkOf(folder)); }
        catch (e) { warnings.push("link-back: " + String(e.message || e)); }
      }
      return res.status(200).json({
        ok: true, registered, duplicate,
        folderId: folder ? folder.id : null, folderLink: folder ? linkOf(folder) : null,
        warnings,
      });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
}
