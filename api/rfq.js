// The public face of an RFQ link — the ONLY door the client's browser uses.
//
// The page at #rfq/<id> is unauthenticated, and sales.rfq_links deliberately
// grants the anon key nothing. This function reads and submits on the
// client's behalf with the service role, exposing exactly two operations on
// exactly one row:
//
//   GET  /api/rfq?id=<uuid>            → the link's offer + company name +
//                                        the official Client ID and Deal ID
//                                        (marks it opened on first view)
//   POST /api/rfq?id=<uuid>  {response} → files the client's requirement
//   POST /api/rfq?id=<uuid>  {sanction:true, post} → the form's LAST stage:
//        files a project-sanctioning application into sales.requests (the
//        same pipe the in-app Apply-for-Project-ID uses → core.intake → ULM)
//        and stamps the link so the chat shows "sanction applied".
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
      const rows = await pg("rfq_links?id=eq." + id + "&select=id,org_id,deal_id,title,offer,note_to_client,contact_name,status,submitted_at,response");
      const link = rows && rows[0];
      if (!link) return res.status(404).json({ error: "This link does not exist or was closed." });
      // The company's public name and official Client ID come from core.orgs;
      // the Deal ID (the SOP code, not the uuid) from sales.deals. Both ride
      // the link so what the client fills lands against the right IDs.
      let company = "", clientId = "", dealCode = "";
      try {
        const orgs = await fetch(BASE + "/rest/v1/orgs?id=eq." + link.org_id + "&select=name,client_id", {
          headers: { apikey: KEY, Authorization: "Bearer " + KEY, "Accept-Profile": "core" },
        }).then((r) => r.json());
        company = (orgs && orgs[0] && orgs[0].name) || "";
        clientId = (orgs && orgs[0] && orgs[0].client_id) || "";
        if (!clientId) {
          // Pre-SOP clients: the working/legacy id still identifies them.
          const det = await pg("org_detail?org_id=eq." + link.org_id + "&select=legacy_cid");
          clientId = (det && det[0] && det[0].legacy_cid) || "";
        }
      } catch (e) { /* ids are informative */ }
      if (link.deal_id) {
        try {
          const ds = await pg("deals?id=eq." + link.deal_id + "&select=code");
          dealCode = (ds && ds[0] && ds[0].code) || "";
        } catch (e) { /* ids are informative */ }
      }
      if (link.status === "created") {
        await pg("rfq_links?id=eq." + id, { method: "PATCH", body: JSON.stringify({ status: "opened", opened_at: new Date().toISOString() }) });
        link.status = "opened";
      }
      const resp = link.response || {};
      const answeredCount = Math.max(0, Math.min(Number(resp._answered) || 0, 100));
      return res.status(200).json({
        id: link.id, company, clientId, dealId: dealCode,
        title: link.title || "", offer: link.offer || [],
        note: link.note_to_client || "", contact: link.contact_name || "",
        submitted: link.status === "submitted", closed: link.status === "closed",
        // Enough for the chat to stay alive after submission without leaking
        // the whole response back out: who they are, and where the
        // sanctioning stage stands. (resp is client-written — coerce types,
        // never trust the shape.)
        respondent: String(resp.name || "").split(/\s+/)[0] || "",
        sanction: !!resp._sanction,
        // Their own half-finished answers, handed back so the chat resumes
        // where they stopped instead of asking everything again. Same
        // person, same link — nothing here is new to them.
        saved: (link.status !== "submitted" && answeredCount > 0)
          ? { answered: answeredCount, answers: resp } : null,
      });
    }

    if (req.method === "POST") {
      const b = req.body || {};

      // The form's last stage: project sanctioning. The application goes
      // into sales.requests — the same pipe the in-app apply uses, read by
      // ULM through core.intake. Filed under the salesperson who created
      // the link (a public page has no signed-in person).
      if (b.sanction === true) {
        const rows = await pg("rfq_links?id=eq." + id + "&select=id,org_id,deal_id,title,status,response,created_by");
        const link = rows && rows[0];
        if (!link) return res.status(404).json({ error: "This link does not exist." });
        if (link.status !== "submitted") return res.status(409).json({ error: "Submit the requirement first." });
        const resp = link.response || {};
        if (resp._sanction) return res.status(200).json({ ok: true, already: true });
        // The basics are a fixed three fields — whitelist them rather than
        // storing whatever shape the browser sent (and never truncate
        // serialized JSON: a cut-off string is not JSON at all).
        const raw = (b.post && typeof b.post === "object") ? b.post : {};
        const post = {};
        for (const k of ["projectName", "kickoff", "decider"]) {
          const v = String(raw[k] == null ? "" : raw[k]).trim().slice(0, 300);
          if (v) post[k] = v;
        }
        const stamp = { ...post, at: new Date().toISOString() };
        // Claim the stamp FIRST, conditionally on it being absent — of two
        // concurrent (or retried) applications only one PATCH matches a row,
        // so only one sales.requests row is ever filed.
        const claimed = await pg("rfq_links?id=eq." + id + "&response-%3E_sanction=is.null", {
          method: "PATCH",
          body: JSON.stringify({ response: { ...resp, _sanction: stamp } }),
        });
        if (!claimed || !claimed.length) return res.status(200).json({ ok: true, already: true });
        const title = "Project sanction — " + (post.projectName || link.title || "RFQ " + id.slice(0, 8));
        const summary = [
          "Filed by the client from the RFQ link (public form, last stage: sanctioning).",
          // Also in the text, not only in requirement jsonb: on a database
          // that predates 23-pipeline-brain.sql the jsonb is dropped, and
          // the trace back to the token must survive that fallback.
          "RFQ link token: " + id + (link.deal_id ? " · deal " + link.deal_id : ""),
          post.projectName ? "Project name: " + post.projectName : "",
          post.kickoff ? "Wants to kick off: " + post.kickoff : "",
          post.decider ? "Signs off on their side: " + post.decider : "",
          resp.need ? "Requirement: " + String(resp.need).slice(0, 2000) : "",
          Array.isArray(resp.services) && resp.services.length ? "Services: " + resp.services.join(", ") : "",
          resp.qty ? "Qty: " + resp.qty : "", resp.timeline ? "Timeline: " + resp.timeline : "",
          resp.budget ? "Budget signal: " + resp.budget : "",
          resp.name ? "Client contact: " + resp.name + (resp.email ? " · " + resp.email : "") + (resp.phone ? " · " + resp.phone : "") : "",
        ].filter(Boolean).join("\n");
        const row = {
          org_id: link.org_id, title, summary, urgency: "normal",
          status: "submitted", submitted_by: link.created_by || null,
        };
        // `requirement` exists only after 23-pipeline-brain.sql — retry
        // without it rather than losing the application itself.
        const withReq = { ...row, requirement: { ...resp, _sanction: post, source: "rfq_public", rfq_link: id, deal_id: link.deal_id || null } };
        try {
          try { await pg("requests", { method: "POST", body: JSON.stringify(withReq) }); }
          catch (e) {
            if (!/requirement|column/i.test(String(e.message || ""))) throw e;
            await pg("requests", { method: "POST", body: JSON.stringify(row) });
          }
        } catch (e) {
          // The insert failed after the claim: release the stamp so the
          // client's retry can file for real, then surface the error.
          try { await pg("rfq_links?id=eq." + id, { method: "PATCH", body: JSON.stringify({ response: resp }) }); } catch (e2) { /* stamp stays; 'already' beats a duplicate */ }
          throw e;
        }
        return res.status(200).json({ ok: true });
      }

      const response = b.response;
      if (!response || typeof response !== "object") return res.status(400).json({ error: "response required" });
      const rows = await pg("rfq_links?id=eq." + id + "&select=id,status,response");
      const link = rows && rows[0];
      if (!link) return res.status(404).json({ error: "This link does not exist." });
      if (link.status === "closed") return res.status(409).json({ error: "This link was closed." });
      // Bound the payload; the client's browser is untrusted input. Reject
      // rather than truncate — a cut serialization is not JSON any more.
      if (JSON.stringify(response).length > 40000) return res.status(413).json({ error: "response too large" });
      const clean = JSON.parse(JSON.stringify(response));
      // A re-submit must never erase the sanctioning stamp — that would
      // re-open the double-file window and re-offer the stage in the chat.
      const prevSanction = link.response && link.response._sanction;
      if (prevSanction) clean._sanction = prevSanction;
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
