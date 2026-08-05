# Four Minds — running status & checklist

Living scratchpad so we can pick up without re-deriving state. Update as things change.
Last verified: 2026-08-01

## Provider chain (api/ask.js)

Order: Anthropic → Gemini → Groq → Cerebras → OpenRouter → CheaperInference.
Keys 1–5 are VALID and correctly named in Vercel. Verified by forcing each
provider to fail and reading its error (auth errors would be 401; we got 400/402/404
model/billing errors instead, which means auth passed).

Verified live 2026-08-05 via `/api/health?live=1`.

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
- [ ] ⏸️ **Anthropic**: "credit balance too low" (a 400, not a 401 — so the key
      authenticates fine, the account just has no credits). **Parked**: the account is
      split across two orgs on one email, free-tier and Pro, and Anthropic support hasn't
      resolved it. Nothing to change in code or Vercel — it re-enters the chain at
      position 1 automatically once the org/credit situation is sorted.
- [ ] ⏸️ **Cerebras**: also a free-tier account. The 402 is quota, not auth. Low priority
      for the same reason as Anthropic — four providers already answer.
- [ ] **Cerebras**: resolve the 402 at cloud.cerebras.ai → billing tab (free tier may
      just need activating). Key rotation is done; quota is the remaining problem.

### 🔴 Rotate these — exposed in chat 2026-07-31
- [ ] ⏸️ **`ANTHROPIC_API_KEY` — deliberately parked 2026-08-05.** An `sk-ant-api03-...`
      value was pasted into a chat window and should eventually be rotated. **Blocked by
      an Anthropic-side account bug:** the same email resolves to two separate orgs — one
      free-tier, one Pro — and keys/credits land in the wrong one. Support has not
      responded. Rotating now would just mint another key in the ambiguous org.
      Resume when Anthropic fixes the org split. Note the health fingerprint can't tell
      old from new — every Anthropic key is `sk-ant` + 108 chars.
- [x] ~~`CEREBRAS_API_KEY` — rotated 2026-08-05, fingerprint changed `csk-km…` → `csk-d9…`~~
- [x] ~~`GEMINI_API_KEY` — an `AIza…` value sat in plaintext in `.claude/settings.local.json`
      (gitignored, never committed). Entries stripped 2026-08-05. Vercel serves a newer
      `AQ.Ab8…` key, so the exposed one was already out of service.~~

Rule going forward: secrets go provider site → Vercel directly. Never into chat, never
into a file in this repo. Only the variable *name* is ever needed in conversation.
Non-secret by contrast: Stripe **price** IDs (`price_...`), model IDs, domains.

### Vercel housekeeping
- [ ] **`CHEAPERINFERENCE_API_KEY`** — key was deleted and is being re-added under the
      correct name. Value must start with `ir_live_` (from cheaperinference.com).
      Code also still accepts the old `CHEAPESTINFERENCE_API_KEY` name as a fallback.
      Once live, verify the model slug and swap to a cheaper one than `claude-opus-4.6`.
- [ ] Delete leftover unused vars `Cloud_Cerebras_AI` and `CLOUD_CEREBRAS_AI`
- [x] ~~Add `MAILGUN_DOMAIN`~~ — **RESOLVED 2026-08-05**. `/api/health` reports
      `mailgun.ready: true`. Cause was the one predicted below: the **Production
      checkbox**. Original diagnosis kept for the pattern — a var scoped only to
      Preview/Development is invisible to the live site and reads as simply missing.
      Nothing sends email yet regardless; the endpoints are still unbuilt.
      Value is the sending domain from Mailgun → Sending → Domains. Currently the
      sandbox domain; becomes `mg.philotalk.qd.je` once the domain is pointed.
      NOT `api.mailgun.net` — that's just the API base URL, same for every account.
      While on a sandbox domain, Mailgun only delivers to addresses listed under
      **Authorized Recipients**.
- [x] ~~`STRIPE_SECRET_KEY` added + redeployed~~
- [x] ~~🔴 `STRIPE_SECRET_KEY` is a LIVE key~~ — **RESOLVED 2026-08-05**. Swapped to a
      sandbox key; `/api/health` now reports `stripe.mode: "test"`. Flip back to the
      live key at launch — no code change, the key prefix alone decides the universe.
- [x] ~~`STRIPE_PRICE_ID` is not set~~ — **RESOLVED 2026-08-05**.
      Sandbox price: `price_1U18duLWPm50p3uvPHRj2e7X`, product `prod_V1AzbTNr9Hj88S`.
      Live-mode price remains `price_1TzOyp2MJmIbm2RbcSoCztKG` — different catalog,
      swap at launch. Price and product IDs are not secret.

#### How to get a Stripe test key (recipe — done 2026-08-05, kept for the launch swap-back)
1. dashboard.stripe.com → get into a non-live environment. Stripe has replaced the old
   **Test mode** toggle with **Sandboxes** (isolated environments you create/discard);
   this account uses sandboxes. Either way it's a parallel universe: separate products,
   customers, payments, logs. Sandbox keys still carry the `sk_test_` prefix, which is
   what `/api/health` keys off. **A product/price only exists inside its own sandbox** —
   an id from a different one looks valid and 404s at checkout.
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

### Database — ✅ LIVE. `users` table created 2026-08-05.
Vercel's **Prisma Postgres** integration (not Neon — corrected after live testing
disproved that assumption), custom var prefix `philo_gorillas`. All three vars
resolve to the same host, `db.prisma.io`:
- `philo_gorillas_DATABASE_URL` ← used (direct `postgres://` TCP connection string)
- `philo_gorillas_POSTGRES_URL` ← same, fallback
- `philo_gorillas_PRISMA_DATABASE_URL` ← same, fallback (name suggests Accelerate,
  but it's also a plain `postgres://` string — there is no Accelerate-protocol URL
  exposed for this resource at all)

Repo's `package.json` depends on `@prisma/client`, `prisma`, `@prisma/adapter-pg`,
and `pg` (Prisma 7 requires a driver adapter for direct `postgres://` connections —
its old `datasource { url = ... }` schema syntax and Accelerate's `accelerateUrl`
constructor option are for a different Prisma product/protocol and don't apply
here). `postinstall: prisma generate` regenerates the client on every Vercel build.
- `prisma/schema.prisma` — no models declared; raw SQL only (`$executeRawUnsafe`/
  `$queryRawUnsafe`), so this file just points the generator at the `postgresql`
  provider.
- `api/_db.js` — resolves the connection string, wraps it in `@prisma/adapter-pg`'s
  `PrismaPg`, exports a lazy `client()`.
- `api/migrate.js` — `POST` endpoint, idempotent (`CREATE TABLE IF NOT EXISTS`),
  creates the `users` table (email, verified flag, verification token + expiry,
  free-question count, stripe customer id, is_pro flag). Gated by `ADMIN_SECRET`
  (already set in Vercel across all environments).
- `api/health.js` — `?live=1` runs a real `SELECT 1` against the DB.

**Confirmed live:** `curl -X POST https://philotalk.dgrvip.net/api/migrate -H "x-admin-key: <ADMIN_SECRET>"`
→ `{"ok":true,"message":"users table is ready.","existingRowCount":0}`.

### Freemium / Pro feature — schema done, endpoints NOT STARTED
Design (per dreaminterpreter.ai model): read answer halfway → signup → verify email →
unlock rest. **6 free questions**, then **$6/mo Pro** unlocks OmniVoice character voices.

- [x] Provision DB (Vercel Prisma Postgres) — connected since before this session.
- [x] `users` table live in production (`api/migrate.js`, run 2026-08-05).
- [ ] Mailgun send + verification-token endpoints
- [ ] Wire the existing UI — `#formSignUp`, `#formSignIn`, `#proModal` already exist in
      index.html but **the signup submit button has no handler at all**. Not a bug; unbuilt.
      Also fix the login-dropdown z-index stacking bug while touching this area (see
      the "login-dropdown stacking context" note further down / recent commit).
- [ ] Stripe checkout. Product `philo-gorillas`, price `price_1TzOyp2MJmIbm2RbcSoCztKG`
      ($6/mo live) / sandbox price `price_1U18duLWPm50p3uvPHRj2e7X` (test, product
      `prod_V1AzbTNr9Hj88S`). Secret key already in Vercel as `STRIPE_SECRET_KEY`
      (currently sandbox/test). Still to build: checkout session endpoint + webhook to
      flip the user's `is_pro` flag on payment.

### Domain — philotalk.qd.je (free, DigitalPlat, reg. 2026-07-31, exp. 2027-07-31)
## 🛑 BLOCKED — `philotalk.qd.je` cannot be verified on Vercel. Buy a real domain.

**Verified 2026-08-05. Do not spend more time editing DNS records for this domain.**

`philotalk.qd.je` is not a domain we own — it is a subdomain of **DigitalPlat's** `qd.je`:

```
qd.je            → ns1/ns2/ns4.digitalplat.org   (DigitalPlat's zone, not ours)
philotalk.qd.je  → dns1/dns2.digitalplat.org     (our zone)
_vercel.qd.je    → NXDOMAIN, and we cannot create it
```

Vercel reports *"This domain is linked to another Vercel account"* and demands a TXT at
**`_vercel.qd.je`** — the parent zone. We have no write access there.

Root cause: `qd.je` is **not on the Public Suffix List** (checked — the list has `co.je`,
`net.je`, `org.je`, `of.je`, but no `qd.je`). So Vercel treats all of `qd.je` as one
owner's property. Another DigitalPlat customer evidently claimed a `qd.je` name on Vercel
first, so Vercel wants the *zone owner* to vouch for us.

Escape routes, in order of sanity:
1. **Buy a real domain (~$10–15/yr). Recommended.** Verification becomes a single CNAME,
   Mailgun gets a proper sending domain, and a paid product gets a credible URL.
2. Check whether *we* hold the domain on a second Vercel account/team — if so, removing
   it there may drop verification to a plain CNAME. Only self-fixable version. Cheap to rule out.
3. Get DigitalPlat to add `_vercel.qd.je` or submit `qd.je` to the Public Suffix List.
   Correct long-term fix, entirely outside our control, not on our timeline.

**This blocks nothing.** The app is live and PWA-installable at `philo-gorillas.vercel.app`,
and a Mailgun sending domain need not match the app's domain. Steps 6–8 (DB, accounts,
server-side paywall) proceed unblocked.

Note the Vercel TXT token also rotated (`…848db5d8a716ba24f059` → `…127e2b6e2be3e83da4db`),
so any previously-entered `_vercel` TXT is stale regardless.

<details><summary>Superseded: notes from when we thought this domain was usable</summary>

**Correction 2026-08-05:** an earlier note here claimed DigitalPlat exposes only
nameservers and no DNS record editor. That is wrong — it has a full record editor, and
we are using it. The zone is live and healthy: `dns1/dns2.digitalplat.org` answer
authoritatively for `philotalk.qd.je`. Ignore the nameserver-delegation instructions
below; they describe a route we did not take.

### ⚠️ DigitalPlat appends the zone name unless you end a value with a dot
This bit us twice on 2026-08-05. Records were entered as `philotalk` and `mailgun.org`
and became `philotalk.philotalk.qd.je` and `mailgun.org.philotalk.qd.je`. Use `@` for
the apex, and always terminate an external hostname with a trailing dot (`mailgun.org.`).

Current record state:
- ✅ TXT `_vercel` — correct, resolves, Vercel ownership check will pass
- ❌ CNAME `philotalk` → delete it; the apex record belongs at Name `@`
- ❌ CNAME `email` → value needs the trailing dot, and Mailgun needs its *full* record
  set (SPF + DKIM TXT, 2× MX, tracking CNAME) under `mg.philotalk.qd.je`, not just this one
- ⬜ Apex `philotalk.qd.je` has no A and no CNAME — this is why nothing resolves

Read the exact apex record off **Vercel → Settings → Domains**; Vercel issues per-domain
targets. If DigitalPlat refuses a CNAME at `@` (normal — a CNAME can't coexist with the
apex NS/SOA), use the A-record option Vercel offers instead.

<details><summary>Superseded: the nameserver-delegation route (not used)</summary>

1. Vercel → project → Settings → Domains → Add `philotalk.qd.je`
2. Vercel offers "Vercel Nameservers" for domains registered elsewhere. Take those two
   values (`ns1.vercel-dns.com` / `ns2.vercel-dns.com` at time of writing — **use what
   the dashboard shows**, they version these).
3. Paste into NAME SERVER 1 and 2 at DigitalPlat → Update nameservers. Leave 3–8 blank.
4. Propagation is minutes to ~24h. Vercel issues the TLS cert automatically once NS
   resolve. Add `www` as a redirect to the apex while you're in there.

</details>

Add `www` as a CNAME and set it to redirect to the apex in Vercel. Once a domain is
live it also gives Mailgun a real sending domain, which removes the sandbox
Authorized-Recipients restriction on verification email — currently Mailgun will only
deliver to addresses whitelisted under Authorized Recipients.

</details>

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
