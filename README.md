# FocusCheck

A free adult ADHD self-assessment with a paid, personalised report.

Built on the **WHO Adult ADHD Self-Report Scale (ASRS-v1.1)** — a screening instrument,
not a diagnostic tool.

Pure static site: no build step, no framework, no backend. Deploy it anywhere.

---

## What's included

| Page | Purpose |
|---|---|
| `index.html` | Landing page — hero, how it works, free vs paid comparison, FAQ |
| `test.html` | 18-question assessment with progress bar and auto-advance |
| `results.html` | Scored result + blurred report preview + `$19` paywall |
| `privacy.html` / `terms.html` | Template legal pages (review before launch) |

```
focuscheck/
├── index.html
├── test.html
├── results.html
├── privacy.html
├── terms.html
├── .nojekyll
└── assets/
    ├── styles.css      # all styling
    ├── questions.js    # the 18 ASRS items + scoring rules
    └── app.js          # test flow, scoring, paywall modal
```

---

## Run locally

Any static server works. From this folder:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly with `file://` also works, but a local server is closer
to production behaviour.

---

## Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "FocusCheck: initial release"
git branch -M main
git remote add origin https://github.com/<your-username>/focuscheck.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Source: `main` / `(root)` → Save**.

Your site will be live at:

```
https://<your-username>.github.io/focuscheck/
```

The `.nojekyll` file is already included so that files starting with `_` are served correctly.

---

## Connect a payment provider

Right now the checkout is a **demo** — clicking *Pay* shows a notice instead of charging.

Pick a **Merchant of Record** so they handle global sales tax and compliance for you.
This is the simplest route for an individual founder without a US entity:

| Provider | Notes |
|---|---|
| **Paddle** | Merchant of record, handles VAT/GST, payouts to many countries |
| **Lemon Squeezy** | Merchant of record, very fast setup, good for digital products |
| **Stripe** | Lowest fees, but needs a business entity in a supported country |

### Wiring it up

1. Create the product in your provider's dashboard and copy the checkout link.
2. Open `results.html` and find the paywall button:

   ```html
   <button class="btn btn-primary btn-lg" data-open-checkout>Unlock my report</button>
   ```

3. Replace it with a link to your hosted checkout:

   ```html
   <a class="btn btn-primary btn-lg" href="https://YOUR-CHECKOUT-LINK">Unlock my report</a>
   ```

That's the whole change. The modal and `#demoNote` block can then be deleted.

### Delivering the report after payment

Three common approaches, easiest first:

1. **Redirect to a success page** — most providers send the buyer to a URL you set.
   Point it at a `report.html` you generate ahead of time.
2. **Provider-hosted file** — attach the PDF as the product file; the provider emails it.
3. **Serverless webhook** — for a personalised, generated-on-demand report, add a small
   function (Cloudflare Workers, Vercel Functions) that calls an LLM and returns the report.

---

## Customising

**Questions and scoring** — edit `assets/questions.js`. Each item has `part` (A = the
validated 6-item screener) and `domain` (`inattention` / `hyperactive`). The Part A
thresholds live in `SCREENER_RULES`.

**Price** — search for `$19` in `index.html` and `results.html`.

**Brand** — colours are CSS variables at the top of `assets/styles.css`
(`--brand`, `--brand-dark`, `--brand-soft`).

**Turning this into a different assessment** — the engine is generic. Swap the questions,
the scoring rules and the copy, and the same three pages work for burnout, attachment
style, or any other scale.

---

## Before you launch — compliance checklist

This is a health-adjacent product. The following are not optional:

- [ ] Keep the wording **screening / self-assessment** everywhere. Never write
      *diagnose*, *diagnosis*, *treat* or *cure* as a claim about your product.
- [ ] Keep the medical disclaimer visible on the landing page, results page and report.
- [ ] Add a crisis-line notice (e.g. 988 in the US, Samaritans 116 123 in the UK).
- [ ] Replace `privacy.html` and `terms.html` with documents reviewed for your jurisdiction.
- [ ] Add a GDPR/CCPA cookie banner if you add analytics or advertising.
- [ ] Do not store more personal data than you need. Answers currently stay in
      `localStorage` on the user's own device.

---

## Attribution

The ASRS-v1.1 was developed by the World Health Organization. It is widely used in
research and clinical screening. Confirm the current licensing terms for your
commercial use before launch.

---

## Licence

MIT for the code. The assessment content and copy are your responsibility to review.
