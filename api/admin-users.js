// ═══════════════════════════════════════════════════════════════════════════
// ADMIN-USERS — create or reset a person's login, from inside the app.
//
// Until now a rostered person had to sign themselves in the first time: an
// admin could add them to the roster, but not give them a way in. Creating a
// user with a chosen password needs the SERVICE ROLE key, which must never
// reach a browser — hence this function.
//
// POST { email, password, name }
//   → { ok, created }   created=true  → fresh login, ready to use
//                       created=false → the login existed; its password was
//                                       RESET to the one given
//
// The caller must be signed in AND be an admin ON THE SALES ROSTER — checked
// server-side against sales.people_detail, never trusted from the browser.
// That check is the sales one deliberately: core.people.role is the company
// roster, and a PMS dept-head is not automatically a sales admin.
//
// Accounts made here are marked email-confirmed, so they work even with
// "Confirm email" switched on — this path IS the invitation.
//
// ── ENV (Vercel → Settings → Environment Variables, server-only) ──────────
//   SUPABASE_URL                same project as VITE_SUPABASE_URL
//   SUPABASE_ANON_KEY           same value as VITE_SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY   Settings → API → service_role. SECRET.
//
// NEVER prefix any of these with VITE_. The service-role key bypasses every
// row-level policy in the database; in a browser bundle it is a total breach.
// ═══════════════════════════════════════════════════════════════════════════

const URL_ = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const ANON_KEY = process.env.SUPABASE_ANON_KEY || "";

const svc = { apikey: SERVICE_KEY, authorization: "Bearer " + SERVICE_KEY };
const jsonHeaders = { ...svc, "content-type": "application/json" };

/** Who is calling? Their own JWT answers; the anon key merely opens the door. */
async function caller(req) {
  const auth = req.headers.authorization || "";
  if (!auth.toLowerCase().startsWith("bearer ")) return null;
  try {
    const r = await fetch(URL_ + "/auth/v1/user", {
      headers: { apikey: ANON_KEY, authorization: auth },
    });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.id ? { id: u.id, email: (u.email || "").toLowerCase() } : null;
  } catch {
    return null;
  }
}

/* Is that person an admin on the SALES roster? The rank lives in
   sales.people_detail; core.people holds the identity. PostgREST reaches a
   non-default schema through Accept-Profile, not through the path.

   Matched by auth_id first (the link a login gets), then by id (a roster row
   created before anyone signed in), then by email as the last resort. */
async function isSalesAdmin(id, email) {
  const enc = encodeURIComponent;
  const ors = [`auth_id.eq.${id}`, `id.eq.${id}`];
  if (email) ors.push(`email.ilike.${email.replace(/[%,()]/g, "")}`);
  try {
    const pr = await fetch(
      `${URL_}/rest/v1/people?select=id&or=(${enc(ors.join(","))})`,
      { headers: { ...svc, "accept-profile": "core" } });
    if (!pr.ok) return false;
    const people = await pr.json();
    if (!people.length) return false;

    const ids = people.map((p) => p.id).join(",");
    const dr = await fetch(
      `${URL_}/rest/v1/people_detail?select=role,active&person_id=in.(${enc(ids)})`,
      { headers: { ...svc, "accept-profile": "sales" } });
    if (!dr.ok) return false;
    const rows = await dr.json();
    return rows.some((d) => d.active !== false && (d.role === "admin" || d.role === "dept_head"));
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  // GET ?action=status — is this endpoint configured? Answers without
  // credentials so the UI (and scripts/check-sales.mjs) can tell "not
  // deployed" from "not configured" from "working".
  if (req.method === "GET") {
    const missing = [];
    if (!URL_) missing.push("SUPABASE_URL");
    if (!SERVICE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
    if (!ANON_KEY) missing.push("SUPABASE_ANON_KEY");
    return res.status(200).json({
      connected: missing.length === 0,
      reason: missing.length ? "missing " + missing.join(", ") : "",
    });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  if (!URL_ || !SERVICE_KEY) {
    return res.status(500).json({
      error: "Login provisioning is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Vercel (server-only, no VITE_ prefix), then redeploy.",
    });
  }

  const who = await caller(req);
  if (!who) return res.status(401).json({ error: "You need to be signed in to manage logins." });
  if (!(await isSalesAdmin(who.id, who.email))) {
    return res.status(403).json({ error: "Only a sales admin can create or reset logins." });
  }

  const body = req.body || {};
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const name = String(body.name || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "That doesn't look like an email address." });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: "The password needs at least 8 characters." });
  }

  // Create — or, if the login already exists, reset its password instead.
  let userId = "", created = true;
  const mk = await fetch(URL_ + "/auth/v1/admin/users", {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify({
      email, password, email_confirm: true,
      user_metadata: { full_name: name || email },
    }),
  });
  const mkBody = await mk.json().catch(() => ({}));

  if (mk.ok && mkBody?.id) {
    userId = mkBody.id;
  } else if (/already/i.test(String(mkBody?.msg ?? mkBody?.message ?? mkBody?.error_description ?? ""))) {
    created = false;
    const list = await fetch(URL_ + "/auth/v1/admin/users?per_page=1000", { headers: svc });
    const data = await list.json().catch(() => ({}));
    const found = (data?.users || []).find((u) => (u.email || "").toLowerCase() === email);
    if (!found) {
      return res.status(500).json({
        error: "That email already has a login, but it couldn't be found to reset — reset it from the Supabase dashboard.",
      });
    }
    userId = found.id;
    const upd = await fetch(URL_ + "/auth/v1/admin/users/" + userId, {
      method: "PUT", headers: jsonHeaders, body: JSON.stringify({ password }),
    });
    if (!upd.ok) {
      const e = await upd.json().catch(() => ({}));
      return res.status(500).json({ error: "Couldn't reset the password — " + (e?.msg ?? e?.message ?? upd.status) + "." });
    }
  } else {
    return res.status(500).json({ error: "Couldn't create the login — " + (mkBody?.msg ?? mkBody?.message ?? mk.status) + "." });
  }

  // Attach the login to the roster entry with the same email, so the app knows
  // this row is them. Best-effort: the signup trigger also does this.
  try {
    await fetch(`${URL_}/rest/v1/people?email=ilike.${encodeURIComponent(email.replace(/[%,()]/g, ""))}`, {
      method: "PATCH",
      headers: { ...jsonHeaders, "content-profile": "core", prefer: "return=minimal" },
      body: JSON.stringify({ auth_id: userId }),
    });
  } catch { /* not fatal — attachment also happens at first sign-in */ }

  return res.status(200).json({ ok: true, created });
}
