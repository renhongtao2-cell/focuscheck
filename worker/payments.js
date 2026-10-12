/*
 * FocusCheck — payment webhook verification and access control
 *
 * Flow:
 *   1. The browser generates a random order reference and sends it to the
 *      checkout page as custom data.
 *   2. The customer pays.
 *   3. The provider POSTs a webhook here. We verify the signature, read the
 *      order reference, and write it to KV.
 *   4. The provider redirects the customer back to report.html?access=<ref>.
 *   5. The browser sends that ref to the Worker, which checks KV before
 *      generating. Nobody who has not paid gets a report.
 *
 * Supported providers: lemon_squeezy | paddle | stripe
 */

const encoder = new TextEncoder();

/* ---------------- crypto helpers ---------------- */

export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(sig))
    .map(function (b) { return b.toString(16).padStart(2, "0"); })
    .join("");
}

/* Length-independent comparison, to avoid leaking a prefix match. */
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------------- provider adapters ---------------- */

const PROVIDERS = {

  lemon_squeezy: {
    /* X-Signature: hex HMAC-SHA256 of the raw body */
    async verify(request, rawBody, secret) {
      const header = request.headers.get("X-Signature") || "";
      const expected = await hmacHex(secret, rawBody);
      return safeEqual(header.toLowerCase(), expected);
    },
    /* returns { paid, ref } or null when the event is not a completed order */
    parse(payload) {
      const name = payload && payload.meta && payload.meta.event_name;
      if (name !== "order_created" && name !== "subscription_created") return null;
      const attrs = payload.data && payload.data.attributes;
      const status = attrs && attrs.status;
      const paid = status === "paid";
      const custom = payload.meta && payload.meta.custom_data;
      return { paid: paid, ref: custom && (custom.ref || custom.order_ref) };
    }
  },

  paddle: {
    /* Paddle-Signature: ts=123;h1=abc  — signed payload is "ts:rawBody" */
    async verify(request, rawBody, secret) {
      const header = request.headers.get("Paddle-Signature") || "";
      const parts = {};
      header.split(";").forEach(function (kv) {
        const i = kv.indexOf("=");
        if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
      });
      if (!parts.ts || !parts.h1) return false;
      const expected = await hmacHex(secret, parts.ts + ":" + rawBody);
      return safeEqual(parts.h1.toLowerCase(), expected);
    },
    parse(payload) {
      const type = payload && payload.event_type;
      if (type !== "transaction.completed") return null;
      const data = payload.data || {};
      const status = data.status;
      const custom = data.custom_data;
      return { paid: status === "completed" || status === "paid", ref: custom && custom.ref };
    }
  },

  stripe: {
    /* Stripe-Signature: t=123,v1=abc — signed payload is "t.rawBody" */
    async verify(request, rawBody, secret) {
      const header = request.headers.get("Stripe-Signature") || "";
      const parts = {};
      header.split(",").forEach(function (kv) {
        const i = kv.indexOf("=");
        if (i > 0) parts[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
      });
      if (!parts.t || !parts.v1) return false;
      const expected = await hmacHex(secret, parts.t + "." + rawBody);
      return safeEqual(parts.v1.toLowerCase(), expected);
    },
    parse(payload) {
      if (!payload || payload.type !== "checkout.session.completed") return null;
      const obj = (payload.data && payload.data.object) || {};
      return { paid: obj.payment_status === "paid", ref: obj.client_reference_id };
    }
  }
};

/* ---------------- webhook handling ---------------- */

export async function handleWebhook(request, rawBody, env) {
  const name = (env.PAYMENT_PROVIDER || "lemon_squeezy").toLowerCase();
  const provider = PROVIDERS[name];
  if (!provider) return { status: 500, body: { error: "unknown_payment_provider" } };

  const secret = env.PAYMENT_WEBHOOK_SECRET;
  if (!secret) return { status: 500, body: { error: "webhook_secret_not_set" } };

  const valid = await provider.verify(request, rawBody, secret);
  if (!valid) return { status: 401, body: { error: "invalid_signature" } };

  let payload;
  try { payload = JSON.parse(rawBody); }
  catch (e) { return { status: 400, body: { error: "invalid_json" } }; }

  const parsed = provider.parse(payload);
  if (!parsed) return { status: 200, body: { ok: true, ignored: true } };
  if (!parsed.paid) return { status: 200, body: { ok: true, unpaid: true } };
  if (!parsed.ref) return { status: 200, body: { ok: true, no_ref: true } };

  if (!env.ORDERS) return { status: 500, body: { error: "orders_kv_not_bound" } };

  await env.ORDERS.put("order:" + parsed.ref, JSON.stringify({
    ref: parsed.ref,
    provider: name,
    at: new Date().toISOString()
  }));

  return { status: 200, body: { ok: true, unlocked: parsed.ref } };
}

/* ---------------- access control ---------------- */

/*
 * Returns true when the caller may generate a report.
 *
 * With REQUIRE_ACCESS unset (the default while you are still setting payment
 * up), generation is open — convenient for development, not for production.
 * Set REQUIRE_ACCESS = "true" once webhooks are live.
 */
export async function checkAccess(token, env) {
  if ((env.REQUIRE_ACCESS || "").toLowerCase() !== "true") return true;

  if (!token || typeof token !== "string" || token.length > 128) return false;
  if (!env.ORDERS) return false;

  const record = await env.ORDERS.get("order:" + token);
  return record !== null;
}
