// Vercel serverless function — proxy to Anthropic Messages API, with Gemini fallback.
// Accepts: { system: "<persona system prompt>", messages: [{role, content}, ...] }
//     or:  { prompt: "<one big string>" }   (legacy fallback)
//
// Backend selection (on the server, never client-visible):
//   - If ANTHROPIC_API_KEY is set → Anthropic Messages API (claude-haiku-4-5)
//   - Else if GEMINI_API_KEY is set → Google Gemini (gemini-2.5-flash)
//   - Else → 500 with a hint to set one on Vercel and redeploy.
//
// Set the key in Vercel → Project → Settings → Environment Variables, then
// trigger a redeploy — Vercel only picks up new env vars on a fresh build.

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!anthropicKey && !geminiKey) {
    res.status(500).json({
      error: "No provider key set on the server. Add ANTHROPIC_API_KEY or GEMINI_API_KEY in Vercel → Project → Settings → Environment Variables, then redeploy."
    });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const system = typeof body.system === "string" ? body.system : "";
  let messages = Array.isArray(body.messages) ? body.messages : null;
  const maxTokens = Number.isInteger(body.max_tokens) ? body.max_tokens : 1024;

  if (!messages) {
    if (typeof body.prompt === "string" && body.prompt.trim()) {
      messages = [{ role: "user", content: body.prompt }];
    } else {
      res.status(400).json({
        error: "Request must include either { system, messages } or a legacy { prompt } string."
      });
      return;
    }
  }

  try {
    let reply, backend;
    if (anthropicKey) {
      const out = await callAnthropic({ apiKey: anthropicKey, system, messages, maxTokens, model: body.model });
      if (out.transientBillingError && geminiKey) {
        // Anthropic key is present but out of credits — silently fall through to Gemini.
        const g = await callGemini({ apiKey: geminiKey, system, messages, maxTokens, model: body.geminiModel });
        if (g.error) { res.status(g.status).json({ error: g.error }); return; }
        reply = g.reply; backend = "gemini (anthropic billing failed over)";
      } else if (out.error) {
        res.status(out.status).json({ error: out.error }); return;
      } else {
        reply = out.reply; backend = "anthropic";
      }
    } else {
      const g = await callGemini({ apiKey: geminiKey, system, messages, maxTokens, model: body.geminiModel });
      if (g.error) { res.status(g.status).json({ error: g.error }); return; }
      reply = g.reply; backend = "gemini";
    }
    res.status(200).json({ reply, backend });
  } catch (e) {
    res.status(500).json({ error: "Backend call failed: " + String(e && e.message || e) });
  }
};

async function callAnthropic({ apiKey, system, messages, maxTokens, model }) {
  const payload = {
    model: (typeof model === "string" && model) || "claude-haiku-4-5",
    max_tokens: maxTokens,
    messages
  };
  if (system) payload.system = system;

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(payload)
  });

  const raw = await upstream.text();
  if (!upstream.ok) {
    let detail = raw;
    try {
      const parsed = JSON.parse(raw);
      detail = (parsed && parsed.error && (parsed.error.message || parsed.error.type)) || raw;
    } catch (e) { /* keep raw */ }
    const isBilling = /credit balance/i.test(detail) || /billing/i.test(detail);
    return {
      status: upstream.status,
      error: "Anthropic " + upstream.status + ": " + String(detail).slice(0, 500),
      transientBillingError: isBilling
    };
  }
  let data;
  try { data = JSON.parse(raw); }
  catch (e) { return { status: 502, error: "Non-JSON Anthropic response: " + raw.slice(0, 300) }; }

  const reply = Array.isArray(data.content)
    ? data.content.filter(b => b && b.type === "text").map(b => b.text).join("\n").trim()
    : "";
  if (!reply) {
    return { status: 502, error: "Empty Anthropic reply (stop_reason=" + (data.stop_reason || "?") + ")." };
  }
  return { reply };
}

async function callGemini({ apiKey, system, messages, maxTokens, model }) {
  const modelId = (typeof model === "string" && model) || "gemini-flash-latest";
  // Gemini uses "user" / "model" roles and a `contents` array. Map Anthropic-shape messages over.
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: typeof m.content === "string" ? m.content : JSON.stringify(m.content) }]
  }));
  const payload = {
    contents,
    generationConfig: { maxOutputTokens: maxTokens }
  };
  if (system) {
    payload.systemInstruction = { role: "system", parts: [{ text: system }] };
  }

  const url = "https://generativelanguage.googleapis.com/v1beta/models/" +
              encodeURIComponent(modelId) + ":generateContent?key=" + encodeURIComponent(apiKey);

  // One quick retry on transient overload (429/503) — Gemini's free tier throttles bursts.
  let upstream, raw;
  for (let attempt = 0; attempt < 2; attempt++) {
    upstream = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    raw = await upstream.text();
    if (upstream.ok || (upstream.status !== 429 && upstream.status !== 503)) break;
    await new Promise(r => setTimeout(r, 1500));
  }
  if (!upstream.ok) {
    let detail = raw;
    try {
      const parsed = JSON.parse(raw);
      detail = (parsed && parsed.error && (parsed.error.message || parsed.error.status)) || raw;
    } catch (e) { /* keep raw */ }
    return { status: upstream.status, error: "Gemini " + upstream.status + ": " + String(detail).slice(0, 500) };
  }
  let data;
  try { data = JSON.parse(raw); }
  catch (e) { return { status: 502, error: "Non-JSON Gemini response: " + raw.slice(0, 300) }; }

  const cand = data.candidates && data.candidates[0];
  const parts = cand && cand.content && cand.content.parts;
  const reply = Array.isArray(parts)
    ? parts.filter(p => p && typeof p.text === "string").map(p => p.text).join("\n").trim()
    : "";
  if (!reply) {
    return { status: 502, error: "Empty Gemini reply (finishReason=" + (cand && cand.finishReason || "?") + ")." };
  }
  return { reply };
}
