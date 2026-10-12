/*
 * Worker unit tests — run with:  npm test
 *
 * The LLM is mocked, so no API key and no network access are needed.
 */
import { createHandler } from "../worker/index.js";

const ENV = {
  LLM_API_KEY: "test-key",
  PROVIDER: "openrouter",
  ALLOWED_ORIGINS: "https://renhongtao2-cell.github.io,http://localhost:8000",
  APP_URL: "https://example.com/"
};
const ORIGIN = "https://renhongtao2-cell.github.io";

const goodAnswers = {};
for (let i = 1; i <= 18; i++) goodAnswers[i] = i <= 6 ? 4 : 3;

const goodReport = {
  overview: "Para one.\n\nPara two.",
  signals: ["Finishing the last 10%", "Getting organised"],
  areas: [
    { title: "Work and career", body: "a" }, { title: "Relationships", body: "b" },
    { title: "Home and daily admin", body: "c" }, { title: "Money", body: "d" },
    { title: "Emotional wellbeing", body: "e" }
  ],
  strategies: [
    { title: "Externalise everything", body: "x" }, { title: "Make time visible", body: "y" },
    { title: "Shrink the first step", body: "z" }, { title: "Use interest", body: "p" },
    { title: "Build accountability", body: "q" }, { title: "Protect focus blocks", body: "r" }
  ]
};

function chatResponse(content) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200, headers: { "Content-Type": "application/json" } });
}

function mockFetch(behavior) {
  return async () => {
    if (behavior === "throw") throw new Error("network down");
    if (behavior === "http500") return new Response("boom", { status: 500 });
    if (behavior === "badjson") return new Response("not json", { status: 200 });
    if (behavior === "garbage") return chatResponse("I'm sorry, I cannot help with that.");
    if (behavior === "fenced") return chatResponse("```json\n" + JSON.stringify(goodReport) + "\n```");
    return chatResponse(JSON.stringify(goodReport));
  };
}

function req(method, body, origin) {
  const h = { "Content-Type": "application/json" };
  if (origin !== null) h["Origin"] = origin === undefined ? ORIGIN : origin;
  return new Request("https://w.example.com/", {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { console.log("  PASS  " + name); pass++; }
  else { console.log("  FAIL  " + name + (extra ? "  -> " + extra : "")); fail++; }
}

/* CORS preflight */
{
  const res = await createHandler(mockFetch("ok"))(req("OPTIONS"), ENV);
  check("OPTIONS preflight -> 204", res.status === 204, res.status);
  check("  allows configured origin",
    res.headers.get("Access-Control-Allow-Origin") === ORIGIN,
    res.headers.get("Access-Control-Allow-Origin"));
}

/* happy path */
{
  const res = await createHandler(mockFetch("ok"))(req("POST", { answers: goodAnswers }), ENV);
  const d = await res.json();
  check("valid request -> 200", res.status === 200, res.status);
  check("  returns 5 areas", d.ok === true && d.report.areas.length === 5);
  check("  server re-derived scores", d.scores && d.scores.positives === 6, JSON.stringify(d.scores));
  check("  pattern detected", d.pattern === "combined", d.pattern);
}

/* model returns fenced JSON anyway */
{
  const res = await createHandler(mockFetch("fenced"))(req("POST", { answers: goodAnswers }), ENV);
  check("markdown-fenced JSON tolerated", res.status === 200, res.status);
}

/* input validation */
{
  const bad = Object.assign({}, goodAnswers); bad[7] = 9;
  const res = await createHandler(mockFetch("ok"))(req("POST", { answers: bad }), ENV);
  check("out-of-range answer -> 400", res.status === 400, res.status);
}
{
  const res = await createHandler(mockFetch("ok"))(req("POST", {}), ENV);
  check("missing answers -> 400", res.status === 400, res.status);
}
{
  const r = new Request("https://w.example.com/", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: "{not json"
  });
  const res = await createHandler(mockFetch("ok"))(r, ENV);
  check("malformed JSON -> 400", res.status === 400, res.status);
}
{
  const res = await createHandler(mockFetch("ok"))(
    req("POST", { answers: goodAnswers }, "https://evil.example.com"), ENV);
  check("disallowed origin -> 403", res.status === 403, res.status);
}
{
  const r = new Request("https://w.example.com/", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: ORIGIN },
    body: JSON.stringify({ answers: { x: "y".repeat(9000) } })
  });
  const res = await createHandler(mockFetch("ok"))(r, ENV);
  check("oversize payload -> 413", res.status === 413, res.status);
}

/* upstream failures */
for (const [b, label] of [["throw", "network throw"], ["http500", "upstream 500"], ["badjson", "upstream non-JSON"]]) {
  const res = await createHandler(mockFetch(b))(req("POST", { answers: goodAnswers }), ENV);
  check("upstream " + label + " -> 502", res.status === 502, res.status);
}
{
  const res = await createHandler(mockFetch("garbage"))(req("POST", { answers: goodAnswers }), ENV);
  check("unusable model output -> 502", res.status === 502, res.status);
}

/* protocol */
{
  const res = await createHandler(mockFetch("ok"))(req("GET", undefined), ENV);
  check("GET -> 405", res.status === 405, res.status);
}
{
  const res = await createHandler(mockFetch("ok"))(
    req("POST", { answers: goodAnswers }), { ALLOWED_ORIGINS: ORIGIN, PROVIDER: "openrouter" });
  check("no API key -> 500", res.status === 500, res.status);
}

/* provider adapters */
{
  const af = async () => new Response(JSON.stringify({ content: [{ text: JSON.stringify(goodReport) }] }),
    { status: 200, headers: { "Content-Type": "application/json" } });
  const res = await createHandler(af)(req("POST", { answers: goodAnswers }),
    Object.assign({}, ENV, { PROVIDER: "anthropic" }));
  check("anthropic provider path -> 200", res.status === 200, res.status);
}
{
  const res = await createHandler(mockFetch("ok"))(
    req("POST", { answers: goodAnswers }), Object.assign({}, ENV, { PROVIDER: "nope" }));
  check("unknown provider -> 500", res.status === 500, res.status);
}

/* access control */
{
  const res = await createHandler(mockFetch("ok"))(req("POST", { answers: goodAnswers }),
    Object.assign({}, ENV, { REQUIRE_ACCESS: "true", ORDERS: null }));
  check("access required but no KV bound -> 403", res.status === 403, res.status);
}
{
  const kv = { get: async () => null };
  const res = await createHandler(mockFetch("ok"))(req("POST", { answers: goodAnswers, access: "nope" }),
    Object.assign({}, ENV, { REQUIRE_ACCESS: "true", ORDERS: kv }));
  check("unpaid token -> 403", res.status === 403, res.status);
}
{
  const kv = { get: async (k) => (k === "order:paid123" ? "{}" : null) };
  const res = await createHandler(mockFetch("ok"))(
    req("POST", { answers: goodAnswers, access: "paid123" }),
    Object.assign({}, ENV, { REQUIRE_ACCESS: "true", ORDERS: kv }));
  check("paid token -> 200", res.status === 200, res.status);
}

/* health */
{
  const r = new Request("https://w.example.com/health", { method: "GET", headers: { Origin: ORIGIN } });
  const res = await createHandler(mockFetch("ok"))(r, ENV);
  const d = await res.json();
  check("health endpoint", res.status === 200 && d.ok === true);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
