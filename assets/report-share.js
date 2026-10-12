/*
 * FocusCheck — share card
 *
 * Renders a shareable summary card onto a canvas and wires up the share
 * buttons. The card deliberately carries only the profile type and the
 * screener ring: no per-dimension percentages, no individual answers.
 *
 * Runs after report.js, which exposes window.FocusCheckReport.
 */
(function () {
  "use strict";

  var cfg = window.FOCUSCHECK_CONFIG || {};
  var CARD = 1080;

  var C = {
    brand: "#0E7C5A",
    brandDark: "#0A5C43",
    brandSoft: "#E8F5F0",
    tint: "#EAF5F1",
    ink: "#13211C",
    ink2: "#56635F",
    ink3: "#8B9691",
    line: "#E3E9E7",
    amber: "#B45309",
    amberSoft: "#FEF3E2"
  };

  var FONT = '"Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif';

  /* ---------------- data ---------------- */

  function siteUrl() {
    if (cfg.SITE_URL) return String(cfg.SITE_URL).replace(/\/+$/, "");
    try {
      var u = new URL(window.location.href);
      u.search = "";
      u.hash = "";
      u.pathname = u.pathname.replace(/[^/]*$/, "");
      return u.toString().replace(/\/+$/, "");
    } catch (e) { return ""; }
  }

  function siteHost() {
    try { return new URL(siteUrl()).hostname.replace(/^www\./, ""); }
    catch (e) { return ""; }
  }

  function getData() {
    var R = window.FocusCheckReport;
    if (!R) return null;
    var sample = new URLSearchParams(window.location.search).get("sample");
    var answers = sample ? R.sampleAnswers(sample) : R.loadAnswers();
    if (!answers || Object.keys(answers).length < 18) return null;
    var r = R.scoreAnswers(answers);
    return { r: r, profile: R.pickProfile(r) };
  }

  /* ---------------- canvas helpers ---------------- */

  function rr(g, x, y, w, h, rad) {
    var m = Math.min(rad, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + m, y);
    g.arcTo(x + w, y, x + w, y + h, m);
    g.arcTo(x + w, y + h, x, y + h, m);
    g.arcTo(x, y + h, x, y, m);
    g.arcTo(x, y, x + w, y, m);
    g.closePath();
  }

  function wrap(g, text, maxW) {
    var words = String(text).split(/\s+/);
    var lines = [], line = "";
    for (var i = 0; i < words.length; i++) {
      var t = line ? line + " " + words[i] : words[i];
      if (line && g.measureText(t).width > maxW) { lines.push(line); line = words[i]; }
      else { line = t; }
    }
    if (line) lines.push(line);
    return lines;
  }

  function track(g, px) {
    if ("letterSpacing" in g) g.letterSpacing = px ? px + "px" : "0px";
  }

  /* ---------------- card ---------------- */

  function drawCard(canvas, data) {
    var r = data.r, profile = data.profile;
    canvas.width = CARD;
    canvas.height = CARD;
    var g = canvas.getContext("2d");
    if (!g) return;

    // background
    var bg = g.createLinearGradient(0, 0, 0, CARD);
    bg.addColorStop(0, "#FFFFFF");
    bg.addColorStop(1, "#F2FAF6");
    g.fillStyle = bg;
    g.fillRect(0, 0, CARD, CARD);

    // top accent
    g.fillStyle = C.brand;
    g.fillRect(0, 0, CARD, 10);

    g.textAlign = "left";
    g.textBaseline = "alphabetic";

    // ---- header ----
    g.fillStyle = C.brand;
    rr(g, 80, 76, 66, 66, 21);
    g.fill();
    g.strokeStyle = "#fff";
    g.lineWidth = 7.5;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.beginPath();
    g.moveTo(99, 110);
    g.lineTo(112, 123);
    g.lineTo(132, 99);
    g.stroke();

    g.fillStyle = C.brand;
    g.font = "700 36px " + FONT;
    g.fillText("FocusCheck", 166, 124);

    g.fillStyle = C.ink3;
    g.font = "600 22px " + FONT;
    g.textAlign = "right";
    g.fillText("ASRS-v1.1", CARD - 80, 120);
    g.textAlign = "left";

    // ---- eyebrow ----
    g.fillStyle = C.ink3;
    g.font = "700 23px " + FONT;
    track(g, 3.4);
    g.fillText("ADULT ADHD SELF-SCREENING", 80, 232);
    track(g, 0);

    // ---- profile name (max 2 lines) ----
    var y = 304;
    g.fillStyle = C.ink;
    g.font = "800 54px " + FONT;
    wrap(g, profile.name, CARD - 160).slice(0, 2).forEach(function (ln) {
      g.fillText(ln, 80, y);
      y += 64;
    });

    // ---- tagline (max 2 lines) — this is the line that makes people click ----
    y += 10;
    g.fillStyle = C.ink2;
    g.font = "400 26px " + FONT;
    wrap(g, profile.tagline, CARD - 180).slice(0, 2).forEach(function (ln) {
      g.fillText(ln, 80, y);
      y += 36;
    });

    // ---- screener ring ----
    var cx = CARD / 2, rad = 130, lw = 26, cy = 660;
    g.lineCap = "butt";
    g.strokeStyle = C.tint;
    g.lineWidth = lw;
    g.beginPath();
    g.arc(cx, cy, rad, 0, Math.PI * 2);
    g.stroke();

    g.strokeStyle = r.flagged ? C.amber : C.brand;
    g.lineWidth = lw;
    g.lineCap = "round";
    g.beginPath();
    g.arc(cx, cy, rad, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (r.positives / 6));
    g.stroke();
    g.lineCap = "butt";

    // centre number — measure both parts so "4/6" sits optically centred
    g.font = "800 92px " + FONT;
    var wNum = g.measureText(String(r.positives)).width;
    g.font = "700 42px " + FONT;
    var wOf = g.measureText("/6").width;
    var x0 = cx - (wNum + wOf) / 2;
    g.textAlign = "left";
    g.fillStyle = C.ink;
    g.font = "800 92px " + FONT;
    g.fillText(String(r.positives), x0, cy + 20);
    g.fillStyle = C.ink3;
    g.font = "700 42px " + FONT;
    g.fillText("/6", x0 + wNum, cy + 20);

    g.textAlign = "center";
    g.fillStyle = C.ink3;
    g.font = "700 16px " + FONT;
    track(g, 2.6);
    g.fillText("PART A CRITERIA", cx, cy + 64);
    track(g, 0);

    // ---- status pill ----
    var pill = r.flagged ? "At or above the screening threshold" : "Below the screening threshold";
    g.font = "700 25px " + FONT;
    var pw = g.measureText(pill).width + 56;
    g.fillStyle = r.flagged ? C.amberSoft : C.brandSoft;
    rr(g, (CARD - pw) / 2, 824, pw, 58, 29);
    g.fill();
    g.fillStyle = r.flagged ? C.amber : C.brandDark;
    g.fillText(pill, CARD / 2, 861);

    // ---- body lines ----
    g.fillStyle = C.ink2;
    g.font = "400 27px " + FONT;
    g.fillText("Screened with the WHO Adult ADHD Self-Report Scale (ASRS-v1.1)", CARD / 2, 934);
    g.fillStyle = C.ink3;
    g.font = "400 23px " + FONT;
    g.fillText("A screening result is not a diagnosis. Only a clinician can diagnose.", CARD / 2, 968);

    // ---- footer strip ----
    g.textAlign = "left";
    g.fillStyle = C.brand;
    g.fillRect(0, CARD - 78, CARD, 78);
    g.fillStyle = "#fff";
    g.font = "700 27px " + FONT;
    g.fillText("Take the free 3-minute screening", 80, CARD - 29);
    var host = siteHost();
    if (host) {
      g.fillStyle = "rgba(255,255,255,.82)";
      g.font = "600 25px " + FONT;
      g.textAlign = "right";
      g.fillText(host, CARD - 80, CARD - 29);
      g.textAlign = "left";
    }
  }

  /* ---------------- share targets ---------------- */

  function shareText(data) {
    return "I scored " + data.r.positives + "/6 on the WHO adult ADHD screener. " +
      "Pattern: " + data.profile.name + ". Screening only — not a diagnosis.";
  }

  var NETWORKS = [
    { id: "x", label: "X", href: function (t, u) {
        return "https://twitter.com/intent/tweet?text=" + encodeURIComponent(t) +
               "&url=" + encodeURIComponent(u); } },
    { id: "facebook", label: "Facebook", href: function (t, u) {
        return "https://www.facebook.com/sharer/sharer.php?u=" + encodeURIComponent(u); } },
    { id: "reddit", label: "Reddit", href: function (t, u) {
        return "https://www.reddit.com/submit?url=" + encodeURIComponent(u) +
               "&title=" + encodeURIComponent(t); } },
    { id: "linkedin", label: "LinkedIn", href: function (t, u) {
        return "https://www.linkedin.com/sharing/share-offsite/?url=" + encodeURIComponent(u); } },
    { id: "email", label: "Email", href: function (t, u) {
        return "mailto:?subject=" + encodeURIComponent("My ADHD screening result") +
               "&body=" + encodeURIComponent(t + "\n\n" + u); } }
  ];

  var ICONS = {
    download: '<path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
    x: '<path d="M4 4l16 16"/><path d="M20 4L4 20"/>',
    facebook: '<path d="M14.5 8.5H17V5.5h-2.5A3.5 3.5 0 0 0 11 9v2H9v3h2v6h3v-6h2.3l.7-3H14v-1.3c0-.7.3-1.2.5-1.2Z"/>',
    reddit: '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10.5" r="1.1"/><circle cx="15" cy="10.5" r="1.1"/><path d="M8.6 14.6a4.6 4.6 0 0 0 6.8 0"/>',
    linkedin: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 10.5V17"/><path d="M7 7.2v.01"/><path d="M11 17v-3.6a2.2 2.2 0 0 1 4.4 0V17"/>'
  };

  function icon(name) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
      'stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || "") + "</svg>";
  }

  /* ---------------- DOM ---------------- */

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function render(data) {
    var mount = document.getElementById("rpShare");
    if (!mount) return;
    var url = siteUrl();
    var text = shareText(data);

    mount.innerHTML =
      '<div class="sh-head">Share your result</div>' +
      '<h2 class="sh-title">Help someone else recognise this sooner</h2>' +
      '<p class="sh-sub">Most adults with ADHD wait years before anyone names it — usually because ' +
      'they assume everyone struggles the same way. A single post is often what makes a friend ' +
      'take the screening.</p>' +
      '<div class="sh-grid">' +
        '<div class="sh-preview">' +
          '<canvas id="shCanvas" width="' + CARD + '" height="' + CARD + '" ' +
            'aria-label="Shareable summary card"></canvas>' +
          '<div class="cap">Your card shows only your profile type — no individual answers.</div>' +
        "</div>" +
        '<div class="sh-actions">' +
          '<div class="sh-btns">' +
            '<button class="sh-btn primary" id="shDownload">' + icon("download") +
              "Download image</button>" +
            '<button class="sh-btn" id="shCopyImg">' + icon("image") + "Copy image</button>" +
            '<button class="sh-btn" id="shCopyLink">' + icon("link") + "Copy link</button>" +
          "</div>" +
          '<div class="sh-btns">' +
            NETWORKS.map(function (n) {
              return '<button class="sh-btn" data-net="' + n.id + '">' + icon(n.id) +
                     esc(n.label) + "</button>";
            }).join("") +
          "</div>" +
          '<div class="sh-status" id="shStatus" role="status" aria-live="polite"></div>' +
          '<p class="sh-note">Your answers never leave your browser and are not attached to the ' +
          "link. Anyone opening it lands on the screening homepage and takes their own test.</p>" +
        "</div>" +
      "</div>";

    var canvas = document.getElementById("shCanvas");
    drawCard(canvas, data);

    var status = document.getElementById("shStatus");
    var statusTimer = null;
    function say(msg) {
      if (!status) return;
      status.textContent = msg;
      clearTimeout(statusTimer);
      statusTimer = setTimeout(function () { status.textContent = ""; }, 3600);
    }

    function toBlob(cb) {
      if (canvas.toBlob) { canvas.toBlob(cb, "image/png"); return; }
      try {
        var url = canvas.toDataURL("image/png");
        var bin = atob(url.split(",")[1]);
        var arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        cb(new Blob([arr], { type: "image/png" }));
      } catch (e) { cb(null); }
    }

    var dl = document.getElementById("shDownload");
    if (dl) dl.addEventListener("click", function () {
      toBlob(function (blob) {
        if (!blob) { say("Could not create the image — try a screenshot instead."); return; }
        var a = document.createElement("a");
        var objUrl = URL.createObjectURL(blob);
        a.href = objUrl;
        a.download = "focuscheck-result.png";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(objUrl); }, 4000);
        say("Image downloaded.");
      });
    });

    var ci = document.getElementById("shCopyImg");
    if (ci) ci.addEventListener("click", function () {
      if (!navigator.clipboard || typeof window.ClipboardItem === "undefined") {
        say("This browser can't copy images — use Download image instead.");
        return;
      }
      toBlob(function (blob) {
        if (!blob) { say("Could not create the image."); return; }
        navigator.clipboard.write([new window.ClipboardItem({ "image/png": blob })])
          .then(function () { say("Image copied — paste it anywhere."); })
          .catch(function () { say("Copy failed — use Download image instead."); });
      });
    });

    var cl = document.getElementById("shCopyLink");
    if (cl) cl.addEventListener("click", function () {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url)
          .then(function () { say("Link copied."); })
          .catch(function () { say("Could not copy — the link is " + url); });
        return;
      }
      say("Link: " + url);
    });

    Array.prototype.forEach.call(mount.querySelectorAll("[data-net]"), function (btn) {
      btn.addEventListener("click", function () {
        var net = NETWORKS.filter(function (n) { return n.id === btn.getAttribute("data-net"); })[0];
        if (!net) return;
        var href = net.href(text, url);
        if (net.id === "email") { window.location.href = href; return; }
        window.open(href, "_blank", "noopener,noreferrer");
      });
    });
  }

  function run() {
    var doc = document.getElementById("rpDoc");
    if (!doc || doc.classList.contains("hidden")) return;
    var data = getData();
    if (!data) return;
    render(data);
  }

  document.addEventListener("DOMContentLoaded", run);

  /* Exposed for tests. */
  window.FocusCheckShare = {
    siteUrl: siteUrl,
    getData: getData,
    drawCard: drawCard,
    shareText: shareText
  };
})();
