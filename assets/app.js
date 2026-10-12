/* FocusCheck — client-side logic (test flow + results) */
(function () {
  "use strict";

  var STORAGE_KEY = "focuscheck.answers.v1";

  /* ---------------- shared helpers ---------------- */

  function save(answers) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(answers)); } catch (e) {}
  }
  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function score(answers) {
    var positives = 0;
    var inatt = { sum: 0, max: 0 };
    var hyper = { sum: 0, max: 0 };

    QUESTIONS.forEach(function (q) {
      var v = typeof answers[q.id] === "number" ? answers[q.id] : 0;

      if (q.part === "A" && v >= SCREENER_RULES[q.id]) positives++;

      if (q.domain === "inattention") { inatt.sum += v; inatt.max += 4; }
      else { hyper.sum += v; hyper.max += 4; }
    });

    return {
      positives: positives,
      flagged: positives >= SCREENER_THRESHOLD,
      inattention: inatt.max ? Math.round((inatt.sum / inatt.max) * 100) : 0,
      hyperactive: hyper.max ? Math.round((hyper.sum / hyper.max) * 100) : 0
    };
  }

  /* ---------------- test page ---------------- */

  function initTest() {
    var i = 0;
    var answers = load() || {};
    var total = QUESTIONS.length;

    var elQNum   = document.getElementById("qNum");
    var elQText  = document.getElementById("qText");
    var elOpts   = document.getElementById("opts");
    var elBar    = document.getElementById("bar");
    var elCount  = document.getElementById("count");
    var elBack   = document.getElementById("back");
    var card     = document.getElementById("qcard");

    function render() {
      var q = QUESTIONS[i];

      elQNum.textContent  = "Question " + (i + 1);
      elQText.textContent = q.text;
      elCount.textContent = (i + 1) + " of " + total;
      elBar.style.width   = ((i) / total * 100) + "%";

      elOpts.innerHTML = "";
      SCALE.forEach(function (s) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "opt" + (answers[q.id] === s.value ? " sel" : "");
        b.innerHTML = '<span class="rd"></span><span>' + s.label + "</span>";
        b.addEventListener("click", function () { choose(q.id, s.value, b); });
        elOpts.appendChild(b);
      });

      elBack.style.visibility = i === 0 ? "hidden" : "visible";

      // small entrance animation
      card.style.animation = "none";
      void card.offsetWidth;
      card.style.animation = "pop .18s ease";
    }

    function choose(id, value, btn) {
      answers[id] = value;
      save(answers);

      Array.prototype.forEach.call(elOpts.children, function (c) { c.classList.remove("sel"); });
      btn.classList.add("sel");

      setTimeout(function () {
        if (i < total - 1) { i++; render(); }
        else { elBar.style.width = "100%"; window.location.href = "results.html"; }
      }, 240);
    }

    elBack.addEventListener("click", function () {
      if (i > 0) { i--; render(); }
    });

    render();
  }

  /* ---------------- results page ---------------- */

  function initResults() {
    var answers = load();
    var empty = document.getElementById("empty");
    var content = document.getElementById("content");

    if (!answers || Object.keys(answers).length < QUESTIONS.length) {
      empty.classList.remove("hidden");
      return;
    }
    content.classList.remove("hidden");

    var r = score(answers);

    // headline badge + copy
    var badge = document.getElementById("badge");
    var title = document.getElementById("resTitle");
    var para  = document.getElementById("resPara");

    if (r.flagged) {
      badge.className = "result-badge flag";
      badge.innerHTML = icon("alert") + "<span>Screening threshold met</span>";
      title.textContent = "Your responses are consistent with ADHD symptoms";
      para.textContent =
        "You met the screening threshold on " + r.positives + " of 6 criteria in the " +
        "validated screener. This does not mean you have ADHD — but it is a strong signal " +
        "that a professional evaluation is worth pursuing.";
    } else if (r.positives >= 2) {
      badge.className = "result-badge flag";
      badge.innerHTML = icon("alert") + "<span>Some symptoms present</span>";
      title.textContent = "You show some ADHD-related symptoms";
      para.textContent =
        "You met " + r.positives + " of 6 screening criteria — below the threshold, but not " +
        "nothing. Symptoms may still be affecting your daily life. The detailed report explains " +
        "which areas are most affected.";
    } else {
      badge.className = "result-badge clear";
      badge.innerHTML = icon("check") + "<span>Below screening threshold</span>";
      title.textContent = "Few ADHD symptoms indicated";
      para.textContent =
        "You met " + r.positives + " of 6 screening criteria. Your responses do not suggest " +
        "significant ADHD symptoms at this time.";
    }

    document.getElementById("scoreBig").textContent = r.positives;
    document.getElementById("scoreOf").textContent = "of 6 criteria met";

    // bars
    setBar("barInatt", "valInatt", r.inattention);
    setBar("barHyper", "valHyper", r.hyperactive);
  }

  function setBar(barId, valId, pct) {
    var bar = document.getElementById(barId);
    var val = document.getElementById(valId);
    if (!bar) return;
    if (pct >= 50) bar.classList.add("warn");
    val.textContent = pct + "%";
    setTimeout(function () { bar.style.width = pct + "%"; }, 120);
  }

  function icon(name) {
    if (name === "alert")
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>';
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
  }

  /* ---------------- paywall modal ---------------- */

  function initModal() {
    var openers = document.querySelectorAll("[data-open-checkout]");
    var modal = document.getElementById("checkout");
    if (!modal) return;

    openers.forEach(function (b) {
      b.addEventListener("click", function (e) {
        e.preventDefault();
        modal.classList.add("open");
        document.body.style.overflow = "hidden";
      });
    });

    modal.addEventListener("click", function (e) {
      if (e.target === modal || e.target.hasAttribute("data-close")) close();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
    });

    function close() {
      modal.classList.remove("open");
      document.body.style.overflow = "";
    }

    var payBtn = document.getElementById("payBtn");
    if (payBtn) {
      payBtn.addEventListener("click", function (e) {
        e.preventDefault();
        var cfg = window.FOCUSCHECK_CONFIG || {};

        if (!cfg.CHECKOUT_URL) {
          // Payment is not configured yet — explain instead of pretending.
          document.getElementById("demoNote").classList.remove("hidden");
          return;
        }

        // Remember a reference in this browser so the report can be unlocked
        // when the provider sends the customer back.
        var ref = newRef();
        try { localStorage.setItem("focuscheck.ref", ref); } catch (err) {}

        var sep = cfg.CHECKOUT_URL.indexOf("?") > -1 ? "&" : "?";
        var param = cfg.CHECKOUT_REF_PARAM || "client_reference_id";
        window.location.href =
          cfg.CHECKOUT_URL + sep + encodeURIComponent(param) + "=" + encodeURIComponent(ref);
      });
    }
  }

  function newRef() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, "");
    var s = "";
    for (var i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s;
  }

  /* ---------------- boot ---------------- */

  document.addEventListener("DOMContentLoaded", function () {
    var page = document.body.getAttribute("data-page");
    if (page === "test") initTest();
    if (page === "results") { initResults(); initModal(); }
  });
})();
