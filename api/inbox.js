// Communications intake — client email, fetched on demand.
//
// The sales manager records the client's email addresses on the company's
// Comms tab; this function reads a mailbox via the Gmail API and returns
// every message to/from those addresses. The app then runs AI over them:
// touches on the record, to-dos raised.
//
// ── TWO WAYS IN, AND THE CHOICE MATTERS ───────────────────────────────────
//
// 1. ONE MAILBOX, CONSENTED ONCE  (preferred)
//    That mailbox signs in once and approves gmail.readonly; the resulting
//    refresh token is stored here. The app can read THAT INBOX AND NOTHING
//    ELSE, no Workspace admin is involved, and the mailbox owner can revoke
//    it themselves from their Google account's security page.
//
//      INBOX_OAUTH_CLIENT_ID      Google Cloud → APIs & Services →
//      INBOX_OAUTH_CLIENT_SECRET    Credentials → OAuth client (Web app)
//      INBOX_OAUTH_REFRESH_TOKEN  minted by action=oauth-url → consent
//      INBOX_GMAIL_USER           the address that token belongs to
//
//    Setup is self-serve — see actions oauth-url / oauth-callback below.
//
// 2. SERVICE ACCOUNT IMPERSONATION  (fallback, and a bigger hammer)
//    The Drive service account acts as the mailbox through Workspace
//    domain-wide delegation. Delegation cannot be scoped to one mailbox:
//    granting it lets the key holder read EVERY mailbox on the domain. Use
//    it only where that is understood and intended.
//
//      GOOGLE_SERVICE_ACCOUNT_JSON  already set for Drive — reused here.
//      INBOX_GMAIL_USER             the mailbox to read.
//      Google Admin → Security → Access and data control → API controls →
//      Domain-wide delegation → add the service account's NUMERIC client ID
//      with scope https://www.googleapis.com/auth/gmail.readonly
//
// Per mailbox, the refresh token wins when it is configured for that exact
// address; otherwise impersonation is tried. Nothing else changes.
//
//   GET /api/inbox?action=status
//   GET /api/inbox?action=fetch&mailboxes=a@x.com,b@y.com[&q=extra][&max=25]
//   GET /api/inbox?action=oauth-url        the consent link to open, once
//   GET /api/inbox?action=oauth-callback   where Google returns the code;
//                                          prints the refresh token to store
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
  // Google reports this one as error:"unauthorized_client" with the detail in
  // error_description; the hint used to test only the description and so
  // never fired on the very error it exists to explain.
  if (!r.ok) {
    const both = (j.error || "") + " " + (j.error_description || "");
    throw new Error("gmail token: " + (j.error_description || j.error || r.status)
      + (/unauthorized_client|not authorized for any of the scopes/i.test(both)
        ? " — this service account has no domain-wide delegation for gmail.readonly."
          + " Either grant it (Google Admin → Security → Access and data control → API controls →"
          + " Domain-wide delegation → add the account's NUMERIC client ID, scope"
          + " https://www.googleapis.com/auth/gmail.readonly), or — narrower, and no admin needed —"
          + " set up a single consented mailbox: open /api/inbox?action=oauth-url."
        : ""));
  }
  return j.access_token;
}

/* ── ONE MAILBOX, CONSENTED ONCE ──────────────────────────────────────────
   A refresh token minted by that mailbox's own sign-in. It reaches exactly
   one inbox, needs no Workspace admin, and the owner can revoke it. Access
   tokens last an hour, so they are cached for the life of the lambda rather
   than re-minted on every fetch. */
const oauthCfg = () => ({
  id:      process.env.INBOX_OAUTH_CLIENT_ID || "",
  secret:  process.env.INBOX_OAUTH_CLIENT_SECRET || "",
  refresh: process.env.INBOX_OAUTH_REFRESH_TOKEN || "",
  user:    (process.env.INBOX_GMAIL_USER || "").trim().toLowerCase(),
});
const oauthReady = (c) => !!(c.id && c.secret && c.refresh && c.user);

const tokenCache = new Map();   // user → { token, exp }

async function oauthToken(c) {
  const hit = tokenCache.get(c.user);
  if (hit && hit.exp > Date.now() + 60000) return hit.token;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token", refresh_token: c.refresh,
      client_id: c.id, client_secret: c.secret,
    }),
  });
  const j = await r.json();
  if (!r.ok) {
    throw new Error("gmail token: " + (j.error_description || j.error || r.status)
      + (/invalid_grant/i.test(j.error || "")
        ? " — the stored refresh token is dead. It was revoked, the password changed, or"
          + " the OAuth consent screen is still in Testing (those tokens expire after 7 days —"
          + " set it to Internal, or publish it). Mint a new one at /api/inbox?action=oauth-url."
        : ""));
  }
  tokenCache.set(c.user, { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 });
  return j.access_token;
}

/* The consented mailbox wins for its own address; anything else falls back
   to impersonation, so a domain that has both keeps working. */
async function tokenFor(box, sa) {
  const c = oauthCfg();
  if (oauthReady(c) && box === c.user) return oauthToken(c);
  if (!sa) throw new Error("no credentials for " + box
    + " — either consent that mailbox (/api/inbox?action=oauth-url) or set GOOGLE_SERVICE_ACCOUNT_JSON.");
  return gmailToken(sa, box);
}

/* Where Google sends the browser back. Registered verbatim as an authorised
   redirect URI on the OAuth client, so it is derived from the request rather
   than guessed — preview deployments and the production domain differ. */
const redirectUri = (req) => {
  const proto = (req.headers["x-forwarded-proto"] || "https").toString().split(",")[0];
  const host  = (req.headers["x-forwarded-host"] || req.headers.host || "").toString().split(",")[0];
  return proto + "://" + host + "/api/inbox?action=oauth-callback";
};

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

  const oc = oauthCfg();

  if (action === "status") {
    const wa = !!process.env.WHATSAPP_TOKEN;
    const viaOauth = oauthReady(oc);
    return res.status(200).json({
      email: {
        configured: !!(mailbox && (viaOauth || sa)),
        mailbox: mailbox || null,
        method: viaOauth ? "consented mailbox (reads this inbox only)"
          : sa ? "service account impersonation (needs domain-wide delegation — reads any mailbox on the domain)"
          : "none",
        // Not a secret, and the single value people most often get wrong:
        // the Admin console wants this NUMBER, never the ...iam address.
        serviceAccount: sa ? { email: sa.client_email, clientId: sa.client_id || "(not in the key JSON)" } : null,
        oauth: {
          ready: viaOauth,
          have: { clientId: !!oc.id, clientSecret: !!oc.secret, refreshToken: !!oc.refresh, mailbox: !!oc.user },
          setUpAt: viaOauth ? null : "/api/inbox?action=oauth-url",
        },
        missing: [
          !mailbox && "INBOX_GMAIL_USER",
          !viaOauth && !sa && "either INBOX_OAUTH_* (one mailbox) or GOOGLE_SERVICE_ACCOUNT_JSON (whole domain)",
        ].filter(Boolean),
      },
      whatsapp: { configured: wa, missing: wa ? [] : ["WHATSAPP_TOKEN", "WHATSAPP_VERIFY_TOKEN"] },
    });
  }

  // ── One-time consent, so nobody has to hand-roll an OAuth dance ────────
  if (action === "oauth-url") {
    if (!oc.id) return res.status(501).json({ error: "INBOX_OAUTH_CLIENT_ID is not set. Google Cloud → APIs & Services → Credentials → Create OAuth client ID → Web application." });
    const uri = redirectUri(req);
    const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
      client_id: oc.id, redirect_uri: uri, response_type: "code", scope: GMAIL_SCOPE,
      // offline + consent together are what actually return a refresh token;
      // without prompt=consent a second run gives an access token only.
      access_type: "offline", prompt: "consent", include_granted_scopes: "true",
    });
    return res.status(200).json({
      open: url,
      redirectUri: uri,
      then: "Sign in AS THE MAILBOX you want read (not your own account), approve, and the next page shows the refresh token to store as INBOX_OAUTH_REFRESH_TOKEN.",
      note: "If Google says redirect_uri_mismatch, add " + uri + " verbatim to the OAuth client's Authorised redirect URIs.",
    });
  }

  if (action === "oauth-callback") {
    const code = (req.query.code || "").toString();
    if (req.query.error) return res.status(400).json({ error: "Google refused: " + req.query.error });
    if (!code) return res.status(400).json({ error: "no code — start at /api/inbox?action=oauth-url" });
    if (!oc.id || !oc.secret) return res.status(501).json({ error: "INBOX_OAUTH_CLIENT_ID / INBOX_OAUTH_CLIENT_SECRET not set" });
    const r = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, client_id: oc.id, client_secret: oc.secret,
        redirect_uri: redirectUri(req), grant_type: "authorization_code",
      }),
    });
    const j = await r.json();
    if (!r.ok) return res.status(502).json({ error: j.error_description || j.error || ("HTTP " + r.status) });
    if (!j.refresh_token) {
      return res.status(200).json({ error: "Google returned no refresh token — this account has already granted consent. Revoke it at https://myaccount.google.com/permissions and run oauth-url again." });
    }
    // Which mailbox actually consented: worth stating, because consenting as
    // the wrong account is the easy mistake and it fails silently later.
    let who = "";
    try {
      const p = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile",
        { headers: { Authorization: "Bearer " + j.access_token } }).then((x) => x.json());
      who = p.emailAddress || "";
    } catch (e) { /* the token is the point; the name is a courtesy */ }
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({
      consentedAs: who || "(could not read the address)",
      INBOX_OAUTH_REFRESH_TOKEN: j.refresh_token,
      INBOX_GMAIL_USER: who || mailbox || "(set this to the address above)",
      next: "Store both in Vercel → Settings → Environment Variables, redeploy, then check /api/inbox?action=status.",
      warning: "This token reads that inbox until revoked. Treat it as a password: store it, do not paste it anywhere else, and revoke at https://myaccount.google.com/permissions if it leaks.",
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
    if (!sa && !oauthReady(oc)) {
      return res.status(501).json({ error: "Email intake has no credentials. Either consent one mailbox — open /api/inbox?action=oauth-url, which needs no Workspace admin and reads that inbox only — or set GOOGLE_SERVICE_ACCOUNT_JSON and grant it domain-wide delegation for gmail.readonly." });
    }
    // The mailbox(es) with access come from the request (e.g. sales@elecbits.in,
    // comma-separated); INBOX_GMAIL_USER is only the fallback default.
    const boxes = ((req.query.mailboxes || mailbox || "").toString())
      .split(",").map((x) => x.trim().toLowerCase()).filter((x) => x.includes("@")).slice(0, 4);
    if (!boxes.length) return res.status(400).json({ error: "mailboxes required — the address(es) with access, e.g. sales@elecbits.in" });
    const extra = (req.query.q || "").toString().trim();   // optional Gmail search terms
    const max = Math.min(parseInt(req.query.max, 10) || 30, 60);
    const out = [];
    const errors = [];
    for (const box of boxes) {
      try {
        const token = await tokenFor(box, sa);
        const q = extra || "newer_than:45d -category:promotions -category:social";
        const list = await gm(token, box, "messages", { q, maxResults: String(max) });
        for (const m of (list.messages || []).slice(0, max)) {
          try {
            const msg = await gm(token, box, "messages/" + m.id, { format: "metadata", metadataHeaders: "From,To,Subject,Date" });
            out.push({
              id: m.id, threadId: msg.threadId, mailbox: box,
              from: header(msg, "From"), to: header(msg, "To"),
              subject: header(msg, "Subject"), date: header(msg, "Date"),
              snippet: msg.snippet || "",
            });
          } catch (e) { /* one bad message never sinks the fetch */ }
        }
      } catch (e) { errors.push(box + ": " + String(e.message || e)); }
    }
    if (!out.length && errors.length) return res.status(502).json({ error: errors.join(" · ") });
    return res.status(200).json({ mailboxes: boxes, count: out.length, messages: out, errors: errors.length ? errors : undefined });
  }

  return res.status(400).json({ error: "unknown action" });
}
