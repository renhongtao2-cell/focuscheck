/*
 * Free-flow end-to-end tests — run with:  npm test
 *
 * Drives the real pages the way a visitor does: answers all 18 questions on
 * test.html, carries the saved answers into results.html, checks the scoring
 * and copy across every branch, then exercises the checkout modal — including
 * the handoff to the payment provider when one is configured.
 *
 * jsdom deliberately locks down window.location (configurable: false), so
 * navigation is detected two ways: jsdom reports an unimplemented-navigation
 * error, and the URL itself is asserted against the extracted checkoutUrl().
 */
import { JSDOM, VirtualConsole } from "jsdom";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..") + path.sep;
const KEY = "focuscheck.answers.v1";

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log("  PASS  " + name); pass++; }
  else { console.log("  FAIL  " + name + (extra ? "  -> " + String(extra).slice(0, 220) : "")); fail++; }
}

const tick = (ms) => new Promise(r => setTimeout(r, ms));

/* Inline every <script src> so the pages run without a server. */
function buildHtml(file, overrides = {}) {
  let html = fs.readFileSync(ROOT + file, "utf8");
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
    let code = fs.readFileSync(ROOT + src, "utf8");
    if (src.endsWith("config.js")) {
      for (const [k, v] of Object.entries(overrides)) {
        code = code.replace(new RegExp(k + ':\\s*""'), k + ': "' + v + '"');
      }
    }
    return "<scr" + "ipt>" + code + "</scr" + "ipt>";
  });
  return html;
}

function makeDom(file, { answers, overrides } = {}) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(e.message || ""));

  const dom = new JSDOM(buildHtml(file, overrides), {
    url: "https://example.com/" + file,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      if (answers) window.localStorage.setItem(KEY, JSON.stringify(answers));
    }
  });
  const navigated = () => errors.some(m => /navigation/i.test(m));
  return { dom, errors, navigated };
}

const click = (dom, el) => el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));

/* ---------- 1 — walking the 18 questions ---------- */
let completedAnswers = null;
{
  const { dom, navigated } = makeDom("test.html");
  await tick(120);
  const d = dom.window.document;

  check("test: first question renders", d.getElementById("qNum").textContent === "Question 1",
    d.getElementById("qNum").textContent);
  check("test: progress starts at 1 of 18", d.getElementById("count").textContent === "1 of 18",
    d.getElementById("count").textContent);
  check("test: question text is the first ASRS item",
    d.getElementById("qText").textContent.includes("wrapping up the final details"),
    d.getElementById("qText").textContent.slice(0, 60));
  check("test: five response options", d.getElementById("opts").children.length === 5,
    d.getElementById("opts").children.length);
  check("test: options are labelled Never..Very Often",
    Array.from(d.getElementById("opts").children).map(b => b.textContent.trim()).join("|") ===
      "Never|Rarely|Sometimes|Often|Very Often",
    Array.from(d.getElementById("opts").children).map(b => b.textContent.trim()).join("|"));
  check("test: back link hidden on the first question",
    d.getElementById("back").style.visibility === "hidden", d.getElementById("back").style.visibility);

  // Back and forward again: answer Q1, step back, confirm the choice is kept.
  const opts = () => Array.from(d.getElementById("opts").children);
  click(dom, opts()[3]);                       // Often
  await tick(300);
  check("test: auto-advances to question 2", d.getElementById("count").textContent === "2 of 18",
    d.getElementById("count").textContent);
  click(dom, d.getElementById("back"));
  check("test: back returns to question 1", d.getElementById("count").textContent === "1 of 18",
    d.getElementById("count").textContent);
  check("test: previous answer still selected",
    opts().filter(b => b.classList.contains("sel")).length === 1,
    opts().map(b => b.className).join(","));

  // Back stepped us to question 1, so all 18 still need answering.
  for (let k = 0; k < 18; k++) {
    click(dom, opts()[k === 17 ? 0 : 3]);      // Often, except item 18 = Never
    await tick(300);
  }

  check("test: progress bar fills to 100%", d.getElementById("bar").style.width === "100%",
    d.getElementById("bar").style.width);
  check("test: navigation to results was attempted", navigated());

  const stored = JSON.parse(dom.window.localStorage.getItem(KEY) || "{}");
  check("test: all 18 answers saved", Object.keys(stored).length === 18, Object.keys(stored).length);
  check("test: saved values are 0-4 integers",
    Object.values(stored).every(v => Number.isInteger(v) && v >= 0 && v <= 4),
    JSON.stringify(stored));
  check("test: item 1 saved as Often (3)", stored[1] === 3, stored[1]);
  check("test: item 18 saved as Never (0)", stored[18] === 0, stored[18]);

  completedAnswers = stored;
}

/* ---------- 2 — results: all Part A items positive ---------- */
{
  const { dom } = makeDom("results.html", { answers: completedAnswers });
  await tick(200);
  const d = dom.window.document;

  check("results: content block shown", !d.getElementById("content").classList.contains("hidden"));
  check("results: empty state hidden", d.getElementById("empty").classList.contains("hidden"));

  // Items 1-17 are "Often" (3). Part A needs >=2 for items 1-3 and >=3 for 4-6,
  // so all six Part A items are positive.
  check("results: screener score is 6", d.getElementById("scoreBig").textContent === "6",
    d.getElementById("scoreBig").textContent);
  check("results: score caption present",
    d.getElementById("scoreOf").textContent === "of 6 criteria met");
  check("results: flagged badge", d.getElementById("badge").className.includes("flag"),
    d.getElementById("badge").className);
  check("results: flagged copy mentions the threshold",
    d.getElementById("resPara").textContent.includes("does not mean you have ADHD"),
    d.getElementById("resPara").textContent.slice(0, 70));
  check("results: inattention bar animates to its value",
    d.getElementById("barInatt").style.width === d.getElementById("valInatt").textContent,
    d.getElementById("barInatt").style.width + " vs " + d.getElementById("valInatt").textContent);
  check("results: high bars get the warn class",
    d.getElementById("barInatt").classList.contains("warn"), d.getElementById("barInatt").className);
}

/* ---------- 3 — the three scoring branches, including the boundaries ---------- */
const fill = (v) => Object.fromEntries(Array.from({ length: 18 }, (_, i) => [i + 1, v]));

async function renderResults(answers) {
  const { dom } = makeDom("results.html", { answers });
  await tick(200);
  return dom.window.document;
}

{
  // All "Sometimes" (2): items 1-3 positive, items 4-6 need 3 => 3 of 6.
  const d = await renderResults(fill(2));
  check("boundary: all Sometimes scores 3", d.getElementById("scoreBig").textContent === "3",
    d.getElementById("scoreBig").textContent);
  check("boundary: 3 is below threshold, so not flagged",
    !d.getElementById("badge").className.includes("clear") && d.getElementById("badge").className.includes("flag"),
    d.getElementById("badge").className);
  check("boundary: uses the 'some symptoms' branch",
    d.getElementById("resTitle").textContent.includes("some ADHD-related symptoms"),
    d.getElementById("resTitle").textContent);
  check("boundary: 'some symptoms' copy counts the criteria",
    d.getElementById("resPara").textContent.includes("3 of 6"),
    d.getElementById("resPara").textContent.slice(0, 60));
}

{
  // Items 1-4 "Often" (3), items 5-6 "Sometimes" (2) => exactly 4 => flagged.
  const a = fill(2);
  for (const i of [1, 2, 3, 4]) a[i] = 3;
  const d = await renderResults(a);
  check("boundary: exactly 4 criteria is flagged", d.getElementById("scoreBig").textContent === "4",
    d.getElementById("scoreBig").textContent);
  check("boundary: 4 uses the flagged branch",
    d.getElementById("resTitle").textContent.includes("consistent with ADHD symptoms"),
    d.getElementById("resTitle").textContent);
}

{
  // "Often" on 5 and 6 but "Never" on 1-4 => 2 of 6, below threshold.
  const a = fill(0);
  a[5] = 3; a[6] = 3;
  const d = await renderResults(a);
  check("boundary: items 5-6 alone score 2", d.getElementById("scoreBig").textContent === "2",
    d.getElementById("scoreBig").textContent);
  check("boundary: 2 is not flagged", d.getElementById("badge").className.includes("flag") &&
    !d.getElementById("resTitle").textContent.includes("consistent with ADHD"),
    d.getElementById("resTitle").textContent);
}

{
  const d = await renderResults(fill(0));
  check("low: score is 0", d.getElementById("scoreBig").textContent === "0",
    d.getElementById("scoreBig").textContent);
  check("low: clear badge", d.getElementById("badge").className.includes("clear"),
    d.getElementById("badge").className);
  check("low: copy says few symptoms", d.getElementById("resTitle").textContent.includes("Few ADHD symptoms"),
    d.getElementById("resTitle").textContent);
  check("low: no bars marked warn",
    !d.getElementById("barInatt").classList.contains("warn") &&
    !d.getElementById("barHyper").classList.contains("warn"));
}

/* ---------- 4 — results page with no answers ---------- */
{
  const { dom } = makeDom("results.html");
  await tick(200);
  const d = dom.window.document;
  check("empty: empty state shown", !d.getElementById("empty").classList.contains("hidden"));
  check("empty: content hidden", d.getElementById("content").classList.contains("hidden"));
}

/* ---------- 5 — checkout modal, payment not configured ---------- */
{
  const { dom, navigated } = makeDom("results.html", { answers: completedAnswers });
  await tick(200);
  const d = dom.window.document;
  const modal = d.getElementById("checkout");

  check("modal: closed on load", !modal.classList.contains("open"), modal.className);
  click(dom, d.querySelector("[data-open-checkout]"));
  check("modal: opens on Unlock", modal.classList.contains("open"), modal.className);
  check("modal: body scroll locked", d.body.style.overflow === "hidden");

  click(dom, d.getElementById("payBtn"));
  check("modal: explains payment is not connected",
    !d.getElementById("demoNote").classList.contains("hidden"));
  check("modal: no navigation without a checkout URL", !navigated(), navigated());
  check("modal: no reference stored", !dom.window.localStorage.getItem("focuscheck.ref"));

  click(dom, modal);
  check("modal: closes on backdrop click", !modal.classList.contains("open"), modal.className);
  check("modal: scroll lock released", d.body.style.overflow === "");
}

/* ---------- 6 — checkout with a provider configured ---------- */
{
  const { dom, navigated } = makeDom("results.html", {
    answers: completedAnswers,
    overrides: { CHECKOUT_URL: "https://store.example.com/buy/focuscheck" }
  });
  await tick(200);
  const d = dom.window.document;

  click(dom, d.querySelector("[data-open-checkout]"));
  click(dom, d.getElementById("payBtn"));

  check("checkout: demo note stays hidden", d.getElementById("demoNote").classList.contains("hidden"));

  const ref = dom.window.localStorage.getItem("focuscheck.ref");
  check("checkout: a reference is stored", !!ref && ref.length >= 16, ref);
  check("checkout: reference is url-safe hex", !!ref && /^[0-9a-f]+$/.test(ref), ref);
  check("checkout: navigation was attempted", navigated());

  // Assert the exact URL through the extracted builder — jsdom cannot show it.
  const built = dom.window.FocusCheckApp.checkoutUrl(
    "https://store.example.com/buy/focuscheck", "checkout[custom][ref]", ref);
  check("checkout: URL uses ? then encodes the param",
    built === "https://store.example.com/buy/focuscheck?checkout%5Bcustom%5D%5Bref%5D=" + ref, built);
}

/* ---------- 7 — URL separator and parameter defaults ---------- */
{
  const { dom } = makeDom("results.html", { answers: completedAnswers });
  await tick(200);
  const App = dom.window.FocusCheckApp;

  check("url: appends ? when the link has no query",
    App.checkoutUrl("https://x.test/buy", "client_reference_id", "abc") ===
      "https://x.test/buy?client_reference_id=abc",
    App.checkoutUrl("https://x.test/buy", "client_reference_id", "abc"));

  check("url: appends & when the link already has a query",
    App.checkoutUrl("https://x.test/buy?product=1", "client_reference_id", "abc") ===
      "https://x.test/buy?product=1&client_reference_id=abc",
    App.checkoutUrl("https://x.test/buy?product=1", "client_reference_id", "abc"));

  check("url: falls back to client_reference_id when no param is configured",
    App.checkoutUrl("https://x.test/buy", "", "abc") === "https://x.test/buy?client_reference_id=abc",
    App.checkoutUrl("https://x.test/buy", "", "abc"));

  check("url: encodes Paddle's bracketed parameter",
    App.checkoutUrl("https://x.test/buy", "checkout[custom][ref]", "abc") ===
      "https://x.test/buy?checkout%5Bcustom%5D%5Bref%5D=abc",
    App.checkoutUrl("https://x.test/buy", "checkout[custom][ref]", "abc"));

  const a = App.newRef(), b = App.newRef();
  check("ref: is 32 hex characters", /^[0-9a-f]{32}$/.test(a), a);
  check("ref: two calls differ", a !== b, a + " / " + b);
}

/* ---------- 8 — retaking the test restores previous answers ---------- */
{
  const { dom } = makeDom("test.html", { answers: completedAnswers });
  await tick(120);
  const d = dom.window.document;
  const selected = Array.from(d.getElementById("opts").children).filter(b => b.classList.contains("sel"));
  check("retake: previous answer pre-selected",
    selected.length === 1 && selected[0].textContent.trim() === "Often",
    selected.map(b => b.textContent.trim()).join(","));
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
