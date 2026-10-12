/*
 * Payment chain integration tests — run with:  npm test
 *
 * Boots tools/dev-server.mjs, which executes the REAL worker/index.js against
 * an in-memory KV with a mocked LLM, then drives the whole paid flow over
 * HTTP: refuse before payment, accept a correctly signed webhook, unlock,
 * generate, and refuse everything else.
 *
 * It also cross-checks the client and the server on profile classification.
 * Both sides re-derive the pattern from the same answers with their own copy
 * of the thresholds, so if one drifts the AI narrative would contradict the
 * template report. That is exactly the kind of bug nobody notices until a
 * customer does.
 */
import { spawn } from "child_process";
import vm from "node:vm";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.TEST_PORT || 8799);
const BASE = `http://127.0.0.1:${PORT}`;
const WORKER = BASE + "/worker";
const SECRET = "dev_webhook_secret_do_not_use_in_production";
const REF = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log("  PASS  " + name); pass++; }
  else { console.log("  FAIL  " + name + (extra ? "  -> " + String(extra).slice(0, 200) : "")); fail++; }
}

/* ---------- load the real client-side scoring ---------- */

const ctx = vm.createContext({
  document: { addEventListener() {}, getElementById() { return null; } },
  window: {},
  console
});
vm.runInContext(fs.readFileSync(path.join(ROOT, "assets", "questions.js"), "utf8"), ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, "assets", "report.js"), "utf8"), ctx);
const Client = ctx.window.FocusCheckReport;

/* ---------- boot the sandbox ---------- */

const server = spawn(process.execPath, [path.join(ROOT, "tools", "dev-server.mjs")], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"]
});
let serverLog = "";
server.stdout.on("data", d => { serverLog += d; });
server.stderr.on("data", d => { serverLog += d; });

function shutdown() { try { server.kill(); } catch (e) {} }
process.on("exit", shutdown);
process.on("SIGINT", () => { shutdown(); process.exit(130); });

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(WORKER + "/health");
      if (r.ok) return await r.json();
    } catch (e) { /* not up yet */ }
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error("sandbox never came up.\n" + serverLog);
}

const health = await waitForServer();
check("sandbox: worker responds to /health", health.ok === true, JSON.stringify(health));
check("sandbox: access is required by default", health.accessRequired === true, JSON.stringify(health));

/* ---------- helpers ---------- */

const post = (url, body, headers = {}) =>
  fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body
  });

async function sign(body) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/*
 * The sandbox emulates whichever provider wrangler.toml names, so the test has
 * to sign the way that provider signs. Deriving the scheme from the same file
 * the Worker reads keeps the two in step: a test that hard-coded one provider's
 * header would keep passing happily while a different provider's format was
 * broken — which is exactly the kind of bug this suite exists to catch.
 */
function readProvider() {
  const src = fs.readFileSync(path.join(ROOT, "worker", "wrangler.toml"), "utf8");
  const m = src.match(/^\s*PAYMENT_PROVIDER\s*=\s*"([^"]*)"/m);
  if (!m) throw new Error("PAYMENT_PROVIDER not found in worker/wrangler.toml");
  return m[1];
}
const PROVIDER = readProvider();

/* Fixed timestamps: the Worker only checks the HMAC, not freshness. */
const TS = "1750000000";

const ADAPTERS = {
  lemon_squeezy: {
    paid: ref => JSON.stringify({
      meta: { event_name: "order_created", custom_data: { ref } },
      data: { attributes: { status: "paid" } }
    }),
    unpaid: ref => JSON.stringify({
      meta: { event_name: "order_created", custom_data: { ref } },
      data: { attributes: { status: "pending" } }
    }),
    otherEvent: () => JSON.stringify({ meta: { event_name: "subscription_cancelled" }, data: {} }),
    noRef: () => JSON.stringify({
      meta: { event_name: "order_created", custom_data: {} },
      data: { attributes: { status: "paid" } }
    }),
    headers: async body => ({ "X-Signature": await sign(body) }),
    wrong: () => ({ "X-Signature": "0".repeat(64) }),
    truncated: async body => ({ "X-Signature": (await sign(body)).slice(0, 32) })
  },

  paddle: {
    paid: ref => JSON.stringify({
      event_type: "transaction.completed",
      data: { status: "completed", custom_data: { ref } }
    }),
    unpaid: ref => JSON.stringify({
      event_type: "transaction.completed",
      data: { status: "past_due", custom_data: { ref } }
    }),
    otherEvent: () => JSON.stringify({ event_type: "subscription.canceled", data: {} }),
    noRef: () => JSON.stringify({
      event_type: "transaction.completed",
      data: { status: "completed", custom_data: {} }
    }),
    headers: async body => ({ "Paddle-Signature": `ts=${TS};h1=${await sign(TS + ":" + body)}` }),
    wrong: () => ({ "Paddle-Signature": `ts=${TS};h1=${"0".repeat(64)}` }),
    truncated: async body =>
      ({ "Paddle-Signature": `ts=${TS};h1=${(await sign(TS + ":" + body)).slice(0, 32)}` })
  },

  stripe: {
    paid: ref => JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { payment_status: "paid", client_reference_id: ref } }
    }),
    unpaid: ref => JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { payment_status: "unpaid", client_reference_id: ref } }
    }),
    otherEvent: () => JSON.stringify({ type: "customer.created", data: { object: {} } }),
    noRef: () => JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { payment_status: "paid" } }
    }),
    headers: async body => ({ "Stripe-Signature": `t=${TS},v1=${await sign(TS + "." + body)}` }),
    wrong: () => ({ "Stripe-Signature": `t=${TS},v1=${"0".repeat(64)}` }),
    truncated: async body =>
      ({ "Stripe-Signature": `t=${TS},v1=${(await sign(TS + "." + body)).slice(0, 32)}` })
  }
};

const P = ADAPTERS[PROVIDER];
if (!P) throw new Error(`no test adapter for PAYMENT_PROVIDER="${PROVIDER}"`);

const state = () => fetch(BASE + "/__pay/state").then(r => r.json());

/* A set of answers that meets exactly 4 of 6 criteria. */
const ANSWERS = {
  1: 3, 2: 3, 3: 3, 4: 3, 5: 2, 6: 2,
  7: 3, 8: 3, 9: 3, 10: 3, 11: 3,
  12: 2, 13: 2, 14: 2, 15: 2, 16: 2, 17: 2, 18: 2
};

await fetch(BASE + "/__pay/reset");

/* ---------- 1 — nothing is served before payment ---------- */

{
  const r = await post(WORKER, JSON.stringify({ answers: ANSWERS }));
  check("gate: no token is refused", r.status === 403, r.status);
  const j = await r.json();
  check("gate: refusal names the reason", j.error === "access_denied", JSON.stringify(j));

  const r2 = await post(WORKER, JSON.stringify({ answers: ANSWERS, access: REF }));
  check("gate: an unpaid reference is refused", r2.status === 403, r2.status);

  const r3 = await post(WORKER, JSON.stringify({ answers: ANSWERS, access: "z".repeat(200) }));
  check("gate: an oversized token is refused", r3.status === 403, r3.status);

  const r4 = await post(WORKER, JSON.stringify({ answers: ANSWERS, access: 12345 }));
  check("gate: a non-string token is refused", r4.status === 403, r4.status);
}

/* ---------- 2 — webhook signature verification ---------- */

{
  check("webhook: the sandbox is emulating " + PROVIDER, !!P);

  const body = P.paid("attacker0000000000000000000000000");

  let r = await post(WORKER + "/webhook", body, P.wrong());
  check("webhook: a wrong signature is rejected", r.status === 401, r.status);

  r = await post(WORKER + "/webhook", body);
  check("webhook: a missing signature is rejected", r.status === 401, r.status);

  // Correct signature, but over different content — the classic tamper attempt.
  const sigForOther = await P.headers(P.paid("someoneelse000000000000000000000"));
  r = await post(WORKER + "/webhook", body, sigForOther);
  check("webhook: a signature for different content is rejected", r.status === 401, r.status);

  // Truncated signature must not pass a prefix comparison.
  r = await post(WORKER + "/webhook", body, await P.truncated(body));
  check("webhook: a truncated signature is rejected", r.status === 401, r.status);

  const s = await state();
  check("webhook: nothing was written by the rejected calls", s.orders.length === 0, s.orders.length);
}

/* ---------- 3 — the happy path ---------- */

{
  const body = P.paid(REF);
  const r = await post(WORKER + "/webhook", body, await P.headers(body));
  const j = await r.json();
  check("webhook: a correctly signed order is accepted", r.status === 200, r.status);
  check("webhook: the response names the unlocked reference", j.unlocked === REF, JSON.stringify(j));

  const s = await state();
  check("kv: the order was recorded", s.orders.length === 1 && s.orders[0].key === "order:" + REF,
    JSON.stringify(s.orders));
  check("kv: the record carries the provider and a timestamp",
    s.orders[0].value.provider === PROVIDER && !isNaN(Date.parse(s.orders[0].value.at)),
    JSON.stringify(s.orders[0].value));

  // Providers retry webhooks; a retry must not break anything.
  const again = await post(WORKER + "/webhook", body, await P.headers(body));
  check("webhook: a retry is accepted", again.status === 200, again.status);
  const s2 = await state();
  check("kv: a retry does not duplicate the order", s2.orders.length === 1, s2.orders.length);
}

/* ---------- 4 — events that must not unlock ---------- */

{
  const unpaid = P.unpaid("unpaidref00000000000000000000000");
  let r = await post(WORKER + "/webhook", unpaid, await P.headers(unpaid));
  check("webhook: an unpaid order does not unlock", (await r.json()).unpaid === true, r.status);

  const other = P.otherEvent();
  r = await post(WORKER + "/webhook", other, await P.headers(other));
  check("webhook: an unrelated event is ignored", (await r.json()).ignored === true, r.status);

  const noRef = P.noRef();
  r = await post(WORKER + "/webhook", noRef, await P.headers(noRef));
  check("webhook: a paid order with no reference is ignored", (await r.json()).no_ref === true, r.status);

  const s = await state();
  check("kv: none of those wrote an order", s.orders.length === 1, s.orders.length);
}

/* ---------- 5 — generation after payment ---------- */

{
  const r = await post(WORKER, JSON.stringify({ answers: ANSWERS, access: REF }));
  const j = await r.json();
  check("generate: succeeds with a paid reference", r.status === 200, r.status + " " + JSON.stringify(j).slice(0, 120));
  check("generate: returns a report", j.ok === true && !!j.report, JSON.stringify(j).slice(0, 120));
  check("generate: the server re-scored the answers", j.scores && j.scores.positives === 4,
    JSON.stringify(j.scores));
  check("generate: five areas and six strategies",
    j.report.areas.length === 5 && j.report.strategies.length === 6,
    j.report.areas.length + " / " + j.report.strategies.length);
  check("generate: the overview has two paragraphs",
    j.report.overview.split(/\n{2,}/).length === 2);

  const s = await state();
  check("generate: the LLM was called exactly once for this request", s.llmCalls === 1, s.llmCalls);

  const r2 = await post(WORKER, JSON.stringify({ answers: ANSWERS, access: "f".repeat(32) }));
  check("generate: a different reference is still refused", r2.status === 403, r2.status);
}

/* ---------- 6 — client and server agree on the profile ---------- */

{
  const SAMPLE_TO_PATTERN = {
    inattentive: "predominantly inattentive",
    hyperactive: "predominantly hyperactive-impulsive",
    combined: "combined",
    mild: "sub-threshold"
  };

  for (const kind of Object.keys(SAMPLE_TO_PATTERN)) {
    const answers = Client.sampleAnswers(kind);
    const r = await post(WORKER, JSON.stringify({ answers, access: REF }));
    const j = await r.json();

    const clientProfile = Client.pickProfile(Client.scoreAnswers(answers)).name;
    check(`agreement: ${kind} — server pattern is correct`,
      j.pattern === SAMPLE_TO_PATTERN[kind], j.pattern + " (expected " + SAMPLE_TO_PATTERN[kind] + ")");
    check(`agreement: ${kind} — server scores match the client`,
      JSON.stringify(j.scores) === JSON.stringify(Client.scoreAnswers(answers)),
      JSON.stringify(j.scores) + " vs " + JSON.stringify(Client.scoreAnswers(answers)));
    check(`agreement: ${kind} — the narrative name matches the client profile`,
      (SAMPLE_TO_PATTERN[kind] === "sub-threshold" && clientProfile.startsWith("Mild")) ||
      clientProfile.toLowerCase().includes(SAMPLE_TO_PATTERN[kind].replace("predominantly ", "")),
      clientProfile + " / " + j.pattern);
  }
}

/* ---------- 7 — input validation ---------- */

{
  const cases = [
    ["missing answers", JSON.stringify({ access: REF })],
    ["answers as an array", JSON.stringify({ answers: [], access: REF })],
    ["a missing item", JSON.stringify({ answers: { 1: 1 }, access: REF })],
    ["an out-of-range value", JSON.stringify({ answers: { ...ANSWERS, 5: 9 }, access: REF })],
    ["a negative value", JSON.stringify({ answers: { ...ANSWERS, 5: -1 }, access: REF })],
    ["a fractional value", JSON.stringify({ answers: { ...ANSWERS, 5: 1.5 }, access: REF })],
    ["a string value", JSON.stringify({ answers: { ...ANSWERS, 5: "3" }, access: REF })],
    ["malformed json", "{not json"]
  ];
  for (const [name, body] of cases) {
    const r = await post(WORKER, body);
    check("validation: " + name + " is rejected", r.status === 400, r.status);
  }

  const big = await post(WORKER, JSON.stringify({ answers: ANSWERS, pad: "x".repeat(5000), access: REF }));
  check("validation: an oversized body is rejected", big.status === 413, big.status);
}

/* ---------- 8 — CORS ---------- */

{
  const pre = await fetch(WORKER, { method: "OPTIONS", headers: { Origin: BASE } });
  check("cors: preflight is answered", pre.status === 204, pre.status);
  check("cors: the sandbox origin is allowed",
    pre.headers.get("Access-Control-Allow-Origin") === BASE,
    pre.headers.get("Access-Control-Allow-Origin"));

  const bad = await fetch(WORKER, {
    method: "OPTIONS", headers: { Origin: "https://evil.example.com" }
  });
  check("cors: an unknown origin gets no allow header",
    bad.headers.get("Access-Control-Allow-Origin") === null,
    bad.headers.get("Access-Control-Allow-Origin"));

  const r = await post(WORKER, JSON.stringify({ answers: ANSWERS, access: REF }),
    { Origin: "https://evil.example.com" });
  check("cors: a browser request from an unknown origin is refused", r.status === 403, r.status);
}

shutdown();
console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
