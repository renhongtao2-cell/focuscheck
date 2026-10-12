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
| `report.html` | **The paid deliverable** — free cover and visual summary, sections 01–07 behind the paywall |
| `adult-adhd-symptoms.html` | Content page — all 18 ASRS statements, explained |
| `adhd-inattentive-type.html` | Content page — the inattentive presentation |
| `adhd-hyperactive-impulsive-type.html` | Content page — the hyperactive-impulsive presentation |
| `adhd-combined-type.html` | Content page — the combined presentation |
| `privacy.html` / `terms.html` | Template legal pages (review before launch) |

```
focuscheck/
├── index.html · test.html · results.html · report.html
├── adult-adhd-symptoms.html · adhd-inattentive-type.html
├── adhd-hyperactive-impulsive-type.html · adhd-combined-type.html
├── privacy.html · terms.html
├── sitemap.xml · robots.txt
├── assets/
│   ├── styles.css        # all styling (incl. print stylesheet)
│   ├── questions.js      # the 18 ASRS items + scoring rules
│   ├── app.js            # test flow, scoring, paywall, checkout redirect
│   ├── report.js         # template report + visual summary (ring, bars, heatmap)
│   ├── report-share.js   # canvas share card + share targets
│   ├── report-ai.js      # asks the Worker for the AI version, falls back safely
│   ├── config.js         # public config — Worker URL, checkout link, site URL
│   └── og/               # generated 1200x630 Open Graph images
├── tools/
│   ├── make_og_images.py # regenerates assets/og/ (npm run og)
│   ├── live-check.mjs    # drives the deployed site in a real browser
│   ├── dev-server.mjs    # payment sandbox: real Worker, in-memory KV, mocked LLM
│   └── pay-check.mjs     # drives the paid flow in a real browser
├── worker/
│   ├── index.js          # Cloudflare Worker: report generation
│   ├── payments.js       # webhook verification + access control
│   ├── wrangler.toml     # configuration (no secrets)
│   └── README.md         # deploy + payment setup
├── test/
│   ├── worker.mjs        # 24 Worker unit tests, LLM mocked
│   ├── flow.mjs          # 57 free-flow tests (test -> results -> checkout)
│   ├── integration.mjs   # 71 report-page tests in jsdom
│   ├── pages.mjs         # 109 metadata / OG image / link checks
│   └── payment.mjs       # 54 paid-chain tests against the sandbox
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

The report is split into a free teaser and a paid body.

**Free** — the cover (profile name, tagline, report ID) and the visual summary: the
score ring, the two cluster bars, and the 18-cell heatmap. These are derived from the
visitor's own answers and need no backend.

**Paid** — sections 01–07: the interpretation, the profile detail, where symptoms show
up, what helps, talking to a clinician, the 30-day plan, and the appendix of responses.

The paid body is generated in **two layers**:

1. **Template** (`report.js`) — a content library for four symptom profiles. This is the
   fallback when the AI is unavailable.
2. **AI upgrade** (`report-ai.js`) — asks the Worker for a version written for the
   visitor's specific answers and swaps in the narrative sections.

### The gate

`report.js` renders the whole report, then **removes `.rp-body` from the DOM** unless the
visitor is entitled to it. Removing it rather than blurring it is deliberate: a blur is
undone in dev tools, and text that is present can be copied or printed.

Unlock happens in one of three ways:

| Condition | Result |
|---|---|
| `?sample=…` | Unlocked — the sales-page previews |
| `ALLOW_DEMO_UNLOCK: true` **and** `?unlocked=1` | Unlocked — local development only |
| A paid order reference the Worker confirms | Unlocked |

`report-ai.js` sends the stored order reference to the Worker. **403 means locked;
anything else means unlocked.** The distinction matters: a 500 or 502 is returned only
after the access check has already passed, so it means the customer paid and the
generation failed — they still get the report. A request that gets no response at all
stays locked, so a dropped connection is not a way in.

The default is **locked**. If anything downstream fails, the failure mode is a locked
report, not a free one.

> `ALLOW_DEMO_UNLOCK` must be `false` in production. Leaving it on means anyone who
> guesses `report.html?unlocked=1` gets the paid report for free.

### Known limit of a client-side gate

The template copy lives in `assets/report.js`, which is a public file. Someone willing to
read it can recover the generic per-profile text. What they cannot get is their own
personalised result, and the AI narrative is never sent to an unpaid browser.

Closing that gap properly means moving the content library to the Worker so the paid text
is never shipped to the client at all. The structure is already there — the Worker has the
answers and does the scoring — but it makes the Worker mandatory for any report to render,
so it is worth doing only once the Worker is deployed.

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

## Report visuals

The top of every report opens with a **"Your results at a glance"** panel, rendered
entirely from the visitor's own answers by `report.js`:

| Element | What it shows | Source |
|---|---|---|
| Score ring | Part A positives out of 6, with the threshold verdict | `r.positives`, `r.flagged` |
| Two cluster bars | Inattention and hyperactivity as a % of maximum symptom load | `r.inattention`, `r.hyperactive` |
| Gap note | Whether one cluster dominates, using the same 12-point rule as `pickProfile()` | derived |
| 18-cell heatmap | Every answer, colour-coded 0–4, split into Part A and Part B | raw `answers` |

The heatmap colours are a single sequential green scale with amber reserved for
"Very Often", so the items that actually matter visually pop out. Every cell carries a
`title` tooltip with the statement and the answer.

The same panel also gives each report section a small header icon. Icons are injected by
`decorateSections()` so `report.html` stays readable.

---

## Share card

`assets/report-share.js` draws a 1080×1080 summary card onto a canvas and wires up the
share buttons (X, Facebook, Reddit, LinkedIn, email, copy link, copy image, download PNG).

**What the card deliberately does not contain:** the two cluster percentages, the answer
appendix, or anything else identifying. It carries the profile type and the Part A ring
only — so a visitor can post their result without publishing their answers. Share links
point at the homepage, not at the report, because report data lives in `localStorage` and
would not travel with a URL.

> Canvas drawing needs a real browser; in jsdom the module no-ops cleanly and the tests
> only assert the DOM around it.

---

## Content pages and SEO

Four public content pages target long-tail search traffic and double as link previews when
someone shares a result:

- `adult-adhd-symptoms.html` — all 18 statements, how scoring works, what else looks like ADHD
- `adhd-inattentive-type.html`, `adhd-hyperactive-impulsive-type.html`, `adhd-combined-type.html`

Each carries a canonical URL, full Open Graph and Twitter Card tags, and links to the other
three plus the free test. `sitemap.xml` lists them; `robots.txt` keeps crawlers out of the
tool pages (`test.html`, `results.html`, `report.html` are all `noindex`).

### Regenerating the OG images

```bash
python tools/make_og_images.py      # or: npm run og
```

Writes five 1200×630 PNGs into `assets/og/`. Pillow is the only dependency.

### Changing the domain

The absolute URLs in the OG tags and sitemap are hard-coded (social crawlers do not run
JavaScript, so they cannot be templated at runtime). If you deploy under a different
domain or path, replace the base across:

```
index.html · adult-adhd-symptoms.html · adhd-inattentive-type.html
adhd-hyperactive-impulsive-type.html · adhd-combined-type.html
sitemap.xml · robots.txt
```

`test/pages.mjs` fails if `og:url` and `canonical` disagree, so a partial edit gets caught.

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

### Try the whole paid flow without an account

You do not need Cloudflare, an LLM key, or a provider account to exercise the paid chain.
The sandbox runs the **real** Worker code — the same `createHandler()` that deploys — with
an in-memory KV store and a mocked LLM, and it delivers a **genuinely signed webhook** to
the real webhook handler rather than faking the unlock.

```bash
npm run sandbox          # http://localhost:8788
```

Open the site, take the assessment, click Unlock, and you land on the sandbox's checkout
page. Clicking "Pay" fires a correctly-signed webhook at the Worker; the browser is
redirected back and the report unlocks exactly as it would in production.

`test/payment.mjs` (54 tests) drives this same chain over HTTP. `npm run check:pay` drives
it in a real browser instead, from the first question to the unlocked AI narrative.

> **The one thing to get right in production.** `CHECKOUT_REF_PARAM` in `assets/config.js`
> must match the parameter name you configure in your provider's dashboard. If they differ,
> the customer pays, the webhook arrives with no order reference, and **the report never
> unlocks**. The sandbox derives that name from a single source and returns a 400 with a
> diagnostic message if a checkout arrives without a reference — which is how the mismatch
> was caught here.

---

## Tests

```bash
npm install
npm test
```

- `test/worker.mjs` — 24 tests covering validation, CORS, every upstream failure mode,
  provider adapters, access control and the health endpoint. The LLM is mocked, so no
  API key or network access is needed.
- `test/integration.mjs` — 84 tests that load `report.html` in jsdom with the real
  scripts, mock the Worker, and verify the gate: that an unpaid visitor's page contains
  no report sections at all, that a paid reference unlocks them, that a 403 re-locks, and
  that a dropped connection does *not* unlock. Plus the visual summary, the share card's
  privacy boundary, and every failure path.
- `test/pages.mjs` — 109 static checks across the public pages: title and description
  lengths, canonical/OG/Twitter metadata, OG image dimensions (read straight from the PNG
  header), no broken internal links, sibling-article cross-linking, and sitemap/robots
  consistency.
- `test/payment.mjs` — 55 tests that boot the payment sandbox and drive the paid chain over
  HTTP: a signed webhook records the order, generation is refused without one, every
  provider's signature format is accepted and a tampered body is rejected. It also
  re-derives the pattern from the same answers on both sides — client and server each keep
  their own copy of the thresholds, so a drift there would make the AI narrative contradict
  the template report.

Total: **329 tests**, none of which need network access, an API key, or a payment account.

### Checking the deployed site

The suites above run against the files on disk. To verify the *deployed* site — the
question "did my deploy actually work?" — there is a separate harness that drives it in a
real browser over the DevTools Protocol:

```bash
npm run check:live
BASE_URL=https://example.com/ PROXY=http://127.0.0.1:8080 npm run check:live
```

It launches headless Chrome, walks the free assessment end to end (18 questions, stepping
back and forward), asserts the score at the screening threshold, opens the checkout modal,
and inspects the rendered report — ring, heatmap, icons, appendix, share card. It exits
non-zero on any failure, so it can gate a deploy.

`PROXY` is optional; set it if your network needs one. Set `CHROME` if Chrome is not in a
standard location.

### Checking the paid flow in a real browser

```bash
npm run check:pay
```

Same idea, but for the money path: it boots the sandbox, answers all 18 questions, checks
the report is locked and that the paid sections are absent from the DOM, unlocks, pays
through the sandbox checkout, and asserts the AI narrative actually replaced the template
sections — 33 checks, exiting non-zero on failure.

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
- [ ] Replace the hard-coded base URL in the OG tags, `sitemap.xml` and `robots.txt` with
      your real domain (see *Changing the domain* above).
- [ ] Submit `sitemap.xml` in Google Search Console once the domain is live.

---

## Attribution

The ASRS-v1.1 was developed by the World Health Organization. It is widely used in
research and clinical screening. Confirm the current licensing terms for your
commercial use before launch.

## Licence

MIT for the code. The assessment content and copy are your responsibility to review.
