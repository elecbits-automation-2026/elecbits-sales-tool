// The public face of an RFQ link — the ONLY door the client's browser uses.
//
// The page at #rfq/<id> is unauthenticated, and sales.rfq_links deliberately
// grants the anon key nothing. This function reads and submits on the
// client's behalf with the service role, exposing exactly two operations on
// exactly one row:
//
//   GET  /api/rfq?id=<uuid>            → the link's offer + company name
//                                        (marks it opened on first view)
//   POST /api/rfq?id=<uuid>  {response} → files the client's requirement
//
// Env: VITE_SUPABASE_URL (or SUPABASE_URL) + SUPABASE_SERVICE_ROLE_KEY.

const BASE = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function pg(path, init = {}) {
  const r = await fetch(BASE + "/rest/v1/" + path, {
    ...init,
    headers: {
      apikey: KEY, Authorization: "Bearer " + KEY,
      "Accept-Profile": "sales", "Content-Profile": "sales",
      "Content-Type": "application/json", Prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && (j.message || j.hint)) || ("postgrest " + r.status));
  return j;
}

export default async function handler(req, res) {
  if (!BASE || !KEY) {
    return res.status(501).json({ error: "RFQ links need SUPABASE_SERVICE_ROLE_KEY (and the Supabase URL) in Vercel." });
  }
  const id = (req.query.id || "").toString().trim();
  if (!UUID_RE.test(id)) return res.status(400).json({ error: "bad link" });

  try {
    if (req.method === "GET") {
      const rows = await pg("rfq_links?id=eq." + id + "&select=id,org_id,title,offer,note_to_client,contact_name,status,submitted_at");
      const link = rows && rows[0];
      if (!link) return res.status(404).json({ error: "This link does not exist or was closed." });
      // The company's public name comes from core.orgs.
      let company = "";
      try {
        const orgs = await fetch(BASE + "/rest/v1/orgs?id=eq." + link.org_id + "&select=name", {
          headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Accept-Profile": "core" },
        }).then((r) => r.json());
        company = (orgs && orgs[0] && orgs[0].name) || "";
      } catch (e) { /* name is cosmetic */ }
      if (link.status === "created") {
        await pg("rfq_links?id=eq." + id, { method: "PATCH", body: JSON.stringify({ status: "opened", opened_at: new Date().toISOString() }) });
        link.status = "opened";
      }
      return res.status(200).json({
        id: link.id, company, title: link.title || "", offer: link.offer || [],
        note: link.note_to_client || "", contact: link.contact_name || "",
        submitted: link.status === "submitted", closed: link.status === "closed",
      });
    }

    if (req.method === "POST") {
      const b = req.body || {};
      const response = b.response;
      if (!response || typeof response !== "object") return res.status(400).json({ error: "response required" });
      const rows = await pg("rfq_links?id=eq." + id + "&select=id,status");
      const link = rows && rows[0];
      if (!link) return res.status(404).json({ error: "This link does not exist." });
      if (link.status === "closed") return res.status(409).json({ error: "This link was closed." });
      // Bound the payload; the client's browser is untrusted input.
      const clean = JSON.parse(JSON.stringify(response).slice(0, 40000));
      if (b.partial) {
        // Mid-form progress: saved as they type, so the salesperson sees how
        // much is filled. Never downgrades a submitted link.
        if (link.status !== "submitted") {
          await pg("rfq_links?id=eq." + id, { method: "PATCH", body: JSON.stringify({ response: clean }) });
        }
        return res.status(200).json({ ok: true });
      }
      await pg("rfq_links?id=eq." + id, {
        method: "PATCH",
        body: JSON.stringify({ response: clean, status: "submitted", submitted_at: new Date().toISOString() }),
      });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "GET or POST" });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
}
