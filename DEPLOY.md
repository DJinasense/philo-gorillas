# Four Minds — deploy this as an installable app

You have 8 files: `index.html`, `manifest.json`, `sw.js`, 3 icon PNGs, and `api/ask.js`.
No coding required — just hosting. Vercel is the path with the least friction because it
auto-detects the `api/` folder as your backend, no config needed.

## 1. Get an Anthropic API key
Go to console.anthropic.com → API Keys → Create Key. Copy it. This is what pays for the
philosophers' replies — cheap per message (this uses Haiku, the fast/cheap model), but
it is a real, ongoing cost tied to usage, not free like the Cowork preview was.

## 2. Put these files in a GitHub repo
- github.com → New repository (public or private, either works) → name it e.g. `four-minds`.
- On the repo page, click "Add file → Upload files," drag in all 8 files (keep `api/ask.js`
  inside a folder named `api`), commit.

## 3. Deploy on Vercel
- vercel.com → Sign up/in with your GitHub account.
- "Add New… → Project" → Import the `four-minds` repo → Deploy (defaults are fine, it's a
  static site + one function, nothing to configure).
- Once deployed: Project → Settings → Environment Variables → add
  `ANTHROPIC_API_KEY` = (the key from step 1) → Save → then Deployments → redeploy so the
  function picks up the new variable.
- Vercel gives you a URL like `four-minds.vercel.app`.

## 4. Install it on your phone
- iPhone: open the Vercel URL in Safari → Share icon → "Add to Home Screen."
- Android: open the URL in Chrome → menu (⋮) → "Add to Home screen" / "Install app."
It now behaves like a real app: own icon, full-screen, no browser chrome.

## Known platform limits — be aware of these, they are not bugs
- **Mic input does not work on iPhone.** Apple's WebKit (which every iOS browser, including
  Chrome-on-iOS, is forced to use) does not implement the Web Speech recognition API.
  Typing always works everywhere. Mic input works on Android (Chrome) and desktop Chrome.
- **Spoken replies (text-to-speech) work on both iOS and Android** — different code path,
  no restriction there.
- Real character voices are already wired in via **OmniVoice Studio**
  (github.com/debpalash/OmniVoice-Studio), a free local voice-cloning app — no account,
  no API key. Install it, create 4 voice profiles named `plato`, `nietzsche`,
  `descartes`, `marcus`, run it, then in the app's left panel switch "Voice engine" to
  OmniVoice and point it at your instance's URL.
  - Desktop, same machine: `http://localhost:3900` works as-is.
  - iPhone: plain `localhost` will NOT reach your desktop. Expose OmniVoice over
    Tailscale (it supports this natively — bearer-token auth) or another HTTPS tunnel,
    and use that URL instead. Browsers block a public HTTPS page from silently calling
    plain `http://` addresses on your network — this is a browser security rule, not a
    bug in the app.
  - ElevenLabs (cloud, paid) remains a fallback option if OmniVoice's local setup is
    more than you want to deal with — say the word and I'll wire that path in too.

## Cost reality check
- Hosting on Vercel: free at this scale.
- Domain (optional, e.g. fourminds.ai): ~$10–40/yr if you want your own name instead of
  `*.vercel.app`.
- Anthropic API usage: pay-per-message, small at low volume, scales with how many people
  actually use it. Worth watching if this becomes public-facing content for YouTube/TikTok.
