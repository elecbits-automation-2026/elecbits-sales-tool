// Communications intake — the seam where client email and WhatsApp will land.
//
// The design (agreed, not yet credentialed):
//   • EMAIL — a dedicated mailbox (e.g. sales-inbox@elecbits.in). This
//     function polls it via the Gmail API using the existing Drive service
//     account with domain-wide delegation, filtering by client address and
//     the project ID in the subject line, and files each mail as a touch on
//     the right company (sales.org_activities, kind='email', source='inbox').
//   • WHATSAPP — the WhatsApp Business API webhook posts here; messages file
//     the same way (kind='whatsapp').
//
// Until the credentials exist this endpoint only reports what is missing, so
// the UI can show a "not connected" card instead of pretending.
//
// Env (Vercel, server-only):
//   INBOX_GMAIL_USER        the mailbox to poll, e.g. sales-inbox@elecbits.in.
//                           The service account needs domain-wide delegation
//                           with scope https://www.googleapis.com/auth/gmail.readonly
//                           (Google Admin → Security → API controls).
//   GOOGLE_SERVICE_ACCOUNT_JSON   already set for Drive — reused here.
//   WHATSAPP_TOKEN          WhatsApp Business API access token.
//   WHATSAPP_VERIFY_TOKEN   the webhook verify token you choose in Meta's console.

export default async function handler(req, res) {
  const action = (req.query.action || "status").toString();

  if (action === "status") {
    const sa = !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    const mailbox = process.env.INBOX_GMAIL_USER || "";
    const wa = !!process.env.WHATSAPP_TOKEN;
    return res.status(200).json({
      email: { configured: !!(sa && mailbox), mailbox: mailbox || null,
        missing: [!sa && "GOOGLE_SERVICE_ACCOUNT_JSON", !mailbox && "INBOX_GMAIL_USER"].filter(Boolean) },
      whatsapp: { configured: wa, missing: wa ? [] : ["WHATSAPP_TOKEN", "WHATSAPP_VERIFY_TOKEN"] },
      note: "Scaffold — polling and webhook handlers activate once the credentials above exist.",
    });
  }

  // WhatsApp webhook verification handshake (Meta calls GET with these params).
  if (req.method === "GET" && req.query["hub.mode"] === "subscribe") {
    if (req.query["hub.verify_token"] === process.env.WHATSAPP_VERIFY_TOKEN) {
      return res.status(200).send(req.query["hub.challenge"]);
    }
    return res.status(403).json({ error: "verify token mismatch" });
  }

  return res.status(501).json({ error: "Not active yet — set the env vars listed by ?action=status." });
}
