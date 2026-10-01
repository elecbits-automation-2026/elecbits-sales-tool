// ═══════════════════════════════════════════════════════════════════════════
// THE DAILY DIGEST — what you owe today, and what you actually did.
//
// Two mails a day, per person, built from the task list:
//
//   morning  everything due today or already late, grouped by the PROJECT it
//            belongs to, because "call Rohan" means nothing without knowing
//            which of six Schneider projects it is about.
//   evening  what was due today, how much of it closed, and what did not —
//            named, not just counted. A recap that only reports a number is
//            a number nobody acts on.
//
// Nobody with nothing to do gets a mail. A digest that arrives empty every
// day teaches people to filter the sender, and then the one that matters is
// filtered too.
//
// ── SENDING ────────────────────────────────────────────────────────────────
// Transport-agnostic on purpose, because the two reasonable choices need
// different things set up and neither is done yet. Whichever is configured
// wins, Resend first:
//
//   RESEND_API_KEY + DIGEST_FROM     a transactional sender. Needs an
//                                    account and a verified domain.
//   INBOX_OAUTH_* (see api/inbox.js) the consented mailbox sends as itself.
//                                    Re-consent is required: the existing
//                                    grant is gmail.readonly, and sending
//                                    needs gmail.send in the scope list.
//
// With neither, every action still WORKS — it renders the digests and
// reports them — it simply does not deliver. That is deliberate: the thing
// worth reviewing before a mail goes to the whole team is the content.
//
// ── TRIGGERING ─────────────────────────────────────────────────────────────
//   vercel.json runs this twice a day. Vercel sends CRON_SECRET as a bearer
//   token; without that secret set, an open endpoint could be used to mail
//   the entire team repeatedly, so an unauthenticated call is refused.
//   A signed-in user may also call it by hand — for ?preview=1 above all.
//
//   GET /api/digest?action=status                 what is configured
//   GET /api/digest?when=morning|evening&preview=1  render, send nothing
//   GET /api/digest?when=morning|evening          render and send
// ═══════════════════════════════════════════════════════════════════════════

const SB_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const SB_ANON = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const CRON_SECRET = process.env.CRON_SECRET || "";
const APP_URL = (process.env.DIGEST_APP_URL || "https://elecbits-sales-tool.vercel.app").replace(/\/+$/, "");

/* ── reading ─────────────────────────────────────────────────────────────
   Service role, because a cron has no user to act as. Read-only here: this
   endpoint never writes, which keeps the blast radius of that key to
   "someone could read the task list". */
async function pg(schema, path) {
  const r = await fetch(SB_URL + "/rest/v1/" + path, {
    headers: {
      apikey: SERVICE_KEY, Authorization: "Bearer " + SERVICE_KEY,
      "Accept-Profile": schema, "Content-Type": "application/json",
    },
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && (j.message || j.hint)) || ("postgrest " + r.status));
  return Array.isArray(j) ? j : [];
}

async function verifiedCaller(req) {
  const auth = req.headers.authorization || "";
  if (!auth.toLowerCase().startsWith("bearer ") || !SB_URL || !SB_ANON) return null;
  try {
    const r = await fetch(SB_URL + "/auth/v1/user", { headers: { apikey: SB_ANON, authorization: auth } });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? u : null;
  } catch { return null; }
}

/* Business time is IST. A digest "for today" built at 03:30 UTC must mean
   the Indian day that is starting, not the UTC one that is ending. */
const istDay = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const prettyDate = (iso) => {
  try {
    return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })
      .format(new Date(iso + "T00:00:00+05:30"));
  } catch { return iso; }
};

/* ── sending ─────────────────────────────────────────────────────────── */
function senderKind() {
  if (process.env.RESEND_API_KEY && process.env.DIGEST_FROM) return "resend";
  if (process.env.INBOX_OAUTH_CLIENT_ID && process.env.INBOX_OAUTH_CLIENT_SECRET
      && process.env.INBOX_OAUTH_REFRESH_TOKEN && process.env.INBOX_GMAIL_USER) return "gmail";
  return "none";
}

let gmailTok = null;   // cached for the life of the lambda
async function gmailToken() {
  if (gmailTok && gmailTok.exp > Date.now() + 60000) return gmailTok.token;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: process.env.INBOX_OAUTH_REFRESH_TOKEN,
      client_id: process.env.INBOX_OAUTH_CLIENT_ID,
      client_secret: process.env.INBOX_OAUTH_CLIENT_SECRET,
    }),
  });
  const j = await r.json();
  if (!r.ok) {
    throw new Error("gmail token: " + (j.error_description || j.error || r.status)
      + " — if this says insufficient scope, the mailbox consented to gmail.readonly only."
      + " Re-run /api/inbox?action=oauth-url; sending needs gmail.send as well.");
  }
  gmailTok = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return gmailTok.token;
}

async function sendMail(to, subject, html) {
  const kind = senderKind();
  if (kind === "resend") {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.DIGEST_FROM, to: [to], subject, html }),
    });
    if (!r.ok) throw new Error("resend " + r.status + ": " + (await r.text()).slice(0, 200));
    return;
  }
  if (kind === "gmail") {
    const from = process.env.INBOX_GMAIL_USER;
    // RFC 2047 for the subject: a rupee sign or an em dash in a raw header
    // arrives as mojibake in most clients.
    const subj = "=?utf-8?B?" + Buffer.from(subject, "utf8").toString("base64") + "?=";
    const mime = [
      "From: " + from, "To: " + to, "Subject: " + subj,
      "MIME-Version: 1.0", 'Content-Type: text/html; charset="utf-8"',
      "Content-Transfer-Encoding: base64", "", Buffer.from(html, "utf8").toString("base64"),
    ].join("\r\n");
    const token = await gmailToken();
    const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({ raw: Buffer.from(mime, "utf8").toString("base64url") }),
    });
    if (!r.ok) throw new Error("gmail send " + r.status + ": " + (await r.text()).slice(0, 200));
    return;
  }
  throw new Error("no sender configured");
}

/* ── the digests ─────────────────────────────────────────────────────── */

const SHELL = (title, lede, body, foot) => `<!doctype html><html><body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a">
<div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:24px">
<h1 style="margin:0 0 4px;font-size:17px">${esc(title)}</h1>
<p style="margin:0 0 18px;font-size:13px;color:#64748b">${esc(lede)}</p>
${body}
<p style="margin:20px 0 0;font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:12px">${foot}
 · <a href="${APP_URL}" style="color:#2563eb;text-decoration:none">open the Sales OS</a></p>
</div></body></html>`;

const taskLi = (t, projectOf, late) => `<li style="margin:0 0 7px;font-size:13.5px;line-height:1.45">
<span>${esc(t.title)}</span>
${t.due ? `<span style="font-family:ui-monospace,monospace;font-size:11.5px;color:${late ? "#dc2626" : "#64748b"};margin-left:6px">${late ? "overdue · " : ""}${esc(prettyDate(t.due))}</span>` : ""}
</li>`;

/* Grouped by project, never a flat list. One client can run six of them and
   a bare task title does not say which — that was the whole point of giving
   tasks a project in the first place. */
function groupByProject(tasks, projectOf) {
  const g = new Map();
  for (const t of tasks) {
    const key = projectOf(t) || "No project named";
    if (!g.has(key)) g.set(key, []);
    g.get(key).push(t);
  }
  return [...g.entries()].sort((a, b) => (a[0] === "No project named" ? 1 : b[0] === "No project named" ? -1 : a[0].localeCompare(b[0])));
}

function morningBody(person, tasks, projectOf, today) {
  const late = tasks.filter((t) => t.due && t.due < today);
  const due = tasks.filter((t) => t.due === today);
  const rest = tasks.filter((t) => !t.due || t.due > today);
  const section = (label, list, colour) => !list.length ? "" : `
    <p style="margin:16px 0 6px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${colour}">${esc(label)} · ${list.length}</p>
    ${groupByProject(list, projectOf).map(([proj, ts]) => `
      <p style="margin:10px 0 3px;font-size:12px;font-weight:600;color:#334155">${esc(proj)}</p>
      <ul style="margin:0;padding-left:18px">${ts.map((t) => taskLi(t, projectOf, t.due && t.due < today)).join("")}</ul>`).join("")}`;
  return section("Overdue", late, "#dc2626") + section("Due today", due, "#0f172a")
    + section("Also open", rest.slice(0, 8), "#64748b");
}

function eveningBody(person, dueToday, projectOf, today) {
  const done = dueToday.filter((t) => t.status === "done");
  const open = dueToday.filter((t) => t.status !== "done");
  const pct = dueToday.length ? Math.round((done.length / dueToday.length) * 100) : 0;
  const bar = `<div style="margin:0 0 14px">
    <div style="height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden">
      <div style="height:8px;width:${pct}%;background:${pct === 100 ? "#16a34a" : pct >= 50 ? "#2563eb" : "#f59e0b"}"></div>
    </div>
    <p style="margin:6px 0 0;font-size:13px"><b>${done.length} of ${dueToday.length}</b> closed${pct === 100 ? " — all of it." : ""}</p>
  </div>`;
  const list = (label, ts, colour) => !ts.length ? "" : `
    <p style="margin:16px 0 6px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${colour}">${esc(label)} · ${ts.length}</p>
    ${groupByProject(ts, projectOf).map(([proj, xs]) => `
      <p style="margin:10px 0 3px;font-size:12px;font-weight:600;color:#334155">${esc(proj)}</p>
      <ul style="margin:0;padding-left:18px">${xs.map((t) => taskLi(t, projectOf, false)).join("")}</ul>`).join("")}`;
  // The ones still open are named, not counted: a number tells you how the
  // day went, a name tells you what to do about it.
  return bar + list("Still open", open, "#dc2626") + list("Closed", done, "#16a34a");
}

export default async function handler(req, res) {
  const action = (req.query.action || "").toString();
  const when = (req.query.when || "").toString();
  const preview = req.query.preview === "1" || req.query.dry === "1";

  if (action === "status") {
    return res.status(200).json({
      ready: !!(SB_URL && SERVICE_KEY) && senderKind() !== "none",
      reads: SB_URL && SERVICE_KEY ? "ok" : "needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
      sender: senderKind(),
      senderHelp: senderKind() !== "none" ? null
        : "Set RESEND_API_KEY + DIGEST_FROM, or finish the mailbox consent in /api/inbox?action=oauth-url WITH the gmail.send scope.",
      cronSecret: CRON_SECRET ? "set" : "missing — the endpoint refuses unauthenticated calls, so the cron cannot run until this is set",
      schedule: "vercel.json: 03:30 UTC (09:00 IST) and 13:00 UTC (18:30 IST), weekdays",
    });
  }

  if (when !== "morning" && when !== "evening") {
    return res.status(400).json({ error: "when=morning or when=evening" });
  }

  /* An open endpoint that mails the whole team is a gift to anyone who
     finds it. Vercel's cron presents CRON_SECRET; a person must be signed
     in. Everything else is refused, including when no secret is set — a
     missing secret must fail shut, not open. */
  const auth = (req.headers.authorization || "").trim();
  const viaCron = !!CRON_SECRET && auth === "Bearer " + CRON_SECRET;
  const user = viaCron ? null : await verifiedCaller(req);
  if (!viaCron && !user) return res.status(401).json({ error: "not authorised" });

  if (!SB_URL || !SERVICE_KEY) {
    return res.status(501).json({ error: "The digest reads the roster and the task list with SUPABASE_SERVICE_ROLE_KEY. Set it (and SUPABASE_URL) in Vercel." });
  }

  try {
    const today = istDay();
    const [people, details, tasks, deals, orgs] = await Promise.all([
      pg("core", "people?select=id,name,email"),
      pg("sales", "people_detail?select=person_id,active"),
      pg("sales", "tasks?select=id,title,status,due,assignee_id,org_id,deal_id,done_at"),
      pg("sales", "deals?select=id,product,did,org_id"),
      pg("core", "orgs?select=id,name"),
    ]);

    const byId = new Map(people.map((p) => [p.id, p]));
    const activeIds = new Set(details.filter((d) => d.active !== false).map((d) => d.person_id));
    const dealById = new Map(deals.map((x) => [x.id, x]));
    const orgById = new Map(orgs.map((o) => [o.id, o.name]));
    const projectOf = (t) => {
      const d = t.deal_id ? dealById.get(t.deal_id) : null;
      const co = orgById.get(t.org_id) || "";
      if (!d) return co || "";
      const label = (d.product || "").trim() || d.did || "";
      return co ? co + (label ? " · " + label : "") : label;
    };

    // Morning: what is owed. Evening: what today asked for, done or not.
    const relevant = when === "morning"
      ? tasks.filter((t) => t.status !== "done" && t.due && t.due <= today)
      : tasks.filter((t) => t.due === today);
    // Morning also carries a little of what is coming, so the mail is a day
    // plan rather than only a list of what is already late.
    const extra = when === "morning"
      ? tasks.filter((t) => t.status !== "done" && (!t.due || t.due > today))
      : [];

    const perPerson = new Map();
    for (const t of [...relevant, ...extra]) {
      if (!t.assignee_id || !activeIds.has(t.assignee_id)) continue;
      if (!perPerson.has(t.assignee_id)) perPerson.set(t.assignee_id, []);
      perPerson.get(t.assignee_id).push(t);
    }

    const out = [], errors = [];
    for (const [pid, list] of perPerson) {
      const p = byId.get(pid);
      if (!p || !p.email) { errors.push("no email on roster: " + (p ? p.name : pid)); continue; }
      const first = String(p.name || "there").trim().split(" ")[0];

      let subject, html, count;
      if (when === "morning") {
        const owed = list.filter((t) => t.status !== "done" && t.due && t.due <= today);
        if (!owed.length) continue;          // nothing owed today: no mail
        const late = owed.filter((t) => t.due < today).length;
        subject = "Today: " + owed.length + " task" + (owed.length === 1 ? "" : "s")
          + (late ? " · " + late + " overdue" : "");
        count = owed.length;
        html = SHELL("Good morning, " + first,
          owed.length + " on you today" + (late ? ", " + late + " already past its date" : "") + ".",
          morningBody(p, list, projectOf, today),
          "Close them in My Tasks — that is where the evidence is checked.");
      } else {
        const dueToday = list.filter((t) => t.due === today);
        if (!dueToday.length) continue;
        const done = dueToday.filter((t) => t.status === "done").length;
        subject = "Today's recap: " + done + " of " + dueToday.length + " closed";
        count = dueToday.length;
        html = SHELL("Where today landed, " + first,
          done === dueToday.length ? "Everything due today is closed." : "What was due today, and what is still open.",
          eveningBody(p, dueToday, projectOf, today),
          "Anything still open rolls into tomorrow's list.");
      }

      if (preview) { out.push({ to: p.email, subject, count, html }); continue; }
      try { await sendMail(p.email, subject, html); out.push({ to: p.email, subject, count, sent: true }); }
      catch (e) { errors.push(p.email + ": " + String(e.message || e)); }
    }

    return res.status(200).json({
      when, date: today, sender: senderKind(), preview: !!preview,
      people: out.length, digests: out,
      errors: errors.length ? errors : undefined,
      note: senderKind() === "none" && !preview
        ? "Rendered but NOT sent — no mail transport is configured. See /api/digest?action=status." : undefined,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
