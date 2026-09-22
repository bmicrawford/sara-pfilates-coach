# Sara — PfilAtes Coach

Phone-first Progressive Web App companion for after a Kajabi PfilAtes purchase. The course stays on Kajabi. This repo is the source of truth for the pocket supplement: redeem a pass, bind one phone, log the day, and ask Sara.

Identity is **email on redeem only** — no password, no Kajabi SSO.

Ask Sara is powered by **xAI Grok** (`grok-4.6`) through a small server-side proxy. The API key never ships in the Vite bundle or on Surge.

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

- Ask Sara API on **http://127.0.0.1:8787** (`POST /ask`, `POST /speak`, `POST /talk`, `GET /talk?id=`, `POST /redeem`, `POST /redeem/mint`) — reads `XAI_API_KEY` from the environment. Mint also needs `REDEEM_MINT_SECRET` (server only).
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
| Model | `grok-4.6` (override with `XAI_MODEL`) |
| Secret | `XAI_API_KEY` — **server only**, never `VITE_*` |

The Sara system prompt lives in `server/askGrok.mjs` (peer coach, Kajabi stays the course, soft irritant coaching, no casual “stress”, pain/UTI safety, session cap).

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

**Motion** is D-ID **Agents Streams** (WebRTC) via `@d-id/client-sdk`. The Worker mints a short-lived `client_key` (`POST /stream`) for the allowed Surge origins. Ask Sara does **not** open WebRTC on mount (Lite’s concurrent stream cap is small; idle phone + laptop + Studio tabs exhaust it). Mint + `connect()` start on **Send / Play**, then `agentManager.speak({ type: 'text', input })` as soon as the Grok reply exists (do not wait for ara). Leaving the page (and `pagehide`) disconnects so idle slots are not held. Do not call `agentManager.chat()` — Grok stays the brain (`POST /ask`).

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

The course stays on Kajabi. A purchase mints a unique pass on this same Worker. The buyer opens `https://sara-pfilates.surge.sh/r/{TOKEN}` on their phone and enters the same email. There is no Kajabi SSO and no lesson content in this app.

`DEMO-SARA-001` stays a local QA pass (welcome screen and `/r/DEMO-SARA-001`). It is not stored in KV and does not need the mint secret.

| | |
|---|---|
| `POST /redeem/mint` | Secret-protected. Stores `{ token, email?, createdAt, usedAt?, externalId?, multiUse? }` and returns `url`. |
| `POST /redeem` | Phone sends `{ token, email }`. A purchased pass accepts the same email and rejects a different one. A class pass (`multiUse: true`) accepts many emails and does not store them. The same phone keeps its local session after redeem, including after **New phone** is cleared (`/move`). |
| Auth | `Authorization: Bearer $REDEEM_MINT_SECRET` or header `X-Redeem-Mint-Secret`. Worker secret only. Never `VITE_*`. |
| Store | Cloudflare KV binding `REDEEM_TOKENS`. |
| Link origin | `SARA_PUBLIC_ORIGIN` (default `https://sara-pfilates.surge.sh`). |

Send `externalId` (the Kajabi transaction id) so a Zapier retry returns the same link.

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

The JSON `url` is the link to email. Rebuild Surge with that Worker as `VITE_SARA_API_URL` so the phone can call `POST /redeem`. Local `npm run dev` proxies `/redeem` to the Node API.

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

### Zapier (Kajabi → New Purchase)

Kajabi’s thank-you page is one page for every buyer, so the unique link has to travel in email (or a custom field the email template reads). Zapier can call mint and then send the `url` from the response.

1. Trigger: **Kajabi → New Purchase**. Filter to the PfilAtes offer.
2. Action: **Webhooks by Zapier → Custom Request / POST**.
   - URL: `https://sara-pfilates-ask.<account>.workers.dev/redeem/mint`
   - Payload type: JSON
   - Header `Authorization`: `Bearer <REDEEM_MINT_SECRET>`
   - Header `Content-Type`: `application/json`
   - Body fields: `email` = the buyer email, `externalId` = the transaction id
   - Keep the secret in the header.
3. Action: email the buyer. Use the `url` field from the mint step.

Optional Kajabi side: add a person custom field `Sara link`, and have the Zap update that field with `url`, then a Kajabi email template prints it. The thank-you page still renders before the Zap finishes, so the email is the link the buyer opens.

### Paste into Kajabi

**Email button label:** Open Sara

**Email body** (`{{url}}` is the mint response in Zapier):

```
Your course stays on Kajabi. Sara is the phone companion — a quiet place to log the day and ask a question between lessons.

Open your private link on your phone:
{{url}}

Use the same email as this purchase. No extra password. You can add Sara to your home screen once it opens.
```

**Thank-you page** (this page has no per-buyer token):

```
Your course stays on Kajabi. Sara is the phone companion for logging the day and questions between lessons.

Check your email for a private Sara link. It looks like sara-pfilates.surge.sh/r/… Open that link on your phone and enter the same email you used here. No extra password.
```

The Kajabi button uses the minted `url`. `DEMO-SARA-001` stays on the QA welcome screen.

## What this prototype does

- Welcome gate when there is no session, with a link to the demo redeem pass
- Redeem at `/r/:token` — email + Continue. QA pass `DEMO-SARA-001` is local. A purchased pass is checked with the Worker (`POST /redeem`) before this phone binds.
- Device bind via `localStorage` plus a mock server token (one phone)
- Stub move-to-new-phone at `/move`
- First-open name + date of birth, saved on-device so the doctor report is labeled (asked once)
- Home with Sara’s portrait, Start New Diary, then the existing event logs: drink, void/leak, pad change (time + reason only), exercise, Ask Sara
- 3-day bladder diary report (`/diary`) and PDF — Day 1–3 totals from the first logged event, incomplete days marked
- 4-week exercise log (`/exercise`) — duration and frequency of logged sessions; after Yes on the 4-week gate, blank days in that window are recorded as 5 min pelvic floor per patient confirmation (logged days keep their minutes); daily Home cue when today’s session is missing; completion PDF only after Yes
- Bottom sheets for those forms
- Ask Sara via Grok (`POST /ask` + short chat history). Heard voice is D-ID Agents stream audio when speak is ready; xAI neural TTS (`POST /speak`, voice `ara`) is the fallback. Realtime head motion is D-ID Agents Streams (WebRTC), not an offline mp4. Mute / Stop / Play stay in the UI. The still and stream fill the Ask Sara screen; the thread is a see-through overlay.

## TODO (later)

- Install hint: `beforeinstallprompt` plus iOS Add to Home Screen tip
- Portrait captions still follow mood; the face is always the Ask Sara idle still
- Stub push (default channel) and SMS fallback after 3 days with no open

Push and SMS are hooks, not live sends. Purchased redeem links are minted by the Worker; this repo does not send the email.

## Product notes

Sara’s voice is a warmer peer, not a clinician. Lessons remain on Kajabi; this app does not replace the course.
