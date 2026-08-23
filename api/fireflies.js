// Fireflies proxy — reads meeting transcripts so the tool never depends on
// somebody remembering to paste one.
//
// Env (Vercel, server-only — never VITE_-prefixed):
//   FIREFLIES_API_KEY   Fireflies → Settings → Developer Settings.
//                       API access requires a PAID Fireflies plan.
//
//   GET /api/fireflies?action=status         is the key present and working
//   GET /api/fireflies?action=list&from=&to= recent meetings (ISO dates)
//   GET /api/fireflies?action=get&id=<id>    one transcript, with sentences
//   GET /api/fireflies?action=schema         field names as the API reports
//                                            them — run this if a field errors
//
// The exact scalar types of the list arguments have varied across Fireflies
// schema revisions, so `list` tries the documented shape and falls back to an
// unfiltered query rather than failing outright.

const FF_URL = "https://api.fireflies.ai/graphql";

async function ff(query, variables) {
  const key = process.env.FIREFLIES_API_KEY;
  if (!key) throw new Error("FIREFLIES_API_KEY not set");
  const r = await fetch(FF_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify({ query, variables: variables || {} }),
  });
  const j = await r.json().catch(() => ({}));
  if (j.errors) throw new Error(j.errors.map((e) => e.message).join("; "));
  if (!r.ok) throw new Error("fireflies HTTP " + r.status);
  return j.data || {};
}

const LIST_FIELDS = `
  id
  title
  date
  duration
  host_email
  organizer_email
  participants
  transcript_url
`;

const ms = (d) => { const t = Date.parse(d); return Number.isFinite(t) ? t : null; };

export default async function handler(req, res) {
  const action = (req.query.action || "status").toString();
  const hasKey = !!process.env.FIREFLIES_API_KEY;

  if (action === "status") {
    if (!hasKey) return res.status(200).json({ connected: false, reason: "FIREFLIES_API_KEY not set" });
    try {
      const d = await ff(`{ transcripts(limit: 1) { id title } }`);
      return res.status(200).json({ connected: true, sample: (d.transcripts || []).length });
    } catch (e) {
      return res.status(200).json({ connected: false, reason: String(e.message || e) });
    }
  }

  if (!hasKey) return res.status(501).json({ error: "Fireflies is not connected. Set FIREFLIES_API_KEY in Vercel (needs a paid Fireflies plan)." });

  try {
    // The field list as the live API reports it — the fix-it tool when a
    // query starts erroring after a Fireflies schema change.
    if (action === "schema") {
      const d = await ff(`{ __type(name:"Transcript"){ fields { name type { name kind ofType { name } } } } }`);
      const fields = ((d.__type && d.__type.fields) || []).map((f) => ({
        name: f.name, type: (f.type && (f.type.name || (f.type.ofType && f.type.ofType.name))) || f.type.kind,
      }));
      return res.status(200).json({ fields });
    }

    if (action === "list") {
      const from = ms(req.query.from), to = ms(req.query.to);
      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
      // Try the date-filtered form first; fall back to plain recency if this
      // schema revision names or types those arguments differently.
      let out = null;
      if (from && to) {
        for (const decl of ["$fromDate: DateTime, $toDate: DateTime", "$fromDate: Float, $toDate: Float", "$fromDate: String, $toDate: String"]) {
          try {
            const vars = decl.includes("String")
              ? { fromDate: new Date(from).toISOString(), toDate: new Date(to).toISOString(), limit }
              : { fromDate: from, toDate: to, limit };
            out = await ff(`query R($limit: Int, ${decl}) { transcripts(limit: $limit, fromDate: $fromDate, toDate: $toDate) { ${LIST_FIELDS} } }`, vars);
            break;
          } catch (e) { /* try the next shape */ }
        }
      }
      if (!out) out = await ff(`query R($limit: Int) { transcripts(limit: $limit) { ${LIST_FIELDS} } }`, { limit });
      const all = (out.transcripts || []).map((t) => ({
        id: t.id, title: t.title, date: t.date, duration: t.duration,
        host: t.host_email || t.organizer_email || "",
        participants: t.participants || [], url: t.transcript_url || "",
      }));
      // Filter client-side too, in case the server ignored the range.
      const items = (from && to) ? all.filter((t) => { const d = Number(t.date); return !d || (d >= from && d <= to); }) : all;
      return res.status(200).json({ items, unfiltered: all.length !== items.length ? all.length : undefined });
    }

    if (action === "get") {
      const id = (req.query.id || "").toString();
      if (!id) return res.status(400).json({ error: "id required" });
      const d = await ff(
        `query One($id: String!) { transcript(id: $id) {
           id title date duration host_email organizer_email participants transcript_url
           sentences { index speaker_name text start_time }
         } }`, { id });
      const t = d.transcript;
      if (!t) return res.status(404).json({ error: "not found" });
      // Hand back plain "Speaker: text" — exactly what the scrum reader wants.
      const text = (t.sentences || []).map((x) => (x.speaker_name ? x.speaker_name + ": " : "") + (x.text || "")).join("\n");
      const speakers = [...new Set((t.sentences || []).map((x) => x.speaker_name).filter(Boolean))];
      return res.status(200).json({
        id: t.id, title: t.title, date: t.date, duration: t.duration,
        host: t.host_email || t.organizer_email || "",
        participants: t.participants || [], url: t.transcript_url || "",
        speakers, text, words: text ? text.split(/\s+/).length : 0,
      });
    }

    // join: send the Fireflies notetaker into a live meeting so the scrum
    // records itself. Older schema revisions lack the `duration` argument —
    // retry without it rather than failing the join.
    if (action === "join") {
      const link = (req.query.link || "").toString().trim();
      if (!link) return res.status(400).json({ error: "link required" });
      const title = (req.query.title || "Eb - Daily scrum").toString();
      const mins = Math.min(parseInt(req.query.mins, 10) || 60, 180);
      try {
        const d = await ff(
          `mutation SendBot($link: String!, $title: String, $duration: Int) {
             addToLiveMeeting(meeting_link: $link, title: $title, duration: $duration) { success }
           }`, { link, title, duration: mins });
        return res.status(200).json({ joined: !!(d.addToLiveMeeting && d.addToLiveMeeting.success) });
      } catch (e) {
        if (/duration/i.test(String(e.message))) {
          const d = await ff(
            `mutation SendBot($link: String!, $title: String) {
               addToLiveMeeting(meeting_link: $link, title: $title) { success }
             }`, { link, title });
          return res.status(200).json({ joined: !!(d.addToLiveMeeting && d.addToLiveMeeting.success) });
        }
        if (/paid|upgrade|plan/i.test(String(e.message)))
          return res.status(200).json({ joined: false, error: "The notetaker API needs a paid Fireflies plan." });
        throw e;
      }
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
}
