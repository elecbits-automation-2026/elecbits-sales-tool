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
      // Closing a link has to stop the READ too, not only the write. This
      // response carries the company name, the official Client ID, the deal
      // code and the contact — exactly what a revoked link must stop
      // disclosing — so a closed token dies here, before any of it is
      // resolved.
      if (link.status === "closed") {
        return res.status(410).json({ error: "This link was closed. Ask your Elecbits contact for a new one." });
      }
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
        // person, same link — nothing here is new to them. `savedPost` does
        // the same for the sanctioning stage after submission.
        saved: (link.status !== "submitted" && answeredCount > 0)
          ? { answered: answeredCount, answers: resp } : null,
        savedPost: (link.status === "submitted" && !resp._sanction && resp._post)
          ? { step: Math.max(0, Math.min(Number(resp._postStep) || 0, 10)), answers: resp._post } : null,
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
        // serialized JSON: a cut-off string is not JSON at all). Anything
        // already saved by the post-stage's own partial writes stands in for
        // what this request didn't send.
        const raw = { ...(resp._post || {}), ...((b.post && typeof b.post === "object") ? b.post : {}) };
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
        // ULM reads this request through core.intake, which exposes a fixed
        // column list — summary among them, requirement NOT. So everything a
        // reviewer must be able to read has to be in the text, and the deal
        // must appear as its human code (EB-C-26-0007-D01), not the uuid
        // that means nothing outside this database.
        let dealCode = "";
        if (link.deal_id) {
          try {
            const ds = await pg("deals?id=eq." + link.deal_id + "&select=code");
            dealCode = (ds && ds[0] && ds[0].code) || "";
          } catch (e) { /* the uuid still travels in requirement */ }
        }
        const title = "Project sanction — " + (post.projectName || link.title || "RFQ " + id.slice(0, 8));
        const summary = [
          "Filed by the client from the RFQ link (public form, last stage: sanctioning).",
          // Also in the text, not only in requirement jsonb: on a database
          // that predates 23-pipeline-brain.sql the jsonb is dropped, and
          // the trace back to the token must survive that fallback.
          "Traceable to RFQ link token: " + id + (dealCode ? " · deal " + dealCode : ""),
          post.projectName ? "Project name: " + post.projectName : "",
          post.kickoff ? "Wants to kick off: " + post.kickoff : "",
          post.decider ? "Signs off on their side: " + post.decider : "",
          resp.need ? "Requirement: " + String(resp.need).slice(0, 2000) : "",
          Array.isArray(resp.services) && resp.services.length ? "Services: " + resp.services.join(", ") : "",
          resp.qty ? "Qty: " + resp.qty : "", resp.timeline ? "Timeline: " + resp.timeline : "",
          resp.budget ? "Budget signal: " + resp.budget : "",
          resp.name ? "Client contact: " + resp.name + (resp.email ? " · " + resp.email : "") + (resp.phone ? " · " + resp.phone : "") : "",
        ].filter(Boolean).join("\n");
        // The columns core.intake actually exposes: fill the ones the client
        // gave us rather than leaving ULM a row of nulls beside the prose.
        const qtyN = parseInt(String(resp.qty || "").replace(/[^\d]/g, ""), 10);
        const svc = (Array.isArray(resp.services) ? resp.services : []).join(" ").toLowerCase();
        const kind = /complete product|odm/.test(svc) ? "odm"
          : /box build|assembly|ems/.test(svc) ? "boxbuild" : null;
        const row = {
          org_id: link.org_id, title, summary, urgency: "normal",
          status: "submitted", submitted_by: link.created_by || null,
          ...(Number.isFinite(qtyN) && qtyN > 0 ? { qty: qtyN } : {}),
          ...(kind ? { proposed_kind: kind } : {}),
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
        // A client applying for sanctioning is the loudest thing that can
        // happen on an account; it must not be discoverable only by noticing
        // a chip. The company's activity feed is where the team looks.
        try {
          await pg("org_activities", {
            method: "POST",
            body: JSON.stringify({
              org_id: link.org_id, kind: "note",
              body: "The client applied for project sanctioning from the RFQ link"
                + (dealCode ? " on deal " + dealCode : "") + "."
                + (post.projectName ? " Project: " + post.projectName + "." : "")
                + (post.decider ? " Signs off: " + post.decider + "." : "")
                + " It is now with ULM for review.",
              author_id: link.created_by || null, at: new Date().toISOString(),
            }),
          });
        } catch (e) { /* the request row is the record; the note is courtesy */ }
        return res.status(200).json({ ok: true });
      }

      // The post-submit sanctioning stage saves as they answer too, so a
      // client who wanders off mid-stage is resumed rather than restarted.
      if (b.postPartial === true) {
        const rows = await pg("rfq_links?id=eq." + id + "&select=id,status,response");
        const link = rows && rows[0];
        if (!link) return res.status(404).json({ error: "This link does not exist." });
        const resp = link.response || {};
        if (resp._sanction) return res.status(200).json({ ok: true, already: true });
        const raw = (b.post && typeof b.post === "object") ? b.post : {};
        const post = { ...(resp._post || {}) };
        for (const k of ["projectName", "kickoff", "decider"]) {
          if (raw[k] === undefined) continue;
          post[k] = String(raw[k] == null ? "" : raw[k]).trim().slice(0, 300);
        }
        const step = Math.max(0, Math.min(Number(b.postStep) || 0, 10));
        await pg("rfq_links?id=eq." + id, {
          method: "PATCH",
          body: JSON.stringify({ response: { ...resp, _post: post, _postStep: step } }),
        });
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
      // Anything the server holds that this payload doesn't mention survives
      // — the sanction stamp above all, whose loss would re-open the
      // double-file window and re-offer the stage in the chat.
      const prev = link.response || {};
      if (prev._sanction) clean._sanction = prev._sanction;
      if (prev._post && clean._post === undefined) clean._post = prev._post;
      if (b.partial) {
        // Mid-form progress: saved as they type, so the salesperson sees how
        // much is filled. Never downgrades a submitted link — and never
        // walks the count backwards either: the same link open on a phone
        // and a laptop must not let the stale tab erase the other's answers.
        if (link.status !== "submitted") {
          const was = Number(prev._answered) || 0;
          const now = Number(clean._answered) || 0;
          const body = now >= was
            ? clean
            : { ...clean, ...prev, _answered: was };   // the further-along answers win
          await pg("rfq_links?id=eq." + id, { method: "PATCH", body: JSON.stringify({ response: body }) });
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
