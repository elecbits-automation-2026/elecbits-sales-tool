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

  // The extraction quality of the whole tool (scrum → tasks, gates, plans)
  // rides on this model. Sonnet 5 is the floor for reliable structured output;
  // override with ANTHROPIC_MODEL if needed.
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
  // Cap output tokens hard so a single call can never run away.
  const max_tokens = Math.min(Math.max(parseInt(maxTokens, 10) || 700, 1), 8192);

  // Content may be a plain string or Anthropic content blocks (text / image /
  // document) — the latter carries pasted screenshots and attached files.
  const cleanBlocks = (content) => {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return null;
    const blocks = content.filter((b) => b && (
      (b.type === "text" && typeof b.text === "string") ||
      ((b.type === "image" || b.type === "document") &&
        b.source && b.source.type === "base64" &&
        typeof b.source.media_type === "string" && typeof b.source.data === "string")
    )).map((b) => b.type === "text"
      ? { type: "text", text: b.text }
      : { type: b.type, source: { type: "base64", media_type: b.source.media_type, data: b.source.data } });
    return blocks.length ? blocks : null;
  };

  // The server always decides the model; client model input is ignored.
  const chatMessages = hasMessages
    ? messages
        .filter((m) => m && (m.role === "user" || m.role === "assistant"))
        .map((m) => ({ role: m.role, content: cleanBlocks(m.content) }))
        .filter((m) => m.content)
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

    if (!text) {
      // An empty answer is a real failure, not an answer. Say why, so it is
      // diagnosable from the browser instead of reading "(No response)".
      console.error("Anthropic returned no text:", JSON.stringify({
        stop_reason: data.stop_reason, blocks: (data.content || []).map((b) => b.type),
      }));
      res.status(200).json({
        text: data.stop_reason === "max_tokens"
          ? "(The answer was cut off before any text came back — ask for less at once.)"
          : "(The AI returned an empty answer" + (data.stop_reason ? " — stop reason: " + data.stop_reason : "") + ". Try again, or re-attach a smaller image.)",
      });
      return;
    }

    res.status(200).json({ text });
  } catch (e) {
    console.error("Claude proxy threw:", e);
    res.status(500).json({ error: "AI request failed." });
  }
}
