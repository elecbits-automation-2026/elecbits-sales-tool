// ═══════════════════════════════════════════════════════════════════════════
// MEET — schedule a Google Meet from the app.
//
// The event is created on the CALLER'S OWN calendar, not a shared robot
// account, so it appears in their diary, the invitees see who called the
// meeting, and the Meet belongs to a real person. Fireflies can be invited at
// the same time, which is what closes the loop: schedule here, talk there, and
// the transcript comes back into the daily scrum on its own.
//
//   POST { action: "create",   date, startTime, endTime, title, description,
//                              attendees[], companyId, recordWithFireflies }
//   POST { action: "upcoming" }                     the caller's next calls
//   POST { action: "cancel",   eventId }            call it off, tell everyone
//   GET  ?action=status                             is this configured?
//
// Google Calendar is the store. Nothing about the meeting is duplicated into
// our database: a second copy of a diary is a second copy to get out of date.
//
// ── ENV (Vercel → Settings → Environment Variables, server-only) ──────────
//   GOOGLE_SERVICE_ACCOUNT_JSON   ALREADY SET if Drive works — same account.
//   GOOGLE_IMPERSONATE_USER       e.g. you@elecbits.in. The fallback identity,
//                                 and the one used for anyone outside the
//                                 Workspace domain.
//   GOOGLE_WORKSPACE_DOMAIN       optional; derived from the address above.
//   FIREFLIES_NOTETAKER_EMAIL     optional; defaults to fred@fireflies.ai
//   SUPABASE_URL / SUPABASE_ANON_KEY   to identify the caller.
//
// ── TWO THINGS TO DO IN THE GOOGLE CONSOLES ───────────────────────────────
// 1. Cloud console → APIs & Services → Enable the **Google Calendar API**.
// 2. Admin console → Security → Access and data control → API controls →
//    Domain-wide delegation → edit THIS service account's client ID → add
//    https://www.googleapis.com/auth/calendar.events
//    Calendar is a separate scope from Drive. Adding it to a DIFFERENT client
//    ID does nothing; it must be the same one, or every call here comes back
//    "unauthorized_client".
// ═══════════════════════════════════════════════════════════════════════════

import crypto from "node:crypto";

const CAL_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const CAL = "https://www.googleapis.com/calendar/v3";

const IMPERSONATE = (process.env.GOOGLE_IMPERSONATE_USER || "").trim().toLowerCase();
// `||` not `??`: an env var that is set-but-empty is unset in every way that
// matters, and `??` would keep the empty string.
const WORKSPACE_DOMAIN = ((process.env.GOOGLE_WORKSPACE_DOMAIN || "").trim()
  || IMPERSONATE.split("@")[1] || "").toLowerCase();
const NOTETAKER = (process.env.FIREFLIES_NOTETAKER_EMAIL || "fred@fireflies.ai").trim().toLowerCase();
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SUPABASE_ANON = process.env.SUPABASE_ANON_KEY || "";

/* ── service account: the same parsing api/drive.js uses ──────────────────
   Kept as its own copy rather than shared, because a serverless function that
   imports across files pulls the other file's env expectations in with it.
   Two short copies beat one shared module that fails for a reason belonging
   to a different endpoint. */

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
  } catch { return null; }
}
function serviceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  const t = raw.trim();
  if (!t.startsWith("{")) {
    try { return tryParse(Buffer.from(t, "base64").toString("utf8")); } catch { return null; }
  }
  return tryParse(t)
      || tryParse(t.replace(/(-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----)/,
                            (s) => s.replace(/\r?\n/g, "\\n")))
      || tryParse(t.replace(/\r?\n/g, ""));
}

const b64url = (buf) => Buffer.from(buf).toString("base64url");

/* Only someone in the Workspace can have a meeting created AS them; anyone
   else falls back to the shared account. */
const subjectFor = (email) =>
  (email && WORKSPACE_DOMAIN && email.endsWith("@" + WORKSPACE_DOMAIN)) ? email : IMPERSONATE;

// Warm across invocations while a container is reused; harmless when it is not.
const tokenCache = new Map();
const noDelegation = new Set();

async function accessToken(sa, subject) {
  const sub = noDelegation.has(subject) ? IMPERSONATE : subject;
  const hit = tokenCache.get(sub);
  if (hit && hit.exp > Date.now() + 60000) return hit.token;

  const now = Math.floor(Date.now() / 1000);
  const input = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." +
    b64url(JSON.stringify({
      iss: sa.client_email, ...(sub ? { sub } : {}), scope: CAL_SCOPE,
      aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
    }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(input);
  const jwt = input + "." + b64url(signer.sign(sa.private_key));

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt,
    }),
  });
  const data = await r.json();
  if (!r.ok) {
    // Match the MACHINE-READABLE code, not the sentence beside it. Google's
    // code is `unauthorized_client` while its description reads "Client is
    // unauthorized to retrieve access tokens…" — testing only the description
    // silently skips the fallback and hides the useful error underneath.
    const code = String(data?.error || "");
    const why = String(data?.error_description || data?.error || r.status);
    if (/unauthorized_client|access_denied|invalid_grant/i.test(code)
        || /unauthorized|not authorized|access denied|delegation/i.test(why)) {
      // Delegation refused for THIS person — remember it and use the shared
      // account rather than failing outright. But if the scope itself was
      // never granted, no subject will work, and saying so saves an hour.
      if (sub && sub !== IMPERSONATE) {
        noDelegation.add(sub);
        return accessToken(sa, IMPERSONATE);
      }
      throw new Error(
        `Google refused the calendar scope (${why}). Add ${CAL_SCOPE} to this service account's ` +
        `client ID under Admin console → Security → API controls → Domain-wide delegation, ` +
        `and make sure the Google Calendar API is enabled for the project.`);
    }
    throw new Error("Google refused the token: " + why);
  }
  tokenCache.set(sub, { token: data.access_token, exp: Date.now() + (Number(data.expires_in) || 3600) * 1000 });
  return data.access_token;
}

/** Who is calling? Their Supabase JWT answers. */
async function caller(req, bodyJwt) {
  const auth = req.headers.authorization || (bodyJwt ? "Bearer " + bodyJwt : "");
  if (!auth.toLowerCase().startsWith("bearer ") || !SUPABASE_URL) return null;
  try {
    const r = await fetch(SUPABASE_URL + "/auth/v1/user", {
      headers: { apikey: SUPABASE_ANON, authorization: auth },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id ? { id: u.id, email: String(u.email || "").trim().toLowerCase() } : null;
  } catch { return null; }
}

/* A local wall-clock time in a named zone → the RFC3339 Calendar wants.
   Sending the date and the timeZone separately is the whole trick: Google
   applies the zone, so nobody has to compute an offset that daylight saving
   would invalidate twice a year anyway. */
const dateTime = (day, hhmm) => `${day}T${(hhmm || "09:00").padStart(5, "0")}:00`;

const meetLinkOf = (ev) =>
  ev?.hangoutLink
  || (ev?.conferenceData?.entryPoints || []).find((e) => e?.entryPointType === "video")?.uri
  || "";

export default async function handler(req, res) {
  const sa = serviceAccount();

  // ── status: answers without credentials, so the UI can show a card and
  //    scripts/check-sales.mjs can tell apart "not deployed" / "not
  //    configured" / "working".
  if (req.method === "GET") {
    const missing = [];
    if (!sa) missing.push("GOOGLE_SERVICE_ACCOUNT_JSON");
    if (!IMPERSONATE) missing.push("GOOGLE_IMPERSONATE_USER");
    if (!SUPABASE_URL) missing.push("SUPABASE_URL");
    return res.status(200).json({
      connected: missing.length === 0,
      reason: missing.length ? "missing " + missing.join(", ") : "",
      notetaker: NOTETAKER,
      organiserFallback: IMPERSONATE || null,
    });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  if (!sa) {
    return res.status(500).json({ error: "Google is not configured (missing GOOGLE_SERVICE_ACCOUNT_JSON)." });
  }

  const body = req.body || {};
  const who = await caller(req, body.userJwt);
  if (!who) return res.status(401).json({ error: "Sign in first — a meeting has to belong to somebody." });

  const subject = subjectFor(who.email);
  if (!subject) {
    return res.status(500).json({ error: "No Google account to create the meeting as — set GOOGLE_IMPERSONATE_USER in Vercel." });
  }

  let token;
  try { token = await accessToken(sa, subject); }
  catch (e) { return res.status(502).json({ error: String(e.message || e) }); }

  const tz = String(body.timeZone || "Asia/Kolkata");
  const authz = { authorization: "Bearer " + token, "content-type": "application/json" };

  try {
    /* ── create ─────────────────────────────────────────────────────────── */
    if (body.action === "create") {
      const day = String(body.date || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return res.status(400).json({ error: "Give me a date as YYYY-MM-DD." });
      const start = String(body.startTime || "09:00").slice(0, 5);
      const end = String(body.endTime || "").slice(0, 5)
        || `${String((Number(start.slice(0, 2)) + 1) % 24).padStart(2, "0")}:${start.slice(3, 5)}`;
      if (dateTime(day, end) <= dateTime(day, start)) {
        return res.status(400).json({ error: "The meeting has to end after it starts." });
      }

      const invitees = [...new Set(
        (body.attendees || []).map((a) => String(a || "").trim().toLowerCase()).filter((a) => a.includes("@")),
      )];
      // Inviting the notetaker is what gets the call recorded. Opt-in, because
      // not every meeting should be.
      if (body.recordWithFireflies && NOTETAKER) invitees.push(NOTETAKER);

      const event = {
        summary: String(body.title || "Elecbits meeting").slice(0, 250),
        description: [String(body.description || "").trim(),
                      body.companyName ? "Account: " + body.companyName : ""]
          .filter(Boolean).join("\n\n") || undefined,
        start: { dateTime: dateTime(day, start), timeZone: tz },
        end: { dateTime: dateTime(day, end), timeZone: tz },
        attendees: invitees.map((email) => ({ email })),
        // requestId must be unique per request or Google reuses the previous
        // conference — which is how two different meetings end up on one link.
        conferenceData: {
          createRequest: {
            requestId: `eb-${day}-${start.replace(":", "")}-${crypto.randomUUID().slice(0, 8)}`,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
        // The account this call was about, kept on the event so it can be
        // traced back to the work later.
        extendedProperties: body.companyId
          ? { private: { elecbitsCompanyId: String(body.companyId) } }
          : undefined,
      };

      // conferenceDataVersion=1 is NOT optional: without it Google silently
      // ignores the createRequest and returns an event with no Meet link.
      const r = await fetch(
        `${CAL}/calendars/primary/events?conferenceDataVersion=1&sendUpdates=all`,
        { method: "POST", headers: authz, body: JSON.stringify(event) });
      const ev = await r.json();
      if (!r.ok) return res.status(502).json({ error: "Google wouldn't create the meeting: " + (ev?.error?.message || r.status) });

      const link = meetLinkOf(ev);
      return res.status(200).json({
        ok: true,
        eventId: ev.id,
        meetLink: link,
        // A calendar event with no Meet link is a trap — say so rather than
        // handing back a blank the caller will paste into a message.
        warning: link ? "" : "The event was created but Google returned no Meet link — check that Meet is enabled for this Workspace.",
        htmlLink: ev.htmlLink || "",
        title: ev.summary || "",
        start: ev.start?.dateTime || "",
        end: ev.end?.dateTime || "",
        organizer: subject,
        attendees: (ev.attendees || []).map((a) => a.email),
        // What we ASKED for versus what Google actually kept. A Workspace that
        // blocks external guests drops the notetaker silently, and the first
        // anyone would otherwise know is a call that produced no transcript.
        recording: !!body.recordWithFireflies,
        notetaker: NOTETAKER,
        notetakerInvited: (ev.attendees || []).some((a) => String(a.email || "").toLowerCase() === NOTETAKER),
      });
    }

    /* ── upcoming ───────────────────────────────────────────────────────── */
    if (body.action === "upcoming") {
      const p = new URLSearchParams({
        timeMin: new Date().toISOString(), maxResults: "20",
        singleEvents: "true", orderBy: "startTime",
      });
      const r = await fetch(`${CAL}/calendars/primary/events?` + p, { headers: authz });
      const data = await r.json();
      if (!r.ok) return res.status(502).json({ error: "Google wouldn't list the calendar: " + (data?.error?.message || r.status) });
      return res.status(200).json({
        ok: true,
        events: (data.items || [])
          .filter((ev) => meetLinkOf(ev))
          .map((ev) => ({
            eventId: ev.id, title: ev.summary || "(no title)",
            meetLink: meetLinkOf(ev), htmlLink: ev.htmlLink || "",
            start: ev.start?.dateTime || ev.start?.date || "",
            end: ev.end?.dateTime || ev.end?.date || "",
            attendees: (ev.attendees || []).map((a) => a.email),
            companyId: ev.extendedProperties?.private?.elecbitsCompanyId || "",
          })),
      });
    }

    /* ── cancel ─────────────────────────────────────────────────────────── */
    if (body.action === "cancel") {
      const id = String(body.eventId || "").trim();
      if (!id) return res.status(400).json({ error: "Which meeting? Give me an eventId." });
      const r = await fetch(
        `${CAL}/calendars/primary/events/${encodeURIComponent(id)}?sendUpdates=all`,
        { method: "DELETE", headers: authz });
      // 410 = already gone. That is the outcome the caller wanted.
      if (!r.ok && r.status !== 410) {
        const e = await r.json().catch(() => ({}));
        return res.status(502).json({ error: "Google wouldn't cancel it: " + (e?.error?.message || r.status) });
      }
      return res.status(200).json({ ok: true, cancelled: id });
    }

    return res.status(400).json({ error: "Unknown action. Use create, upcoming or cancel." });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
