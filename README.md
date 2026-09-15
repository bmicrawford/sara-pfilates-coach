# Sara — PfilAtes Coach

Phone-first Progressive Web App companion for after a Kajabi PfilAtes purchase. The course stays on Kajabi. This repo is the source of truth for the pocket supplement: redeem a pass, bind one phone, log the day, and ask Sara.

Identity is **email on redeem only** — no password, no Kajabi SSO.

Ask Sara is powered by **xAI Grok** (`grok-4.6`) through a small server-side proxy. The API key never ships in the Vite bundle or on Surge.

## Run it locally

```bash
npm install
cp .env.example .env
# On a machine that already has the key in the environment, write it into .env
# without printing it:
#   python3 -c 'import os; open(".env","a").write("XAI_API_KEY="+os.environ["XAI_API_KEY"]+"\n")'
npm run dev
```

`npm run dev` starts:

- Ask Sara API on **http://127.0.0.1:8787** (`POST /ask`, `POST /speak`, `POST /talk`) — reads `XAI_API_KEY` from the environment
- Vite app on **port 43147**, proxying those paths to that API

Or run them separately:

```bash
npm run api      # Node proxy (needs XAI_API_KEY)
npm run dev:web  # frontend only
```

Open the demo redeem URL:

[http://localhost:43147/r/DEMO-SARA-001](http://localhost:43147/r/DEMO-SARA-001)

**Phone UI (static):** [https://sara-pfilates-coach.surge.sh/r/DEMO-SARA-001](https://sara-pfilates-coach.surge.sh/r/DEMO-SARA-001)

Ask Sara on the phone demo needs the Grok proxy URL baked in as `VITE_SARA_API_URL` (see below). Until a Worker is deployed **with** `XAI_API_KEY`, the UI shows an honest “couldn’t reach my brain” line — it will not fake a Grok answer from the old keyword stub.

Production build:

```bash
npm run build
npm run preview
```

## xAI / Grok

| | |
|---|---|
| Endpoint | `https://api.x.ai/v1/chat/completions` |
| Model | `grok-4.6` (override with `XAI_MODEL`) |
| Secret | `XAI_API_KEY` — **server only**, never `VITE_*` |

The Sara system prompt lives in `server/askGrok.mjs` (peer coach, Kajabi stays the course, soft irritant coaching, no casual “stress”, pain/UTI safety, session cap).

Spoken replies use the same key via **xAI neural TTS** (`POST https://api.x.ai/v1/tts`, voice **`ara`** — warm adult female). The browser Web Speech API is not the voice path.

| | |
|---|---|
| TTS endpoint | `POST /speak` on this proxy → `https://api.x.ai/v1/tts` |
| Voice | `ara` (override with `XAI_TTS_VOICE`) |
| Secret | same `XAI_API_KEY` — **server only** |

After you pull this change, **restart** `npm run api` (and the cloudflared / trycloudflare tunnel) so `/speak` exists on the public URL. A hard-refresh of the Surge app still talks to that tunnel.

### Talking-head / lip-sync

Ask Sara pins Sara’s portrait while the chat scrolls. While neural audio plays, the locked still (`public/avatar/sara-default.png`) gets a real mouth open/close driven by the audio (not a pulse ring).

Vendor talking-head **video** is scaffolded on `POST /talk` (D-ID: upload the neural audio + locked still → mp4). It is off until you set one extra secret:

```bash
# The one key to collect for full video lip-sync:
DID_API_KEY=   # D-ID studio API key
# optional override; default is the Surge still:
SARA_AVATAR_URL=https://sara-pfilates-coach.surge.sh/avatar/sara-default.png
```

```bash
printf '%s' "$DID_API_KEY" | npx wrangler secret put DID_API_KEY
```

Without `DID_API_KEY`, voice still uses xAI `ara` and the mouth still moves on the still. Do not fall back to OS `speechSynthesis` as the “good” path.

### Cloudflare Worker (public HTTPS proxy)

```bash
cd worker
# Secret from the environment already on this box — do not paste the key into chat or flags:
printf '%s' "$XAI_API_KEY" | npx wrangler secret put XAI_API_KEY
npx wrangler deploy
```

Copy the printed `*.workers.dev` URL, then rebuild the PWA so the phone app can reach it:

```bash
VITE_SARA_API_URL=https://sara-pfilates-ask.<account>.workers.dev npm run build
npx surge ./dist https://sara-pfilates-coach.surge.sh
```

`wrangler` must be logged in on that box (`npx wrangler login`, or `CLOUDFLARE_API_TOKEN` already in env).

## What this prototype does

- Welcome gate when there is no session, with a link to the demo redeem pass
- Redeem at `/r/:token` (seed token `DEMO-SARA-001`) — email + Continue
- Device bind via `localStorage` plus a mock server token (one phone)
- Stub move-to-new-phone at `/move`
- Home with Sara’s portrait and quick logs: drink, void/leak, pad change (time + reason only), exercise, Ask Sara
- Bottom sheets for those forms
- Ask Sara via Grok (`POST /ask` + short chat history), then spoken with xAI neural TTS (`POST /speak`, voice `ara`). Mute / Stop / Play stay in the UI. Portrait stays pinned while the thread scrolls.

## TODO (later)

Vendor talking-head video waits on **`DID_API_KEY`** (D-ID). Mouth motion on the locked still + neural `ara` voice already ship.
- Install hint: `beforeinstallprompt` plus iOS Add to Home Screen tip
- Portrait moods: idle = default smile, listening while logging/typing or waiting on Grok, celebrate on a successful save (especially exercise), quiet/neutral after idle
- Stub push (default channel) and SMS fallback after 3 days with no open

Kajabi API is a placeholder comment only. Push and SMS are hooks, not live sends.

## Product notes

Sara’s voice is a warmer peer, not a clinician. Lessons remain on Kajabi; this app does not replace the course.
