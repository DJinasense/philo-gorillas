// Vercel serverless function: POST { prompt } -> { reply }
// Keeps your Anthropic API key on the server. NEVER put it in index.html.
// Set it in your Vercel project as an Environment Variable named ANTHROPIC_API_KEY.

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY is not set on the server." });
    return;
  }

  const { prompt } = req.body || {};
  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "Missing 'prompt' string in request body." });
    return;
  }

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!upstream.ok) {
      const errBody = await upstream.text();
      res.status(upstream.status).json({ error: "Anthropic API error: " + errBody.slice(0, 300) });
      return;
    }

    const data = await upstream.json();
    const reply = (data.content && data.content[0] && data.content[0].text) || "";
    res.status(200).json({ reply });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
