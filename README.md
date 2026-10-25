# Sara — PfilAtes Coach

Phone-first Progressive Web App companion for after a Kajabi PfilAtes purchase. The course stays on Kajabi. This repo is the source of truth for the pocket supplement: redeem a pass, bind one phone, log the day, and ask Sara.

Identity is **email on redeem only** — no password, no Kajabi SSO.

Ask Sara is powered by **xAI Grok** (`grok-4.20-0309-non-reasoning`) through a small server-side proxy. The API key never ships in the Vite bundle or on Surge. That model is non-reasoning so a reply is a couple of seconds, not half a minute.

Eng operating notes (board-first, named trees, who merges, Sara constraints): [docs/eng-playbook.md](docs/eng-playbook.md).

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

- Ask Sara API on **http://127.0.0.1:8787** (`POST /ask`, `POST /speak`, `POST /talk`, `GET /talk?id=`, `POST /redeem`, `POST /redeem/mint`, `POST /kajabi/purchase`, `POST /kajabi/open`, `POST /kajabi/grant`) — reads `XAI_API_KEY` from the environment. Mint and grant need `REDEEM_MINT_SECRET` (server only). Purchase needs `KAJABI_WEBHOOK_KEY` and `KAJABI_SARA_OFFER_IDS`.
- Vite app on **port 43147**, proxying those paths to that API

Or run them separately:

```bash
npm run api      # Node proxy (needs XAI_API_KEY)
npm run dev:web  # frontend only
```

Open the demo redeem URL:

[http://localhost:43147/r/DEMO-SARA-001](http://localhost:43147/r/DEMO-SARA-001)

**Phone UI (static):** [https://sara-pfilates.surge.sh/r/DEMO-SARA-001](https://sara-pfilates.surge.sh/r/DEMO-SARA-001) (current). The older Surge host `https://sara-pfilates-coach.surge.sh` remains CORS-allowlisted.

Ask Sara on the phone demo needs the **Cloudflare Worker** URL baked in as `VITE_SARA_API_URL` (see below). Until that Worker is deployed **with** `XAI_API_KEY`, the UI shows an honest reconnect line — it will not fake a Grok answer from the old keyword stub, and it will not fall back to the phone’s `speechSynthesis`. Never bake a `*.trycloudflare.com` tunnel into Surge.

Production build:

```bash
npm run build
npm run preview
```

## xAI / Grok

| | |
|---|---|
| Endpoint | `https://api.x.ai/v1/chat/completions` |
| Model | `grok-4.20-0309-non-reasoning` (override with `XAI_MODEL`) |
| Secret | `XAI_API_KEY` — **server only**, never `VITE_*` |

The Sara system prompt lives in `server/askGrok.mjs` (peer coach, Kajabi stays the course, soft irritant coaching, no casual “stress”, UTI safety, session cap). Spoken replies are 2 to 4 short sentences, conversational, with no lists, so ara can start quickly. `max_tokens` stays 600. Dr C's approved claims, the ten movement names, and red-flag rules are edited only in `server/saraGuardrails.mjs` and composed into that prompt. PfilAtes research Sara may cite (sourced, no rounding) lives only in `server/saraKnowledge.mjs`, composed after the guardrails; the full sourced summary and research QA prompts are in `docs/pfilates-research.md`. As of Oct 25, 2026 she does not say 10x, ten times, or 10 times more than a Kegel; a Kegel comparison uses the EMG figure of 21% to 56% in 100 consecutive patients, worded as "suggests". Kajabi onboarding emails for buyers are retrieved per question from `server/onboardingEmails.mjs` (regenerate with `npm run onboarding:emails` from `content/onboarding-emails`). Ordinary questions do not add that text. A demo user is not told those emails already arrived. Sample prompts for red-flag QA are in `docs/sara-red-flag-qa.md`. The prompt's trigger checklist copies a red-flag sentence only when the latest message matches that rule. After the Worker is deployed, run the prompts against the live model with `XAI_API_KEY=... npm run qa:live` (`scripts/qa-live.mjs`). `XAI_MODEL` or `--model` selects the model. `QA_RUNS` or `--runs` (1–5) repeats each prompt. Prompt changes reach the phone only after the Worker is redeployed.

Spoken replies use the same key via **xAI neural TTS** (`POST https://api.x.ai/v1/tts`, voice **`ara`** — warm adult female). The browser Web Speech API is not the voice path.

| | |
|---|---|
| TTS endpoint | `POST /speak` on this proxy → `https://api.x.ai/v1/tts` |
| Voice | `ara` (override with `XAI_TTS_VOICE`) |
| Secret | same `XAI_API_KEY` — **server only** |

The durable public origin is the **Cloudflare Worker**, not an ephemeral trycloudflare tunnel.

### Talking-head / lip-sync

Ask Sara is a fullscreen talking surface: the idle still and the live stream **cover the viewport** (edge to edge). Questions and answers sit in a **transparent overlay** so Sara’s face stays visible behind the text. Idle is the locked still (`public/avatar/sara-default.png`, `SARA_PORTRAIT_STILL`) — no SVG mouth overlay. Home and the other circular portraits use that same still; they do not cycle mood faces.

**Heard voice** is D-ID Agents stream audio when `speak()` has started **and** the WebRTC `<video>` has visible playing frames. Keep the element muted until that moment so late `play()` can decode, then unmute / enable audio tracks together so audio cannot lead the mouth — do **not** also play xAI `ara` (no double voice). Do not start ara while waiting for D-ID. If connect/speak fails, hits the Lite session cap, `srcObject` never attaches, or a short budget elapses with **no playable AV**, fall back to `POST /speak` ara + still (or muted video if frames exist without audio). Never wait on a D-ID mp4. Never skip ara after a frozen / empty video.

The public demo pass `DEMO-SARA-001` warms one muted D-ID session when the landing or home screen loads, then reuses that same session on Ask Sara (one `POST /stream` per visit). While it is connecting, the still breathes, sways, and blinks, and the screen says “Sara is getting ready”. Sending a note shows “Sara is listening…” immediately. The reply text shows as soon as Grok returns. If that session is still not live about 6 seconds after Send, ara plays (at most 3 `/speak` calls) and the still sways — the phone does not wait out the WebRTC connect, and it does not switch mid-sentence. A later reply uses the video once the same session is live. If the session is already live, Sara speaks with D-ID’s own audio and video, including on iPhone, and ara does not also play. Ara starts only when speech frames are not on screen within 3 seconds of that speak. iPhone shows “No sound? Turn off the Silent switch.” Audio is unlocked inside the Send tap. While ara speaks, the still breathes, sways, and a glow ring follows a synthetic level. Quiet, she keeps a slow breath. `prefers-reduced-motion` turns that off. The warmed session closes on leave, on page hide, and 60 seconds after the last reply. Demo D-ID is capped (3/hour and 6/day per IP, 150/day globally, 2 at once). Over the cap the Worker returns a quiet 429 and the phone stays on ara with no error. Purchase and class passes keep D-ID without those caps, and they still connect on Send rather than on open.

**Motion** for paying and class passes is D-ID **Agents Streams** (WebRTC) via `@d-id/client-sdk`. The Worker mints a short-lived `client_key` (`POST /stream`) for the allowed Surge origins. Those passes do **not** open WebRTC on mount (Lite’s concurrent stream cap is small; idle phone + laptop + Studio tabs exhaust it). Mint + `connect()` start on **Send / Play**, then `agentManager.speak({ type: 'text', input })` as soon as the Grok reply exists (do not wait for ara). The demo pass opens one muted session on the landing and home screen, because a session started at Send time is still connecting when the reply is ready. Ask Sara reuses it. Leaving the page (and `pagehide`) disconnects so idle slots are not held. Do not call `agentManager.chat()` — Grok stays the brain (`POST /ask`).

Head motion needs **D-ID credits and a free stream slot**. Live `POST /agents/{id}/streams` `403 Forbidden` / `Max user sessions reached` is **not** retried (retries hold sessions and make the cap worse). Ara and the still portrait still work. Humans top up credits in the D-ID dashboard; do not recreate the agent or rotate Worker secrets for this error.

Human setup (once): create a Talks V2 **photo** Agent from `https://sara-pfilates.surge.sh/avatar/sara-default.png` (no D-ID LLM), put `DID_AGENT_ID` on the Worker, keep `DID_API_KEY` as a Worker secret. The Worker mints client keys with allowed origins `https://sara-pfilates.surge.sh`, `https://sara-pfilates-coach.surge.sh`, and local Vite (`http://localhost:43147`). Default still URL: `https://sara-pfilates.surge.sh/avatar/sara-default.png`. Do not fall back to OS `speechSynthesis` as the “good” path.

Create the photo Agent (human; `DID_API_KEY` already in that shell — do not paste it into chat):

```bash
curl -sS -X POST https://api.d-id.com/agents \
  -H "Authorization: Basic $(printf '%s' "$DID_API_KEY:" | base64 | tr -d '\n')" \
  -H "Content-Type: application/json" \
  -d '{
    "preview_name": "Sara",
    "preview_description": "PfilAtes peer coach. Answers come from our Grok worker, not D-ID.",
    "embed": true,
    "presenter": {
      "type": "talk",
      "source_url": "https://sara-pfilates.surge.sh/avatar/sara-default.png",
      "thumbnail": "https://sara-pfilates.surge.sh/avatar/sara-default.png",
      "stitch": true
    }
  }'
# copy id (agt_...) then:
#   printf '%s' "$DID_AGENT_ID" | npx wrangler secret put DID_AGENT_ID
```

Or in D-ID Studio: new Agent → photo of that still → embed → do not wire an LLM. Studio “allowed domains” can stay empty; this app uses Worker-minted short-lived keys.

### Cloudflare Worker (durable phone-demo origin)

Human after merge (do not put `XAI_API_KEY` in the repo or in agent chat):

```bash
cd worker
printf '%s' "$XAI_API_KEY" | npx wrangler secret put XAI_API_KEY
npx wrangler deploy
```

Copy the printed `https://sara-pfilates-ask.<account>.workers.dev` URL, then verify and rebuild Surge:

```bash
npm run verify:ask-api -- https://sara-pfilates-ask.<account>.workers.dev
# expect GET /health → ok, tts=ara; fails loudly on *.trycloudflare.com

VITE_SARA_API_URL=https://sara-pfilates-ask.<account>.workers.dev npm run build
# build copies index.html → 200.html so Surge keeps /r/:token and /ask on the PWA
npx surge ./dist https://sara-pfilates.surge.sh
```

`wrangler` must be logged in on that box (`npx wrangler login`, or `CLOUDFLARE_API_TOKEN` already in env). `npm run build` refuses a trycloudflare `VITE_SARA_API_URL`.

## Kajabi purchase → Sara link

The course stays on Kajabi. A Kajabi **Payment Succeeded** or **Cart Purchase** webhook records an entitlement for the buyer email. The welcome email button opens `https://sara-pfilates.surge.sh/open?e={{ email }}`. When that entitlement is already stored, Sara mints or reuses one redeem pass and binds this phone the same way `/r/{TOKEN}` does. There is no Kajabi SSO, no lesson content in this app, and the Worker never sends email.

`DEMO-SARA-001` is the public prospect link and the local QA pass (welcome screen and `/r/DEMO-SARA-001`). It is not stored in KV as a redeem record and does not need the mint secret. Prospects are not asked for an email, name, or date of birth. Ask Sara on that pass uses prospect copy and can open D-ID lip-sync, with ara as the fallback. See `server/demoGate.mjs`: 20 `/ask` and 60 `/speak` per IP per hour, 60 `/ask` and 150 `/speak` per IP per UTC day, and 3000 `/ask` plus 3000 `/speak` per UTC day across all demo traffic. The speak caps are higher because one reply can take up to 3 `/speak` calls. The global daily speak cap stays 3000. D-ID on that pass is separate: 3 sessions per IP per hour, 6 per IP per day, 150 per day globally, and 2 concurrent WebRTC sessions. Over an ask or speak limit the Worker returns HTTP 429 with `Retry-After` and `Sara is busy, please try again in a bit.` Over a D-ID cap it returns HTTP 429 `did_unavailable` with an empty message so the phone falls back to ara and shows no error. Unknown passes are rejected. No new secret and no new KV binding — counters and the concurrency lease are short-TTL `rl:demo:` keys in `REDEEM_TOKENS`.

| | |
|---|---|
| `POST /redeem/mint` | Secret-protected. Stores `{ token, email?, createdAt, usedAt?, externalId?, multiUse? }` and returns `url`. |
| `POST /redeem` | Phone sends `{ token, email }`. A purchased pass accepts the same email and rejects a different one. A class pass (`multiUse: true`) accepts many emails and does not store them. The same phone keeps its local session after redeem, including after **New phone** is cleared (`/move`). |
| Auth | `Authorization: Bearer $REDEEM_MINT_SECRET` or header `X-Redeem-Mint-Secret`. Worker secret only. Never `VITE_*`. |
| Store | Cloudflare KV binding `REDEEM_TOKENS`. |
| Link origin | `SARA_PUBLIC_ORIGIN` (default `https://sara-pfilates.surge.sh`). |

Send `externalId` (a Kajabi transaction id, or the open flow’s buyer id) so a retry returns the same link.

### Human setup (after merge)

```bash
cd worker
# REDEEM_TOKENS is already bound in wrangler.toml (id 6465ceb88c4b4fdfbc9cf0374588181d).
openssl rand -hex 32   # this value is REDEEM_MINT_SECRET — do not commit it
printf '%s' "$REDEEM_MINT_SECRET" | npx wrangler secret put REDEEM_MINT_SECRET
npx wrangler deploy
```

`GET /health` includes `"redeem": true` when the secret and the KV binding are both present.

```bash
curl -sS -X POST "https://sara-pfilates-ask.<account>.workers.dev/redeem/mint" \
  -H "Authorization: Bearer $REDEEM_MINT_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"email":"buyer@example.com","externalId":"kajabi-test-1"}'
```

The JSON `url` is a direct `/r/{TOKEN}` link for a manual or class pass. A Kajabi purchase uses the welcome-email button below, not this curl. Rebuild Surge with that Worker as `VITE_SARA_API_URL` so the phone can call `POST /redeem` and `POST /kajabi/open`. Local `npm run dev` proxies those paths to the Node API.

### Live class QR (one link, many students)

A certification class uses one multi-use pass. Mint it once. Students scan the same `url`, enter their own email, and that phone keeps the session. The shared KV record is not tied to one email. Kajabi purchase passes stay single-email. `DEMO-SARA-001` stays the QA pass.

```bash
curl -sS -X POST "https://sara-pfilates-ask.<account>.workers.dev/redeem/mint" \
  -H "Authorization: Bearer $REDEEM_MINT_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"multiUse":true,"externalId":"class-cert-sac-2026-10-08"}'
```

The response `url` looks like `https://sara-pfilates.surge.sh/r/SARA-XXXX-XXXX-XXXX-XXXX`. The same `externalId` returns that token again. Do not put the secret in the QR. To revoke, delete KV keys `redeem:{TOKEN}` and `ext:{externalId}`. Phones that already saved a session stay signed in until **New phone**.

`node scripts/mint-class-token.mjs class-cert-sac-2026-10-08` does the same call when `REDEEM_MINT_SECRET` and `SARA_WORKER_URL` are set. It prints the token and url only.

### Kajabi webhook (no Zapier)

Kajabi’s thank-you page is one page for every buyer, so Sara’s link travels in the welcome email. Zapier is not part of this path. The Worker does not send that email.

Dr C’s admin (Pro Annual) configures outbound webhooks under **Settings > Integrations & Webhooks > Webhooks**. The form has an Event and an Endpoint URL. The events offered are **Payment Succeeded** and **Cart Purchase**. Granted or comped access does not fire either event. Kajabi’s webhook articles do not document a signature header.

Create **two** webhooks. Both use the same endpoint:

`https://sara-pfilates-ask.pfilates.workers.dev/kajabi/purchase?key=<KAJABI_WEBHOOK_KEY>`

| Event | When it fires |
|---|---|
| Payment Succeeded | A successful charge, including a one-time offer checkout and a cart order |
| Cart Purchase | A successful Kajabi Cart order |

A classic offer checkout fires Payment Succeeded. A cart checkout can fire both. The same order is one entitlement.

`KAJABI_SARA_OFFER_IDS` is the deploy-time allowlist (comma-separated). Known $149 offers: `2147989270` (women), `2149556914` (men). Leave the live list unset in git; set it when deploying.

```bash
cd worker
openssl rand -hex 32   # this value is KAJABI_WEBHOOK_KEY — do not commit it
printf '%s' "$KAJABI_WEBHOOK_KEY" | npx wrangler secret put KAJABI_WEBHOOK_KEY
printf '%s' "$KAJABI_SARA_OFFER_IDS" | npx wrangler secret put KAJABI_SARA_OFFER_IDS
npx wrangler deploy
```

`REDEEM_MINT_SECRET` and the `REDEEM_TOKENS` KV binding stay as they are. Opening Sara mints the redeem pass with that secret. Rebuild Surge after merge so `/open` is in the phone bundle.

### Paste into the Kajabi welcome email

**Button label:** Open Sara

**Button URL** (Kajabi merge tag `{{ email }}`; a space in the address is treated as `+`):

```
https://sara-pfilates.surge.sh/open?e={{ email }}
```

**Email body:**

```
Your course stays on Kajabi. Sara is the phone companion — a quiet place to log the day and ask a question between lessons.

Open Sara on your phone with the same email as this purchase. No extra password. You can add Sara to your home screen once it opens.
```

**Thank-you page** (this page has no per-buyer token):

```
Your course stays on Kajabi. Sara is the phone companion for logging the day and questions between lessons.

Check your email for Open Sara. Open that button on your phone. No extra password.
```

`DEMO-SARA-001` stays on the QA welcome screen.

### Backfill (comped access and earlier buyers)

Payment Succeeded and Cart Purchase do not fire when an offer is granted without a sale. Grant an entitlement with the mint secret, then send the same Open Sara button. This command does not send email and does not deploy.

```bash
REDEEM_MINT_SECRET=... SARA_WORKER_URL=https://sara-pfilates-ask.pfilates.workers.dev \
  node worker/scripts/grant-entitlement.mjs buyer@example.com 2147989270
```

The offer id is optional. A repeat for the same email keeps the first entitlement. `POST /kajabi/grant` with `Authorization: Bearer $REDEEM_MINT_SECRET` does the same thing.

## What this prototype does

- Welcome gate when there is no session, with a link to the demo redeem pass
- Open Sara at `/open?e=` from the Kajabi welcome email. An entitlement mints or reuses a pass and binds this phone, including the Home Screen coach. Otherwise the page says Sara is getting ready, with Try again and the purchase email.
- Redeem at `/r/:token` — email + Continue for a purchased or class pass. The public demo pass `DEMO-SARA-001` continues without an email and is not asked for a name or date of birth. A purchased pass is checked with the Worker (`POST /redeem`) before this phone binds.
- Device bind via `localStorage` plus a mock server token (one phone)
- Stub move-to-new-phone at `/move`
- First-open name + date of birth, saved on-device so the doctor report is labeled (asked once)
- Home with Sara’s portrait, Start New Diary, then the existing event logs: drink, void/leak, pad change (time + reason only), exercise, Ask Sara
- 3-day bladder diary report (`/diary`) and PDF — Day 1–3 totals from the first logged event, incomplete days marked
- 4-week exercise log (`/exercise`) — duration and frequency of logged sessions; after Yes on the 4-week gate, blank days in that window are recorded as 5 min pelvic floor per patient confirmation (logged days keep their minutes); daily Home cue when today’s session is missing; completion PDF only after Yes
- Bottom sheets for those forms
- Ask Sara via Grok (`POST /ask` + short chat history). The phone sends its pass. Heard voice for a purchased or class pass is D-ID Agents stream audio when speak is ready; xAI neural TTS (`POST /speak`, voice `ara`) is the fallback. The demo pass warms one D-ID session on the landing and home screen and Ask Sara reuses it. Lip-sync (including D-ID’s own voice on iPhone) is used when that session is already live; if it is still connecting about 6 seconds after Send, that turn falls back to the still plus ara. Realtime head motion is D-ID Agents Streams (WebRTC), not an offline mp4. Mute / Stop / Play stay in the UI. The still and stream fill the Ask Sara screen; the thread is a see-through overlay. A demo-pass ask/speak 429 shows “Sara is busy, please try again in a bit.” A demo D-ID 429 does not.
- After a successful redeem, a Home Screen coach (on the name gate if that’s first, then Home): iPhone/iPad steps are Share → Add to Home Screen → Add. Android Chrome shows Install when `beforeinstallprompt` fires, and Chrome menu steps if it does not. Not now and a successful install stay in `localStorage`. An installed app (`display-mode: standalone` or iOS `navigator.standalone`) skips the coach. New phone clears that memory.

## TODO (later)

- Portrait captions still follow mood; the face is always the Ask Sara idle still
- Stub push (default channel) and SMS fallback after 3 days with no open

Push and SMS are hooks, not live sends. Purchased redeem links are minted by the Worker; this repo does not send the email.

## Product notes

Sara’s voice is a warmer peer, not a clinician. Lessons remain on Kajabi; this app does not replace the course.
