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
| Local smokes | `npm run smoke:replies && npm run smoke:ask && npm run smoke:ask-copy && npm run smoke:speak && npm run smoke:verify-api` | No network secrets required. |
| Deploy | Human only | Worker secret + `wrangler deploy` + Surge rebuild with the Worker URL. |

Default connector timeout: **~12s**. If `/health` cannot DNS or connect, the phone demo is still on a dead origin — do not “fix” it by baking another tunnel.

## Sara product constraints

- **Kajabi stays the course.** This app is the pocket companion (redeem, bind one phone, log the day, Ask Sara). Do not move lessons off Kajabi.
- **No outbound patient email from eng.** Identity is email-on-redeem only. This repo does not send mail, SMS campaigns, or clinician notifications.
- **D-ID talking-head is Agents Streams (WebRTC), not Talks mp4.** Worker `POST /stream` mints a short-lived Agents SDK `client_key` (`ttl_seconds` ~10 min) for `https://sara-pfilates.surge.sh` and `https://sara-pfilates-coach.surge.sh` (plus local Vite). Browser uses `@d-id/client-sdk` `createAgentManager` + `speak({ type: 'text', input })` with the Grok reply. Connect on Send / Play only — do **not** pre-warm `connect()` when Ask Sara mounts (Lite session caps are small; idle peers fill them). Keep the session without gating on decoded frames; fire `speak()` as soon as Grok text exists (parallel with ara). Release on leave / unmount / `pagehide`, and after a short idle once speak settles. Do not call `chat()` (Grok is the brain via `POST /ask`). Voice is immediate xAI `ara` via `POST /speak` — never block on D-ID clip generation. Mute the WebRTC element so ara is the only audio. Missing `DID_API_KEY` or `DID_AGENT_ID` → honest null credentials, ara still works. Do not restore the SVG mouth overlay. Do not put `DID_API_KEY` in the Vite bundle. CORS must keep both Surge hosts. Default still: `https://sara-pfilates.surge.sh/avatar/sara-default.png`. `403 Forbidden` / `Max user sessions reached` (or zero D-ID credits) is a dashboard credit/session-cap issue: do not retry connect/speak, do not recreate the agent, keep still + ara.
- **Site-backed medical claims only.** Never invent clinical promises. Sara is a peer coach, not a clinician. If you touch coach copy, keep it to what the site / system prompt already allows.
- **Voice path is xAI neural TTS** (`ara`) via `POST /speak`. Do not treat OS `speechSynthesis` as the good path.
- **Sticky Ask Sara portrait:** Sara stays pinned; the thread scrolls underneath. Do not “fix” that layout unless you have a clear regression.

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

## Secrets

- `XAI_API_KEY` is server/Worker only. Never `VITE_*`, never commit `.env`, never put it in `wrangler.toml`.
- `.env.example` may name the keys. The repo must not contain values.
