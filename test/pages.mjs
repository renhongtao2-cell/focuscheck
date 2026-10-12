/*
 * Static page checks — run with:  npm test
 *
 * Verifies the public content pages actually carry the metadata social
 * crawlers read, that every referenced OG image exists at the right size,
 * and that no internal link points at a file that isn't there.
 */
import { JSDOM } from "jsdom";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..") + path.sep;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log("  PASS  " + name); pass++; }
  else { console.log("  FAIL  " + name + (extra ? "  -> " + String(extra).slice(0, 200) : "")); fail++; }
}

const PAGES = [
  "index.html",
  "adult-adhd-symptoms.html",
  "adhd-inattentive-type.html",
  "adhd-hyperactive-impulsive-type.html",
  "adhd-combined-type.html"
];

/* ---------- helpers ---------- */

function meta(doc, selector) {
  const el = doc.querySelector(selector);
  return el ? (el.getAttribute("content") || "").trim() : null;
}

/** Read width/height straight out of the PNG IHDR chunk. */
function pngSize(file) {
  const buf = fs.readFileSync(file);
  const isPng = buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isPng) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

/* ---------- 1 — every public page carries shareable metadata ---------- */
for (const page of PAGES) {
  const html = fs.readFileSync(ROOT + page, "utf8");
  const doc = new JSDOM(html).window.document;
  const tag = page + ":";

  const title = (doc.title || "").trim();
  check(tag + " has a title", title.length > 10 && title.length <= 70, title.length + " chars");

  const desc = meta(doc, 'meta[name="description"]');
  check(tag + " has a meta description", !!desc && desc.length >= 60 && desc.length <= 165,
    desc ? desc.length + " chars" : "missing");

  const canonical = doc.querySelector('link[rel="canonical"]');
  check(tag + " has an absolute canonical",
    !!canonical && /^https:\/\//.test(canonical.getAttribute("href")),
    canonical && canonical.getAttribute("href"));

  const ogUrl = meta(doc, 'meta[property="og:url"]');
  check(tag + " og:url is absolute", !!ogUrl && /^https:\/\//.test(ogUrl), ogUrl);
  check(tag + " canonical matches og:url",
    !!canonical && canonical.getAttribute("href") === ogUrl,
    canonical && canonical.getAttribute("href") + " vs " + ogUrl);

  check(tag + " has og:type", !!meta(doc, 'meta[property="og:type"]'));
  check(tag + " has og:title", (meta(doc, 'meta[property="og:title"]') || "").length > 10);
  check(tag + " has og:description", (meta(doc, 'meta[property="og:description"]') || "").length > 40);
  check(tag + " has og:site_name", meta(doc, 'meta[property="og:site_name"]') === "FocusCheck");

  const ogImage = meta(doc, 'meta[property="og:image"]');
  check(tag + " og:image is absolute", !!ogImage && /^https:\/\//.test(ogImage), ogImage);
  check(tag + " og:image is a png", !!ogImage && ogImage.endsWith(".png"), ogImage);

  check(tag + " twitter:card is a large image",
    meta(doc, 'meta[name="twitter:card"]') === "summary_large_image");
  check(tag + " twitter:image matches og:image",
    meta(doc, 'meta[name="twitter:image"]') === ogImage);

  // The referenced OG file must actually exist locally, at 1200x630.
  const ogRel = (ogImage || "").replace(/^https:\/\/[^/]+\/[^/]+\//, "");
  check(tag + " og:image file exists locally", exists(ogRel), ogRel);
  if (exists(ogRel)) {
    const size = pngSize(path.join(ROOT, ogRel));
    check(tag + " og:image is 1200x630",
      !!size && size.width === 1200 && size.height === 630,
      size ? size.width + "x" + size.height : "not a png");
  }

  const h1s = doc.querySelectorAll("h1");
  check(tag + " has exactly one h1", h1s.length === 1, h1s.length);
}

/* ---------- 2 — no internal link points at a missing file ---------- */
for (const page of PAGES) {
  const html = fs.readFileSync(ROOT + page, "utf8");
  const doc = new JSDOM(html).window.document;
  const broken = [];

  for (const a of doc.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href").trim();
    if (!href || href.startsWith("#") || href.startsWith("http") ||
        href.startsWith("mailto:") || href.startsWith("data:")) continue;
    const file = href.split("#")[0].split("?")[0];
    if (!file) continue;
    if (!exists(file)) broken.push(file);
  }

  check(page + ": no broken internal links", broken.length === 0, broken.join(", "));
}

/* ---------- 3 — the article pages link to each other ---------- */
{
  const ARTICLES = PAGES.slice(1);
  for (const page of ARTICLES) {
    const doc = new JSDOM(fs.readFileSync(ROOT + page, "utf8")).window.document;
    const hrefs = Array.from(doc.querySelectorAll("a[href]")).map(a => a.getAttribute("href"));
    const missing = ARTICLES.filter(other => other !== page && !hrefs.includes(other));
    check(page + ": links to all three sibling articles", missing.length === 0, missing.join(", "));
    check(page + ": links to the free test", hrefs.includes("test.html"));
  }
}

/* ---------- 4 — crawlability plumbing ---------- */
{
  const sitemap = fs.readFileSync(ROOT + "sitemap.xml", "utf8");
  // Strip XML comments first — the file documents the exclusions in prose.
  const bare = sitemap.replace(/<!--[\s\S]*?-->/g, "");
  for (const page of PAGES) {
    const loc = page === "index.html"
      ? "https://renhongtao2-cell.github.io/focuscheck/"
      : "https://renhongtao2-cell.github.io/focuscheck/" + page;
    check("sitemap lists " + page, bare.includes("<loc>" + loc + "</loc>"), loc);
  }
  check("sitemap excludes the noindex tool pages",
    !bare.includes("report.html") && !bare.includes("results.html") && !bare.includes("test.html"));
  check("sitemap is well-formed urlset",
    bare.trim().startsWith("<?xml") && bare.includes("</urlset>"));

  const robots = fs.readFileSync(ROOT + "robots.txt", "utf8");
  check("robots.txt allows crawling", /^User-agent: \*\s*$/m.test(robots));
  check("robots.txt points at the sitemap", robots.includes("sitemap.xml"));
  check("robots.txt disallows the tool pages",
    robots.includes("Disallow: /report.html") && robots.includes("Disallow: /test.html"));
}

/* ---------- 5 — every generated OG image is present ---------- */
{
  const ogDir = path.join(ROOT, "assets", "og");
  const files = fs.existsSync(ogDir) ? fs.readdirSync(ogDir).filter(f => f.endsWith(".png")) : [];
  check("five OG images generated", files.length === 5, files.join(", "));
  for (const f of files) {
    const size = pngSize(path.join(ogDir, f));
    check("og/" + f + " is 1200x630",
      !!size && size.width === 1200 && size.height === 630,
      size ? size.width + "x" + size.height : "bad png");
  }
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
