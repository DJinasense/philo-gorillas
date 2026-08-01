// Vercel serverless function — proxy to Anthropic Messages API, with Gemini, Groq,
// Cerebras, OpenRouter, and CheapestInference fallback (tried in that order, first
// configured key wins per request; on failure it falls through to the next).
// Accepts: { system: "<persona system prompt>", messages: [{role, content}, ...] }
//     or:  { prompt: "<one big string>" }   (legacy fallback)
//
// Backend selection (on the server, never client-visible):
//   - If ANTHROPIC_API_KEY is set → Anthropic Messages API (claude-haiku-4-5)
//   - Else if GEMINI_API_KEY is set → Google Gemini (gemini-flash-latest)
//   - Else if GROQ_API_KEY is set → Groq (llama-3.3-70b-versatile)
//   - Else if CEREBRAS_API_KEY is set → Cerebras Cloud (llama-3.3-70b)
//   - Else if OPENROUTER_API_KEY is set → OpenRouter (free-tier model)
//   - Else if CHEAPESTINFERENCE_API_KEY is set → cheapestinference.com (PAID — last
//     on purpose, so it only bills when every free provider above is down)
//   - Else → 500 with a hint to set one on Vercel.
//
// Set keys in Vercel → Project → Settings → Environment Variables, then
// trigger a redeploy — Vercel only picks up new env vars on a fresh build.

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }

  const anthropicKey  = process.env.ANTHROPIC_API_KEY;
  const geminiKey     = process.env.GEMINI_API_KEY;
  const groqKey       = process.env.GROQ_API_KEY;
  const cerebrasKey   = process.env.CEREBRAS_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const cheapestKey   = process.env.CHEAPESTINFERENCE_API_KEY;

  if (!anthropicKey && !geminiKey && !groqKey && !cerebrasKey && !openrouterKey && !cheapestKey) {
    res.status(500).json({
      error: "No provider key set on the server. Add ANTHROPIC_API_KEY, GEMINI_API_KEY, GROQ_API_KEY, CEREBRAS_API_KEY, OPENROUTER_API_KEY, or CHEAPESTINFERENCE_API_KEY in Vercel → Project → Settings → Environment Variables, then redeploy."
    });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const system    = typeof body.system === "string" ? body.system : "";
  let   messages  = Array.isArray(body.messages) ? body.messages : null;
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
    const errors = [];

    // ── Anthropic first ──────────────────────────────────────────────────────
    if (anthropicKey) {
      const out = await callAnthropic({ apiKey: anthropicKey, system, messages, maxTokens, model: body.model });
      if (out.error) {
        errors.push(out.error);
        // fall through to next provider
      } else {
        reply = out.reply;
        backend = "anthropic";
      }
    }

    // ── Gemini second ─────────────────────────────────────────────────────────
    if (!reply && geminiKey) {
      const g = await callGemini({ apiKey: geminiKey, system, messages, maxTokens, model: body.geminiModel });
      if (g.error) {
        errors.push(g.error);
        // fall through to Groq
      } else {
        reply = g.reply;
        backend = "gemini";
      }
    }

    // ── Groq third ───────────────────────────────────────────────────────────
    if (!reply && groqKey) {
      const gr = await callGroq({ apiKey: groqKey, system, messages, maxTokens });
      if (gr.error) {
        errors.push(gr.error);
        // fall through to Cerebras
      } else {
        reply = gr.reply;
        backend = "groq";
      }
    }

    // ── Cerebras fourth ──────────────────────────────────────────────────────
    if (!reply && cerebrasKey) {
      const ce = await callCerebras({ apiKey: cerebrasKey, system, messages, maxTokens, model: body.cerebrasModel });
      if (ce.error) {
        errors.push(ce.error);
        // fall through to OpenRouter
      } else {
        reply = ce.reply;
        backend = "cerebras";
      }
    }

    // ── OpenRouter fifth ─────────────────────────────────────────────────────
    if (!reply && openrouterKey) {
      const or = await callOpenRouter({ apiKey: openrouterKey, system, messages, maxTokens, model: body.openrouterModel });
      if (or.error) {
        errors.push(or.error);
        // fall through to CheapestInference
      } else {
        reply = or.reply;
        backend = "openrouter";
      }
    }

    // ── CheapestInference last ───────────────────────────────────────────────
    // Deliberately last: this one is a paid subscription, so it only carries
    // traffic when every free provider above has failed.
    if (!reply && cheapestKey) {
      const ch = await callCheapestInference({ apiKey: cheapestKey, system, messages, maxTokens, model: body.cheapestModel });
      if (ch.error) {
        errors.push(ch.error);
      } else {
        reply = ch.reply;
        backend = "cheapestinference";
      }
    }

    if (!reply) {
      res.status(502).json({ error: "All providers failed. Errors: " + errors.join(" | ") });
      return;
    }
    res.status(200).json({ reply, backend });
  } catch (e) {
    res.status(500).json({ error: "Backend call failed: " + String(e && e.message || e) });
  }
};

// ── Provider implementations ─────────────────────────────────────────────────

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

  const cand  = data.candidates && data.candidates[0];
  const parts = cand && cand.content && cand.content.parts;
  const reply = Array.isArray(parts)
    ? parts.filter(p => p && typeof p.text === "string").map(p => p.text).join("\n").trim()
    : "";
  if (!reply) {
    return { status: 502, error: "Empty Gemini reply (finishReason=" + (cand && cand.finishReason || "?") + ")." };
  }
  return { reply };
}

async function callGroq({ apiKey, system, messages, maxTokens }) {
  // Groq is OpenAI-compatible. We use llama-3.3-70b-versatile — strong, cheap, fast.
  const groqMessages = system
    ? [{ role: "system", content: system }, ...messages]
    : messages;

  const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": "Bearer " + apiKey
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      max_tokens: maxTokens,
      messages: groqMessages
    })
  });

  const raw = await upstream.text();
  if (!upstream.ok) {
    let detail = raw;
    try {
      const parsed = JSON.parse(raw);
      detail = (parsed && parsed.error && (parsed.error.message || parsed.error.type)) || raw;
    } catch (e) { /* keep raw */ }
    return { status: upstream.status, error: "Groq " + upstream.status + ": " + String(detail).slice(0, 500) };
  }
  let data;
  try { data = JSON.parse(raw); }
  catch (e) { return { status: 502, error: "Non-JSON Groq response: " + raw.slice(0, 300) }; }

  const reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || "").trim();
  if (!reply) {
    return { status: 502, error: "Empty Groq reply (finish_reason=" + (data.choices && data.choices[0] && data.choices[0].finish_reason || "?") + ")." };
  }
  return { reply };
}

async function callCerebras({ apiKey, system, messages, maxTokens, model }) {
  // Cerebras Cloud is OpenAI-compatible.
  const cerebrasMessages = system
    ? [{ role: "system", content: system }, ...messages]
    : messages;

  const upstream = await fetch("https://api.cerebras.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": "Bearer " + apiKey
    },
    body: JSON.stringify({
      // gpt-oss-120b is the model this account has access to; other Cerebras
      // slugs (llama3.1-8b, qwen-3-32b, llama-4-scout) return 404 for us.
      model: (typeof model === "string" && model) || "gpt-oss-120b",
      max_tokens: maxTokens,
      messages: cerebrasMessages
    })
  });

  const raw = await upstream.text();
  if (!upstream.ok) {
    let detail = raw;
    try {
      const parsed = JSON.parse(raw);
      detail = (parsed && parsed.error && (parsed.error.message || parsed.error.type)) || raw;
    } catch (e) { /* keep raw */ }
    return { status: upstream.status, error: "Cerebras " + upstream.status + ": " + String(detail).slice(0, 500) };
  }
  let data;
  try { data = JSON.parse(raw); }
  catch (e) { return { status: 502, error: "Non-JSON Cerebras response: " + raw.slice(0, 300) }; }

  const reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || "").trim();
  if (!reply) {
    return { status: 502, error: "Empty Cerebras reply (finish_reason=" + (data.choices && data.choices[0] && data.choices[0].finish_reason || "?") + ")." };
  }
  return { reply };
}

async function callOpenRouter({ apiKey, system, messages, maxTokens, model }) {
  // OpenRouter is OpenAI-compatible; default to a free-tier model so this fallback
  // never incurs cost even if it ends up carrying traffic for a while.
  const openrouterMessages = system
    ? [{ role: "system", content: system }, ...messages]
    : messages;

  const upstream = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": "Bearer " + apiKey,
      "HTTP-Referer": "https://philo-gorillas.vercel.app",
      "X-Title": "Four Minds"
    },
    body: JSON.stringify({
      // Verified free-tier slug. OpenRouter retires ":free" variants periodically —
      // if this 404s, list current ones with: curl https://openrouter.ai/api/v1/models
      model: (typeof model === "string" && model) || "openai/gpt-oss-20b:free",
      max_tokens: maxTokens,
      messages: openrouterMessages
    })
  });

  const raw = await upstream.text();
  if (!upstream.ok) {
    let detail = raw;
    try {
      const parsed = JSON.parse(raw);
      detail = (parsed && parsed.error && (parsed.error.message || parsed.error.type)) || raw;
    } catch (e) { /* keep raw */ }
    return { status: upstream.status, error: "OpenRouter " + upstream.status + ": " + String(detail).slice(0, 500) };
  }
  let data;
  try { data = JSON.parse(raw); }
  catch (e) { return { status: 502, error: "Non-JSON OpenRouter response: " + raw.slice(0, 300) }; }

  const reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || "").trim();
  if (!reply) {
    return { status: 502, error: "Empty OpenRouter reply (finish_reason=" + (data.choices && data.choices[0] && data.choices[0].finish_reason || "?") + ")." };
  }
  return { reply };
}

async function callCheapestInference({ apiKey, system, messages, maxTokens, model }) {
  // cheapestinference.com — OpenAI-compatible, flat-rate paid subscription.
  // Their docs don't publish the model slugs and /v1/models needs auth, so the
  // default below is overridable via CHEAPESTINFERENCE_MODEL without a redeploy
  // of this file. Advertised models: Kimi K3, Kimi K2.7, GLM 5.2, MiniMax M3,
  // DeepSeek V4 Flash, MiMo v2.5.
  const cheapestMessages = system
    ? [{ role: "system", content: system }, ...messages]
    : messages;

  const modelId = (typeof model === "string" && model)
    || process.env.CHEAPESTINFERENCE_MODEL
    || "deepseek-v4-flash";

  const upstream = await fetch("https://api.cheapestinference.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": "Bearer " + apiKey
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: maxTokens,
      messages: cheapestMessages
    })
  });

  const raw = await upstream.text();
  if (!upstream.ok) {
    let detail = raw;
    try {
      const parsed = JSON.parse(raw);
      detail = (parsed && parsed.error && (parsed.error.message || parsed.error.type)) || (parsed && parsed.error) || raw;
    } catch (e) { /* keep raw */ }
    return { status: upstream.status, error: "CheapestInference " + upstream.status + " (model=" + modelId + "): " + String(detail).slice(0, 500) };
  }
  let data;
  try { data = JSON.parse(raw); }
  catch (e) { return { status: 502, error: "Non-JSON CheapestInference response: " + raw.slice(0, 300) }; }

  const reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || "").trim();
  if (!reply) {
    return { status: 502, error: "Empty CheapestInference reply (finish_reason=" + (data.choices && data.choices[0] && data.choices[0].finish_reason || "?") + ")." };
  }
  return { reply };
}
