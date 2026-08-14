// Google Drive proxy — one folder per company under a shared root.
//
// Zero dependencies: the service-account JWT is signed with node:crypto and
// exchanged for an access token at Google's token endpoint. Configure two
// Vercel env vars and the whole feature lights up (until then the app shows
// a "not connected" card):
//
//   GOOGLE_SERVICE_ACCOUNT_JSON  the service account's key file — the full
//                                JSON, or the same base64-encoded
//   DRIVE_ROOT_FOLDER_ID         the Drive folder that holds all company
//                                folders. Share it with the service account's
//                                client_email (Editor) or nothing is visible.
//
// GET  /api/drive?action=status              → { connected }
// GET  /api/drive?action=open&name=X         → { id, link }   (find-or-create)
// GET  /api/drive?action=list&name=X         → { id, link, files: [...] }

import crypto from "node:crypto";

const SCOPE = "https://www.googleapis.com/auth/drive";

// A PEM key that lost its newlines (hard-wrapped paste, stripped \n escapes)
// gets rebuilt: header/footer on their own lines, 64-char body lines.
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
  // Paste-mangled variants, most-likely first: verbatim; raw newlines that
  // belong inside the key re-escaped; raw newlines stripped entirely.
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
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt,
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("token: " + (j.error_description || j.error || r.status));
  return j.access_token;
}

async function gapi(token, path, params, init = {}) {
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

// Folder names carry user text — escape for the Drive query language.
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

const FOLDER_MIME = "application/vnd.google-apps.folder";

// Finding a folder to READ must not be limited to the root's direct children —
// real Drives nest, and a folder two levels down was reported "empty" simply
// because the lookup never found it. Creating still happens under the root.
async function findFolder(token, root, name) {
  const byName = `name = '${esc(name)}' and mimeType = '${FOLDER_MIME}' and trashed = false`;
  const under = await gapi(token, "files", {
    q: `'${esc(root)}' in parents and ` + byName,
    fields: "files(id,name,webViewLink)", supportsAllDrives: "true", includeItemsFromAllDrives: "true",
  });
  if (under.files && under.files.length) return under.files[0];
  const anywhere = await gapi(token, "files", {
    q: byName, fields: "files(id,name,webViewLink)", pageSize: "10",
    supportsAllDrives: "true", includeItemsFromAllDrives: "true",
  });
  return (anywhere.files && anywhere.files[0]) || null;
}

async function createFolder(token, root, name) {
  return gapi(token, "files", { fields: "id,name,webViewLink", supportsAllDrives: "true" }, {
    method: "POST",
    body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [root] }),
  });
}

async function childrenOf(token, id, pageSize = 100) {
  const l = await gapi(token, "files", {
    q: `'${esc(id)}' in parents and trashed = false`,
    fields: "files(id,name,mimeType,modifiedTime,webViewLink,size)",
    orderBy: "folder,modifiedTime desc", pageSize: String(pageSize),
    supportsAllDrives: "true", includeItemsFromAllDrives: "true",
  });
  return (l.files || []).map((x) => ({
    id: x.id, name: x.name, mime: x.mimeType, folder: x.mimeType === FOLDER_MIME,
    modified: x.modifiedTime, link: x.webViewLink, size: x.size ? Number(x.size) : null,
  }));
}

export default async function handler(req, res) {
  const sa = serviceAccount();
  const root = process.env.DRIVE_ROOT_FOLDER_ID;
  const action = (req.query.action || "status").toString();

  if (action === "status") {
    // Spell out which half is missing so nobody has to guess from `false`.
    return res.status(200).json({
      connected: !!(sa && root),
      email: sa ? sa.client_email : null,
      service_account_json: sa ? "ok" : (process.env.GOOGLE_SERVICE_ACCOUNT_JSON ? "unparseable" : "missing"),
      root_folder_id: root ? "set" : "missing",
    });
  }
  if (!sa || !root) {
    return res.status(501).json({ error: "Drive not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON and DRIVE_ROOT_FOLDER_ID in Vercel." });
  }

  try {
    const token = await accessToken(sa);

    // Listings that don't need a folder name: the root's own folders, and a
    // name search across everything shared with the service account.
    if (action === "root") {
      const l = await gapi(token, "files", {
        q: `'${esc(root)}' in parents and trashed = false`,
        fields: "files(id,name,mimeType,modifiedTime,webViewLink)",
        orderBy: "name", pageSize: "100",
        supportsAllDrives: "true", includeItemsFromAllDrives: "true",
      });
      return res.status(200).json({
        files: (l.files || []).map((x) => ({ id: x.id, name: x.name, mime: x.mimeType, modified: x.modifiedTime, link: x.webViewLink })),
      });
    }
    if (action === "search") {
      const term = (req.query.q || "").toString().trim();
      if (!term) return res.status(400).json({ error: "q required" });
      const l = await gapi(token, "files", {
        q: `name contains '${esc(term)}' and trashed = false`,
        fields: "files(id,name,mimeType,modifiedTime,webViewLink,parents)",
        orderBy: "modifiedTime desc", pageSize: "30",
        supportsAllDrives: "true", includeItemsFromAllDrives: "true",
      });
      return res.status(200).json({
        files: (l.files || []).map((x) => ({ id: x.id, name: x.name, mime: x.mimeType, modified: x.modifiedTime, link: x.webViewLink })),
      });
    }

    const name = (req.query.name || "").toString().trim();
    if (!name) return res.status(400).json({ error: "name required" });

    // verify: does the artifact a person claims to have saved actually exist?
    // Looks in the company folder and one level of sub-folders, matching
    // loosely on name so "MoM 14 Aug" finds "2026-08-14_MoM_Sunrise.docx".
    if (action === "verify") {
      const claim = (req.query.file || "").toString().trim();
      if (!claim) return res.status(400).json({ error: "file required" });
      const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const words = norm(claim).split(" ").filter((w) => w.length > 2);
      const hit = (n) => { const t = norm(n); return t === norm(claim) || words.length > 0 && words.every((w) => t.includes(w)); };

      const f = await findFolder(token, root, name);
      const pool = [];
      if (f) {
        const kids = await childrenOf(token, f.id);
        pool.push(...kids.filter((k) => !k.folder).map((k) => ({ ...k, where: f.name })));
        for (const sub of kids.filter((k) => k.folder).slice(0, 8)) {
          const c = await childrenOf(token, sub.id, 60);
          pool.push(...c.filter((k) => !k.folder).map((k) => ({ ...k, where: f.name + "/" + sub.name })));
        }
      }
      let matches = pool.filter((x) => hit(x.name));
      // Not in the company folder — is it anywhere the tool can see?
      if (!matches.length) {
        const g = await gapi(token, "files", {
          q: `name contains '${esc(claim.slice(0, 40))}' and trashed = false`,
          fields: "files(id,name,modifiedTime,webViewLink,parents)", pageSize: "10",
          supportsAllDrives: "true", includeItemsFromAllDrives: "true",
        });
        matches = (g.files || []).map((x) => ({ name: x.name, link: x.webViewLink, modified: x.modifiedTime, where: "elsewhere in Drive" }));
      }
      return res.status(200).json({
        folderFound: !!f, folder: f ? f.name : name, scanned: pool.length,
        found: matches.length > 0,
        matches: matches.slice(0, 5).map((m) => ({ name: m.name, where: m.where, modified: m.modified, link: m.link })),
      });
    }

    // deep: the folder, plus what is inside each of its sub-folders. This is
    // what "check inside all these folders" needs — one call, not ten.
    if (action === "deep") {
      const f = await findFolder(token, root, name);
      if (!f) return res.status(200).json({ found: false, name, files: [], folders: [] });
      const kids = await childrenOf(token, f.id);
      const subs = kids.filter((k) => k.folder).slice(0, 12);
      const inside = [];
      for (const s of subs) {
        const c = await childrenOf(token, s.id, 40);
        inside.push({ folder: s.name, link: s.link, count: c.length, files: c.map((x) => ({ name: x.name, folder: x.folder, modified: x.modified, link: x.link })) });
      }
      return res.status(200).json({
        found: true, name: f.name, link: f.webViewLink,
        files: kids.filter((k) => !k.folder), folders: kids.filter((k) => k.folder).map((k) => k.name),
        inside,
      });
    }
    if (action === "open") {
      const f = (await findFolder(token, root, name)) || (await createFolder(token, root, name));
      return res.status(200).json({ id: f.id, link: f.webViewLink || ("https://drive.google.com/drive/folders/" + f.id) });
    }
    if (action === "list") {
      const f = await findFolder(token, root, name);
      if (!f) return res.status(200).json({ found: false, id: null, link: null, files: [], folders: [] });
      const kids = await childrenOf(token, f.id);
      return res.status(200).json({
        found: true, id: f.id, name: f.name,
        link: f.webViewLink || ("https://drive.google.com/drive/folders/" + f.id),
        files: kids.filter((k) => !k.folder),
        folders: kids.filter((k) => k.folder).map((k) => ({ name: k.name, link: k.link })),
      });
    }
    // write: POST { name, folder?, fileName, content, mimeType? }
    // Files a document into the company folder (creating the sub-folder on
    // first use), so a write-up lands in Drive without anybody uploading it.
    if (action === "write") {
      if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
      const b = req.body || {};
      const fileName = String(b.fileName || "").trim();
      if (!b.name || !fileName) return res.status(400).json({ error: "name and fileName required" });
      const f = (await findFolder(token, root, b.name)) || (await createFolder(token, root, b.name));
      let parent = f.id;
      if (b.folder) {
        const kids = await childrenOf(token, f.id);
        const sub = kids.find((k) => k.folder && k.name.toLowerCase() === String(b.folder).toLowerCase());
        parent = sub ? sub.id : (await createFolder(token, f.id, b.folder)).id;
      }
      const boundary = "eb" + Math.random().toString(36).slice(2);
      const meta = JSON.stringify({ name: fileName, parents: [parent] });
      const payload =
        "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + meta + "\r\n" +
        "--" + boundary + "\r\nContent-Type: " + (b.mimeType || "text/markdown") + "; charset=UTF-8\r\n\r\n" + (b.content || "") + "\r\n" +
        "--" + boundary + "--";
      const r = await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink",
        { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "multipart/related; boundary=" + boundary }, body: payload });
      const j = await r.json();
      if (!r.ok) return res.status(502).json({ error: (j.error && j.error.message) || ("upload " + r.status) });
      return res.status(200).json({ ok: true, id: j.id, name: j.name, link: j.webViewLink, folder: b.folder || f.name });
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
}
