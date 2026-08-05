# Philo-Gorillas — step-by-step guide to finishing it

Last verified live: **2026-08-05** (via `/api/health` against the deployed site).
Companion doc to `STATUS.md`. `STATUS.md` is the reference ("what is true right now");
this is the sequence ("what to do next, in what order, and why that order").

Each step is tagged with who does it:

- 🧑 **Dima** — a browser/dashboard task. No code. Claude cannot do these (they need
  your logins, and entering credentials is yours to do).
- 🤖 **Claude** — a code task in this repo. Just ask.
- 🧑🤖 **Both** — Claude writes the code, you flip a switch somewhere.

---

## Where the project actually stands (verified, not remembered)

**Working right now**

- Deployed and live at `philo-gorillas.vercel.app`. All 6 AI provider keys are present
  and correctly named. 4 of 6 respond (Gemini serves normal traffic).
- Postgres is connected — `philo_gorillas_DATABASE_URL` and friends are live.
- Chat, Room mode, Solo mode, browser text-to-speech, theme toggle, parallax.
- `/api/health` gives an instant, free, secret-free readout of all of the above.

**Not working / not built**

- No account system. `#formSignIn` and `#formSignUp` render and their tabs switch, but
  both carry `onsubmit="return false;"` and have no submit handler — verified at
  `index.html:742` and `index.html:749`. There is nothing to sign into.
- No free-question counter. The only gate in the code is `isPro()`
  (`index.html:1553`), which reads a localStorage flag. The "6 free questions" model
  does not exist in code yet.
- No Stripe checkout, no webhook, no Pro entitlement check.
- `MAILGUN_DOMAIN` still not reaching Production — confirmed missing again today.
- `philotalk.qd.je` does not resolve at all (connection fails). Nameservers still unset.
- `STRIPE_SECRET_KEY` is still a **live** key with no price ID set.

---

# Phase 0 — Safety first (do before anything else)

Nothing below this line is worth doing on top of burned keys or a live payment key.

### Step 1 🧑 Rotate the three exposed keys

Three key values have been exposed in places they shouldn't be. Rotating is quick and
there is no code change — the variable *names* stay identical, so the app doesn't care.

| Key | Where to rotate | Why |
|---|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys | Value was pasted into a chat window 2026-07-31 |
| `CEREBRAS_API_KEY` | cloud.cerebras.ai → API Keys | Value appeared in a screenshot 2026-07-31 |
| `GEMINI_API_KEY` | aistudio.google.com → API Keys | An `AIza…` value is sitting in plaintext in `.claude/settings.local.json` |

For each: revoke the old one, create a new one, paste it into Vercel → Settings →
Environment Variables under the **same name**, tick **Production**, then redeploy once
at the end for all three.

Good news on Gemini: the key Vercel is currently serving is already a newer-format
value, so the plaintext `AIza…` one is probably no longer the live key. Revoke it
anyway — it costs nothing and removes the question.

### Step 2 🤖 Clean the leaked values out of `.claude/settings.local.json`

That file is gitignored and has never been committed (verified), so nothing leaked to
GitHub. But it holds real key values inside `Bash(export ANTHROPIC_API_KEY='sk-ant-…')`
permission entries. Ask Claude to strip those entries. Cheap, and it stops the file
from being a standing liability.

**The rule going forward:** secrets go provider site → Vercel dashboard, directly.
Never into chat, never into a repo file, never into a screenshot. Only the variable
*name* is ever needed in conversation.

### Step 3 🧑 Swap Stripe into test mode

`STRIPE_SECRET_KEY` is currently an `sk_live_` key. Building checkout against it means
the very first test charges a real card on a real statement. Do this before any payment
code exists, not after.

1. dashboard.stripe.com → get into a non-live environment. Stripe has replaced the old
   single **Test mode** toggle with **Sandboxes** — isolated environments you create and
   discard. Depending on the account you'll see one or the other; either is fine. Dima's
   account uses **sandboxes**.
2. Developers → API keys → copy the **Secret key**. Sandbox and legacy test-mode keys
   both carry the `sk_test_` prefix, which is what `/api/health` keys off.
3. Products → new product `philo-gorillas`, recurring, **$6/month** → copy its price id.
   It will *not* match the live price id `price_1TzOyp2MJmIbm2RbcSoCztKG`. That's
   correct, not a mistake — every environment has its own catalog.

   ⚠️ **The product must be created inside the same sandbox as the key.** Sandboxes are
   isolated from each other and from live. A price id from a different sandbox looks
   perfectly valid and 404s at checkout. Known product id: `prod_V1AzbTNr9Hj88S` —
   confirm it appears under Products *with that sandbox selected* before trusting it.

   Note: the product id itself is never an env var. Checkout takes the **price** id.
   Keep `prod_…` for the webhook work in Step 9.
4. Vercel → set `STRIPE_SECRET_KEY` to the `sk_test_` value and `STRIPE_PRICE_ID` to the
   new test price id. **Tick Production** on both.
5. `/api/health` reports `stripe.mode` on every check — use it to confirm you landed in
   test mode before writing a line of checkout code.

At launch you swap both back to live values. Nothing in code changes; the key prefix
alone decides which universe you're in.

---

# Phase 1 — Infrastructure the paywall depends on

### Step 4 🧑 Point the domain

`philotalk.qd.je` is registered (DigitalPlat, exp. 2027-07-31) but does not resolve —
all eight nameserver fields are blank. The registrar exposes only nameservers, no DNS
record editor, so the route is Vercel's nameservers rather than A/CNAME records.

1. Vercel → project → Settings → Domains → Add `philotalk.qd.je`.
2. Vercel offers "Vercel Nameservers" for externally-registered domains. Copy the two
   values it shows you — **use what the dashboard shows**, they version these.
3. DigitalPlat → paste into NAME SERVER 1 and 2 → Update. Leave 3–8 blank.
4. Wait. Minutes to ~24h. Vercel issues the TLS certificate automatically once the
   nameservers resolve. Add `www` as a redirect to the apex while you're in there.

This is a prerequisite for the next step, which is why it comes before the email work:
a real domain gives Mailgun a real sending domain and removes the sandbox
Authorized-Recipients restriction that would otherwise block verification email to
anyone but you.

### Step 5 🧑 Make `MAILGUN_DOMAIN` actually reach Production

This one has now failed twice. `/api/health` confirms today: `MAILGUN_API_KEY` present,
`MAILGUN_DOMAIN` absent.

We've already ruled out a spelling mismatch — health checks for any variable with
"mail" in the name and that list comes back empty. So it's one of exactly two things:

1. **The Production checkbox was left unticked.** A variable scoped only to Preview or
   Development is invisible to the live site. Check this first — it's the likely cause.
2. It was saved without a redeploy afterwards.

The value is the sending domain from Mailgun → Sending → Domains. Once Step 4 lands,
that's `mg.philotalk.qd.je`; before then it's `sandboxXXXX.mailgun.org`. It is **not**
`api.mailgun.net` — that's the API base URL, identical for every account, and it's the
most common wrong answer here.

Confirm with `/api/health` → `services.mailgun.ready: true` before moving on.

---

# Phase 2 — The freemium product (the actual remaining build)

This is the big one and it's genuinely unbuilt. Steps 6–9 are sequential — each needs
the one before it.

The design, per the dreaminterpreter.ai model you liked: user reads an answer about
halfway → prompted to sign up → verifies email → rest of the answer unlocks.
**6 free questions**, then **$6/mo Pro**, which unlocks the OmniVoice character voices.

### Step 6 ✅ Database schema — done and LIVE 2026-08-05

`users` table is live in production (confirmed via curl, `existingRowCount: 0`).

Built: `package.json` (`@prisma/client`, `prisma`, `@prisma/adapter-pg`, `pg`,
`postinstall: prisma generate`), `prisma/schema.prisma` (no models — raw SQL only),
`api/_db.js` (resolves the connection string, wraps it in a `@prisma/adapter-pg`
driver adapter), `api/migrate.js` (idempotent `CREATE TABLE IF NOT EXISTS users
(...)`, secret-gated). `api/health.js?live=1` runs `SELECT 1` against the real DB.

Two corrections vs. the original assumption, found by live testing rather than
docs: this is Vercel's **Prisma Postgres** integration, not Neon — and despite the
name, `philo_gorillas_PRISMA_DATABASE_URL` is also a plain `postgres://` string,
not an Accelerate-protocol URL. There is no Accelerate URL exposed for this
resource at all, so Prisma 7's `accelerateUrl` constructor option doesn't apply —
a driver adapter (`@prisma/adapter-pg`) is the correct approach. Also, Prisma 7
dropped `datasource { url = env(...) }` from schema files entirely; the
connection string is now supplied in code (`api/_db.js`), not the schema.

The connection vars are named `philo_gorillas_DATABASE_URL` / `_POSTGRES_URL` /
`_PRISMA_DATABASE_URL` — **not** the usual `POSTGRES_URL` — so auto-detecting
libraries find nothing; `_db.js` checks all three explicitly.

### Step 7 🤖 Auth endpoints, and wire the forms up

Build `/api/signup`, `/api/verify`, `/api/signin` — email + token, no passwords to
store or lose. Then attach real submit handlers to `#formSignUp` and `#formSignIn`,
which currently do nothing.

Do the one-line CSS fix in the same pass: the sign-in dropdown renders *behind* the
chat. `#loginDropdown` has `z-index: 500`, which looks like it should win but doesn't —
`index.html:133` sets `header, .layout, .composer { position: relative; z-index: 1 }`,
so `header` opens its own stacking context and the dropdown's 500 only competes inside
it. Against sibling `.layout` at the same z-index 1, the later element in the DOM
paints on top. The fix is to raise `header` (e.g. `z-index: 10`), not the dropdown.
Deferred until now on purpose — there was nothing behind the dropdown worth seeing.

### Step 8 🤖 Move the free-question counter server-side

Count questions against the user record in Postgres, not localStorage. Serve the first
half of the answer to an un-verified user and hold the rest behind verification.

Worth being clear-eyed: `?pro=1` in the URL currently flips Pro on for any browser, and
Pro is just a localStorage flag. That's fine as an owner testing convenience and it
should stay — but it means the gate is decorative until entitlement is checked
server-side. This step is what makes it real.

### Step 9 🧑🤖 Stripe checkout + webhook

Checkout session endpoint plus a webhook that flips the user's Pro flag when payment
succeeds. Test with card `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP.

You'll need to add the webhook endpoint URL in the Stripe dashboard and paste its
signing secret into Vercel — Claude will tell you the exact URL once the endpoint
exists.

---

# Phase 3 — Polish and launch

### Step 10 🧑 Add provider credits (optional)

Two of six providers are blocked on money, not bugs. Neither is urgent — Gemini, Groq,
OpenRouter and CheaperInference cover traffic fine.

- **Anthropic**: "credit balance too low". console.anthropic.com → Plans & Billing. It
  re-enters the chain at position 1 automatically, no code change.
- **Cerebras**: 402 payment required. cloud.cerebras.ai → billing tab; the free tier may
  just need activating.

### Step 11 🤖 Cheaper CheaperInference model

`CHEAPERINFERENCE_MODEL` currently resolves to `claude-opus-4.6` — Opus-class pricing on
the one paid provider in the chain. It only bills when all five free providers above it
have failed, so exposure is low, but it's worth swapping to a cheaper slug once we can
read their live `/v1/models` catalog. Override via the `CHEAPERINFERENCE_MODEL` env var
in Vercel — no code change needed.

### Step 12 🧑 Confirm the PWA on your iPhone

Once the domain is live: Safari → your URL → Share → Add to Home Screen. Confirm it
opens standalone (no browser chrome), the icon looks right, and voice output actually
plays.

Do **not** spend time debugging microphone input on iPhone. Apple's WebKit doesn't
implement speech recognition, every iOS browser is forced onto WebKit, and there is no
workaround. Text input plus voice output is the iPhone experience. Mic works on Android
and desktop Chrome.

---

# The `/dream` routine is now part of this project

`/dream` is a nightly memory-review pass: it reads recent session transcripts, diffs
them against what's already recorded, and proposes corrections for approval. It never
rewrites memory on its own — only tiny mechanical fixes (typos, broken index lines)
auto-apply; everything with meaning in it waits for you to say `/dream apply <ids>`.

It now lives at `.claude/skills/dream/` **in this repo**, vendored the same way
`ui-ux-pro-max` is. When a session's working directory is inside Philo-Gorillas, this
copy shadows the global one at `~/.claude/skills/dream/`.

**Why bother vendoring it:** the project copy knows two things the global one doesn't.

1. **There are two memory stores, and one of them was rotting.**
   `~/.claude/memory/` is what `/dream` maintains. But
   `~/.claude/projects/C--Projects-philo-gorillas/memory/` is what gets loaded into
   context automatically at the start of every session in this repo — and nothing was
   refreshing it. It had drifted five days stale and was actively wrong (it claimed the
   Vercel deployment status was "unknown" and the freemium plan was still just a plan).
   The project copy of `/dream` proposes against **both** stores.

2. **`STATUS.md` drifts the same way memory does.** The project copy also diffs recent
   sessions against `STATUS.md` and proposes updates — a provider that changed state, an
   env var that landed, a TODO that got finished. Always as a proposal, never
   auto-applied, because it's a committed file and a bad edit lands in git history.

**How to use it**

```bash
/dream
```

Reviews everything since the last run, prints numbered proposals with evidence quotes,
and waits. Then:

```bash
/dream apply 1,3,5
```

Or `/dream apply all`. Proposals live in `~/.claude/memory/dream-report.md`, which is a
durable log — applied items get marked, not deleted.

There's also a nightly unattended run at 3:00 AM via Windows Task Scheduler
(`run-dream.ps1`, vendored alongside the skill). It auto-applies nothing but the tiny
fixes and leaves everything else in the report for you to read in the morning.

**One rule it inherits and enforces harder here:** API key values never get written into
a memory file, into `STATUS.md`, or into a dream report — not even quoted as evidence.
Variable names only. Non-secret and fine to record: env var names, model IDs, Stripe
price IDs, domains.

---

## The fastest way to answer "is it working right now?"

```bash
curl -s "https://philo-gorillas.vercel.app/api/health?live=1"
```

Pings every provider (~10 tokens each) and reports OK/FAIL per provider with error text,
plus Stripe mode, Mailgun readiness, and whether the DB variables landed. Never returns
a secret value. Drop `?live=1` for the instant, completely free version.
