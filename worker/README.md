# FocusCheck Worker

A single Cloudflare Worker that does two jobs:

1. **Generates reports** — holds your LLM API key server-side and turns assessment
   answers into a personalised report. The key never reaches the browser.
2. **Verifies payments** — receives webhooks from your payment provider and records
   which orders have been paid, so only paying customers can generate a report.

Routes:

| Route | Method | Purpose |
|---|---|---|
| `/` | POST | Generate a report from `{ answers, access }` |
| `/webhook` | POST | Receive payment webhooks |
| `/health` | GET | Check configuration |

---

## 1. Prerequisites

- A Cloudflare account (the free plan is enough — Workers include 100,000 requests/day)
- Node.js 18+ locally
- An LLM API key (OpenRouter, OpenAI or Anthropic)

## 2. Deploy

```bash
cd worker
npx wrangler login
```

**Create the KV namespace** used to record paid orders:

```bash
npx wrangler kv namespace create ORDERS
```

It prints an `id`. Uncomment the `[[kv_namespaces]]` block in `wrangler.toml` and
paste the id in.

**Set your secrets** (these are stored encrypted by Cloudflare, never in the repo):

```bash
npx wrangler secret put LLM_API_KEY
npx wrangler secret put PAYMENT_WEBHOOK_SECRET
```

**Edit `wrangler.toml`** — at minimum set `ALLOWED_ORIGINS` to your real site origin.
Once you have a custom domain, add it too:

```toml
ALLOWED_ORIGINS = "https://renhongtao2-cell.github.io,https://yourdomain.com"
```

**Deploy:**

```bash
npx wrangler deploy
```

It prints a URL like `https://focuscheck-report.<your-subdomain>.workers.dev`.

**Point the site at it** — open `assets/config.js` and set:

```js
API_ENDPOINT: "https://focuscheck-report.<your-subdomain>.workers.dev",
```

That is the only front-end change. Reload the report page and it will use AI.

### Choosing a model

`wrangler.toml` sets the defaults:

```toml
PROVIDER  = "openrouter"          # openrouter | openai | anthropic
LLM_MODEL = "openai/gpt-4o-mini"
```

Any model string your provider accepts works. Good value options:

| Provider | Model | Notes |
|---|---|---|
| openrouter | `openai/gpt-4o-mini` | cheap, fast, good enough |
| openrouter | `anthropic/claude-sonnet-4-5` | noticeably better writing |
| openai | `gpt-4o-mini` | direct from OpenAI |
| anthropic | `claude-sonnet-4-5` | direct from Anthropic |

Change `LLM_MODEL`, redeploy, done. You can switch providers later by changing
`PROVIDER` — no code changes.

---

## 3. Payment

The flow is designed so that **nobody who has not paid can generate a report**.

```
browser                provider              worker            KV
   │  click Unlock        │                    │               │
   ├─ generate ref ──────►│                    │               │
   │  (store in localStorage)                  │               │
   │                      │  webhook ─────────►│  verify sig   │
   │                      │                    ├─ put order:ref►│
   │◄─ redirect to report.html ────────────────│               │
   ├─ POST { answers, access: ref } ──────────►│  get order:ref│
   │◄───────────────────── report ─────────────┤               │
```

### Setup

1. Create the product in your provider's dashboard with price **$19**.
2. Set the **redirect / success URL** to your report page:
   `https://renhongtao2-cell.github.io/focuscheck/report.html`
3. Set the **webhook URL** to:
   `https://focuscheck-report.<your-subdomain>.workers.dev/webhook`
4. Copy the **webhook signing secret** into the Worker:
   ```bash
   npx wrangler secret put PAYMENT_WEBHOOK_SECRET
   ```
5. Set `PAYMENT_PROVIDER` in `wrangler.toml` to `lemon_squeezy`, `paddle` or `stripe`.
6. Put the **checkout link** into `assets/config.js`:
   ```js
   CHECKOUT_URL: "https://yourstore.lemonsqueezy.com/checkout/buy/xxxxxxxx",
   CHECKOUT_REF_PARAM: "checkout[custom][ref]",
   ```
7. **Once a test payment works**, turn on enforcement:
   ```toml
   REQUIRE_ACCESS = "true"
   ```
   Redeploy. From now on, an order must exist in KV before a report is generated.

### Provider-specific notes

| Provider | `CHECKOUT_REF_PARAM` | `PAYMENT_PROVIDER` |
|---|---|---|
| Lemon Squeezy | `checkout[custom][ref]` | `lemon_squeezy` |
| Paddle | uses `_passthrough` — see below | `paddle` |
| Stripe | `client_reference_id` | `stripe` |

**Paddle** passes custom data via `_passthrough`, which has a slightly different
shape. If you use Paddle, set `CHECKOUT_REF_PARAM` to `_passthrough` and adjust
`CHECKOUT_URL` construction in `assets/app.js` to send a JSON payload:

```js
_passthrough={"ref":"<the generated ref>"}
```

The webhook side already reads `data.custom_data.ref` for Paddle.

### Testing the webhook locally

```bash
npx wrangler dev
```

Then send a signed request with the secret from your `.dev.vars`:

```bash
BODY='{"meta":{"event_name":"order_created","custom_data":{"ref":"test123"}},"data":{"attributes":{"status":"paid"}}}'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$PAYMENT_WEBHOOK_SECRET" | awk '{print $2}')
curl -X POST http://localhost:8787/webhook \
  -H "X-Signature: $SIG" -H "Content-Type: application/json" -d "$BODY"
```

Then check `http://localhost:8787/health` and try a generation with
`access: "test123"`.

---

## 4. Security notes

- **`REQUIRE_ACCESS = "false"` means anyone can call your Worker and spend your LLM
  credits.** That setting exists for development only. Turn it on before you launch.
- The Worker re-derives the scores from the submitted answers rather than trusting
  whatever the client sends, so a tampered request cannot inflate a result.
- Answers are validated item by item (18 items, integer 0–4) and the body is capped
  at 4 KB, which blocks most abuse and prompt-injection attempts.
- CORS is restricted to `ALLOWED_ORIGINS`. Requests from other browser origins are
  rejected. (Requests with no `Origin` header are allowed through and gated by the
  access check instead — that is what lets you test with curl.)
- The prompt explicitly forbids diagnostic language, and the model is asked to
  return structured JSON which is validated before being sent to the browser.
- Webhook signatures are verified with HMAC-SHA256 using a timing-safe comparison.

## 5. Costs

- Workers free plan: 100,000 requests/day.
- KV free plan: 100,000 reads/day, 1,000 writes/day — far more than a launch needs.
- LLM: roughly **$0.002–0.01 per report** on a small model. At $19 per report, the
  model cost is not the constraint.

---

## Files

| File | Purpose |
|---|---|
| `index.js` | Routing, validation, prompt building, provider adapters |
| `payments.js` | Webhook signature verification and access control |
| `wrangler.toml` | Configuration (no secrets) |
