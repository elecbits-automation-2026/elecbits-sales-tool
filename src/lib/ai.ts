// AI helper — calls our own serverless proxy at /api/claude, which holds the
// ANTHROPIC_API_KEY server-side and forwards to the Anthropic API. The browser
// never sees the key. See api/claude.js.
async function callClaude(prompt, maxTokens = 700) {
  try {
    const response = await fetch("/api/claude", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, maxTokens }),
    });
    if (!response.ok) {
      console.error("callClaude: proxy returned", response.status);
      return "(No response generated.)";
    }
    const data = await response.json();
    return (data && data.text) || "(No response generated.)";
  } catch (e) {
    console.error("callClaude failed:", e);
    return "(No response generated.)";
  }
}

export { callClaude };
