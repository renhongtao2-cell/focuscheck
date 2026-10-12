#!/usr/bin/env node
/*
 * Local payment sandbox — runs the real Worker with a fake payment provider.
 *
 * The Worker code is not reimplemented here. `createHandler()` from
 * worker/index.js is imported and executed as-is, with an in-memory KV and a
 * mocked LLM upstream. That means this exercises the actual production code
 * path: signature verification, KV writes, the access check, prompt building,
 * and response shaping.
 *
 *   node tools/dev-server.mjs            # http://localhost:8788
 *   node tools/dev-server.mjs --open-access   # REQUIRE_ACCESS=false
 *
 * Routes
 *   /                       the real site (static files)
 *   /worker/*               the real Worker handler
 *   /__pay/checkout?ref=..  a fake provider checkout page
 *   /__pay/complete?ref=..  "the customer paid" -> signed webhook -> redirect back
 *   /__pay/state            what the KV currently holds
 *   /__pay/reset            clear the KV
 *
 * assets/config.js is served with the local Worker URL and the local checkout
 * URL spliced in, so the real file on disk stays untouched. That mirrors
 * exactly what you do in production, just pointed at localhost.
 */
import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createHandler } from "../worker/index.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 8788);
const OPEN_ACCESS = process.argv.includes("--open-access");
const SECRET = "dev_webhook_secret_do_not_use_in_production";
/*
 * Which provider's signature format to emulate. Read from wrangler.toml so the
 * sandbox verifies against the same scheme the deployed Worker will use —
 * signature formats differ per provider, so a wrong default here would let a
 * broken webhook pass locally and fail in production.
 */
function readWranglerValue(key, fallback) {
  const src = fs.readFileSync(path.join(ROOT, "worker", "wrangler.toml"), "utf8");
  const m = src.match(new RegExp("^\\s*" + key + "\\s*=\\s*\"([^\"]*)\"", "m"));
  return m ? m[1] : fallback;
}

const PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER || readWranglerValue("PAYMENT_PROVIDER", "lemon_squeezy");

/*
 * The LLM provider is a separate axis from the payment provider — they happen
 * to be configured next to each other, but "stripe" and "anthropic" have
 * nothing to do with one another. Keeping one variable for both is how the
 * mock upstream ends up shaped for the wrong vendor.
 */
const LLM_PROVIDER = process.env.LLM_PROVIDER || readWranglerValue("PROVIDER", "openrouter");

const ORIGIN = `http://localhost:${PORT}`;
const WORKER_URL = ORIGIN + "/worker";
const CHECKOUT_URL = ORIGIN + "/__pay/checkout";

/*
 * Browsers treat localhost and 127.0.0.1 as different origins, and so does the
 * Worker's CORS check. Allow both, unless the caller is explicit.
 */
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ||
  [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`].join(",");

/*
 * The parameter the checkout link carries the order reference in.
 *
 * It has to match assets/config.js exactly. A mismatch is the single most
 * likely way to ship a broken payment flow: the customer pays, the webhook
 * arrives with no reference, and the report never unlocks.
 *
 * So don't restate the value here — read it out of the real config. The
 * sandbox is then guaranteed to exercise whatever the site actually ships,
 * and the two can never drift apart. CHECKOUT_REF_PARAM in the environment
 * still wins, which is only useful for deliberately reproducing a mismatch.
 */
function readConfigRefParam() {
  const src = fs.readFileSync(path.join(ROOT, "assets", "config.js"), "utf8");
  const m = src.match(/CHECKOUT_REF_PARAM:\s*"([^"]*)"/);
  if (!m) throw new Error("CHECKOUT_REF_PARAM not found in assets/config.js");
  return m[1];
}
const REF_PARAM = process.env.CHECKOUT_REF_PARAM || readConfigRefParam();

/* ---------------- in-memory KV, matching the Workers KV surface ---------------- */

const store = new Map();
const ORDERS = {
  async get(key) { return store.has(key) ? store.get(key) : null; },
  async put(key, value) { store.set(key, String(value)); },
  async delete(key) { store.delete(key); },
  async list({ prefix = "" } = {}) {
    const keys = [...store.keys()].filter(k => k.startsWith(prefix)).map(name => ({ name }));
    return { keys, list_complete: true };
  }
};

/* ---------------- mocked LLM upstream ---------------- */

let llmCalls = 0;
function mockLlm(url, init) {
  llmCalls++;
  const sent = JSON.parse(init.body);
  const userPrompt = sent.messages
    ? sent.messages[sent.messages.length - 1].content
    : "";
  const criteria = (userPrompt.match(/Screener criteria met: (\d) of 6/) || [])[1] || "?";
  const pattern = (userPrompt.match(/- Pattern: (.+)/) || [])[1] || "?";

  const report = {
    overview:
      "MOCK_OVERVIEW_PARAGRAPH_ONE. Your responses met " + criteria + " of 6 screening criteria.\n\n" +
      "MOCK_OVERVIEW_PARAGRAPH_TWO. This is a screening indication, not a diagnosis.",
    signals: ["MOCK_SIGNAL_ONE", "MOCK_SIGNAL_TWO", "MOCK_SIGNAL_THREE"],
    areas: [
      { title: "MOCK_AREA_Work", body: "Mock body for work." },
      { title: "MOCK_AREA_Relationships", body: "Mock body for relationships." },
      { title: "MOCK_AREA_Home", body: "Mock body for home." },
      { title: "MOCK_AREA_Money", body: "Mock body for money." },
      { title: "MOCK_AREA_Wellbeing", body: "Mock body for wellbeing." }
    ],
    strategies: [1, 2, 3, 4, 5, 6].map(i => ({
      title: "MOCK_STRATEGY_" + i, body: "Mock strategy body " + i + "."
    }))
  };

  const body = LLM_PROVIDER === "anthropic"
    ? { content: [{ text: JSON.stringify(report) }] }
    : { choices: [{ message: { content: JSON.stringify(report) } }] };

  return Promise.resolve(new Response(JSON.stringify(body), {
    status: 200, headers: { "Content-Type": "application/json" }
  }));
}

/* ---------------- env passed to the Worker ---------------- */

const env = {
  LLM_API_KEY: "mock-key-not-used",
  PROVIDER: LLM_PROVIDER,
  LLM_MODEL: "mock-model",
  ALLOWED_ORIGINS: ALLOWED_ORIGINS,
  APP_URL: ORIGIN,
  PAYMENT_PROVIDER: PAYMENT_PROVIDER,
  PAYMENT_WEBHOOK_SECRET: SECRET,
  REQUIRE_ACCESS: OPEN_ACCESS ? "false" : "true",
  ORDERS
};

const handler = createHandler(mockLlm);

/* ---------------- static files ---------------- */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel.endsWith("/")) rel += "index.html";

  const file = path.join(ROOT, rel);
  // Refuse anything that escapes the project root.
  if (!file.startsWith(ROOT + path.sep) && file !== ROOT) {
    res.writeHead(403).end("forbidden");
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("not found: " + rel);
    return;
  }

  let body = fs.readFileSync(file);

  // Splice the local endpoints into config.js without touching the file.
  if (rel === "/assets/config.js") {
    body = Buffer.from(
      body.toString("utf8")
        .replace('API_ENDPOINT: ""', 'API_ENDPOINT: "' + WORKER_URL + '"')
        .replace('CHECKOUT_URL: ""', 'CHECKOUT_URL: "' + CHECKOUT_URL + '"')
        .replace(/CHECKOUT_REF_PARAM: "[^"]*"/, 'CHECKOUT_REF_PARAM: "' + REF_PARAM + '"')
        // Force the real access path: a paid reference is the only way in.
        .replace(/ALLOW_DEMO_UNLOCK: true/, "ALLOW_DEMO_UNLOCK: false"),
      "utf8"
    );
  }

  res.writeHead(200, {
    "Content-Type": MIME[path.extname(file)] || "application/octet-stream",
    "Cache-Control": "no-store"
  }).end(body);
}

/* ---------------- fake provider ---------------- */

function checkoutPage(ref) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Sandbox checkout</title>
<style>
 body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#F5F8F7;
      display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
 .card{background:#fff;border:1px solid #E3E9E7;border-radius:18px;padding:34px 36px;
       max-width:440px;box-shadow:0 24px 60px rgba(16,24,40,.12)}
 .tag{display:inline-block;font-size:11.5px;font-weight:800;letter-spacing:.08em;
      text-transform:uppercase;color:#B45309;background:#FEF3E2;padding:4px 11px;border-radius:999px}
 h1{font-size:21px;margin:14px 0 6px;letter-spacing:-.02em}
 p{color:#56635F;font-size:14.5px;line-height:1.6;margin:0 0 18px}
 code{background:#F5F8F7;padding:2px 6px;border-radius:5px;font-size:12.5px;word-break:break-all}
 .sum{display:flex;justify-content:space-between;padding:14px 0;border-top:1px solid #E3E9E7;
      border-bottom:1px solid #E3E9E7;font-size:14.5px;margin-bottom:20px}
 button{width:100%;background:#0E7C5A;color:#fff;border:none;border-radius:11px;
        padding:15px;font-size:16px;font-weight:600;cursor:pointer;font-family:inherit}
 button:hover{background:#0A5C43}
 .alt{display:block;text-align:center;margin-top:14px;font-size:13.5px;color:#8B9691}
</style></head><body>
<div class="card">
  <span class="tag">Sandbox — no real money</span>
  <h1>FocusCheck full report</h1>
  <p>This stands in for Lemon Squeezy / Paddle / Stripe. Paying here sends a
     <b>real signed webhook</b> to the Worker at <code>/worker/webhook</code>.</p>
  <div class="sum"><span>One-time payment</span><b>$19.00</b></div>
  <button onclick="location.href='/__pay/complete?ref=${encodeURIComponent(ref)}'">Pay $19.00</button>
  <span class="alt">Order reference: <code>${ref}</code></span>
</div></body></html>`;
}

/*
 * Pull the order reference out of the checkout link. Accepts the configured
 * parameter plus the common aliases, so a mismatch shows up as a clear error
 * rather than as a silent "customer paid, nothing unlocked".
 */
function readRef(url) {
  return url.searchParams.get(REF_PARAM) ||
    url.searchParams.get("ref") ||
    url.searchParams.get("client_reference_id") ||
    "";
}

function buildWebhookBody(ref) {
  if (PAYMENT_PROVIDER === "paddle") {
    return {
      event_type: "transaction.completed",
      data: { status: "completed", custom_data: { ref } }
    };
  }
  if (PAYMENT_PROVIDER === "stripe") {
    return {
      type: "checkout.session.completed",
      data: { object: { payment_status: "paid", client_reference_id: ref } }
    };
  }
  return {
    meta: { event_name: "order_created", custom_data: { ref } },
    data: { attributes: { status: "paid" } }
  };
}

async function signWebhook(rawBody) {
  const ts = Math.floor(Date.now() / 1000);

  /*
   * Each provider signs a different string, not just a different header:
   * Stripe signs "t.body", Paddle signs "ts:body", Lemon Squeezy signs the raw
   * body. Signing the raw body and merely relabelling the header produces a
   * signature that looks right and always fails — mirror worker/payments.js
   * exactly rather than approximating it.
   */
  let signedPayload = rawBody;
  if (PAYMENT_PROVIDER === "paddle") signedPayload = ts + ":" + rawBody;
  if (PAYMENT_PROVIDER === "stripe") signedPayload = ts + "." + rawBody;

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedPayload));
  const hex = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");

  if (PAYMENT_PROVIDER === "paddle") return { name: "Paddle-Signature", value: `ts=${ts};h1=${hex}` };
  if (PAYMENT_PROVIDER === "stripe") return { name: "Stripe-Signature", value: `t=${ts},v1=${hex}` };
  return { name: "X-Signature", value: hex };
}

/* ---------------- request plumbing ---------------- */

async function readRaw(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

async function toRequest(req, raw) {
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach(x => headers.append(k, x));
    else if (v !== undefined) headers.set(k, v);
  }
  const init = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD" && raw && raw.length) init.body = raw;
  return new Request(ORIGIN + req.url, init);
}

async function sendResponse(res, out) {
  const buf = Buffer.from(await out.arrayBuffer());
  const headers = {};
  out.headers.forEach((v, k) => { headers[k] = v; });
  res.writeHead(out.status, headers).end(buf);
}

/* ---------------- server ---------------- */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, ORIGIN);
  const p = url.pathname;

  try {
    /* --- sandbox provider --- */
    if (p === "/__pay/checkout") {
      const ref = readRef(url);
      if (!ref) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" }).end(
          "<pre>No order reference on the checkout link.\n\n" +
          "Looked for the parameter: " + REF_PARAM + "\n" +
          "Received: " + url.search + "\n\n" +
          "The site's CHECKOUT_REF_PARAM and the provider's parameter name must match.</pre>");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(checkoutPage(ref));
      return;
    }

    if (p === "/__pay/complete") {
      const ref = readRef(url);
      if (!ref) {
        res.writeHead(400, { "Content-Type": "text/plain" })
          .end("no order reference on /__pay/complete");
        return;
      }
      const rawBody = JSON.stringify(buildWebhookBody(ref));
      const sig = await signWebhook(rawBody);

      // Deliver the webhook exactly as the provider would: raw body + signature.
      const hookReq = new Request(ORIGIN + "/webhook", {
        method: "POST",
        headers: { "Content-Type": "application/json", [sig.name]: sig.value },
        body: rawBody
      });
      const hookRes = await handler(hookReq, env);
      const hookBody = await hookRes.json();
      console.log("  webhook ->", hookRes.status, JSON.stringify(hookBody));

      if (hookRes.status !== 200) {
        res.writeHead(502, { "Content-Type": "text/html; charset=utf-8" })
          .end("<pre>webhook failed: " + hookRes.status + " " +
               JSON.stringify(hookBody) + "</pre>");
        return;
      }
      // Providers redirect the customer back after payment.
      res.writeHead(302, { Location: "/report.html" }).end();
      return;
    }

    if (p === "/__pay/state") {
      const keys = [...store.keys()];
      res.writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({
          requireAccess: env.REQUIRE_ACCESS,
          provider: PAYMENT_PROVIDER,
          llmCalls,
          orders: keys.map(k => ({ key: k, value: JSON.parse(store.get(k)) }))
        }, null, 2));
      return;
    }

    if (p === "/__pay/reset") {
      store.clear();
      llmCalls = 0;
      res.writeHead(200, { "Content-Type": "application/json" }).end('{"ok":true}');
      return;
    }

    /* --- the real Worker --- */
    if (p === "/worker" || p.startsWith("/worker/")) {
      const raw = await readRaw(req);
      const forwarded = new Request(ORIGIN + p.slice("/worker".length) + url.search, {
        method: req.method,
        headers: (() => {
          const h = new Headers();
          for (const [k, v] of Object.entries(req.headers)) {
            if (Array.isArray(v)) v.forEach(x => h.append(k, x));
            else if (v !== undefined) h.set(k, v);
          }
          return h;
        })(),
        body: (req.method === "GET" || req.method === "HEAD") ? undefined : raw
      });
      await sendResponse(res, await handler(forwarded, env));
      return;
    }

    /* --- static site --- */
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end("method not allowed");
      return;
    }
    serveStatic(req, res, p);

  } catch (err) {
    console.error("dev-server error:", err);
    res.writeHead(500, { "Content-Type": "text/plain" }).end("dev-server error: " + err.message);
  }
});

server.listen(PORT, () => {
  console.log("\n  FocusCheck sandbox");
  console.log("  site      " + ORIGIN + "/");
  console.log("  worker    " + WORKER_URL);
  console.log("  payment   " + PAYMENT_PROVIDER + "   access required: " + (env.REQUIRE_ACCESS === "true"));
  console.log("  LLM       mocked (no key needed)\n");
});

export { server, env, ORDERS, store };
