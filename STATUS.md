# Four Minds — running status & checklist

Living scratchpad so we can pick up without re-deriving state. Update as things change.
Last verified: 2026-08-01

## Provider chain (api/ask.js)

Order: Anthropic → Gemini → Groq → Cerebras → OpenRouter → CheaperInference.
Keys 1–5 are VALID and correctly named in Vercel. Verified by forcing each
provider to fail and reading its error (auth errors would be 401; we got 400/402/404
model/billing errors instead, which means auth passed).

Verified live 2026-08-01 via `/api/health?live=1`.

| # | Provider | Env var | Status |
|---|----------|---------|--------|
| 1 | Anthropic | `ANTHROPIC_API_KEY` | ❌ Blocked — "credit balance is too low". Key fine, account needs credits. |
| 2 | Gemini | `GEMINI_API_KEY` | ✅ Working |
| 3 | Groq | `GROQ_API_KEY` | ✅ Working |
| 4 | Cerebras | `CEREBRAS_API_KEY` | ❌ Blocked — 402 "Payment required… visit your billing tab". Key fine, account has no quota. |
| 5 | OpenRouter | `OPENROUTER_API_KEY` | ✅ Working (`openai/gpt-oss-20b:free`) |
| 6 | CheaperInference | `CHEAPERINFERENCE_API_KEY` | ✅ Working (`claude-opus-4.6`) |

Net: **4 of 6 live.** Gemini serves normal traffic. Only the two paid-account
providers are down, and both need money, not fixes.

**CheaperInference is PAID** (per-token, ~30% below list), which is why it sits last —
it only bills when all five free providers above have failed. Not free backup.

Note: `cheaperinference.com` and `cheapestinference.com` are two different companies
with near-identical names. We are on **cheaper**. Keys are prefixed `ir_live_`.

### Model IDs — do not guess these, they drift
- Anthropic: `claude-haiku-4-5`
- Gemini: `gemini-flash-latest`
- Groq: `llama-3.3-70b-versatile` (hardcoded; max_tokens ceiling 32768)
- Cerebras: `gpt-oss-120b` — other slugs (`llama3.1-8b`, `qwen-3-32b`,
  `llama-4-scout-17b-16e-instruct`, `llama-3.3-70b`) all 404 for this account
- OpenRouter: `openai/gpt-oss-20b:free` — `:free` variants get retired without notice.
  Re-list with: `curl https://openrouter.ai/api/v1/models`
- CheaperInference: `claude-opus-4.6` — taken from their own documented curl example,
  so it's known-good, but Opus-class pricing. Base URL `https://api.cheaperinference.com/v1`.
  Full catalog only readable from `/v1/models` (needs auth); other documented slugs
  include `gpt-5.4` and `kimi-k3`. Override with `CHEAPERINFERENCE_MODEL` in Vercel —
  no code change needed. **Worth switching to a cheaper slug once we can read the
  live catalog.**

### Admin health check
`/api/health` — instant, free, shows which env vars are present, which variable name
each provider is actually reading, a masked key fingerprint, Stripe test-vs-live mode,
and whether the DB vars landed. Never returns a secret value.

`/api/health?live=1` — also pings every AI provider (~10 tokens each) and reports
OK/FAIL per provider with the error text. This is the fastest way to answer
"is everything actually working right now?"

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

### 🔴 Rotate these — exposed in chat 2026-07-31
- [ ] `ANTHROPIC_API_KEY` — an `sk-ant-api03-...` value was pasted into a chat window.
      Revoke at console.anthropic.com → API Keys, issue a new one, update Vercel.
- [ ] `CEREBRAS_API_KEY` — a `csk-...` value appeared in a screenshot. Same drill.

Rule going forward: secrets go provider site → Vercel directly. Never into chat, never
into a file in this repo. Only the variable *name* is ever needed in conversation.
Non-secret by contrast: Stripe **price** IDs (`price_...`), model IDs, domains.

### Vercel housekeeping
- [ ] **`CHEAPERINFERENCE_API_KEY`** — key was deleted and is being re-added under the
      correct name. Value must start with `ir_live_` (from cheaperinference.com).
      Code also still accepts the old `CHEAPESTINFERENCE_API_KEY` name as a fallback.
      Once live, verify the model slug and swap to a cheaper one than `claude-opus-4.6`.
- [ ] Delete leftover unused vars `Cloud_Cerebras_AI` and `CLOUD_CEREBRAS_AI`
- [ ] Add `MAILGUN_DOMAIN` — **still not reaching Production as of 2026-08-01**, even
      though it was entered. `/api/health` now lists `similarlyNamedVars` (any var with
      "mail" in the name) and that list came back **empty** — so it isn't a spelling
      mismatch. Two remaining causes: the **Production checkbox was left unticked**
      (a var scoped only to Preview/Development is invisible to the live site), or it
      was saved without a redeploy. Check the environment checkboxes first.
      Value is the sending domain from Mailgun → Sending → Domains
      (e.g. `sandboxXXXX.mailgun.org` or `mg.philotalk.qd.je`).
      NOT `api.mailgun.net` — that's just the API base URL, same for every account.
- [x] ~~`STRIPE_SECRET_KEY` added + redeployed~~
- [ ] 🔴 **`STRIPE_SECRET_KEY` is a LIVE key (`sk_live_`)** — confirmed via /api/health.
      Building checkout against it means the first test charges a real card. Swap for a
      `sk_test_` key while developing, then flip back at launch.
- [ ] `STRIPE_PRICE_ID` is not set in Vercel at all. The known price
      `price_1TzOyp2MJmIbm2RbcSoCztKG` (product `philo-gorillas`, $6/mo) belongs to
      **live** mode — test and live have separate catalogs, so a test key needs its own
      product + price. Price IDs are not secret.

#### How to get a Stripe test key (recipe)
1. dashboard.stripe.com → flip the **Test mode** switch, top right. Everything below
   is now a parallel universe: separate products, customers, payments, logs.
2. Developers → API keys → copy the **Secret key**, which starts `sk_test_`.
3. Products → add a product named `philo-gorillas`, recurring, $6/month → copy its
   new price id. It will differ from the live one; that's expected, not a mistake.
4. Vercel → set `STRIPE_SECRET_KEY` = the `sk_test_` value, `STRIPE_PRICE_ID` = the
   test price id. Tick **Production** so the deployed site actually sees them.
5. Test with card `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP.
6. At launch, swap both back to the live values. Nothing in code changes — the key
   prefix alone decides which universe you're in, which is why `/api/health` reports
   `stripe.mode` on every check.

Reminder: env var names are **case-sensitive** and must match `process.env.X` exactly.
This bit us once already — `Anthropic`/`Gemini` were silently ignored for weeks.
One redeploy at the end covers all edits.

### Database — ✅ CONNECTED
Vercel Postgres/Neon integration, custom prefix `philo_gorillas`. Confirmed present:
- `philo_gorillas_DATABASE_URL`
- `philo_gorillas_POSTGRES_URL`
- `philo_gorillas_PRISMA_DATABASE_URL`

Note these are **not** the usual `POSTGRES_*` names, so libraries that auto-detect
will not find them — pass the connection string explicitly.

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

### Domain — philotalk.qd.je (free, DigitalPlat, reg. 2026-07-31, exp. 2027-07-31)
Registered but **not yet pointed anywhere**; all eight nameserver fields are blank and
the domain shows a "Disabled" badge. The registrar UI exposes only nameservers — no
DNS record editor — so the route is Vercel's nameservers, not A/CNAME records:

1. Vercel → project → Settings → Domains → Add `philotalk.qd.je`
2. Vercel offers "Vercel Nameservers" for domains registered elsewhere. Take those two
   values (`ns1.vercel-dns.com` / `ns2.vercel-dns.com` at time of writing — **use what
   the dashboard shows**, they version these).
3. Paste into NAME SERVER 1 and 2 at DigitalPlat → Update nameservers. Leave 3–8 blank.
4. Propagation is minutes to ~24h. Vercel issues the TLS cert automatically once NS
   resolve. Add `www` as a redirect to the apex while you're in there.

Once live this also gives Mailgun a real sending domain (`mg.philotalk.qd.je`), which
removes the sandbox Authorized-Recipients restriction on verification email.

### Known non-issues (don't re-investigate)
- OmniVoice already falls back to browser SpeechSynthesis if unreachable — Pro users
  never get silence, just a generic voice. Working as designed.
- iPhone mic input doesn't work. Apple WebKit lacks Web Speech recognition. Platform
  limit, not a bug. TTS works fine on iOS.
- Fixed 2026-07-31 (`3af7c54`): a TDZ crash on `voiceAssignment` was halting the whole
  inline script before any listener attached — that's why the theme toggle and every
  other button appeared dead.
- Fixed 2026-08-01 (`6bfb5e0`): `speak()` ran `if (!isPro()) { showProModal(); return; }`
  before dispatching to either engine, so the Pro modal intercepted **browser** voices
  too and the app was mute for every visitor — and for us. The gate now lives inside the
  `omni` branch only. Verified live: asked a question with audio on and no Pro flag set;
  no modal, `speechSynthesis.speaking === true`.
- `?pro=1` on any URL turns Pro on for that browser, `?pro=0` turns it off. Owner
  convenience for testing both views. Not security — Pro is still just a localStorage
  flag, and stays that way until entitlement is checked server-side.

### Diagnosed, deliberately not yet fixed
**Sign-in dropdown renders behind the chat.** `#loginDropdown` has `z-index: 500`, which
looks like it should win but doesn't: line 133 sets `header, .layout, .composer
{ position: relative; z-index: 1 }`. `header` therefore opens its own stacking context,
so the dropdown's 500 only competes *inside* the header — and against sibling `.layout`
at the same z-index 1, the later element in the DOM paints on top. Fix is one line:
give `header` a higher z-index than `.layout`/`.composer` (e.g. `header { z-index: 10 }`)
rather than raising the dropdown. Held off 2026-08-01 at user's request — login is
unbuilt, so the dropdown has nothing behind it yet.

### Where "login" stands
There is still **no account system**. `#formSignUp` / `#formSignIn` render but the submit
buttons have no handlers, and `#proModalCta` only fires an `alert()` placeholder. So there
is nothing to log into and no credential to forget — the DB landing is what unblocks
building it for real.
