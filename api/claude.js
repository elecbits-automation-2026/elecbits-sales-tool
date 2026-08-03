// Vercel serverless function — AI proxy.
// Holds ANTHROPIC_API_KEY server-side and forwards note-helper prompts to the
// Anthropic Messages API. The browser calls this at /api/claude (see src/lib/ai.ts).
//
// Env vars (set in Vercel project settings, server-only — do NOT prefix with VITE_):
//   ANTHROPIC_API_KEY   (required)
//   ANTHROPIC_MODEL     (optional; defaults to claude-opus-4-8. Use
//                        claude-sonnet-5 or claude-haiku-4-5 to cut cost.)

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "AI is not configured (missing ANTHROPIC_API_KEY)." });
    return;
  }

  // Two accepted shapes:
  //   { prompt, maxTokens }                     — single-turn (legacy helpers)
  //   { system, messages, maxTokens }           — multi-turn chat (Sales OS gates / KB assistant)
  const { prompt, system, messages, maxTokens } = req.body || {};
  const hasMessages = Array.isArray(messages) && messages.length > 0;
  if (!hasMessages && (!prompt || typeof prompt !== "string")) {
    res.status(400).json({ error: "Missing 'prompt' or 'messages'." });
    return;
  }

  // Cheapest-capable default: Haiku 4.5 ($1/$5 per Mtok) — plenty for the short
  // stage-intake Q&A and knowledge lookups this app makes, ~5x cheaper than Opus.
  // Override with ANTHROPIC_MODEL (e.g. claude-sonnet-5 for sharper gates).
  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";
  // Cap output tokens hard so a single call can never run away. 1200 covers a
  // gate question + compiled summary comfortably.
  const max_tokens = Math.min(Math.max(parseInt(maxTokens, 10) || 700, 1), 1200);

  // The client may not send a model (or an outdated one) — the server always
  // decides the model, so client input is ignored here on purpose.
  const chatMessages = hasMessages
    ? messages
        .filter((m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
        .map((m) => ({ role: m.role, content: m.content }))
    : [{ role: "user", content: prompt }];

  const body = { model, max_tokens, messages: chatMessages };
  if (typeof system === "string" && system.trim()) body.system = system;

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    const data = await anthropicRes.json();

    if (!anthropicRes.ok) {
      // Surface the upstream reason (status + Anthropic error type/message) so
      // failures are diagnosable from the browser Network tab. This never
      // includes the API key. Common cases: 401 authentication_error (bad or
      // revoked key), 400 invalid_request_error / credit balance too low
      // (no credits on the account), 404 not_found_error (bad model id).
      console.error("Anthropic API error:", anthropicRes.status, JSON.stringify(data));
      const upstream = (data && data.error) || {};
      res.status(502).json({
        error: "AI request failed.",
        upstreamStatus: anthropicRes.status,
        type: upstream.type || null,
        detail: upstream.message || null,
      });
      return;
    }

    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    res.status(200).json({ text: text || "(No response generated.)" });
  } catch (e) {
    console.error("Claude proxy threw:", e);
    res.status(500).json({ error: "AI request failed." });
  }
}
