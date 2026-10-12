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

function makeDom({ apiEndpoint, fetchImpl, url, storedRef }) {
  const calls = [];
  const dom = new JSDOM(buildHtml(apiEndpoint), {
    url: url || "https://example.com/report.html?sample=inattentive&unlocked=1",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: quietConsole(),
    beforeParse(window) {
      window.AbortController = AbortController;
      if (storedRef) window.localStorage.setItem("focuscheck.ref", storedRef);
      window.fetch = async (u, opts) => {
        calls.push({ url: String(u), body: opts && opts.body ? JSON.parse(opts.body) : null });
        return fetchImpl();
      };
    }
  });
  return { dom, calls };
}

const tick = (ms) => new Promise(r => setTimeout(r, ms));

const okResponse = () => new Response(JSON.stringify({
  ok: true,
  scores: { positives: 4, flagged: true, inattention: 94, hyperactive: 25 },
  pattern: "predominantly inattentive",
  report: AI_REPORT
}), { status: 200, headers: { "Content-Type": "application/json" } });

/* 1 — the template report must render even with no AI at all */
{
  const { dom, calls } = makeDom({ apiEndpoint: "", fetchImpl: async () => { throw new Error("should not be called"); } });
  await tick(200);
  const d = dom.window.document;
  check("no endpoint: no network call", calls.length === 0, calls.length);
  check("no endpoint: cover rendered", d.getElementById("rpProfile").textContent.includes("Inattentive"),
    d.getElementById("rpProfile").textContent);
  check("no endpoint: interpretation rendered", d.getElementById("rpInterp").innerHTML.length > 200);
  check("no endpoint: areas rendered", d.getElementById("rpAreas").innerHTML.includes("Work and career"));
  check("no endpoint: strategies rendered", d.getElementById("rpStrategies").innerHTML.includes("Externalise everything"));
  check("no endpoint: 30-day plan rendered", d.getElementById("rpPlan").innerHTML.includes("Capture everything"));
  check("no endpoint: appendix table rendered", d.getElementById("rpTable").innerHTML.includes("<tbody>"));
  check("no endpoint: all 18 rows present", (d.getElementById("rpTable").innerHTML.match(/<tr>/g) || []).length === 19);
}

/* 2 — AI generation replaces the narrative sections */
{
  const { dom, calls } = makeDom({ apiEndpoint: "https://worker.test/", fetchImpl: okResponse });
  await tick(200);
  const d = dom.window.document;

  check("worker called once", calls.length === 1, calls.length);
  check("  posts 18 answers", Object.keys(calls[0].body.answers).length === 18);
  check("  sends demo token", calls[0].body.access === "demo", calls[0].body.access);

  const ov = d.getElementById("rpOverview").innerHTML;
  check("AI overview injected", ov.includes("AI_OVERVIEW_ONE") && ov.includes("AI_OVERVIEW_TWO"));
  check("  split into 2 paragraphs", (ov.match(/<p>/g) || []).length === 2);
  check("AI signals injected", d.getElementById("rpSignals").innerHTML.includes("AI_SIGNAL_A"));
  check("AI areas injected", d.getElementById("rpAreas").innerHTML.includes("AI_AREA_5"));
  check("AI strategies injected", d.getElementById("rpStrategies").innerHTML.includes("AI_STRAT_6"));
  check("success banner shown",
    d.getElementById("aiBanner").textContent.includes("written for your specific answers"));
  check("static sections untouched", d.getElementById("rpPlan").innerHTML.includes("Capture everything"));
}

/* 3 — upstream failure falls back to the template */
{
  const { dom } = makeDom({
    apiEndpoint: "https://worker.test/",
    fetchImpl: async () => new Response(JSON.stringify({ error: "upstream_error" }),
      { status: 502, headers: { "Content-Type": "application/json" } })
  });
  await tick(200);
  const d = dom.window.document;
  check("on 502: template overview kept", !d.getElementById("rpOverview").innerHTML.includes("AI_OVERVIEW"));
  check("on 502: template areas kept", d.getElementById("rpAreas").innerHTML.includes("Work and career"));
  check("on 502: fallback banner shown", d.getElementById("aiBanner").textContent.includes("standard version"),
    d.getElementById("aiBanner").textContent.slice(0, 80));
}

/* 4 — access denied */
{
  const { dom } = makeDom({
    apiEndpoint: "https://worker.test/",
    fetchImpl: async () => new Response(JSON.stringify({ error: "access_denied" }),
      { status: 403, headers: { "Content-Type": "application/json" } })
  });
  await tick(200);
  check("on 403: template kept", dom.window.document.getElementById("rpAreas").innerHTML.includes("Work and career"));
  check("on 403: link-expired message",
    dom.window.document.getElementById("aiBanner").textContent.includes("isn't valid"));
}

/* 5 — network failure */
{
  const { dom } = makeDom({
    apiEndpoint: "https://worker.test/",
    fetchImpl: async () => { throw new Error("network down"); }
  });
  await tick(200);
  check("on network error: fallback banner",
    dom.window.document.getElementById("aiBanner").textContent.includes("Couldn't reach"));
  check("on network error: template intact",
    dom.window.document.getElementById("rpStrategies").innerHTML.includes("Externalise everything"));
}

/* 6 — not unlocked: no call at all */
{
  const { dom, calls } = makeDom({
    apiEndpoint: "https://worker.test/",
    url: "https://example.com/report.html?sample=inattentive",
    fetchImpl: async () => { throw new Error("should not be called"); }
  });
  await tick(200);
  check("not unlocked: no network call", calls.length === 0, calls.length);
  check("not unlocked: template renders",
    dom.window.document.getElementById("rpAreas").innerHTML.includes("Work and career"));
}

/* 7 — the reference stored before checkout is used as the token */
{
  const { calls } = makeDom({
    apiEndpoint: "https://worker.test/",
    url: "https://example.com/report.html?sample=inattentive",
    storedRef: "ref_from_checkout_123",
    fetchImpl: okResponse
  });
  await tick(200);
  check("stored checkout ref used as access token",
    calls.length === 1 && calls[0].body.access === "ref_from_checkout_123",
    calls[0] && calls[0].body.access);
}

/* 8 — each sample profile renders a distinct cover */
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

/* 9 — the visual summary is driven by the real answers */
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

/* 10 — a sub-threshold sample must not be drawn as flagged */
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

/* 11 — every section gets an icon */
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

/* 12 — the share block is built and stays privacy-safe */
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

/* 13 — no report, no share block */
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
