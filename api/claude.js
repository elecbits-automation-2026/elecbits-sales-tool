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

  const { prompt, maxTokens } = req.body || {};
  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "Missing 'prompt'." });
    return;
  }

  const model = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
  const max_tokens = Math.min(Math.max(parseInt(maxTokens, 10) || 700, 1), 4096);

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await anthropicRes.json();

    if (!anthropicRes.ok) {
      console.error("Anthropic API error:", data);
      res.status(502).json({ error: "AI request failed." });
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
