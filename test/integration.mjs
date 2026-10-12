/*
 * End-to-end page tests — run with:  npm test
 *
 * Loads report.html in jsdom, inlines the real scripts, mocks the Worker, and
 * checks that AI content is injected and that every failure path still leaves a
 * usable report on screen.
 */
import { JSDOM, VirtualConsole } from "jsdom";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..") + path.sep;

/*
 * jsdom has no canvas backend, so every getContext() call emits a jsdomError.
 * The report now draws a share card on every render, so those are dropped here
 * rather than flooding the output. Real errors still surface.
 */
function quietConsole() {
  const vc = new VirtualConsole();
  vc.on("jsdomError", (err) => {
    if (/getContext|toBlob|toDataURL|Not implemented/.test(err.message || "")) return;
    console.error("jsdom:", err.message);
  });
  return vc;
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log("  PASS  " + name); pass++; }
  else { console.log("  FAIL  " + name + (extra ? "  -> " + String(extra).slice(0, 160) : "")); fail++; }
}

function buildHtml(apiEndpoint) {
  let html = fs.readFileSync(ROOT + "report.html", "utf8");
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
    let code = fs.readFileSync(ROOT + src, "utf8");
    if (src.endsWith("config.js")) {
      code = code.replace('API_ENDPOINT: ""', 'API_ENDPOINT: "' + apiEndpoint + '"');
    }
    return "<scr" + "ipt>" + code + "</scr" + "ipt>";
  });
  return html;
}

const AI_REPORT = {
  overview: "AI_OVERVIEW_ONE.\n\nAI_OVERVIEW_TWO.",
  signals: ["AI_SIGNAL_A", "AI_SIGNAL_B", "AI_SIGNAL_C"],
  areas: [1, 2, 3, 4, 5].map(i => ({ title: "AI_AREA_" + i, body: "AI area body " + i })),
  strategies: [1, 2, 3, 4, 5, 6].map(i => ({ title: "AI_STRAT_" + i, body: "AI strat body " + i }))
};

/*
 * A real set of answers, so a test can look like a visitor who has taken the
 * assessment without using ?sample=. Sample URLs are preview mode and skip the
 * network entirely, so they cannot exercise the paid path.
 */
const ANSWERS = {
  1: 3, 2: 3, 3: 3, 4: 3, 5: 2, 6: 2, 7: 3, 8: 3, 9: 3,
  10: 3, 11: 3, 12: 2, 13: 2, 14: 2, 15: 2, 16: 2, 17: 2, 18: 2
};

function makeDom({ apiEndpoint, fetchImpl, url, storedRef, answers }) {
  const calls = [];
  const dom = new JSDOM(buildHtml(apiEndpoint), {
    // No ?sample= by default. A sample URL is preview mode, which is unlocked
    // and never calls the network — the opposite of what these tests need.
    url: url || "https://example.com/report.html",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: quietConsole(),
    beforeParse(window) {
      window.AbortController = AbortController;
      if (answers) {
        window.localStorage.setItem("focuscheck.answers.v1", JSON.stringify(answers));
      }
      if (storedRef) window.localStorage.setItem("focuscheck.ref", storedRef);
      window.fetch = async (u, opts) => {
        calls.push({ url: String(u), body: opts && opts.body ? JSON.parse(opts.body) : null });
        return fetchImpl();
      };
    }
  });
  return { dom, calls };
}

/* True when the paid section of the report is actually in the document. */
const bodyPresent = (d) => !!d.querySelector(".rp-body");
const paywallShown = (d) => {
  const lock = d.getElementById("rpLock");
  return !!lock && !lock.classList.contains("hidden") && lock.innerHTML.length > 0;
};

const tick = (ms) => new Promise(r => setTimeout(r, ms));

const okResponse = () => new Response(JSON.stringify({
  ok: true,
  scores: { positives: 4, flagged: true, inattention: 94, hyperactive: 25 },
  pattern: "predominantly inattentive",
  report: AI_REPORT
}), { status: 200, headers: { "Content-Type": "application/json" } });

/* 1 — a visitor who has not paid gets the teaser, not the report */
{
  const { dom, calls } = makeDom({
    apiEndpoint: "",
    answers: ANSWERS,
    fetchImpl: async () => { throw new Error("should not be called"); }
  });
  await tick(200);
  const d = dom.window.document;

  check("locked: no network call without a reference", calls.length === 0, calls.length);

  // The free tier: cover and the visual summary.
  check("locked: cover rendered", d.getElementById("rpProfile").textContent.includes("Inattentive"),
    d.getElementById("rpProfile").textContent);
  check("locked: visual summary rendered", d.getElementById("rpRing").querySelectorAll("svg circle").length === 2);
  check("locked: heatmap rendered", d.getElementById("rpHm").querySelectorAll(".hm-cell").length === 6);

  // The paid tier: gone from the document, not merely hidden.
  check("locked: body is not in the DOM", !bodyPresent(d));
  check("locked: no sections in the DOM", d.querySelectorAll(".rp-sec").length === 0,
    d.querySelectorAll(".rp-sec").length);
  /*
   * Check the report container, not document.body: buildHtml() inlines every
   * script into the body, so body.textContent includes report.js's own source —
   * which of course contains this text.
   */
  const visible = d.getElementById("rpDoc").textContent;
  check("locked: no paid text in the report",
    !visible.includes("Externalise everything") && !visible.includes("Capture everything"),
    visible.slice(0, 120));
  check("locked: the appendix table is gone", !d.getElementById("rpTable"));

  check("locked: paywall shown", paywallShown(d));
  check("locked: paywall lists all seven sections",
    d.getElementById("rpLock").querySelectorAll(".lk-list li").length === 7,
    d.getElementById("rpLock").querySelectorAll(".lk-list li").length);
  check("locked: paywall offers the purchase",
    d.getElementById("rpLock").textContent.includes("$19"));
}

/* 2 — the ?unlocked=1 demo flag must not work in production config */
{
  const { dom } = makeDom({
    apiEndpoint: "",
    answers: ANSWERS,
    url: "https://example.com/report.html?unlocked=1",
    fetchImpl: async () => { throw new Error("nope"); }
  });
  await tick(200);
  check("demo flag off: ?unlocked=1 does not unlock",
    !bodyPresent(dom.window.document));
}

/* 3 — the sample previews stay fully open, for the sales pages */
{
  const { dom } = makeDom({
    apiEndpoint: "",
    url: "https://example.com/report.html?sample=inattentive",
    fetchImpl: async () => { throw new Error("nope"); }
  });
  await tick(200);
  const d = dom.window.document;
  check("preview: body present", bodyPresent(d));
  check("preview: no paywall", !paywallShown(d));
  check("preview: sections rendered", d.querySelectorAll(".rp-sec").length === 7,
    d.querySelectorAll(".rp-sec").length);
}

/* 4 — a paid order unlocks the report and gets the AI narrative */
{
  const { dom, calls } = makeDom({
    apiEndpoint: "https://worker.test/",
    answers: ANSWERS,
    storedRef: "ref_from_checkout_123",
    fetchImpl: okResponse
  });
  await tick(200);
  const d = dom.window.document;

  check("worker called once", calls.length === 1, calls.length);
  check("  posts 18 answers", Object.keys(calls[0].body.answers).length === 18);
  check("  sends the stored checkout reference", calls[0].body.access === "ref_from_checkout_123",
    calls[0] && calls[0].body.access);

  check("unlocked: body is back in the DOM", bodyPresent(d));
  check("unlocked: paywall gone", !paywallShown(d));
  check("unlocked: seven sections", d.querySelectorAll(".rp-sec").length === 7,
    d.querySelectorAll(".rp-sec").length);

  const ov = d.getElementById("rpOverview").innerHTML;
  check("AI overview injected", ov.includes("AI_OVERVIEW_ONE") && ov.includes("AI_OVERVIEW_TWO"));
  check("  split into 2 paragraphs", (ov.match(/<p>/g) || []).length === 2);
  check("AI signals injected", d.getElementById("rpSignals").innerHTML.includes("AI_SIGNAL_A"));
  check("AI areas injected", d.getElementById("rpAreas").innerHTML.includes("AI_AREA_5"));
  check("AI strategies injected", d.getElementById("rpStrategies").innerHTML.includes("AI_STRAT_6"));
  check("success banner shown",
    d.getElementById("aiBanner").textContent.includes("written for your specific answers"));
  check("static sections untouched", d.getElementById("rpPlan").innerHTML.includes("Capture everything"));
  check("unlocked: appendix back", (d.getElementById("rpTable").innerHTML.match(/<tr>/g) || []).length === 19);
}

/* 5 — a paid order whose personalisation failed still gets the report */
{
  const { dom } = makeDom({
    apiEndpoint: "https://worker.test/",
    answers: ANSWERS,
    storedRef: "ref_paid_502",
    fetchImpl: async () => new Response(JSON.stringify({ error: "upstream_error" }),
      { status: 502, headers: { "Content-Type": "application/json" } })
  });
  await tick(200);
  const d = dom.window.document;
  check("on 502: unlocked — the customer paid", bodyPresent(d));
  check("on 502: template areas present", d.getElementById("rpAreas").innerHTML.includes("Work and career"));
  check("on 502: no AI content", !d.getElementById("rpOverview").innerHTML.includes("AI_OVERVIEW"));
  check("on 502: busy banner shown", d.getElementById("aiBanner").textContent.includes("busy"),
    d.getElementById("aiBanner").textContent.slice(0, 80));
}

/* 6 — an order that cannot be matched stays locked */
{
  const { dom } = makeDom({
    apiEndpoint: "https://worker.test/",
    answers: ANSWERS,
    storedRef: "ref_not_found",
    fetchImpl: async () => new Response(JSON.stringify({ error: "access_denied" }),
      { status: 403, headers: { "Content-Type": "application/json" } })
  });
  await tick(200);
  const d = dom.window.document;
  check("on 403: still locked", !bodyPresent(d));
  check("on 403: paywall explains the missing order",
    d.getElementById("rpLock").textContent.includes("couldn't find that order"),
    d.getElementById("rpLock").textContent.slice(0, 90));
}

/* 7 — a dropped connection must not become a way past the paywall */
{
  const { dom } = makeDom({
    apiEndpoint: "https://worker.test/",
    answers: ANSWERS,
    storedRef: "ref_offline",
    fetchImpl: async () => { throw new Error("network down"); }
  });
  await tick(200);
  const d = dom.window.document;
  check("on network error: still locked", !bodyPresent(d));
  check("on network error: banner tells them to reload",
    d.getElementById("aiBanner").textContent.includes("Couldn't reach"));
}

/* 8 — no Worker configured: locked, with a reason rather than a silent blank */
{
  const { dom, calls } = makeDom({
    apiEndpoint: "",
    answers: ANSWERS,
    storedRef: "ref_no_worker",
    fetchImpl: async () => { throw new Error("should not be called"); }
  });
  await tick(200);
  const d = dom.window.document;
  check("no endpoint: no network call", calls.length === 0, calls.length);
  check("no endpoint: locked", !bodyPresent(d));
  check("no endpoint: paywall says it is unavailable",
    d.getElementById("rpLock").textContent.includes("isn't available yet"),
    d.getElementById("rpLock").textContent.slice(0, 90));
}

/* 9 — a request rejected before the access check must not unlock */
{
  const { dom } = makeDom({
    apiEndpoint: "https://worker.test/",
    answers: ANSWERS,
    storedRef: "ref_bad_request",
    fetchImpl: async () => new Response(JSON.stringify({ error: "invalid_json" }),
      { status: 400, headers: { "Content-Type": "application/json" } })
  });
  await tick(200);
  check("on 400: still locked (never reached the access check)",
    !bodyPresent(dom.window.document));
}

/* 10 — each sample profile renders a distinct cover */
for (const kind of ["inattentive", "hyperactive", "combined", "mild"]) {
  const { dom } = makeDom({
    apiEndpoint: "",
    url: "https://example.com/report.html?sample=" + kind,
    fetchImpl: async () => { throw new Error("nope"); }
  });
  await tick(200);
  const d = dom.window.document;
  check("sample=" + kind + " renders a titled report",
    d.getElementById("rpProfile").textContent.trim().length > 5 &&
    d.getElementById("rpTable").innerHTML.includes("<tbody>"),
    d.getElementById("rpProfile").textContent);
}

/* 11 — the visual summary is driven by the real answers */
{
  const { dom } = makeDom({
    apiEndpoint: "",
    url: "https://example.com/report.html?sample=inattentive",
    fetchImpl: async () => { throw new Error("nope"); }
  });
  await tick(200);
  const d = dom.window.document;

  const ring = d.getElementById("rpRing");
  check("viz: ring rendered", ring.querySelectorAll("svg circle").length === 2);
  check("viz: ring is flagged above threshold", ring.className.includes("flag"), ring.className);
  check("viz: ring shows the screener count", ring.querySelector(".ctr .big").textContent === "4/6",
    ring.querySelector(".ctr .big") && ring.querySelector(".ctr .big").textContent);
  check("viz: ring label present", ring.querySelector(".ctr .lbl").textContent === "Part A criteria");
  check("viz: ring threshold tag", ring.querySelector(".viz-ringtag").textContent === "At or above threshold",
    ring.querySelector(".viz-ringtag").textContent);

  const prog = ring.querySelector(".prog");
  const dash = parseFloat(prog.getAttribute("stroke-dasharray"));
  const off = parseFloat(prog.style.strokeDashoffset);
  check("viz: ring animated to 4/6", Math.abs(off - dash * (1 - 4 / 6)) < 0.5, off + " of " + dash);

  const dims = d.getElementById("rpDims");
  const fills = dims.querySelectorAll(".fill");
  check("viz: two dimension bars", fills.length === 2, fills.length);
  check("viz: inattention bar is 94%", fills[0].getAttribute("data-w") === "94", fills[0].getAttribute("data-w"));
  check("viz: hyperactivity bar is 25%", fills[1].getAttribute("data-w") === "25", fills[1].getAttribute("data-w"));
  check("viz: bars animated to their value",
    fills[0].style.width === "94%" && fills[1].style.width === "25%",
    fills[0].style.width + " / " + fills[1].style.width);
  check("viz: gap note explains the skew", dims.querySelector(".viz-gap").innerHTML.includes("Inattention"));

  const partA = d.getElementById("rpHm").querySelectorAll(".hm-cell");
  const partB = d.getElementById("rpHm2").querySelectorAll(".hm-cell");
  check("viz: heatmap Part A has 6 cells", partA.length === 6, partA.length);
  check("viz: heatmap Part B has 12 cells", partB.length === 12, partB.length);
  check("viz: heatmap cell 1 is Very Often", partA[0].getAttribute("data-v") === "4", partA[0].getAttribute("data-v"));
  check("viz: heatmap Part B starts at item 7", partB[0].textContent === "7", partB[0].textContent);
  check("viz: heatmap cell 13 is Never", partB[6].getAttribute("data-v") === "0", partB[6].getAttribute("data-v"));
  check("viz: heatmap cell has a readable tooltip",
    partA[0].getAttribute("title").includes("Finishing the last 10%"), partA[0].getAttribute("title"));
  check("viz: heatmap legend has 5 steps",
    d.getElementById("rpHmLegend").querySelectorAll(".lg").length === 5);
}

/* 12 — a sub-threshold sample must not be drawn as flagged */
{
  const { dom } = makeDom({
    apiEndpoint: "",
    url: "https://example.com/report.html?sample=mild",
    fetchImpl: async () => { throw new Error("nope"); }
  });
  await tick(200);
  const d = dom.window.document;
  const ring = d.getElementById("rpRing");
  check("mild: ring not flagged", !ring.className.includes("flag"), ring.className);
  const mildCount = parseInt(ring.querySelector(".ctr .big").textContent, 10);
  check("mild: ring count is below the threshold of 4", mildCount < 4,
    ring.querySelector(".ctr .big").textContent);
  check("mild: below-threshold tag", ring.querySelector(".viz-ringtag").textContent === "Below threshold");
  check("mild: gap note describes a matched pattern",
    d.getElementById("rpDims").querySelector(".viz-gap").innerHTML.includes("close together"));
}

/* 13 — every section gets an icon */
{
  const { dom } = makeDom({
    apiEndpoint: "",
    url: "https://example.com/report.html?sample=combined",
    fetchImpl: async () => { throw new Error("nope"); }
  });
  await tick(200);
  const d = dom.window.document;
  const heads = d.querySelectorAll(".rp-sec h2");
  check("icons: 7 sections", heads.length === 7, heads.length);
  check("icons: every section has one",
    Array.from(heads).every(h => h.querySelector(".ico svg")),
    Array.from(heads).map(h => h.textContent.trim().slice(0, 4)).join("|"));
}

/* 14 — the share block is built and stays privacy-safe */
{
  const { dom } = makeDom({
    apiEndpoint: "",
    url: "https://example.com/report.html?sample=inattentive",
    fetchImpl: async () => { throw new Error("nope"); }
  });
  await tick(200);
  const d = dom.window.document;
  const share = d.getElementById("rpShare");

  check("share: block rendered", share.innerHTML.length > 400);
  check("share: canvas present", !!d.getElementById("shCanvas"));
  check("share: download button", !!d.getElementById("shDownload"));
  check("share: copy image button", !!d.getElementById("shCopyImg"));
  check("share: copy link button", !!d.getElementById("shCopyLink"));
  check("share: 5 networks offered", share.querySelectorAll("[data-net]").length === 5,
    share.querySelectorAll("[data-net]").length);
  check("share: marked no-print", share.className.includes("no-print"), share.className);

  const S = dom.window.FocusCheckShare;
  check("share: module exposed", !!S);
  const text = S.shareText(S.getData());
  check("share: text names the profile", text.includes("Inattentive"), text);
  check("share: text carries no percentages", !text.includes("%"), text);
  check("share: text carries no per-item answers", !/item\s*\d/i.test(text), text);

  const leaked = share.innerHTML.replace(/<canvas[\s\S]*?<\/canvas>/g, "");
  check("share: block leaks no scores", !leaked.includes("94%") && !leaked.includes("25%"), leaked.slice(0, 120));
  check("share: site url derived from the page", S.siteUrl() === "https://example.com", S.siteUrl());
}

/* 15 — no report, no share block */
{
  const { dom } = makeDom({
    apiEndpoint: "",
    url: "https://example.com/report.html",
    fetchImpl: async () => { throw new Error("nope"); }
  });
  await tick(200);
  const d = dom.window.document;
  check("empty state: share block left empty", d.getElementById("rpShare").innerHTML === "",
    d.getElementById("rpShare").innerHTML.slice(0, 60));
  check("empty state: no ring drawn", d.getElementById("rpRing").innerHTML === "");
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
