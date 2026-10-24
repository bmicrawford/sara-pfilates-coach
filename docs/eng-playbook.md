# Galaxy Eng playbook — Sara PfilAtes Coach

Single-writer operating notes for **this repo**. If a card, issue, or agent brief disagrees with a later human instruction on the same tree, follow the later instruction — but do not silently expand scope.

## Board first

Work starts from the board (issue, card, or coordinator brief). Do not invent product, medical claims, or extra PRs. If the board is silent, ask or stop; do not “helpfully” open a second tree.

## Who writes, who merges

| Role | Does | Does not |
|---|---|---|
| Cloud agent | Writes code on a **named tree**, opens **one** PR for that tree | Merge, deploy secrets, `wrangler secret put`, or Surge publish with real keys |
| Human (Dr C / CoS / coordinator) | Reviews, merges, puts Worker secrets, deploys | Expect the agent to bake `XAI_API_KEY` or a live phone origin |

Agents leave a PR description that states the **human steps after merge**. Humans run those steps.

## Named work trees

- One git branch per task, matching `cursor/<short-name>-<id>`.
- One PR per tree, against `main`, unless the brief names another base.
- The tree owns only the brief. Unrelated files, branches, and PRs stay untouched.
- Do not rebase, force-push, or comment on someone else’s PR to “fix it while you’re here.”

## Roles (strict PR ownership)

| Role | Owns | Rule |
|---|---|---|
| **Scout** | Investigation only | Read, hypothesize, discard wrong guesses. No code unless the brief says to implement. |
| **Implementer** | Exactly one named-tree PR | Implements the brief. Does not drive-by edit other PRs. |
| **Cleanup** | The same tree, or a **new** named tree if scoped that way | Does not hijack another agent’s PR. |
| **Reviewer** | Comments / verdict | Does not push to a PR they do not own unless asked. |

Never touch unrelated PRs. Two agents on two trees do not share a branch.

## Watchdogs (keep them short)

Do not babysit long builds. Prefer a short, fail-loud check:

| Watchdog | Command | Passes when |
|---|---|---|
| App build | `npm run build` | Typecheck + Vite succeed. **Fails** if `VITE_SARA_API_URL` is `*.trycloudflare.com`. |
| Ask Sara connector | `npm run verify:ask-api -- <worker-url>` | `GET /health` is reachable and `tts` is `ara` (or equivalent). **Fails** on trycloudflare. |
| Local smokes | `npm run smoke:replies && npm run smoke:ask && npm run smoke:ask-copy && npm run smoke:speech && npm run smoke:speak && npm run smoke:diary && npm run smoke:exercise && npm run smoke:verify-api && npm run smoke:redeem && npm run smoke:install && npm run smoke:demo && npm run smoke:chunks && npm run smoke:qa-check` | No network secrets required. `npm run smoke:voice-ui` needs `npm run build` and Chrome. `npm run qa:live` needs `XAI_API_KEY` (`XAI_MODEL`, `--model`, `QA_RUNS`, `--runs`) and is not part of this set. |
| Deploy | Human only | Worker secret + `wrangler deploy` + Surge rebuild with the Worker URL. |

Default connector timeout: **~12s**. If `/health` cannot DNS or connect, the phone demo is still on a dead origin — do not “fix” it by baking another tunnel.

## Sara product constraints

- **Kajabi stays the course.** This app is the pocket companion (redeem, bind one phone, log the day, Ask Sara). Do not move lessons off Kajabi.
- **Redeem passes are Worker tokens.** `POST /redeem/mint` is protected by the Worker secret `REDEEM_MINT_SECRET`. Tokens live in KV binding `REDEEM_TOKENS` as `{ token, email?, createdAt, usedAt?, externalId?, multiUse? }`. The phone validates a purchased pass with `POST /redeem` on the Ask Sara origin (`VITE_SARA_API_URL`). The same email may redeem again (new phone after `/move`); a different email cannot. A class pass is minted with `multiUse: true` and no email; many students can redeem it, and their emails stay on the phone (local `sara.session`) instead of on the shared record. `DEMO-SARA-001` stays a local QA pass and is not written to KV as a redeem record. It is also the public prospect link. Demo `/ask` and `/speak` are rate-limited with short-TTL keys prefixed `rl:demo:` in this same `REDEEM_TOKENS` namespace (no second namespace, no new secret). Pass `externalId` (Kajabi transaction id, or a class id such as `class-cert-sac-2026-10-08`) so a retry returns the same `url`.
- **No outbound patient email from eng.** Identity is email-on-redeem only. This repo does not send mail, SMS campaigns, or clinician notifications. Zapier or Kajabi sends the minted `url`.
- **Public demo pass warms one D-ID session, then lip-syncs or falls back to ara.** `isDemoVoiceOnly` (true only for `DEMO-SARA-001`) still selects prospect copy and `audience: 'demo'`. It does not skip D-ID. Opening Ask Sara on that pass mints one muted Agents session (`POST /stream` + WebRTC, no `speak`) and reuses it for every question in that visit. One session per tab. A React strict-mode remount reuses the in-flight connect (the close waits 400ms). Close it on leaving the screen, on `pagehide`, and 60s after the last reply. The next Send after an idle or page-hide close plays ara for that turn and opens one new session for a later reply. Do not renew the 90s Worker lease; it expires on its TTL, and `disconnect()` is what releases the D-ID session. While the session is still connecting, show the reply text and play ara immediately (synthetic sway). Do not make the user wait for D-ID, and do not switch to D-ID mid-sentence. When the session is already live, call `speak()` at reply time and use D-ID's own audio and video — on iPhone too — and do not also play ara. Start ara only if speech frames are not live within 3s. iOS WebKit rejects `play()` on an unmuted WebRTC `<video>` outside the Send tap, so the Send, Ask Sara open, and Test voice taps call `play()` synchronously while `muted` is still true. Unmute later by setting `muted=false` on that already-playing element. If that unmute fails, keep the video muted (so the head still moves) and play ara. If `play()` itself is rejected, show a large Tap to see Sara control on her face. If the session is not live on iOS within 15s, say so on `?debug=1` and fall back to ara with no error. `?debug=1` is stored in `sessionStorage` so the redeem redirect cannot drop it. The debug line also shows `play`, mute, `videoWidth`, `readyState`, ICE state, whether a track arrived, and the fallback reason. iPhone shows `No sound? Turn off the Silent switch.` Tap to hear Sara and Test voice stay. `?debug=1` shows stream state, milliseconds from screen open to live, and the chosen path (`did-audio` or `ara`). Caps live in `server/demoGate.mjs`: 3 D-ID sessions per IP per hour, 6 per IP per day, 150 per day globally, and 2 concurrent sessions (90s KV lease on `POST /stream` only). `POST /talk` shares that budget. `GET /talk` does not. Over a cap, a full lease, or a D-ID 402/403/429 (max sessions, forbidden, credits) returns HTTP 429 `did_unavailable` with an empty message so the phone stays on ara and shows no error, and that visit does not open another session. Ask and speak limits are unchanged. No new KV namespace and no new secret. Paying and class passes are not counted and do not warm on mount.
- **D-ID talking-head is Agents Streams (WebRTC), not Talks mp4.** Worker `POST /stream` mints a short-lived Agents SDK `client_key` (`ttl_seconds` ~10 min) for `https://sara-pfilates.surge.sh` and `https://sara-pfilates-coach.surge.sh` (plus local Vite). Browser uses `@d-id/client-sdk` `createAgentManager` + `speak({ type: 'text', input })` with the Grok reply. Do **not** `connect()` on Ask Sara mount for a paying or class pass (Lite concurrent-session cap). Those passes mint + WebRTC on Send / Play only. The demo pass warms one muted session when Ask Sara opens (see the demo bullet). Keep the session without gating speak() on decoded frames; fire `speak()` as soon as Grok text exists when a session is already live. Heard voice is D-ID stream audio only when speak has started **and** the `<video>` has visible playing frames — keep the element muted until then so late `play()` can decode, then unmute / enable audio tracks together; do **not** also play ara. On a demo turn whose session is not live yet, start ara as soon as the first chunk is ready instead of waiting out the connect. If connect/speak fails, is session-capped, `srcObject` never attaches, or a short budget elapses with no playable AV, fall back to xAI `ara` via `POST /speak` + still (or muted video if frames exist). SDP finalize `400 SessionError` (missing `session_id`) is not a dead session — re-attach after the SDK retry. Release on leave / unmount / `pagehide`. Do not call `chat()` (Grok is the brain via `POST /ask`). Never block on D-ID clip generation. Missing `DID_API_KEY` or `DID_AGENT_ID` → honest null credentials, ara still works. Do not restore the SVG mouth overlay. Do not put `DID_API_KEY` in the Vite bundle. CORS must keep both Surge hosts. Default still: `https://sara-pfilates.surge.sh/avatar/sara-default.png`. `403 Forbidden` / `Max user sessions reached` (or zero D-ID credits) is a dashboard credit/session-cap issue: do not retry connect/speak, do not recreate the agent, keep still + ara.
- **Site-backed medical claims only.** Never invent clinical promises. Sara is a peer coach, not a clinician. Ask Sara's approved claims, the ten movement names, and Dr C's red-flag rules live only in `server/saraGuardrails.mjs` (composed into the system prompt in `server/askGrok.mjs`). PfilAtes research facts Sara may cite live only in `server/saraKnowledge.mjs` (sourced in `docs/pfilates-research.md`). Do not add conditions, statistics, cure claims, or step-by-step movement instructions beyond those two server files. The system prompt starts with a trigger checklist. Copy an exact red-flag sentence only when the latest user message matches that rule: pain during a movement, symptoms stated as worsening, osteoporosis, hip replacement, or pregnancy. Negations, other joints, cause questions, and unrelated topics get a no-trigger note and must not open with those sentences. Early pregnancy still copies the pregnancy sentence, including "after 12 weeks gestational age." Manual QA prompts are in `docs/sara-red-flag-qa.md`. Redeploy the Worker after changing them.
- **Voice path is xAI neural TTS** (`ara`) via `POST /speak`. Do not treat OS `speechSynthesis` as the good path. Ask Sara uses `grok-4.20-0309-non-reasoning` (`XAI_MODEL` in `worker/wrangler.toml`, fallback `GROK_MODEL`). Do not switch it back to a reasoning model. Spoken replies are 2 to 4 short sentences. The client plays them on one persistent `HTMLAudioElement` (`playsInline`, appended once, never recreated, not routed through an `AudioContext`). Inside the Send/Play tap, before any await, play a tiny silent data URI on that element and do not pause it. At most 3 chunks: sentence 1 plays when its bytes arrive; the rest are fetched in parallel and `src` swaps in the `ended` handler. If `play()` rejects or `currentTime` does not advance within 1.5s, show Tap to hear Sara. Demo `/speak` is still counted per call, including Test voice.
- **Demo motion.** When the demo is on ara, CSS breathes, and — only while that audio element's `currentTime` is advancing — sways the still and shows a smoothed synthetic glow (about 0.25–0.9). Do not drive the glow from an `AnalyserNode` or any other Web Audio graph: that output stays silent under the iOS hardware silent switch while the ring still flashes. Idle breathing stays on when she is quiet. `prefers-reduced-motion` turns the motion off. Real head movement is the D-ID stream when it is live in time; do not open a session only to fake the glow.
- **Fullscreen Ask Sara portrait:** The still and stream cover the Ask Sara viewport; questions/answers sit in a transparent overlay so the face stays visible. Keep Send/input usable on mobile (safe areas, contrast on video). Do not restore the circular crop or opaque cream thread unless a later brief says so.

## Durable Ask Sara path (phone demo)

The Surge static app (`https://sara-pfilates.surge.sh`, current phone demo; `https://sara-pfilates-coach.surge.sh` still CORS-allowlisted) can only call a **public HTTPS** origin baked in as `VITE_SARA_API_URL`.

**Use the Cloudflare Worker** (`worker/`, name `sara-pfilates-ask` → `https://sara-pfilates-ask.<account>.workers.dev`).

Do **not** use ephemeral `*.trycloudflare.com` tunnels for the phone demo. They die; DNS fails; Ask Sara text and voice both look “broken” even when the client bundle is fine.

### Deploy / verify checklist (human, after merge)

1. In `worker/`, put the key once (do not paste it into chat, flags, or the repo):
   ```bash
   printf '%s' "$XAI_API_KEY" | npx wrangler secret put XAI_API_KEY
   ```
2. Deploy the Worker:
   ```bash
   cd worker && npx wrangler deploy
   ```
3. Copy the printed `*.workers.dev` URL.
4. Verify the connector (no secrets; expect `tts=ara`):
   ```bash
   npm run verify:ask-api -- https://sara-pfilates-ask.<account>.workers.dev
   ```
5. Rebuild Surge **with that Worker URL** (not a tunnel):
   ```bash
   VITE_SARA_API_URL=https://sara-pfilates-ask.<account>.workers.dev npm run build
   npx surge ./dist https://sara-pfilates.surge.sh
   ```
6. Re-run `verify:ask-api` against the same Worker URL. Hard-refresh the phone demo.

Agents must not run steps 1, 2, or 5 with real secrets. `DID_API_KEY` is already on the Worker; do not put it in the repo. After this tree merges: create the Sara photo Agent if it does not exist, `wrangler secret put DID_AGENT_ID`, redeploy the Worker so `POST /stream` ships, then rebuild Surge.

### Redeem mint (human, after this tree merges)

Ask Sara keeps working if these steps wait. `POST /redeem/mint` stays closed until both the secret and the KV namespace exist. `GET /health` reports `"redeem": true` when they do.

1. The live namespace is already in `worker/wrangler.toml` (`REDEEM_TOKENS` id `6465ceb88c4b4fdfbc9cf0374588181d`). Do not create a second namespace.
2. Generate a mint secret and store it on the Worker (do not paste it into chat, flags, or the repo):
   ```bash
   openssl rand -hex 32
   printf '%s' "$REDEEM_MINT_SECRET" | npx wrangler secret put REDEEM_MINT_SECRET
   ```
3. Deploy once (`npx wrangler deploy` from `worker/`). Confirm `GET /health` has `"redeem": true`.
4. Mint a test pass (the JSON `url` is what a buyer opens):
   ```bash
   curl -sS -X POST "https://sara-pfilates-ask.<account>.workers.dev/redeem/mint" \
     -H "Authorization: Bearer $REDEEM_MINT_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"email":"buyer@example.com","externalId":"kajabi-test-1"}'
   ```
   Class QR (many emails, one token — do not send `email`):
   ```bash
   curl -sS -X POST "https://sara-pfilates-ask.<account>.workers.dev/redeem/mint" \
     -H "Authorization: Bearer $REDEEM_MINT_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"multiUse":true,"externalId":"class-cert-sac-2026-10-08"}'
   ```
   Print the `url` (`https://sara-pfilates.surge.sh/r/SARA-XXXX-XXXX-XXXX-XXXX`). The same `externalId` returns that token. Delete KV `redeem:{TOKEN}` and `ext:{externalId}` to revoke new scans. Phones that already stored `sara.session` stay signed in.
5. In Zapier: **Kajabi → New Purchase** (PfilAtes offer) → **Webhooks POST** `/redeem/mint` with header `Authorization: Bearer <REDEEM_MINT_SECRET>` and JSON `{ "email", "externalId" }` → email the buyer the returned `url`. Button label: **Open Sara**. Thank-you page copy is in the README (that page has no per-buyer token; the email carries the link). Do not set `multiUse` on purchase zaps.
6. Rebuild Surge with the same Worker URL as `VITE_SARA_API_URL` so the phone can `POST /redeem`.

`DEMO-SARA-001` remains the QA pass on the welcome screen. The Kajabi button uses the minted `url`.

## Public prospect demo limits

`DEMO-SARA-001` (`https://sara-pfilates.surge.sh/r/DEMO-SARA-001`) is the blast link for people who have not bought the course. One tree owns these constants in `server/demoGate.mjs`. Do not add a KV binding or a secret to change them. Redeploy the Worker after editing the numbers.

| Constant | Value | Applies to |
|---|---|---|
| `askPerIpPerHour` | 20 | `POST /ask` on the demo pass, per IP |
| `speakPerIpPerHour` | 60 | `POST /speak` on the demo pass, per IP. 3 chunks × the 20 asks/hour budget |
| `askPerIpPerDay` | 60 | `POST /ask` on the demo pass, per IP, UTC day |
| `speakPerIpPerDay` | 150 | `POST /speak` on the demo pass, per IP, UTC day. About 3 chunks × 60 asks |
| `globalAsksPerDay` | 3000 | all demo `/ask` traffic, UTC day |
| `globalSpeaksPerDay` | 3000 | all demo `/speak` traffic, UTC day |
| `didPerIpPerHour` | 3 | demo `POST /stream` and `POST /talk`, per IP |
| `didPerIpPerDay` | 6 | demo `POST /stream` and `POST /talk`, per IP, UTC day |
| `globalDidPerDay` | 150 | all demo D-ID sessions, UTC day. Change this constant to raise or lower it |
| `didConcurrentMax` | 2 | simultaneous demo WebRTC sessions. `POST /stream` only, 90s lease (`DEMO_DID_LEASE_TTL_SECONDS`) |

Hour keys TTL `DEMO_HOUR_TTL_SECONDS` (2 hours). Day and global keys TTL `DEMO_DAY_TTL_SECONDS` (2 days). The D-ID concurrency lease TTL is `DEMO_DID_LEASE_TTL_SECONDS` (90 seconds). Over an ask or speak limit: HTTP 429, `Retry-After`, JSON `message` and `reply` of `Sara is busy, please try again in a bit.` Over a D-ID cap or lease, or when D-ID itself returns a session/credit error: HTTP 429, `Retry-After`, `error: did_unavailable`, empty `message` and `reply` (the phone falls back to ara and shows nothing). Paid and class passes are checked and then not counted. Unknown passes are rejected. Missing passes are rejected. Demo redeem does not ask for an email and does not store one on the server. Demo users are not asked for a name or date of birth. Do not log IPs, passes, or secrets. Redeploy the Worker after changing these numbers. No new secret. Rebuild Surge so the demo race is in the phone bundle; keep the same `VITE_SARA_API_URL`.

The demo system note in `SARA_DEMO_AUDIENCE` is appended after `server/saraGuardrails.mjs` and `server/saraKnowledge.mjs`. Do not edit those two files to change prospect wording, and do not put the audience note ahead of them.

## Secrets

- `XAI_API_KEY` is server/Worker only. Never `VITE_*`, never commit `.env`, never put it in `wrangler.toml`.
- `REDEEM_MINT_SECRET` is server/Worker only. Never `VITE_*`, never in the Vite bundle, never in `wrangler.toml` as a value. Zapier sends it as `Authorization: Bearer` or `X-Redeem-Mint-Secret`.
- `.env.example` may name the keys. The repo must not contain values.
