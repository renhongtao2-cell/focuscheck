#!/usr/bin/env node
/*
 * Full paid-flow check — the whole customer journey, in a real browser.
 *
 * Boots the sandbox (tools/dev-server.mjs) and drives headless Chrome through:
 *   test.html -> 18 answers -> results.html -> Unlock -> Pay
 *   -> sandbox checkout -> signed webhook -> back to report.html
 *   -> the report unlocks and the AI narrative replaces the template
 *
 * Everything in that chain is real except the payment provider and the LLM,
 * both of which the sandbox stands in for. This is the only place the
 * browser-side half of the payment loop gets exercised: the reference stored
 * before checkout, and report-ai.js picking it up again on the way back.
 *
 *   node tools/pay-check.mjs
 *   CHROME=/path/to/chrome node tools/pay-check.mjs
 */
import { spawn } from "child_process";
import fs from "fs";

const PORT = Number(process.env.PORT || 8798);
const CDP_PORT = Number(process.env.CDP_PORT || 9334);
const BASE = `http://localhost:${PORT}`;

const CANDIDATES = [
  process.env.CHROME,
  process.env.CHROME_PATH,
  "C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium"
].filter(Boolean);
const CHROME = CANDIDATES.find(p => { try { return fs.existsSync(p); } catch { return false; } });
if (!CHROME) {
  console.error("No Chrome/Chromium found. Set CHROME=/path/to/chrome and retry.");
  process.exit(2);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

let sandbox = spawn(process.execPath, ["tools/dev-server.mjs"], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"]
});
let sandboxLog = "";
sandbox.stdout.on("data", d => { sandboxLog += d; });
sandbox.stderr.on("data", d => { sandboxLog += d; });

let chrome = null;
function cleanup() {
  try { chrome && chrome.kill(); } catch (e) {}
  try { sandbox.kill(); } catch (e) {}
}
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(130); });

const results = [];
function log(name, ok, detail) {
  results.push({ name, ok });
  console.log((ok ? "  PASS  " : "  FAIL  ") + name + (ok ? "" : "  -> " + JSON.stringify(detail)));
}

try {
  await run();
} catch (err) {
  console.error("\nHarness error: " + err.message);
  if (sandboxLog) console.error(sandboxLog.slice(-800));
  cleanup();
  process.exit(2);
}

async function run() {
  /* ---- boot the sandbox ---- */
  let up = false;
  for (let i = 0; i < 80 && !up; i++) {
    try { up = (await fetch(BASE + "/worker/health")).ok; } catch (e) {}
    if (!up) await sleep(150);
  }
  if (!up) throw new Error("sandbox never came up");
  await fetch(BASE + "/__pay/reset");

  /* ---- boot chrome ---- */
  chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${CDP_PORT}`, "about:blank"
  ], { stdio: "ignore" });

  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
      const page = list.find(t => t.type === "page");
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch (e) {}
    if (!wsUrl) await sleep(250);
  }
  if (!wsUrl) throw new Error("the DevTools endpoint never came up");

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

  let nextId = 1;
  const pending = new Map();
  const pageErrors = [];
  const consoleErrors = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Runtime.exceptionThrown") {
      pageErrors.push(m.params.exceptionDetails?.exception?.description ||
                      m.params.exceptionDetails?.text || "unknown");
    }
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      consoleErrors.push(m.params.args.map(a => a.value || a.description || "").join(" "));
    }
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  };
  const send = (method, params = {}) => {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  };
  async function evaluate(expression, awaitPromise = false) {
    const r = await send("Runtime.evaluate", {
      expression, awaitPromise, returnByValue: true, userGesture: true
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
    }
    return r.result.value;
  }

  /*
   * Run an expression that is expected to navigate. The navigation tears the
   * execution context down mid-call, so CDP reports "navigated or closed" —
   * which is the outcome we wanted, not an error.
   */
  async function evaluateNavigating(expression, awaitPromise = false) {
    try {
      return await evaluate(expression, awaitPromise);
    } catch (e) {
      if (/navigated or closed/i.test(e.message)) return null;
      throw e;
    }
  }
  async function goto(url) {
    await send("Page.navigate", { url });
    for (let i = 0; i < 100; i++) {
      await sleep(200);
      try { if (await evaluate("document.readyState") === "complete") return; } catch (e) {}
    }
    throw new Error("page never loaded: " + url);
  }
  async function waitFor(expr, label, timeout = 15000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      try { if (await evaluate(expr)) return true; } catch (e) {}
      await sleep(200);
    }
    console.log("      (timed out waiting for " + label + ")");
    return false;
  }

  await send("Page.enable");
  await send("Runtime.enable");

  console.log("\nPaid flow, end to end, against " + BASE + "\n");

  /* ---- 1. the sandbox serves a site wired to itself ---- */
  await goto(BASE + "/results.html");
  const cfg = await evaluate(`(() => ({
    api: window.FOCUSCHECK_CONFIG.API_ENDPOINT,
    checkout: window.FOCUSCHECK_CONFIG.CHECKOUT_URL,
    demo: window.FOCUSCHECK_CONFIG.ALLOW_DEMO_UNLOCK
  }))()`);
  log("config: worker endpoint points at the sandbox", cfg.api === BASE + "/worker", cfg.api);
  log("config: checkout points at the sandbox provider", cfg.checkout === BASE + "/__pay/checkout", cfg.checkout);
  log("config: demo unlock is off, so only a paid ref works", cfg.demo === false, cfg.demo);

  /* ---- 2. answer the assessment ---- */
  await goto(BASE + "/test.html");
  await evaluateNavigating(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    for (let k = 0; k < 18; k++) {
      const opts = document.getElementById('opts').children;
      opts[(k === 4 || k === 5) ? 2 : 3].click();   // exactly 4 of 6 criteria
      await sleep(320);
    }
  })()`, true);
  await waitFor("location.pathname.endsWith('/results.html') && document.readyState === 'complete'",
    "results.html");
  await waitFor("!document.getElementById('content').classList.contains('hidden')", "results to render");
  log("flow: assessment completed and scored",
    await evaluate("document.getElementById('scoreBig').textContent") === "4");

  /* ---- 3. the report is locked before payment ---- */
  await goto(BASE + "/report.html");
  await sleep(500);
  const locked = await evaluate(`(() => ({
    doc: !document.getElementById('rpDoc').classList.contains('hidden'),
    overview: document.getElementById('rpOverview').innerHTML,
    ai: document.getElementById('rpOverview').innerHTML.includes('MOCK_OVERVIEW'),
    banner: document.getElementById('aiBanner').textContent.trim(),
    ref: localStorage.getItem('focuscheck.ref')
  }))()`);
  log("locked: the template report still renders", locked.doc === true, locked.doc);
  log("locked: no AI content before payment", locked.ai === false, locked.ai);
  log("locked: no order reference stored yet", locked.ref === null, locked.ref);

  /* ---- 4. unlock -> sandbox checkout -> pay ---- */
  await goto(BASE + "/results.html");
  await sleep(400);
  await evaluate("document.querySelector('[data-open-checkout]').click()");
  log("checkout: the modal opens", await evaluate("document.getElementById('checkout').classList.contains('open')"));

  await evaluateNavigating("document.getElementById('payBtn').click()");
  await waitFor("location.pathname.startsWith('/__pay/checkout')", "the sandbox checkout page");
  const atCheckout = await evaluate(`(() => {
    // The parameter name depends on the provider, so look for the value itself.
    const values = [...new URLSearchParams(location.search).values()];
    return {
      path: location.pathname,
      query: location.search,
      ref: values.find(v => /^[0-9a-f]{32}$/.test(v)) || null,
      stored: localStorage.getItem('focuscheck.ref')
    };
  })()`);
  log("checkout: redirected to the provider with a reference",
    !!atCheckout.ref, atCheckout.query);
  log("checkout: the same reference is stored in the browser",
    atCheckout.stored === atCheckout.ref, atCheckout.stored + " vs " + atCheckout.ref);

  await evaluateNavigating("document.querySelector('button').click()");   // Pay $19.00
  await waitFor("location.pathname.endsWith('/report.html')", "the redirect back to the report");

  /* ---- 5. the report unlocks with AI content ---- */
  const unlocked = await waitFor(
    "document.getElementById('rpOverview').innerHTML.includes('MOCK_OVERVIEW')",
    "the AI narrative to be injected");

  const after = await evaluate(`(() => ({
    overview: document.getElementById('rpOverview').innerHTML,
    signals: document.getElementById('rpSignals').innerHTML,
    areas: document.getElementById('rpAreas').innerHTML,
    strategies: document.getElementById('rpStrategies').innerHTML,
    banner: document.getElementById('aiBanner').textContent.trim(),
    profile: document.getElementById('rpProfile').textContent,
    ring: document.querySelectorAll('#rpRing svg circle').length,
    share: document.getElementById('shCanvas') ? document.getElementById('shCanvas').width : 0
  }))()`);

  log("unlocked: the AI narrative replaced the template", unlocked === true, after.overview.slice(0, 80));
  log("unlocked: the overview has both paragraphs",
    after.overview.includes("MOCK_OVERVIEW_PARAGRAPH_ONE") &&
    after.overview.includes("MOCK_OVERVIEW_PARAGRAPH_TWO"));
  log("unlocked: AI signals injected", after.signals.includes("MOCK_SIGNAL_ONE"));
  log("unlocked: AI areas injected", after.areas.includes("MOCK_AREA_Wellbeing"));
  log("unlocked: AI strategies injected", after.strategies.includes("MOCK_STRATEGY_6"));
  log("unlocked: the success banner is shown",
    after.banner.includes("written for your specific answers"), after.banner.slice(0, 60));
  log("unlocked: the visual summary still renders", after.ring === 2, after.ring);
  log("unlocked: the share card still renders", after.share === 1080, after.share);

  /* ---- 6. the server saw exactly one paid order and one generation ---- */
  const st = await (await fetch(BASE + "/__pay/state")).json();
  log("server: exactly one order recorded", st.orders.length === 1, JSON.stringify(st.orders));
  log("server: the order matches the browser reference",
    st.orders.length === 1 && st.orders[0].key === "order:" + atCheckout.ref,
    st.orders.map(o => o.key).join(","));
  log("server: the LLM was called once", st.llmCalls === 1, st.llmCalls);

  /* ---- 7. a fresh visitor without a reference gets nothing ---- */
  await evaluate("localStorage.clear()");
  await goto(BASE + "/report.html");
  await sleep(600);
  log("gated: clearing the reference hides the report",
    await evaluate("!document.getElementById('rpDoc').classList.contains('hidden')") === false);

  /* ---- 8. cleanliness ---- */
  log("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3));
  log("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3));

  const failed = results.filter(r => !r.ok);
  console.log("\n" + (results.length - failed.length) + " passed, " + failed.length + " failed\n");

  ws.close();
  cleanup();
  process.exit(failed.length ? 1 : 0);
}
