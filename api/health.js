// Admin health check — answers "which of my env vars are actually wired up,
// and which providers really work right now?" without ever exposing a secret.
//
//   GET /api/health          → instant, free. Which vars are present.
//   GET /api/health?live=1   → also pings every AI provider (tiny, ~10 tokens each).
//
// Values are NEVER returned — only whether a variable exists, plus a masked
// fingerprint (first 6 chars) so you can tell two keys apart without seeing either.

const ask = require("./ask.js");

function present(name) {
  const v = process.env[name];
  return typeof v === "string" && v.trim().length > 0;
}

// Shows enough to identify a key, not enough to use one.
function fingerprint(name) {
  const v = process.env[name];
  if (!v) return null;
  return v.slice(0, 6) + "…(" + v.length + " chars)";
}

function firstPresent(names) {
  return names.find(present) || null;
}

module.exports = async function handler(req, res) {
  const live = req.query && (req.query.live === "1" || req.query.live === "true");

  // Which env var name is each provider actually reading? Mirrors ask.js.
  const providers = [
    { id: "anthropic",         label: "Anthropic",         vars: ["ANTHROPIC_API_KEY"] },
    { id: "gemini",            label: "Gemini",            vars: ["GEMINI_API_KEY"] },
    { id: "groq",              label: "Groq",              vars: ["GROQ_API_KEY"] },
    { id: "cerebras",          label: "Cerebras",          vars: ["CEREBRAS_API_KEY"] },
    { id: "openrouter",        label: "OpenRouter",        vars: ["OPENROUTER_API_KEY"] },
    { id: "cheaperinference",  label: "CheaperInference",  vars: ["CHEAPERINFERENCE_API_KEY", "CHEAPINFERENCE_API_KEY", "CHEAPESTINFERENCE_API_KEY"] }
  ];

  const chain = providers.map(p => {
    const found = firstPresent(p.vars);
    return {
      order: p.label,
      configured: !!found,
      readingVar: found,
      keyFingerprint: found ? fingerprint(found) : null,
      note: found && found !== p.vars[0]
        ? "Working, but named '" + found + "'. Canonical name is '" + p.vars[0] + "'."
        : undefined
    };
  });

  // Non-AI services. Presence only — these are all secrets except the price ID.
  const services = {
    mailgun: {
      MAILGUN_API_KEY: present("MAILGUN_API_KEY"),
      MAILGUN_DOMAIN:  present("MAILGUN_DOMAIN"),
      ready: present("MAILGUN_API_KEY") && present("MAILGUN_DOMAIN"),
      // Names only, never values. When a var "was definitely added" but reads as
      // missing, it is almost always spelled differently — this shows the spelling.
      similarlyNamedVars: Object.keys(process.env)
        .filter(k => /mail|mg_/i.test(k) && k !== "MAILGUN_API_KEY" && k !== "MAILGUN_DOMAIN")
        .sort(),
      note: present("MAILGUN_DOMAIN") ? undefined : "MAILGUN_DOMAIN missing — verification email cannot send. Check similarlyNamedVars for a spelling mismatch, and confirm a redeploy happened after adding it."
    },
    stripe: {
      STRIPE_SECRET_KEY: present("STRIPE_SECRET_KEY"),
      STRIPE_PRICE_ID:   present("STRIPE_PRICE_ID"),
      // Price IDs are not secret, so this one is safe to show in full.
      priceId: process.env.STRIPE_PRICE_ID || null,
      mode: present("STRIPE_SECRET_KEY")
        ? (String(process.env.STRIPE_SECRET_KEY).startsWith("sk_live_")
            ? "LIVE — real charges against real cards"
            : "test")
        : null
    },
    database: {
      // The Vercel/Neon integration used a custom prefix, so the vars are
      // philo_gorillas_* rather than the usual POSTGRES_*. List whatever landed.
      detectedVars: Object.keys(process.env)
        .filter(k => /^(philo_gorillas|POSTGRES|DATABASE|NEON)/i.test(k))
        .sort(),
      get connected() { return this.detectedVars.length > 0; }
    }
  };

  const result = {
    checkedAt: new Date().toISOString(),
    chain,
    summary: {
      configured: chain.filter(c => c.configured).length,
      total: chain.length
    },
    services
  };

  if (!live) {
    result.hint = "Add ?live=1 to also ping each AI provider and see which genuinely respond.";
    res.status(200).json(result);
    return;
  }

  // Live probe: small request to each provider, in parallel.
  // maxTokens must leave real headroom — reasoning models spend tokens before
  // emitting any text, so too low a ceiling reports a healthy provider as failed.
  const probe = [{ role: "user", content: "Reply with the single word: ok" }];
  const T = 256;
  const runners = {
    anthropic:        k => ask.callAnthropic({ apiKey: k, system: "", messages: probe, maxTokens: T }),
    gemini:           k => ask.callGemini({ apiKey: k, system: "", messages: probe, maxTokens: T }),
    groq:             k => ask.callGroq({ apiKey: k, system: "", messages: probe, maxTokens: T }),
    cerebras:         k => ask.callCerebras({ apiKey: k, system: "", messages: probe, maxTokens: T }),
    openrouter:       k => ask.callOpenRouter({ apiKey: k, system: "", messages: probe, maxTokens: T }),
    cheaperinference: k => ask.callCheaperInference({ apiKey: k, system: "", messages: probe, maxTokens: T })
  };

  await Promise.all(providers.map(async (p, i) => {
    const varName = chain[i].readingVar;
    if (!varName) { chain[i].live = "not configured"; return; }
    try {
      const out = await runners[p.id](process.env[varName]);
      if (out && out.error) {
        chain[i].live = "FAIL";
        chain[i].error = String(out.error).slice(0, 300);
      } else {
        chain[i].live = "OK";
      }
    } catch (e) {
      chain[i].live = "FAIL";
      chain[i].error = String((e && e.message) || e).slice(0, 300);
    }
  }));

  result.summary.live = chain.filter(c => c.live === "OK").length;
  res.status(200).json(result);
};
