#!/usr/bin/env node
/*
 * Live deployment check — drives the deployed site in a real browser.
 *
 * The jsdom suites in test/ cover the logic; this one answers a different
 * question: "is the thing I just deployed actually working?" It launches
 * headless Chrome over the DevTools Protocol, walks the free assessment
 * end to end, opens the checkout modal, and inspects the rendered report.
 *
 *   node tools/live-check.mjs
 *   BASE_URL=https://example.com/ node tools/live-check.mjs
 *   PROXY=http://127.0.0.1:10809 node tools/live-check.mjs   # if you need one
 *   CHROME="/path/to/chrome" node tools/live-check.mjs
 *
 * Exit code is non-zero if any check fails, so it can gate a deploy.
 */
import { spawn } from "child_process";

const BASE = (process.env.BASE_URL || "https://renhongtao2-cell.github.io/focuscheck").replace(/\/+$/, "");
const PROXY = process.env.PROXY || "";
const PORT = Number(process.env.CDP_PORT || 9333);

const CANDIDATES = [
  process.env.CHROME,
  process.env.CHROME_PATH,
  "C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium"
].filter(Boolean);

const fs = await import("fs");
const CHROME = CANDIDATES.find(p => { try { return fs.existsSync(p); } catch { return false; } });
if (!CHROME) {
  console.error("No Chrome/Chromium found. Set CHROME=/path/to/chrome and retry.");
  process.exit(2);
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const args = [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--remote-debugging-port=" + PORT, "about:blank"
];
if (PROXY) args.splice(1, 0, "--proxy-server=" + PROXY, "--proxy-bypass-list=127.0.0.1;localhost");

const chrome = spawn(CHROME, args, { stdio: "ignore" });

let ws;
try {
  ws = await connect();
  await run();
} catch (err) {
  console.error("\nHarness error: " + err.message);
  chrome.kill();
  process.exit(2);
}

async function connect() {
  let wsUrl = null;
  for (let i = 0; i < 60 && !wsUrl; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find(t => t.type === "page");
      if (page) wsUrl = page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    if (!wsUrl) await sleep(250);
  }
  if (!wsUrl) throw new Error("the DevTools endpoint never came up");

  const sock = new WebSocket(wsUrl);
  await new Promise((res, rej) => { sock.onopen = res; sock.onerror = rej; });
  return sock;
}

async function run() {
  let nextId = 1;
  const pending = new Map();
  const pageErrors = [];
  const consoleErrors = [];

  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method === "Runtime.exceptionThrown") {
      pageErrors.push(msg.params.exceptionDetails?.exception?.description ||
                      msg.params.exceptionDetails?.text || "unknown");
    }
    if (msg.method === "Runtime.consoleAPICalled" && msg.params.type === "error") {
      consoleErrors.push(msg.params.args.map(a => a.value || a.description || "").join(" "));
    }
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  };

  function send(method, params = {}) {
    const id = nextId++;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }

  async function evaluate(expression, awaitPromise = false) {
    const r = await send("Runtime.evaluate", {
      expression, awaitPromise, returnByValue: true, userGesture: true
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails));
    }
    return r.result.value;
  }

  async function goto(url) {
    await send("Page.navigate", { url });
    for (let i = 0; i < 100; i++) {
      await sleep(200);
      try { if (await evaluate("document.readyState") === "complete") return; } catch { /* in flight */ }
    }
    throw new Error("page never finished loading: " + url);
  }

  /** Poll until truthy — safe across navigations, which tear down the context. */
  async function waitFor(expr, label = expr, timeout = 12000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try { if (await evaluate(expr)) return true; } catch { /* context gone */ }
      await sleep(200);
    }
    console.log("      (timed out waiting for " + label + ")");
    return false;
  }

  const results = [];
  const log = (name, ok, detail) => {
    results.push({ name, ok, detail });
    console.log((ok ? "  PASS  " : "  FAIL  ") + name + (ok ? "" : "  -> " + JSON.stringify(detail)));
  };

  await send("Page.enable");
  await send("Runtime.enable");

  console.log("\nChecking " + BASE + "\n");

  /* ---- free flow ---- */
  await goto(BASE + "/test.html");
  log("test.html: script populated the first question",
    await evaluate("document.getElementById('qText').textContent.length > 40"));
  log("test.html: five response options",
    await evaluate("document.getElementById('opts').children.length") === 5);

  const walk = await evaluate(`(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const seen = [];
    for (let k = 0; k < 18; k++) {
      seen.push(document.getElementById('count').textContent);
      const opts = document.getElementById('opts').children;
      // items 1-4 "Often" -> positive; items 5-6 "Sometimes" -> not.
      // Exactly 4 of 6, so this lands on the screening threshold.
      opts[(k === 4 || k === 5) ? 2 : 3].click();
      await sleep(320);
    }
    return { seen: seen.join(','), saved: localStorage.getItem('focuscheck.answers.v1') };
  })()`, true);

  log("test.html: advanced through all 18 in order",
    walk.seen === Array.from({ length: 18 }, (_, i) => `${i + 1} of 18`).join(','),
    walk.seen.slice(0, 40));
  log("test.html: all 18 answers persisted",
    Object.keys(JSON.parse(walk.saved || "{}")).length === 18);

  await waitFor("location.pathname.endsWith('/results.html') && document.readyState === 'complete'",
    "results.html to load");
  await waitFor("!document.getElementById('content').classList.contains('hidden')",
    "the results to render");
  await waitFor("document.getElementById('barInatt').style.width !== ''",
    "the score bars to animate");

  const res = await evaluate(`(() => ({
    score: document.getElementById('scoreBig').textContent,
    title: document.getElementById('resTitle').textContent,
    para: document.getElementById('resPara').textContent,
    badge: document.getElementById('badge').className,
    inatt: document.getElementById('valInatt').textContent,
    barW: document.getElementById('barInatt').style.width
  }))()`);

  log("results.html: scored 4 of 6 at the threshold", res.score === "4", res.score);
  log("results.html: flagged copy shown",
    res.title.includes("consistent with ADHD symptoms"), res.title);
  log("results.html: copy quotes the criteria count", res.para.includes("4 of 6"), res.para.slice(0, 60));
  log("results.html: badge carries the flag class", res.badge.includes("flag"), res.badge);
  log("results.html: score bar animated to its value", res.barW === res.inatt,
    res.barW + " vs " + res.inatt);

  /* ---- checkout modal ---- */
  const modal = await evaluate(`(() => {
    document.querySelector('[data-open-checkout]').click();
    const open = document.getElementById('checkout').classList.contains('open');
    document.getElementById('payBtn').click();
    return { open,
      note: !document.getElementById('demoNote').classList.contains('hidden'),
      stillHere: location.pathname.endsWith('/results.html'),
      ref: localStorage.getItem('focuscheck.ref') };
  })()`);
  log("checkout: the Unlock button opens the modal", modal.open, modal.open);
  log("checkout: explains payment is not connected yet", modal.note, modal.note);
  log("checkout: no redirect while CHECKOUT_URL is empty", modal.stillHere, modal.stillHere);
  log("checkout: no order reference stored", modal.ref === null, modal.ref);

  /* ---- report page ---- */
  await evaluate("localStorage.removeItem('focuscheck.answers.v1')");
  await goto(BASE + "/report.html");
  await sleep(700);
  log("report.html: shows the empty state with no answers",
    await evaluate("!document.getElementById('rpEmpty').classList.contains('hidden')"));
  log("report.html: no share card built without a report",
    await evaluate("!document.getElementById('shCanvas')"));

  /*
   * The paywall. A visitor who has taken the assessment but not paid must not
   * receive the written report — this is the regression guard for the bug where
   * report.html rendered all seven sections for anyone who opened it.
   */
  await evaluate(`localStorage.setItem('focuscheck.answers.v1', JSON.stringify({
    1:3,2:3,3:3,4:3,5:2,6:2,7:3,8:3,9:3,10:3,11:3,12:2,13:2,14:2,15:2,16:2,17:2,18:2
  }))`);
  await goto(BASE + "/report.html");
  await sleep(700);
  const gated = await evaluate(`(() => ({
    body: !!document.querySelector('.rp-body'),
    sections: document.querySelectorAll('.rp-sec').length,
    paywall: (function () {
      var l = document.getElementById('rpLock');
      return l && !l.classList.contains('hidden') ? l.textContent : '';
    })(),
    ring: document.querySelectorAll('#rpRing svg circle').length
  }))()`);
  log("report.html: unpaid visitor does not get the written report", gated.body === false, gated.body);
  log("report.html: unpaid visitor sees no sections", gated.sections === 0, gated.sections);
  log("report.html: unpaid visitor sees the paywall", gated.paywall.indexOf('$19') > -1,
    gated.paywall.slice(0, 60));
  log("report.html: the free summary is still shown", gated.ring === 2, gated.ring);
  await evaluate("localStorage.clear()");

  /*
   * ?sample= must NOT unlock on a published host. It is a local preview; if it
   * worked here, one guessed query string plus the Download PDF button would
   * give away the entire paid report.
   */
  await goto(BASE + "/report.html?sample=combined");
  await sleep(1200);
  const sampleOnLive = await evaluate(`(() => ({
    body: !!document.querySelector('.rp-body'),
    sections: document.querySelectorAll('.rp-sec').length,
    paywall: (function () {
      var l = document.getElementById('rpLock');
      return l && !l.classList.contains('hidden') ? l.textContent : '';
    })(),
    ring: document.querySelectorAll('#rpRing svg circle').length,
    cellsA: document.querySelectorAll('#rpHm .hm-cell').length,
    cellsB: document.querySelectorAll('#rpHm2 .hm-cell').length,
    shareW: document.getElementById('shCanvas')?.width || 0,
    nets: document.querySelectorAll('[data-net]').length
  }))()`);
  log("report.html: ?sample= does not unlock on the live host", sampleOnLive.body === false,
    sampleOnLive.body);
  log("report.html: ?sample= on the live host gets the paywall",
    sampleOnLive.paywall.indexOf('$19') > -1, sampleOnLive.paywall.slice(0, 60));
  log("report.html: ?sample= on the live host gets no sections",
    sampleOnLive.sections === 0, sampleOnLive.sections);
  log("report.html: free tier still renders there", sampleOnLive.ring === 2, sampleOnLive.ring);
  log("report.html: heatmap is 6 + 12 cells", sampleOnLive.cellsA === 6 && sampleOnLive.cellsB === 12,
    sampleOnLive.cellsA + " + " + sampleOnLive.cellsB);
  log("report.html: share card drawn at 1080px", sampleOnLive.shareW === 1080, sampleOnLive.shareW);
  log("report.html: five share targets", sampleOnLive.nets === 5, sampleOnLive.nets);

  /* ---- content page ---- */
  await goto(BASE + "/adhd-inattentive-type.html");
  const art = await evaluate(`(() => ({
    h1: document.querySelector('h1').textContent.trim(),
    og: document.querySelector('meta[property="og:image"]').getAttribute('content'),
    sibling: !!document.querySelector('a[href="adhd-combined-type.html"]')
  }))()`);
  log("article page: h1 renders", art.h1.length > 20, art.h1);
  log("article page: og:image is absolute", /^https:\/\//.test(art.og), art.og);
  log("article page: links to sibling articles", art.sibling === true, art.sibling);

  /* ---- runtime cleanliness ---- */
  log("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3));
  log("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3));

  const failed = results.filter(r => !r.ok);
  console.log("\n" + (results.length - failed.length) + " passed, " + failed.length + " failed\n");

  ws.close();
  chrome.kill();
  process.exit(failed.length ? 1 : 0);
}
