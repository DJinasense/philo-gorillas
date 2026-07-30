# Four Minds — Project Summary

**One line:** A voice-and-text web app where you talk to Plato, Nietzsche, Descartes, and
Marcus Aurelius — built from their real texts, installable on iOS/Android as a PWA, with
a "let them debate each other" mode. Built for Dima, a poet/musician/real-estate broker
using this as a study companion and a potential content engine for YouTube/TikTok.

Repo: github.com/DJinasense/philo-gorillas (public).

---

## 1. What exists right now

A single-page web app (`index.html` + `manifest.json` + `sw.js` + icons + `api/ask.js`),
currently running two ways:
1. **Cowork artifact** ("four-minds") — works today, zero setup, uses Cowork's built-in
   `window.cowork.askClaude()` bridge to generate replies. Lives in a different session,
   not this repo — treat this repo as the canonical source going forward.
2. **Standalone PWA** (the files in this repo) — same code, dual-mode: if
   `window.cowork` exists it uses that; otherwise it calls `/api/ask`, a serverless
   function that hits the Anthropic API directly. This is what needs to be deployed
   (Vercel) to get a real URL installable on a phone home screen.

## 2. Core architecture

```
index.html          → all UI, all 4 persona system prompts, all client logic (single file)
manifest.json         → PWA metadata (name, icons, standalone display)
sw.js                 → service worker, caches the app shell, never caches /api/ calls
api/ask.js            → Vercel serverless function; server-side Anthropic API call
icon-*.png,
apple-touch-icon.png,
favicon-32.png         → generated icons (4 overlapping circles in each philosopher's color)
DEPLOY.md              → step-by-step GitHub + Vercel deployment guide
```

No database, no auth, no vector store. Conversation history lives in a JS array in
memory (`history[]`) and resets on page reload. Intentionally minimal — a prototype/MVP.

## 3. The four personas

Each is a ~250-word system prompt (see `PERSONAS` object in `index.html`) covering:
core doctrine, rhetorical style, and a named source edition. Grounded in real,
**verified** public-domain texts (fetched and confirmed live on Project Gutenberg, not
just recalled from training data):

| Philosopher | Primary text | Translator | Gutenberg link |
|---|---|---|---|
| Plato | The Republic | Benjamin Jowett | gutenberg.org/ebooks/1497 |
| Nietzsche | Beyond Good and Evil | Helen Zimmern | gutenberg.org/ebooks/4363 |
| Nietzsche | Thus Spoke Zarathustra | Thomas Common | gutenberg.org/ebooks/1998 |
| Descartes | Discourse on the Method | John Veitch | gutenberg.org/ebooks/59 |
| Marcus Aurelius | Meditations | Meric Casaubon | gutenberg.org/ebooks/2680 |

All public domain — zero licensing exposure. Each philosopher card in the UI links
directly to their real text.

**Not yet done:** deeper grounding via actual excerpted passages injected into replies
(currently the model reasons from the system-prompt description of the doctrine, not
retrieved passages). Lightweight RAG — chunk the Gutenberg texts, embed, pull 1-3
relevant passages per question into the prompt — is the next authenticity upgrade if it
matters more than current shipping speed.

## 4. Voice

- **Input:** browser-native Web Speech API (`SpeechRecognition`). Works in Chrome
  desktop and Chrome on Android. **Does not work on iPhone** — Apple's WebKit (every iOS
  browser is forced to use it, including Chrome-on-iOS) doesn't implement speech
  recognition. Hard platform limit, not a bug.
- **Output:** two engines, user-selectable in the UI:
  - Browser-native `SpeechSynthesis` (default, works everywhere, generic voices).
  - **OmniVoice Studio** (github.com/debpalash/OmniVoice-Studio, AGPL-3.0) — free, local,
    voice-cloning app. `index.html` has a "Voice engine" selector with a configurable
    base URL + optional bearer token; `speakOmni()` calls `POST {base}/v1/audio/speech`
    (OpenAI-compatible) with `voice: <profile id>`, and falls back to browser voices on
    any failure. **Not yet actually wired to a running instance or tested end-to-end** —
    see Immediate Task below.

## 5. On "OmniVoice" and "ui-ux-pro-max-skill"

Both are real, independently-published open-source projects (verified by cloning them
directly), not Cowork/Anthropic connectors:
- **OmniVoice Studio** — AGPL-3.0. Running it locally or calling its API from this app
  is unrestricted. If the *server itself* is modified and redistributed or offered as a
  network service to others, AGPL requires releasing that source too. Not a concern for
  personal use.
- **ui-ux-pro-max-skill** (github.com/nextlevelbuilder/ui-ux-pro-max-skill) — MIT.
  Install via `npx ui-ux-pro-max-cli init --ai claude`. Ships 84 UI styles, 192 color
  palettes, 74 font pairings, 98 UX guidelines, 161 reasoning rules. `index.html`
  currently has ONE style (row #79, "Academia/Scholarly" — parchment/brass/crimson,
  Cormorant Garamond + Crimson Pro + Cinzel) hand-applied by reading the CSV directly,
  as a stand-in for actually running the tool. That was a workaround — see Immediate
  Task below to do it properly.

## 6. Known platform limits (don't rediscover these the hard way)

- Mic input: Android/desktop Chrome only, never iPhone (see section 4).
- `localhost` URLs (for OmniVoice) only work when the browser and the OmniVoice
  backend are on the same device. For iPhone use, OmniVoice needs to be reachable over
  HTTPS from outside — Tailscale Funnel or similar tunnel, not plain `localhost`.
- This app was built inside Cowork (Anthropic's sandboxed agent product) in a prior
  session with no filesystem/git access — that's why deployment never got past
  scaffolding. Claude Code, running here with real filesystem + git + shell, is the
  right place to finish it.

---

## IMMEDIATE TASK — do this now, in order

**1. Design pass with ui-ux-pro-max-skill (do it properly, not by hand)**

- Install: `npx ui-ux-pro-max-cli init --ai claude` in this repo root.
- Use the skill's actual design-system generation flow (per its own docs/instructions
  the installer adds) to audit `index.html` against its reasoning rules and UX
  guidelines — not just colors and fonts. Check: spacing rhythm, touch target sizes on
  the mobile roster/composer, contrast ratios, focus states, `prefers-reduced-motion`,
  and whatever pre-delivery checklist the tool outputs.
- Keep the "Academia / scholarly" direction (parchment, brass, crimson, Cormorant
  Garamond + Crimson Pro + Cinzel) — deliberate choice, matches four dead philosophers.
  Refine within that direction, don't replace it with something generic.
- Must stay light-mode-safe (`:root { color-scheme: light }`) and single-file — this
  also gets pasted back into a Cowork artifact sandbox elsewhere, which requires that.

**2. Real character voices with OmniVoice Studio**

- Help Dima install and run it locally if it isn't already.
- Design four voices in its Voice Design tool matched to character, not defaults:
  - **Plato** — measured, warm, older, faint classical/Mediterranean cadence, unhurried.
  - **Nietzsche** — younger, intense, faster, wider dynamic range, edge of mania under
    control.
  - **Descartes** — precise, even, slightly formal, French-inflected, deliberate.
  - **Marcus Aurelius** — grave, weathered, low, imperial authority, minimal affect.
- Save each as a profile named exactly `plato`, `nietzsche`, `descartes`, `marcus` —
  `index.html` already expects those exact IDs.
- Verify `speakOmni()`'s call shape against OmniVoice's actual current API/OpenAPI spec
  — it may have moved on since this was written; don't trust the existing code blindly.
- Make OmniVoice the default engine once confirmed working; keep browser voices as
  fallback, don't remove it.
- Clarify for Dima whether `localhost` vs. a Tailscale/remote URL is needed for his
  actual daily use (he wants this working on his iPhone, not just desktop).

**3. Ship it**

- Repo already exists and is public: github.com/DJinasense/philo-gorillas — init git
  here if not already, commit, push.
- Deploy to Vercel (CLI if installed, or walk Dima through Vercel's GitHub import). He
  supplies his own `ANTHROPIC_API_KEY` as a Vercel environment variable — don't ask him
  to paste it into chat, tell him where to enter it in Vercel's dashboard.
- Confirm the deployed URL installs cleanly as a home-screen PWA on iPhone (Safari →
  Share → Add to Home Screen) and that voice output actually plays there.

Ask before anything destructive (force-pushes, wholesale rewrites of the existing
Academia styling if the skill wants something different, etc.) — otherwise just build.
