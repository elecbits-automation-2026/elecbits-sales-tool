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

/* A LIVE TEST WITHOUT MAILING THE TEAM. ?preview=1 proves the content but
   never exercises the actual send — the token, the scope, the From line,
   what it looks like in a real client. DIGEST_ONLY_TO does: everything is
   still built for everyone, and only these addresses are delivered to.
   The rest are reported as held, so the run still shows who WOULD have
   been mailed.

   Left set by accident this silently stops the team's digests, so status
   reports it and every response carries the list. A filter you cannot see
   is worse than no filter. */
const ONLY_TO = (process.env.DIGEST_ONLY_TO || "")
  .toLowerCase().split(",").map((x) => x.trim()).filter((x) => x.includes("@"));
const deliverable = (email) => !ONLY_TO.length || ONLY_TO.includes(String(email).toLowerCase());

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
/* The address the digest sends AS is its own setting. It used to borrow
   INBOX_GMAIL_USER, which meant choosing a sender also chose whose inbox
   the comms intake reads — two unrelated decisions welded together. The
   OAuth client id and secret are shared (one app, one consent screen);
   only the mailbox and its token differ. */
const gmailCfg = () => ({
  id:      process.env.INBOX_OAUTH_CLIENT_ID || "",
  secret:  process.env.INBOX_OAUTH_CLIENT_SECRET || "",
  refresh: process.env.DIGEST_OAUTH_REFRESH_TOKEN || process.env.INBOX_OAUTH_REFRESH_TOKEN || "",
  user:    (process.env.DIGEST_GMAIL_USER || process.env.INBOX_GMAIL_USER || "").trim(),
});

function senderKind() {
  if (process.env.RESEND_API_KEY && process.env.DIGEST_FROM) return "resend";
  const g = gmailCfg();
  if (g.id && g.secret && g.refresh && g.user) return "gmail";
  return "none";
}

let gmailTok = null;   // cached for the life of the lambda
async function gmailToken() {
  if (gmailTok && gmailTok.exp > Date.now() + 60000) return gmailTok.token;
  const g = gmailCfg();
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token", refresh_token: g.refresh,
      client_id: g.id, client_secret: g.secret,
    }),
  });
  const j = await r.json();
  if (!r.ok) {
    throw new Error("gmail token: " + (j.error_description || j.error || r.status)
      + " — if this mentions scope, the mailbox consented to reading only."
      + " Run /api/inbox?action=oauth-url&for=digest, which asks for gmail.send.");
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
    const from = gmailCfg().user;
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
   tasks a project in the first place.

   Keyed on the deal, not on its printed name: two projects can be called
   the same thing, and a project with no name at all still has to be its
   own group rather than merging into everything else unnamed. */
function groupByProject(tasks, projectOf) {
  const g = new Map();
  for (const t of tasks) {
    const head = projectOf(t);
    if (!g.has(head.key)) g.set(head.key, { head, tasks: [] });
    g.get(head.key).tasks.push(t);
  }
  // Biggest deal first: if only part of this gets read, let it be the part
  // with the most riding on it. Unvalued projects sort by name at the end.
  return [...g.values()].sort((a, b) =>
    (b.head.value - a.head.value)
    || a.head.client.localeCompare(b.head.client)
    || a.head.product.localeCompare(b.head.product));
}

/* ₹25L, ₹1.2Cr — the way the board writes money, so the mail and the app
   do not disagree about what a deal is worth. */
function money(n) {
  const v = Number(n || 0);
  if (!v) return "";
  if (v >= 10000000) return "₹" + (v / 10000000).toFixed(1).replace(/\.0$/, "") + "Cr";
  if (v >= 100000) return "₹" + (v / 100000).toFixed(1).replace(/\.0$/, "") + "L";
  if (v >= 1000) return "₹" + Math.round(v / 1000) + "k";
  return "₹" + v;
}

/* The headline above a project's tasks: who it is for, what it is, what it
   is worth. The deal code stands in when nobody has named the project. */
function projectHead(head) {
  const name = head.product || head.code || "";
  return `<div style="margin:14px 0 4px;padding-top:10px;border-top:1px solid #f1f5f9">
    <span style="font-size:13px;font-weight:600;color:#0f172a">${esc(head.client)}</span>
    ${name ? `<span style="font-size:13px;color:#475569"> · ${esc(name)}</span>` : ""}
    ${head.value ? `<span style="font-size:11.5px;font-family:ui-monospace,monospace;color:#64748b;margin-left:6px">${esc(money(head.value))}</span>` : ""}
    ${!head.product && !head.code ? `<span style="font-size:11.5px;color:#94a3b8"> · not tied to a project</span>` : ""}
  </div>`;
}

/* THE MORNING MAIL, in three time buckets, each grouped by project.

   A task appears in exactly one bucket — the one its date puts it in — so
   nothing is counted twice and the three sections add up to the day.
   Within a bucket the work is project-wise and every project carries its
   headline, because "follow up with Rohan" is not actionable until you
   know it is the ₹25L Schneider job and not the other five.

   The forward view stops at three days. An unbounded "also open" list is
   how a digest becomes something nobody reads to the end of. */
function morningBody(tasks, projectOf, today, horizon) {
  const late = tasks.filter((t) => t.due && t.due < today);
  const now  = tasks.filter((t) => t.due === today);
  const soon = tasks.filter((t) => t.due && t.due > today && t.due <= horizon);

  const section = (label, list, colour, note) => !list.length ? "" : `
    <p style="margin:22px 0 2px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${colour}">${esc(label)} · ${list.length}</p>
    ${note ? `<p style="margin:0;font-size:11px;color:#94a3b8">${esc(note)}</p>` : ""}
    ${groupByProject(list, projectOf).map((g) => projectHead(g.head)
      + `<ul style="margin:0;padding-left:18px">${g.tasks
          .slice()
          .sort((a, b) => String(a.due || "").localeCompare(String(b.due || "")))
          .map((t) => taskLi(t, projectOf, !!(t.due && t.due < today))).join("")}</ul>`).join("")}`;

  const oldest = late.map((t) => t.due).filter(Boolean).sort()[0];
  return section("Overdue", late, "#dc2626",
      oldest ? "Oldest has been waiting since " + prettyDate(oldest) + "." : "")
    + section("Due today", now, "#0f172a", "")
    + section("Next three days", soon, "#2563eb", "What is coming, so today can be planned around it.");
}

function eveningBody(dueToday, projectOf) {
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
    <p style="margin:22px 0 2px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${colour}">${esc(label)} · ${ts.length}</p>
    ${groupByProject(ts, projectOf).map((g) => projectHead(g.head)
      + `<ul style="margin:0;padding-left:18px">${g.tasks.map((t) => taskLi(t, projectOf, false)).join("")}</ul>`).join("")}`;
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
      sendsAs: senderKind() === "gmail" ? gmailCfg().user : (process.env.DIGEST_FROM || null),
      senderHelp: senderKind() !== "none" ? null
        : "Either set RESEND_API_KEY + DIGEST_FROM, or consent the sending mailbox at /api/inbox?action=oauth-url&for=digest and store DIGEST_OAUTH_REFRESH_TOKEN + DIGEST_GMAIL_USER.",
      cronSecret: CRON_SECRET ? "set" : "missing — the endpoint refuses unauthenticated calls, so the cron cannot run until this is set",
      runByHand: CRON_SECRET
        ? "/api/digest?when=morning&preview=1&key=<CRON_SECRET>  — drop preview to send for real"
        : "set CRON_SECRET first",
      onlyTo: ONLY_TO.length ? ONLY_TO : null,
      onlyToWarning: ONLY_TO.length
        ? "TESTING FILTER IS ON. Only these addresses receive anything; everyone else's digest is built and held. Clear DIGEST_ONLY_TO when you are done or the team never gets theirs."
        : null,
      schedule: "vercel.json: 03:30 UTC (09:00 IST) and 13:00 UTC (18:30 IST), weekdays",
    });
  }

  if (when !== "morning" && when !== "evening") {
    return res.status(400).json({ error: "when=morning or when=evening" });
  }

  /* An open endpoint that mails the whole team is a gift to anyone who
     finds it, so an unauthenticated call is refused — and refused when no
     secret is set, because a missing secret must fail shut.

     Three ways in. The header is how Vercel's cron calls it. ?key= is how
     a PERSON calls it: pasting a URL into the address bar sends no
     Authorization header, so without this the endpoint could only ever be
     triggered by a machine — which makes it impossible to test, and an
     untestable mail job is one nobody trusts. A signed-in app user works
     too, for anything calling with fetch().

     ?key= puts the secret in a URL, where browser history and access logs
     keep it. That is the cost of being able to run it by hand; rotate
     CRON_SECRET if the URL ends up somewhere it should not. */
  const auth = (req.headers.authorization || "").trim();
  const key = (req.query.key || "").toString().trim();
  const viaCron = !!CRON_SECRET && (auth === "Bearer " + CRON_SECRET || key === CRON_SECRET);
  const user = viaCron ? null : await verifiedCaller(req);
  if (!viaCron && !user) {
    return res.status(401).json({
      error: "not authorised",
      how: CRON_SECRET
        ? "Add ?key=<CRON_SECRET> to this URL to run it by hand — opening a URL in a browser sends no Authorization header, so being signed in to the app is not enough."
        : "CRON_SECRET is not set, so nothing can authenticate — not even Vercel's own cron. Set it in Vercel and redeploy.",
    });
  }

  if (!SB_URL || !SERVICE_KEY) {
    return res.status(501).json({ error: "The digest reads the roster and the task list with SUPABASE_SERVICE_ROLE_KEY. Set it (and SUPABASE_URL) in Vercel." });
  }

  try {
    const today = istDay();
    // Three days ahead, in IST — the forward view the morning mail carries.
    const horizon = istDay(new Date(Date.now() + 3 * 86400000));
    const [people, details, tasks, deals, orgs] = await Promise.all([
      pg("core", "people?select=id,name,email"),
      pg("sales", "people_detail?select=person_id,active"),
      pg("sales", "tasks?select=id,title,status,due,assignee_id,org_id,deal_id,done_at"),
      // `code`, not `did`: did is the app's name for it, code is the column.
      pg("sales", "deals?select=id,product,code,org_id,value,currency"),
      pg("core", "orgs?select=id,name"),
    ]);

    const byId = new Map(people.map((p) => [p.id, p]));
    const activeIds = new Set(details.filter((d) => d.active !== false).map((d) => d.person_id));
    const dealById = new Map(deals.map((x) => [x.id, x]));
    const orgById = new Map(orgs.map((o) => [o.id, o.name]));
    /* A project's headline, not a string: the client, what we are building
       for them, and what it is worth. A task title alone does not tell you
       which of six Schneider projects you are looking at, and a project
       name alone does not tell you whether it is the ₹25L one. */
    const projectOf = (t) => {
      const d = t.deal_id ? dealById.get(t.deal_id) : null;
      const client = orgById.get(t.org_id) || "Unlinked";
      if (!d) return { key: "org:" + (t.org_id || "none"), client, product: "", value: 0, code: "" };
      return {
        key: "deal:" + d.id, client,
        product: (d.product || "").trim(),
        value: Number(d.value || 0),
        code: d.code || "",
      };
    };

    // Morning: what is owed. Evening: what today asked for, done or not.
    const relevant = when === "morning"
      ? tasks.filter((t) => t.status !== "done" && t.due && t.due <= today)
      : tasks.filter((t) => t.due === today);
    // Morning also carries a little of what is coming, so the mail is a day
    // plan rather than only a list of what is already late.
    // The forward view is bounded: three days, not everything open. An
    // undated task is in nobody's three days, so it is left out too.
    const extra = when === "morning"
      ? tasks.filter((t) => t.status !== "done" && t.due && t.due > today && t.due <= horizon)
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
        const soon = list.filter((t) => t.status !== "done" && t.due && t.due > today && t.due <= horizon);
        // Nothing owed AND nothing imminent: no mail. A digest that arrives
        // empty is how a sender gets filtered.
        if (!owed.length && !soon.length) continue;
        const late = owed.filter((t) => t.due < today).length;
        const dueNow = owed.length - late;
        subject = late
          ? "Today: " + dueNow + " due · " + late + " overdue"
          : "Today: " + dueNow + " task" + (dueNow === 1 ? "" : "s");
        count = owed.length;
        html = SHELL("Good morning, " + first,
          [dueNow ? dueNow + " due today" : "nothing due today",
           late ? late + " overdue" : null,
           soon.length ? soon.length + " in the next three days" : null,
          ].filter(Boolean).join(" · ") + ".",
          morningBody(list, projectOf, today, horizon),
          "Close them in My Tasks — that is where the evidence is checked.");
      } else {
        const dueToday = list.filter((t) => t.due === today);
        if (!dueToday.length) continue;
        const done = dueToday.filter((t) => t.status === "done").length;
        subject = "Today's recap: " + done + " of " + dueToday.length + " closed";
        count = dueToday.length;
        html = SHELL("Where today landed, " + first,
          done === dueToday.length ? "Everything due today is closed." : "What was due today, and what is still open.",
          eveningBody(dueToday, projectOf),
          "Anything still open rolls into tomorrow's list.");
      }

      if (preview) { out.push({ to: p.email, subject, count, html }); continue; }
      if (!deliverable(p.email)) { out.push({ to: p.email, subject, count, held: "DIGEST_ONLY_TO" }); continue; }
      try { await sendMail(p.email, subject, html); out.push({ to: p.email, subject, count, sent: true }); }
      catch (e) { errors.push(p.email + ": " + String(e.message || e)); }
    }

    return res.status(200).json({
      when, date: today, sender: senderKind(), preview: !!preview,
      people: out.length, digests: out,
      onlyTo: ONLY_TO.length ? ONLY_TO : undefined,
      held: ONLY_TO.length ? out.filter((x) => x.held).length : undefined,
      errors: errors.length ? errors : undefined,
      note: senderKind() === "none" && !preview
        ? "Rendered but NOT sent — no mail transport is configured. See /api/digest?action=status." : undefined,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e.message || e) });
  }
}
