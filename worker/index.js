/*
 * FocusCheck — report generation Worker
 *
 * A single Cloudflare Worker that holds the LLM API key server-side and turns a
 * set of assessment answers into a personalised report. The key never reaches
 * the browser.
 *
 * Deploy:  see worker/README.md
 * Env vars (set as Worker secrets, never in code):
 *   LLM_API_KEY        required — your provider key
 *   PROVIDER           openrouter | openai | anthropic   (default: openrouter)
 *   LLM_MODEL          optional — overrides the provider default
 *   ALLOWED_ORIGINS    comma-separated list of allowed origins
 *   APP_URL            optional — shown to OpenRouter in the Referer header
 */

import { handleWebhook, checkAccess } from "./payments.js";

/* ------------------------------------------------------------------ *
 * Provider adapters
 * ------------------------------------------------------------------ */

const PROVIDERS = {
  openrouter: {
    url: "https://openrouter.ai/api/v1/chat/completions",
    headers: function (env) {
      return {
        "Authorization": "Bearer " + env.LLM_API_KEY,
        "Content-Type": "application/json",
        "HTTP-Referer": env.APP_URL || "https://focuscheck.app",
        "X-Title": "FocusCheck"
      };
    },
    body: function (env, system, user) {
      return {
        model: env.LLM_MODEL || "openai/gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
        max_tokens: 4000
      };
    },
    extract: function (d) {
      return d && d.choices && d.choices[0] && d.choices[0].message
        ? d.choices[0].message.content : null;
    }
  },

  openai: {
    url: "https://api.openai.com/v1/chat/completions",
    headers: function (env) {
      return {
        "Authorization": "Bearer " + env.LLM_API_KEY,
        "Content-Type": "application/json"
      };
    },
    body: function (env, system, user) {
      return {
        model: env.LLM_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user }
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
        max_tokens: 4000
      };
    },
    extract: function (d) {
      return d && d.choices && d.choices[0] && d.choices[0].message
        ? d.choices[0].message.content : null;
    }
  },

  anthropic: {
    url: "https://api.anthropic.com/v1/messages",
    headers: function (env) {
      return {
        "x-api-key": env.LLM_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      };
    },
    body: function (env, system, user) {
      return {
        model: env.LLM_MODEL || "claude-sonnet-4-5",
        max_tokens: 4000,
        temperature: 0.7,
        system: system,
        messages: [{ role: "user", content: user }]
      };
    },
    extract: function (d) {
      return d && d.content && d.content[0] ? d.content[0].text : null;
    }
  }
};

/* ------------------------------------------------------------------ *
 * Scoring — mirrors assets/questions.js so the server can re-derive the
 * result rather than trusting whatever the client sends.
 * ------------------------------------------------------------------ */

const ITEMS = [
  { id: 1,  part: "A", domain: "inattention" },
  { id: 2,  part: "A", domain: "inattention" },
  { id: 3,  part: "A", domain: "inattention" },
  { id: 4,  part: "A", domain: "inattention" },
  { id: 5,  part: "A", domain: "hyperactive" },
  { id: 6,  part: "A", domain: "hyperactive" },
  { id: 7,  part: "B", domain: "inattention" },
  { id: 8,  part: "B", domain: "inattention" },
  { id: 9,  part: "B", domain: "inattention" },
  { id: 10, part: "B", domain: "inattention" },
  { id: 11, part: "B", domain: "inattention" },
  { id: 12, part: "B", domain: "hyperactive" },
  { id: 13, part: "B", domain: "hyperactive" },
  { id: 14, part: "B", domain: "hyperactive" },
  { id: 15, part: "B", domain: "hyperactive" },
  { id: 16, part: "B", domain: "hyperactive" },
  { id: 17, part: "B", domain: "hyperactive" },
  { id: 18, part: "B", domain: "hyperactive" }
];

const SCREENER_RULES = { 1: 2, 2: 2, 3: 2, 4: 3, 5: 3, 6: 3 };
const SCREENER_THRESHOLD = 4;

const ITEM_TEXT = {
  1: "trouble wrapping up the final details of a project",
  2: "difficulty getting things in order for tasks requiring organisation",
  3: "problems remembering appointments or obligations",
  4: "avoiding or delaying tasks that require a lot of thought",
  5: "fidgeting or squirming when seated for a long time",
  6: "feeling overly active, driven by a motor",
  7: "careless mistakes on boring or difficult projects",
  8: "difficulty keeping attention on boring or repetitive work",
  9: "difficulty concentrating on what people say directly to them",
  10: "misplacing or losing things at home or work",
  11: "being distracted by activity or noise",
  12: "leaving their seat when expected to stay seated",
  13: "feeling restless or fidgety",
  14: "difficulty unwinding and relaxing",
  15: "talking too much in social situations",
  16: "finishing other people's sentences",
  17: "difficulty waiting their turn",
  18: "interrupting others when they are busy"
};

const SCALE_LABELS = ["Never", "Rarely", "Sometimes", "Often", "Very Often"];

function scoreAnswers(answers) {
  let positives = 0, inatt = 0, inattMax = 0, hyper = 0, hyperMax = 0;

  ITEMS.forEach(function (q) {
    const v = answers[q.id];
    if (q.part === "A" && v >= SCREENER_RULES[q.id]) positives++;
    if (q.domain === "inattention") { inatt += v; inattMax += 4; }
    else { hyper += v; hyperMax += 4; }
  });

  return {
    positives: positives,
    flagged: positives >= SCREENER_THRESHOLD,
    inattention: Math.round((inatt / inattMax) * 100),
    hyperactive: Math.round((hyper / hyperMax) * 100)
  };
}

function pickPattern(r) {
  const d = r.inattention - r.hyperactive;
  const notable = Math.max(r.inattention, r.hyperactive) >= 40;
  if (d >= 12 && notable) return "predominantly inattentive";
  if (d <= -12 && notable) return "predominantly hyperactive-impulsive";
  if (r.flagged) return "combined";
  return "sub-threshold";
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

const MAX_BODY_BYTES = 4096;

function validate(body) {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_body" };

  const a = body.answers;
  if (!a || typeof a !== "object" || Array.isArray(a)) {
    return { ok: false, error: "missing_answers" };
  }

  const clean = {};
  for (let i = 0; i < ITEMS.length; i++) {
    const id = ITEMS[i].id;
    const v = a[id] !== undefined ? a[id] : a[String(id)];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 4) {
      return { ok: false, error: "invalid_answer_" + id };
    }
    clean[id] = v;
  }
  return { ok: true, answers: clean };
}

/* ------------------------------------------------------------------ *
 * Prompt
 * ------------------------------------------------------------------ */

const SYSTEM_PROMPT = [
  "You write the narrative sections of a self-assessment report for an adult who has just",
  "completed the WHO Adult ADHD Self-Report Scale (ASRS-v1.1) screening questionnaire.",
  "",
  "Absolute rules:",
  "- This is a SCREENING tool, not a diagnosis. Never say or imply the person has ADHD.",
  "- Never use the words diagnose, diagnosis, treat, treatment, cure, or prescribe as claims",
  "  about the reader's condition. You may refer to \"a professional evaluation\" or \"talking",
  "  to a clinician\".",
  "- Write in the second person (\"you\"), warm, plain, specific, and non-alarmist.",
  "- Do not invent facts about the reader. Ground everything in the scores and items provided.",
  "- No filler, no hype, no exclamation marks. Aim for the tone of a careful clinician writing",
  "  a plain-language summary.",
  "",
  "Return ONLY a JSON object, no markdown fences, matching exactly this shape:",
  "{",
  '  "overview": "2 to 4 short paragraphs separated by \\n\\n",',
  '  "signals": ["short 3-7 word label for each high-scoring item", ...],',
  '  "areas": [{"title": "Work and career", "body": "1 paragraph"}, ...],',
  '  "strategies": [{"title": "3-6 word imperative", "body": "1-3 sentences"}, ...]',
  "}",
  "Provide exactly 5 areas covering: work and career, relationships, home and daily admin,",
  "money, and emotional wellbeing. Provide exactly 6 strategies, ordered by what would help",
  "this specific person most."
].join("\n");

function buildUserPrompt(answers, r, pattern) {
  const high = ITEMS.filter(function (q) { return answers[q.id] >= 3; });

  const lines = [];
  lines.push("Screening results:");
  lines.push("- Screener criteria met: " + r.positives + " of 6 (threshold is 4)");
  lines.push("- Inattention symptom load: " + r.inattention + "%");
  lines.push("- Hyperactivity/impulsivity symptom load: " + r.hyperactive + "%");
  lines.push("- Pattern: " + pattern);
  lines.push("");
  lines.push("Items rated Often or Very Often:");
  if (high.length === 0) {
    lines.push("- (none)");
  } else {
    high.forEach(function (q) {
      lines.push("- [" + q.domain + ", " + SCALE_LABELS[answers[q.id]] + "] " + ITEM_TEXT[q.id]);
    });
  }
  lines.push("");
  lines.push("Full response set:");
  ITEMS.forEach(function (q) {
    lines.push("- Item " + q.id + " (" + q.domain + "): " + SCALE_LABELS[answers[q.id]]);
  });

  return lines.join("\n");
}

/* ------------------------------------------------------------------ *
 * Response shaping
 * ------------------------------------------------------------------ */

function extractJson(text) {
  if (!text || typeof text !== "string") return null;
  let t = text.trim();
  // strip markdown fences if the model added them anyway
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try { return JSON.parse(t); } catch (e) {}
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end > start) {
    try { return JSON.parse(t.slice(start, end + 1)); } catch (e) {}
  }
  return null;
}

function str(v, max) {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function shape(raw) {
  if (!raw || typeof raw !== "object") return null;

  const overview = str(raw.overview, 4000);
  if (!overview) return null;

  const signals = Array.isArray(raw.signals)
    ? raw.signals.map(function (s) { return str(s, 80); }).filter(Boolean).slice(0, 12)
    : [];

  const areas = Array.isArray(raw.areas)
    ? raw.areas.map(function (a) {
        return a && typeof a === "object"
          ? { title: str(a.title, 80), body: str(a.body, 1200) }
          : null;
      }).filter(function (a) { return a && a.title && a.body; }).slice(0, 6)
    : [];

  const strategies = Array.isArray(raw.strategies)
    ? raw.strategies.map(function (s) {
        return s && typeof s === "object"
          ? { title: str(s.title, 80), body: str(s.body, 800) }
          : null;
      }).filter(function (s) { return s && s.title && s.body; }).slice(0, 8)
    : [];

  if (!areas.length || !strategies.length) return null;

  return { overview: overview, signals: signals, areas: areas, strategies: strategies };
}

/* ------------------------------------------------------------------ *
 * HTTP plumbing
 * ------------------------------------------------------------------ */

function corsHeaders(env, request) {
  const allowed = (env.ALLOWED_ORIGINS || "*").split(",")
    .map(function (s) { return s.trim(); }).filter(Boolean);
  const origin = request.headers.get("Origin") || "";
  let allow = "";

  if (allowed.indexOf("*") !== -1) allow = "*";
  else if (origin && allowed.indexOf(origin) !== -1) allow = origin;

  const h = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
  if (allow) h["Access-Control-Allow-Origin"] = allow;
  return h;
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json; charset=utf-8" }, headers || {})
  });
}

/* ------------------------------------------------------------------ *
 * Handler (exported with an injectable fetch so it can be unit-tested)
 * ------------------------------------------------------------------ */

export function createHandler(fetchImpl) {
  const doFetch = fetchImpl || fetch;

  return async function handle(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(env, request);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    /* ---- payment webhook (called by the provider's server, not a browser) ---- */
    if (url.pathname === "/webhook") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);
      const rawBody = await request.text();
      const r = await handleWebhook(request, rawBody, env);
      return json(r.body, r.status, cors);
    }

    /* ---- health check ---- */
    if (url.pathname === "/health") {
      return json({
        ok: true,
        provider: env.PROVIDER || "openrouter",
        accessRequired: (env.REQUIRE_ACCESS || "").toLowerCase() === "true"
      }, 200, cors);
    }

    /* ---- report generation ---- */
    if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, cors);

    // Reject browsers from origins we do not recognise. Requests with no Origin
    // header (server-to-server, curl) are allowed through and gated by the
    // access check below instead.
    const origin = request.headers.get("Origin");
    if (origin && cors["Access-Control-Allow-Origin"] === undefined) {
      return json({ error: "origin_not_allowed" }, 403, cors);
    }

    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413, cors);

    let body;
    try { body = JSON.parse(raw); }
    catch (e) { return json({ error: "invalid_json" }, 400, cors); }

    const v = validate(body);
    if (!v.ok) return json({ error: v.error }, 400, cors);

    const allowed = await checkAccess(body.access, env);
    if (!allowed) return json({ error: "access_denied" }, 403, cors);

    if (!env.LLM_API_KEY) return json({ error: "server_not_configured" }, 500, cors);

    const providerName = (env.PROVIDER || "openrouter").toLowerCase();
    const provider = PROVIDERS[providerName];
    if (!provider) return json({ error: "unknown_provider" }, 500, cors);

    const scores = scoreAnswers(v.answers);
    const pattern = pickPattern(scores);
    const userPrompt = buildUserPrompt(v.answers, scores, pattern);

    let upstream;
    try {
      upstream = await doFetch(provider.url, {
        method: "POST",
        headers: provider.headers(env),
        body: JSON.stringify(provider.body(env, SYSTEM_PROMPT, userPrompt))
      });
    } catch (e) {
      return json({ error: "upstream_unreachable" }, 502, cors);
    }

    if (!upstream.ok) {
      let detail = "";
      try { detail = (await upstream.text()).slice(0, 300); } catch (e) {}
      return json({ error: "upstream_error", status: upstream.status, detail: detail }, 502, cors);
    }

    let payload;
    try { payload = await upstream.json(); }
    catch (e) { return json({ error: "upstream_bad_json" }, 502, cors); }

    const text = provider.extract(payload);
    const parsed = extractJson(text);
    const shaped = shape(parsed);
    if (!shaped) return json({ error: "generation_unusable" }, 502, cors);

    return json({
      ok: true,
      scores: scores,
      pattern: pattern,
      report: shaped
    }, 200, cors);
  };
}

export default { fetch: createHandler() };
