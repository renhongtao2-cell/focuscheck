/*
 * FocusCheck — AI report upgrade
 *
 * Runs after report.js. The template report renders instantly; if the visitor
 * has unlocked the report and a Worker endpoint is configured, this asks the
 * Worker for an AI-written version and swaps it in. Any failure leaves the
 * template report on screen, so the page always has content.
 */
(function () {
  "use strict";

  var cfg = window.FOCUSCHECK_CONFIG || {};
  var api = (cfg.API_ENDPOINT || "").trim();

  function params() { return new URLSearchParams(window.location.search); }

  function accessToken() {
    var p = params();
    var token = p.get("access");
    if (token) return token;

    // The provider sends the customer back without a token, so fall back to the
    // reference this browser stored just before checkout.
    try {
      var stored = localStorage.getItem("focuscheck.ref");
      if (stored) return stored;
    } catch (e) {}

    if (cfg.ALLOW_DEMO_UNLOCK !== false && p.get("unlocked") === "1") return "demo";
    return null;
  }

  function getAnswers() {
    var p = params();
    var sample = p.get("sample");
    if (sample && window.FocusCheckReport) {
      return window.FocusCheckReport.sampleAnswers(sample);
    }
    return window.FocusCheckReport ? window.FocusCheckReport.loadAnswers() : null;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  /* ---------- UI ---------- */

  function banner(text, kind) {
    var el = document.getElementById("aiBanner");
    if (!el) return;
    el.className = "no-print";
    el.style.cssText =
      "max-width:840px;margin:0 auto 18px;font-size:13.5px;padding:12px 18px;" +
      "border-radius:12px;line-height:1.6;display:flex;align-items:center;gap:10px;" +
      (kind === "error"
        ? "background:var(--amber-soft);border:1px solid #F3D9AE;color:#7A4A08"
        : kind === "done"
        ? "background:var(--brand-soft);border:1px solid var(--tealline);color:var(--brand-dark)"
        : "background:#EEF3F8;border:1px solid #CFE0F0;color:#25506F");
    el.innerHTML = text;
  }

  function spinner() {
    return '<span style="display:inline-block;width:13px;height:13px;border:2px solid currentColor;' +
      'border-right-color:transparent;border-radius:50%;animation:fcspin .7s linear infinite"></span>';
  }

  function ensureKeyframes() {
    if (document.getElementById("fcspinStyle")) return;
    var s = document.createElement("style");
    s.id = "fcspinStyle";
    s.textContent = "@keyframes fcspin{to{transform:rotate(360deg)}}";
    document.head.appendChild(s);
  }

  /* ---------- generation ---------- */

  function request(answers, token, signal) {
    return fetch(api, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers: answers, access: token }),
      signal: signal
    }).then(function (res) {
      return res.json().then(function (data) {
        return { status: res.status, data: data };
      }).catch(function () {
        return { status: res.status, data: null };
      });
    });
  }

  function inject(report) {
    var ov = document.getElementById("rpOverview");
    if (ov && report.overview) {
      ov.innerHTML = report.overview.split(/\n{2,}/).map(function (p) {
        return "<p>" + esc(p.trim()) + "</p>";
      }).join("");
    }

    var sig = document.getElementById("rpSignals");
    if (sig && report.signals && report.signals.length) {
      sig.innerHTML =
        "<p>These are the strongest signals in your result:</p>" +
        '<div class="tag-list">' +
        report.signals.map(function (s, i) {
          return '<span class="tag' + (i < 3 ? " hot" : "") + '">' + esc(s) + "</span>";
        }).join("") + "</div>";
    }

    var areas = document.getElementById("rpAreas");
    if (areas && report.areas && report.areas.length) {
      areas.innerHTML = report.areas.map(function (a) {
        return "<h3>" + esc(a.title) + "</h3><p>" + esc(a.body) + "</p>";
      }).join("");
    }

    var strat = document.getElementById("rpStrategies");
    if (strat && report.strategies && report.strategies.length) {
      strat.innerHTML =
        "<p>These are practical, evidence-informed approaches — not cures. Most people find that " +
        "two or three of them, applied consistently, make a bigger difference than trying all of " +
        "them at once.</p>" +
        '<div class="strat">' +
        report.strategies.map(function (s, i) {
          return '<div class="s"><div class="i">' + (i + 1) + "</div><div>" +
            "<h3>" + esc(s.title) + "</h3><p>" + esc(s.body) + "</p></div></div>";
        }).join("") + "</div>";
    }
  }

  function run() {
    var doc = document.getElementById("rpDoc");
    if (!doc || doc.classList.contains("hidden")) return; // empty state or no answers

    var token = accessToken();
    if (!token) return;                                   // not unlocked — template only
    if (!api) return;                                     // no Worker configured

    var answers = getAnswers();
    if (!answers) return;

    ensureKeyframes();
    banner(spinner() + " <span>Personalising your report…</span>", "info");

    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (ctrl) ctrl.abort();
    }, cfg.TIMEOUT_MS || 45000);

    request(answers, token, ctrl ? ctrl.signal : undefined)
      .then(function (r) {
        clearTimeout(timer);

        if (r.status === 200 && r.data && r.data.ok && r.data.report) {
          inject(r.data.report);
          banner(
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" ' +
            'stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px">' +
            '<path d="M20 6 9 17l-5-5"/></svg> ' +
            "<span>This report was written for your specific answers.</span>",
            "done"
          );
          return;
        }

        // Anything other than success: keep the template report, explain why.
        var msg = "We couldn't personalise this report right now, so you're seeing the standard version.";
        if (r.status === 403) msg = "This report link isn't valid any more. You're seeing the standard version.";
        if (r.status === 502 || r.status === 504) msg = "The report service is busy. You're seeing the standard version — reload to try again.";
        if (r.status === 500 && r.data && r.data.error === "server_not_configured") {
          msg = "The report service isn't configured yet. You're seeing the standard version.";
        }
        banner(esc(msg), "error");
      })
      .catch(function () {
        clearTimeout(timer);
        banner(
          esc("Couldn't reach the report service — you're seeing the standard version. " +
              "Reload to try again."),
          "error"
        );
      });
  }

  document.addEventListener("DOMContentLoaded", function () {
    // let report.js render the template first, then upgrade it
    setTimeout(run, 0);
  });
})();
