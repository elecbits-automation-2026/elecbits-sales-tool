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

async function findOrCreateFolder(token, root, name, create) {
  const q = `'${esc(root)}' in parents and name = '${esc(name)}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const found = await gapi(token, "files", {
    q, fields: "files(id,name,webViewLink)", supportsAllDrives: "true", includeItemsFromAllDrives: "true",
  });
  if (found.files && found.files.length) return found.files[0];
  if (!create) return null;
  return gapi(token, "files", { fields: "id,name,webViewLink", supportsAllDrives: "true" }, {
    method: "POST",
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [root] }),
  });
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
    if (action === "open") {
      const f = await findOrCreateFolder(token, root, name, true);
      return res.status(200).json({ id: f.id, link: f.webViewLink || ("https://drive.google.com/drive/folders/" + f.id) });
    }
    if (action === "list") {
      const f = await findOrCreateFolder(token, root, name, false);
      if (!f) return res.status(200).json({ id: null, link: null, files: [] });
      const l = await gapi(token, "files", {
        q: `'${esc(f.id)}' in parents and trashed = false`,
        fields: "files(id,name,mimeType,modifiedTime,webViewLink,iconLink,size)",
        orderBy: "modifiedTime desc", pageSize: "50",
        supportsAllDrives: "true", includeItemsFromAllDrives: "true",
      });
      return res.status(200).json({
        id: f.id, link: f.webViewLink || ("https://drive.google.com/drive/folders/" + f.id),
        files: (l.files || []).map((x) => ({
          id: x.id, name: x.name, mime: x.mimeType, modified: x.modifiedTime,
          link: x.webViewLink, icon: x.iconLink, size: x.size ? Number(x.size) : null,
        })),
      });
    }
    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
}
