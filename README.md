# FocusCheck

A free adult ADHD self-assessment with a paid, AI-written report.

Built on the **WHO Adult ADHD Self-Report Scale (ASRS-v1.1)** — a screening instrument,
not a diagnostic tool.

The site itself is static — no build step, no framework. The only server-side piece is a
single Cloudflare Worker that holds the LLM key and verifies payments.

---

## What's included

| Page | Purpose |
|---|---|
| `index.html` | Landing page — hero, how it works, free vs paid comparison, FAQ |
| `test.html` | 18-question assessment with progress bar and auto-advance |
| `results.html` | Scored result + blurred report preview + `$19` paywall |
| `report.html` | **The paid deliverable** — a 7-section personalised report |
| `privacy.html` / `terms.html` | Template legal pages (review before launch) |

```
focuscheck/
├── index.html · test.html · results.html · report.html
├── privacy.html · terms.html
├── assets/
│   ├── styles.css      # all styling (incl. print stylesheet)
│   ├── questions.js    # the 18 ASRS items + scoring rules
│   ├── app.js          # test flow, scoring, paywall, checkout redirect
│   ├── report.js       # template report generator + content library
│   ├── report-ai.js    # asks the Worker for the AI version, falls back safely
│   └── config.js       # public config — Worker URL, checkout link
├── worker/
│   ├── index.js        # Cloudflare Worker: report generation
│   ├── payments.js     # webhook verification + access control
│   ├── wrangler.toml   # configuration (no secrets)
│   └── README.md       # deploy + payment setup
├── test/
│   ├── worker.mjs      # 24 Worker unit tests, LLM mocked
│   └── integration.mjs # 32 page tests in jsdom
├── package.json
└── .nojekyll
```

---

## Run locally

```bash
python -m http.server 8000     # or: npm run serve
# open http://localhost:8000
```

---

## How the report works

The report is generated in **two layers**:

1. **Template** (`report.js`) — renders instantly from the user's answers, using a
   content library for four symptom profiles. This always works, even with no backend.
2. **AI upgrade** (`report-ai.js`) — if the visitor has unlocked the report and a
   Worker is configured, it asks the Worker for an AI-written version and swaps in the
   narrative sections.

If generation fails for any reason — network, timeout, quota, bad access — **the
template report stays on screen** and a short note explains why. The page never ends up
empty.

Preview the report without taking the test:

```
report.html?sample=inattentive
report.html?sample=hyperactive
report.html?sample=combined
report.html?sample=mild
```

### Editing the report content

All copy lives in the `PROFILES` object in `assets/report.js`. Each profile has `name`,
`tagline`, `overview`, `areas` (five `[heading, paragraph]` pairs) and `strategies`
(six `[title, description]` pairs).

The AI prompt lives in `worker/index.js` (`SYSTEM_PROMPT`).

---

## AI report generation

A static site cannot call an LLM directly — the API key would be visible to anyone who
opens dev tools. So the call goes through `worker/`, a Cloudflare Worker that holds the
key server-side.

**One-shot setup** — with a Cloudflare account and an LLM API key in hand, this does
everything: login check, KV creation, secret storage, deploy, and writing the Worker URL
into `assets/config.js`.

```bash
bash worker/setup.sh
```

**Or do it by hand** — see [`worker/README.md`](worker/README.md) for the full guide:

```bash
cd worker
npx wrangler login
npx wrangler kv namespace create ORDERS      # paste the id into wrangler.toml
npx wrangler secret put LLM_API_KEY
npx wrangler deploy
```

Then set `API_ENDPOINT` in `assets/config.js` to the URL it prints. That's the only
front-end change.

> The site works without any of this — it just serves the template report instead of an
> AI-written one.

---

## Payment

The Worker receives webhooks from your provider (Paddle, Lemon Squeezy or Stripe) and
records paid orders in KV. The report page sends its order reference back, and the
Worker refuses to generate unless that order exists.

```
Unlock → checkout (ref stored in browser) → webhook writes order:ref to KV
       → redirect back → report requests generation with ref → KV check → report
```

Setup steps, including the exact `CHECKOUT_URL` and `CHECKOUT_REF_PARAM` values for each
provider, are in [`worker/README.md`](worker/README.md).

> **Important:** `REQUIRE_ACCESS` defaults to `"false"`, which means generation is open
> while you are still setting payment up. Set it to `"true"` once a test payment works —
> otherwise anyone can spend your LLM credits.

---

## Tests

```bash
npm install
npm test
```

- `test/worker.mjs` — 24 tests covering validation, CORS, every upstream failure mode,
  provider adapters, access control and the health endpoint. The LLM is mocked, so no
  API key or network access is needed.
- `test/integration.mjs` — 32 tests that load `report.html` in jsdom with the real
  scripts, mock the Worker, and verify that AI content is injected correctly and that
  every failure path still leaves a usable report on screen.

---

## Deploy the site to GitHub Pages

```bash
git init && git add . && git commit -m "FocusCheck"
git branch -M main
git remote add origin https://github.com/<you>/focuscheck.git
git push -u origin main
```

Then **Settings → Pages → Source: `main` / `(root)`**.

The Worker is deployed separately (`cd worker && npx wrangler deploy`).

---

## Before you launch — compliance checklist

This is a health-adjacent product. The following are not optional:

- [ ] Keep the wording **screening / self-assessment** everywhere. Never write
      *diagnose*, *diagnosis*, *treat* or *cure* as a claim about your product.
- [ ] Keep the medical disclaimer visible on the landing page, results page and report.
- [ ] Add a crisis-line notice (e.g. 988 in the US, Samaritans 116 123 in the UK).
- [ ] Replace `privacy.html` and `terms.html` with documents reviewed for your jurisdiction.
- [ ] Add a GDPR/CCPA cookie banner if you add analytics or advertising.
- [ ] Set `REQUIRE_ACCESS = "true"` and `ALLOW_DEMO_UNLOCK: false` before going live.
- [ ] Remove `report.html?unlocked=1` access before launch — it grants free reports.

---

## Attribution

The ASRS-v1.1 was developed by the World Health Organization. It is widely used in
research and clinical screening. Confirm the current licensing terms for your
commercial use before launch.

## Licence

MIT for the code. The assessment content and copy are your responsibility to review.
