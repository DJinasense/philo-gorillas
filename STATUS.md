# Four Minds — running status & checklist

Living scratchpad so we can pick up without re-deriving state. Update as things change.
Last verified: 2026-07-31

## Provider chain (api/ask.js)

Order: Anthropic → Gemini → Groq → Cerebras → OpenRouter → CheapestInference.
Keys 1–5 are VALID and correctly named in Vercel. Verified by forcing each
provider to fail and reading its error (auth errors would be 401; we got 400/402/404
model/billing errors instead, which means auth passed).

| # | Provider | Env var | Status |
|---|----------|---------|--------|
| 1 | Anthropic | `ANTHROPIC_API_KEY` | ❌ Blocked — "credit balance is too low". Key fine, account needs credits. |
| 2 | Gemini | `GEMINI_API_KEY` | ✅ Working |
| 3 | Groq | `GROQ_API_KEY` | ✅ Working |
| 4 | Cerebras | `CEREBRAS_API_KEY` | ❌ Blocked — 402 "Payment required… visit your billing tab". Key fine, account has no quota. |
| 5 | OpenRouter | `OPENROUTER_API_KEY` | ✅ Working (`openai/gpt-oss-20b:free`) |
| 6 | CheapestInference | `CHEAPESTINFERENCE_API_KEY` | ❌ 401 Invalid API key. Var name is correct (provider is reached); the **value** is rejected. Their key should start with `sk-`. |

Net: **3 of 6 live.** Site answers fine today via Gemini.

**CheapestInference is PAID** (flat $14.99/mo), which is why it sits last — it only
bills when all five free providers above have failed. Don't mistake it for free backup.

### Model IDs — do not guess these, they drift
- Anthropic: `claude-haiku-4-5`
- Gemini: `gemini-flash-latest`
- Groq: `llama-3.3-70b-versatile` (hardcoded; max_tokens ceiling 32768)
- Cerebras: `gpt-oss-120b` — other slugs (`llama3.1-8b`, `qwen-3-32b`,
  `llama-4-scout-17b-16e-instruct`, `llama-3.3-70b`) all 404 for this account
- OpenRouter: `openai/gpt-oss-20b:free` — `:free` variants get retired without notice.
  Re-list with: `curl https://openrouter.ai/api/v1/models`
- CheapestInference: **slug unconfirmed.** Base URL `https://api.cheapestinference.com/v1`,
  OpenAI-compatible. Their docs pages 404 and `/v1/models` needs auth, so the slugs
  behind the advertised names (Kimi K3, Kimi K2.7, GLM 5.2, MiniMax M3, DeepSeek V4
  Flash, MiMo v2.5) are guesses. Code defaults to `deepseek-v4-flash` but reads
  `CHEAPESTINFERENCE_MODEL` first — so a wrong guess is fixable in Vercel with no
  code change.

### How to test the chain without touching Vercel
`api/ask.js` accepts per-provider model overrides, so you can force fallthrough:

```bash
curl -s -X POST https://philo-gorillas.vercel.app/api/ask -H "content-type: application/json" -d '{"prompt":"ping","model":"bogus","geminiModel":"bogus","max_tokens":32769}'
```

`model`/`geminiModel` bogus kills 1 and 2; `max_tokens` over 32768 kills Groq.
A failure of all five returns a 502 listing every provider's error — best single
diagnostic we have.

## TODO

### Blockers to full resilience
- [ ] **Anthropic**: add credits at console.anthropic.com → Plans & Billing.
      Nothing to change in code or Vercel — it re-enters at position 1 automatically.
- [ ] **Cerebras**: resolve the 402 at cloud.cerebras.ai → billing tab (free tier may
      just need activating). Also **rotate this key** — the old value was pasted in
      plaintext into a chat screenshot on 2026-07-31 and should be considered burned.

### Vercel housekeeping
- [x] ~~Rename the CheapInference var → `CHEAPESTINFERENCE_API_KEY`~~ done, name verified live
- [ ] **Fix the `CHEAPESTINFERENCE_API_KEY` value** — currently 401s. Get the subscriber
      key (starts with `sk-`) from the cheapestinference.com dashboard; confirm the
      subscription is active. Model slug still unverifiable until auth works.
- [ ] Delete leftover unused vars `Cloud_Cerebras_AI` and `CLOUD_CEREBRAS_AI`
- [ ] Add `MAILGUN_DOMAIN` — not yet present. Value is the sending domain from
      Mailgun → Sending → Domains (e.g. `sandboxXXXX.mailgun.org` or `mg.yourdomain.com`).
      NOT `api.mailgun.net` — that's just the API base URL, same for every account.
- [x] ~~`STRIPE_SECRET_KEY` added + redeployed~~
- [ ] Add `STRIPE_PRICE_ID` = `price_1TzOyp2MJmIbm2RbcSoCztKG` if not already set
      (Stripe product catalog name: `philo-gorillas`). Price IDs are not secret.

Reminder: env var names are **case-sensitive** and must match `process.env.X` exactly.
This bit us once already — `Anthropic`/`Gemini` were silently ignored for weeks.
One redeploy at the end covers all edits.

### Freemium / Pro feature — NOT STARTED
Design (per dreaminterpreter.ai model): read answer halfway → signup → verify email →
unlock rest. **6 free questions**, then **$6/mo Pro** unlocks OmniVoice character voices.

- [ ] Provision DB (decided: Vercel Postgres via Neon). Schema: email, verified flag,
      free-question count, stripe customer id
- [ ] Mailgun send + verification-token endpoints
- [ ] Wire the existing UI — `#formSignUp`, `#formSignIn`, `#proModal` already exist in
      index.html but **the signup submit button has no handler at all**. Not a bug; unbuilt.
- [ ] Stripe checkout. Product `philo-gorillas`, price `price_1TzOyp2MJmIbm2RbcSoCztKG`
      ($6/mo). Secret key already in Vercel as `STRIPE_SECRET_KEY`. Still to build:
      checkout session endpoint + webhook to flip the user's Pro flag on payment.
      Confirm whether the key/price are test-mode or live-mode before wiring.

### Known non-issues (don't re-investigate)
- OmniVoice already falls back to browser SpeechSynthesis if unreachable — Pro users
  never get silence, just a generic voice. Working as designed.
- iPhone mic input doesn't work. Apple WebKit lacks Web Speech recognition. Platform
  limit, not a bug. TTS works fine on iOS.
- Fixed 2026-07-31 (`3af7c54`): a TDZ crash on `voiceAssignment` was halting the whole
  inline script before any listener attached — that's why the theme toggle and every
  other button appeared dead.
