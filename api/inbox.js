// Communications intake — client email, fetched on demand.
//
// The sales manager records the client's email addresses on the company's
// Comms tab; this function reads the shared sales mailbox via the Gmail API
// (the existing Drive service account, impersonating the mailbox through
// domain-wide delegation) and returns every message to/from those addresses.
// The app then runs AI over them: touches on the record, to-dos raised.
//
// Env (Vercel, server-only):
//   GOOGLE_SERVICE_ACCOUNT_JSON   already set for Drive — reused here.
//   INBOX_GMAIL_USER              the mailbox to read, e.g. sales@elecbits.in.
//     One-time Google Admin step: Security → API controls → domain-wide
//     delegation → add the service account's client ID with scope
//     https://www.googleapis.com/auth/gmail.readonly
//
//   GET /api/inbox?action=status
//   GET /api/inbox?action=fetch&emails=a@x.com,b@y.com[&q=extra][&max=25]
//
// WhatsApp (webhook receiver) stays scaffolded behind WHATSAPP_* vars.

import crypto from "node:crypto";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

function fixPem(k) {
  if (!k || k.includes("\n")) return k;
  const m = k.match(/-----BEGIN PRIVATE KEY-----(.*)-----END PRIVATE KEY-----/s);
  if (!m) return k;
  const body = m[1].replace(/\s+/g, "");
  return "-----BEGIN PRIVATE KEY-----\n" + body.replace(/(.{64})/g, "$1\n").trim() + "\n-----END PRIVATE KEY-----\n";
}
function serviceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  const t = raw.trim();
  const parse = (x) => { try { const sa = JSON.parse(x); if (sa.client_email && sa.private_key) { sa.private_key = fixPem(sa.private_key); return sa; } } catch (e) {} return null; };
  if (!t.startsWith("{")) { try { return parse(Buffer.from(t, "base64").toString("utf8")); } catch (e) { return null; } }
  return parse(t) || parse(t.replace(/\r?\n/g, ""));
}
const b64url = (buf) => Buffer.from(buf).toString("base64url");

// Impersonated token: same JWT dance as Drive, plus the `sub` claim that
// makes the service account act as the mailbox owner.
async function gmailToken(sa, user) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: sa.client_email, sub: user, scope: GMAIL_SCOPE,
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(header + "." + claims);
  const jwt = header + "." + claims + "." + b64url(signer.sign(sa.private_key));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("gmail token: " + (j.error_description || j.error || r.status)
    + (String(j.error_description || "").includes("unauthorized_client")
      ? " — the service account's client ID needs domain-wide delegation with the gmail.readonly scope (Google Admin → Security → API controls)." : ""));
  return j.access_token;
}

async function gm(token, user, path, params) {
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/" + encodeURIComponent(user) + "/" + path);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
  const j = await r.json();
  if (!r.ok) throw new Error("gmail: " + (j.error?.message || r.status));
  return j;
}

const header = (msg, name) => {
  const h = (msg.payload?.headers || []).find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h ? h.value : "";
};

export default async function handler(req, res) {
  const action = (req.query.action || "status").toString();
  const sa = serviceAccount();
  const mailbox = process.env.INBOX_GMAIL_USER || "";

  if (action === "status") {
    const wa = !!process.env.WHATSAPP_TOKEN;
    return res.status(200).json({
      email: { configured: !!(sa && mailbox), mailbox: mailbox || null,
        missing: [!sa && "GOOGLE_SERVICE_ACCOUNT_JSON", !mailbox && "INBOX_GMAIL_USER"].filter(Boolean),
        note: sa && mailbox ? "" : "Also grant the service account domain-wide delegation with the gmail.readonly scope." },
      whatsapp: { configured: wa, missing: wa ? [] : ["WHATSAPP_TOKEN", "WHATSAPP_VERIFY_TOKEN"] },
    });
  }

  // WhatsApp webhook verification handshake.
  if (req.method === "GET" && req.query["hub.mode"] === "subscribe") {
    if (req.query["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(req.query["hub.challenge"]);
    }
    return res.status(403).json({ error: "verify token mismatch" });
  }

  if (action === "fetch") {
    if (!sa || !mailbox) {
      return res.status(501).json({ error: "Email intake is not configured. Set INBOX_GMAIL_USER (the mailbox to read) in Vercel — the Drive service account is reused, plus one Google Admin delegation step (gmail.readonly)." });
    }
    const emails = (req.query.emails || "").toString().split(",").map((x) => x.trim()).filter((x) => x.includes("@"));
    if (!emails.length) return res.status(400).json({ error: "emails required (comma-separated)" });
    const extra = (req.query.q || "").toString().trim();
    const max = Math.min(parseInt(req.query.max, 10) || 25, 50);
    try {
      const token = await gmailToken(sa, mailbox);
      const who = emails.map((e) => "from:" + e + " OR to:" + e).join(" OR ");
      const q = "(" + who + ")" + (extra ? " " + extra : "");
      const list = await gm(token, mailbox, "messages", { q, maxResults: String(max) });
      const out = [];
      for (const m of (list.messages || []).slice(0, max)) {
        try {
          const msg = await gm(token, mailbox, "messages/" + m.id, { format: "metadata", metadataHeaders: "From,To,Subject,Date" });
          out.push({
            id: m.id, threadId: msg.threadId,
            from: header(msg, "From"), to: header(msg, "To"),
            subject: header(msg, "Subject"), date: header(msg, "Date"),
            snippet: msg.snippet || "",
          });
        } catch (e) { /* one bad message never sinks the fetch */ }
      }
      return res.status(200).json({ mailbox, query: q, count: out.length, messages: out });
    } catch (e) {
      return res.status(502).json({ error: String(e.message || e) });
    }
  }

  return res.status(400).json({ error: "unknown action" });
}
