# Sara — PfilAtes Coach

Phone-first Progressive Web App companion for after a Kajabi PfilAtes purchase. The course stays on Kajabi. This repo is the source of truth for the pocket supplement: redeem a pass, bind one phone, log the day, and ask Sara.

Identity is **email on redeem only** — no password, no Kajabi SSO.

## Run it

```bash
npm install
npm run dev
```

Dev server prefers **port 43147**.

Open the demo redeem URL:

[http://localhost:43147/r/DEMO-SARA-001](http://localhost:43147/r/DEMO-SARA-001)

**Phone preview (no Node install):** [https://sara-pfilates-coach.surge.sh/r/DEMO-SARA-001](https://sara-pfilates-coach.surge.sh/r/DEMO-SARA-001)

Production build:

```bash
npm run build
npm run preview
```

## What this prototype does

- Welcome gate when there is no session, with a link to the demo redeem pass
- Redeem at `/r/:token` (seed token `DEMO-SARA-001`) — email + Continue
- Device bind via `localStorage` plus a mock server token (one phone)
- Stub move-to-new-phone at `/move`
- Home with Sara’s portrait and quick logs: drink, void/leak, pad change (time + reason only), exercise, Ask Sara
- Bottom sheets for those forms
- Ask Sara canned-reply stub
- Install hint: `beforeinstallprompt` plus iOS Add to Home Screen tip
- Portrait moods: idle = default smile, listening while logging/typing, celebrate on a successful save (especially exercise), quiet/neutral after idle
- Stub push (default channel) and SMS fallback after 3 days with no open

Kajabi API is a placeholder comment only. Push and SMS are hooks, not live sends.

## Product notes

Sara’s voice is a warmer peer, not a clinician. Lessons remain on Kajabi; this app does not replace the course.
