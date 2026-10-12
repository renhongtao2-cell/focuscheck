/*
 * FocusCheck — personalised report generator
 *
 * Reads the user's saved answers, classifies their symptom pattern, and builds
 * the full report. Everything runs client-side; no data leaves the browser.
 */
(function () {
  "use strict";

  var KEY = "focuscheck.answers.v1";

  /* ---------------- content library ---------------- */

  var PROFILES = {
    inattentive: {
      name: "Predominantly Inattentive Pattern",
      tagline: "Focus, follow-through and working memory are the main challenge — not energy or restlessness.",
      overview:
        "Your responses cluster around the inattentive items: starting tasks, sustaining focus on " +
        "low-stimulation work, remembering routine obligations, and keeping track of everyday " +
        "objects. Hyperactive and impulsive symptoms were comparatively mild or absent. This is the " +
        "most commonly missed adult presentation — partly because it is quieter, and partly because " +
        "many people build strong compensatory habits early on that hide it from the outside.",
      areas: [
        ["Work and career",
          "You are likely at your best under deadline pressure, when a task is genuinely interesting, " +
          "or when someone else is waiting on you. Routine administrative work, long unstructured " +
          "projects, and anything that amounts to \u201Cjust sit down and do it\u201D are the hardest. " +
          "Colleagues may read the gap as inconsistency rather than as a symptom."],
        ["Relationships",
          "You may lose the thread of conversations, forget commitments, or drift off mid-story. " +
          "Partners often experience this as not caring, when it is actually an attention-capture and " +
          "working-memory issue. Naming it out loud defuses most of the damage."],
        ["Home and daily admin",
          "Bills, forms, appointments, renewals and paperwork are the classic pain point. Things get " +
          "misplaced, deadlines slip, and the pile grows until it feels too large to start."],
        ["Money",
          "Late fees, unused subscriptions, forgotten cancellations and boredom-driven purchases are " +
          "common. Not because of carelessness with money, but because the admin around money is " +
          "exactly the kind of task that slips."],
        ["Emotional wellbeing",
          "The most common pattern is a persistent gap between what you know you are capable of and " +
          "what you actually get done. Over years this can harden into \u201CI'm lazy\u201D or " +
          "\u201CI'm not smart enough\u201D — a self-story that is usually far harsher than the evidence."]
      ],
      strategies: [
        ["Externalise everything",
          "If it is not written down somewhere you will actually see it, it does not exist. One " +
          "capture system — paper, phone, whiteboard — used ruthlessly beats five half-used apps."],
        ["Make time visible",
          "Analog clocks, timers and calendar blocks you can physically see. Time blindness is a core " +
          "feature here; you cannot manage what you cannot perceive."],
        ["Shrink the first step",
          "The barrier is almost always starting, not doing. Define the first action as something " +
          "under two minutes — \u201Copen the document and write one bad sentence\u201D."],
        ["Use interest, not willpower",
          "Willpower is an unreliable fuel. Design tasks to be novel, competitive, urgent, or tied to " +
          "something you care about — those are the conditions your attention actually engages under."],
        ["Build in accountability",
          "A person expecting you is one of the strongest focus aids available. Body doubling, study " +
          "partners and scheduled check-ins work because the deadline becomes social, not internal."],
        ["Protect focus blocks",
          "Once you are in a productive state, defend it. Interruption costs far more than it appears " +
          "to, because re-entry is the expensive part."]
      ]
    },

    hyperactive: {
      name: "Predominantly Hyperactive-Impulsive Pattern",
      tagline: "Restlessness and impulse control are the main challenge — sustained attention is comparatively intact.",
      overview:
        "Your responses cluster around the hyperactive-impulsive items: physical restlessness, " +
        "difficulty unwinding, talking over people, and acting before the pause. Inattentive symptoms " +
        "were comparatively mild. This presentation is easier to spot from the outside, but it often " +
        "gets misread as personality — \u201Chigh energy\u201D, \u201Ca lot\u201D, or \u201Cjust impatient\u201D.",
      areas: [
        ["Work and career",
          "You may thrive in fast-moving, high-stimulation environments and struggle in slow, " +
          "process-heavy ones. Meetings and long documents are hard; firefighting and rapid " +
          "problem-solving are where you shine. Impulsive contributions can be a genuine asset or a " +
          "genuine liability, depending on the room."],
        ["Relationships",
          "Finishing other people's sentences, interrupting, and struggling to wait your turn can " +
          "land as disrespect even when it is not intended. The intent is usually enthusiasm or " +
          "urgency — but the other person experiences the impact, not the intent."],
        ["Home and daily life",
          "Sitting through a film, waiting on a slow process, or doing something quietly for an hour " +
          "can feel genuinely uncomfortable. Restlessness tends to come out as pacing, fidgeting, or " +
          "starting new things before finishing old ones."],
        ["Money",
          "Impulse purchases are the most common financial signature — buying in the moment of " +
          "excitement and regretting it later. The issue is the gap between impulse and pause, not " +
          "financial literacy."],
        ["Emotional wellbeing",
          "Frustration tolerance can run short, and the constant sense of being \u201Cdriven by a " +
          "motor\u201D is exhausting over time. Many people describe feeling wired but tired — unable " +
          "to properly rest even when the opportunity is there."]
      ],
      strategies: [
        ["Build movement into the day",
          "Structured exercise is one of the most reliably effective interventions for restlessness. " +
          "It is not a cure, but it changes the baseline for hours afterwards."],
        ["Create a pause before acting",
          "The gap between impulse and action is what you are training. A physical habit — writing " +
          "the purchase down, counting to five, leaving the cart overnight — beats trying to " +
          "\u201Cjust be less impulsive\u201D."],
        ["Give fidgeting a legitimate outlet",
          "Suppressing restlessness costs attention. Fidget tools, standing desks, walking meetings " +
          "and movement breaks let you spend the energy without spending focus."],
        ["Make slow tasks physical",
          "Pair low-stimulation tasks with movement or background input. Walking while on a call, or " +
          "listening while doing something with your hands, can be the difference between impossible " +
          "and manageable."],
        ["Protect the unwind",
          "Difficulty relaxing is a symptom, not a character flaw. Wind-down routines, delayed " +
          "screens and a predictable bedtime structure do more than trying to force yourself to " +
          "\u201Cswitch off\u201D."],
        ["Name the pattern early",
          "Telling people you tend to interrupt, and asking them to flag it, removes the social cost " +
          "far faster than trying to hide it."]
      ]
    },

    combined: {
      name: "Combined Pattern",
      tagline: "Both symptom clusters are elevated — focus difficulties and restlessness are present together.",
      overview:
        "Your responses are elevated on both the inattentive and the hyperactive-impulsive items. " +
        "This is the most common adult presentation in clinical settings, and often the most " +
        "disruptive, because the two clusters interact: restlessness makes it harder to stay on " +
        "task, and lost focus makes the restlessness more noticeable.",
      areas: [
        ["Work and career",
          "You may swing between intense productive sprints and long unfocused periods. The challenge " +
          "is rarely ability — it is consistency. Environments offering both structure and variety " +
          "tend to work best; rigid, quiet, repetitive ones tend to be the worst."],
        ["Relationships",
          "Both missed details and impulsive reactions can be present. The combination can be " +
          "especially hard on partners, who may experience inconsistency in attention and in mood."],
        ["Home and daily life",
          "Tasks get started and abandoned, and the environment often reflects that — several " +
          "projects open at once, and a background hum of things left unfinished."],
        ["Money",
          "Both forgotten admin and impulse spending are common. Together they create a pattern where " +
          "money leaks from several directions at once."],
        ["Emotional wellbeing",
          "The combination is draining. Sustained effort costs more than it appears to, and the sense " +
          "of underachievement is often significant — despite real capability."]
      ],
      strategies: [
        ["Externalise everything",
          "One capture system for tasks, commitments and ideas, used ruthlessly. If it is not " +
          "recorded somewhere visible, it will be lost."],
        ["Make time visible",
          "Timers and analog clocks, everywhere. Time blindness amplifies both clusters, and it is " +
          "one of the most manageable pieces."],
        ["Build movement into the day",
          "Exercise and movement breaks lower restlessness and, indirectly, improve focus. This is " +
          "the highest-leverage single habit for a combined pattern."],
        ["Shrink the first step",
          "Define the first action as something under two minutes. The barrier is starting, and a " +
          "small enough first step removes it."],
        ["Create a pause before acting",
          "A physical habit that inserts a gap between impulse and action — write it down, leave the " +
          "cart overnight, count to five."],
        ["Build in accountability",
          "A person expecting you is one of the strongest focus aids available, and it helps with " +
          "follow-through on both fronts."]
      ]
    },

    mild: {
      name: "Mild / Sub-threshold Pattern",
      tagline: "Some symptoms are present, but below the screening threshold.",
      overview:
        "You did not meet the screening threshold, but your responses were not empty either — some " +
        "ADHD-related symptoms are present. That is worth taking seriously without over-reading it. " +
        "Sub-threshold symptoms can still affect daily life, and they can also be caused by things " +
        "that are not ADHD at all: sleep debt, chronic stress, anxiety, low mood, or a thyroid " +
        "issue. That is exactly why a professional view is useful if this is genuinely bothering you.",
      areas: [
        ["What this result does mean",
          "You have some difficulty with attention or restlessness that is noticeable enough to show " +
          "up on a validated screener. It may be situational, it may be longstanding, and it is " +
          "worth tracking rather than dismissing."],
        ["What this result does not mean",
          "It does not mean you have ADHD, and it does not mean you do not. Screening instruments " +
          "are deliberately tuned to avoid missing cases, which means they also flag people whose " +
          "symptoms come from somewhere else."],
        ["Worth ruling out first",
          "Sleep quality and duration, sustained stress, anxiety, low mood and thyroid function can " +
          "all produce this exact picture. These are common, checkable, and often reversible."],
        ["Worth tracking",
          "Note when symptoms are worst — time of day, task type, sleep the night before, stress " +
          "level. Patterns over two to three weeks are far more informative than a single test."],
        ["Emotional wellbeing",
          "Even mild, persistent difficulty focusing carries a cost — usually in self-criticism " +
          "rather than in output. Take that part seriously too."]
      ],
      strategies: [
        ["Fix sleep first",
          "Sleep debt mimics attention problems almost perfectly. A consistent schedule and a real " +
          "wind-down routine is the cheapest intervention available."],
        ["Externalise the important things",
          "A single capture system for commitments. This helps whether or not ADHD is involved."],
        ["Make time visible",
          "Timers and visible clocks reduce the everyday cost of time blindness."],
        ["Shrink the first step",
          "Break avoided tasks into a first action under two minutes."],
        ["Track for two to three weeks",
          "Note sleep, stress and symptom intensity. Bring the pattern to a professional if it " +
          "persists."],
        ["Get a professional opinion if it persists",
          "If this is affecting work, relationships or self-esteem, a proper assessment is worth " +
          "more than any self-guided approach."]
      ]
    }
  };

  /* ---------------- helpers ---------------- */

  function loadAnswers() {
    try {
      var raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function computeScores(answers) {
    var positives = 0, inatt = 0, inattMax = 0, hyper = 0, hyperMax = 0;
    QUESTIONS.forEach(function (q) {
      var v = typeof answers[q.id] === "number" ? answers[q.id] : 0;
      if (q.part === "A" && v >= SCREENER_RULES[q.id]) positives++;
      if (q.domain === "inattention") { inatt += v; inattMax += 4; }
      else { hyper += v; hyperMax += 4; }
    });
    return {
      positives: positives,
      flagged: positives >= SCREENER_THRESHOLD,
      inattention: inattMax ? Math.round(inatt / inattMax * 100) : 0,
      hyperactive: hyperMax ? Math.round(hyper / hyperMax * 100) : 0
    };
  }

  function pickProfile(r) {
    var d = r.inattention - r.hyperactive;
    var notable = Math.max(r.inattention, r.hyperactive) >= 40;
    // A clear skew toward one cluster describes the pattern regardless of severity.
    if (d >= 12 && notable) return PROFILES.inattentive;
    if (d <= -12 && notable) return PROFILES.hyperactive;
    // No clear skew: only call it combined if the screener actually flagged.
    if (r.flagged) return PROFILES.combined;
    return PROFILES.mild;
  }

  /*
   * Sample answers for previewing the report without taking the test.
   * Usage: report.html?sample=inattentive | hyperactive | combined | mild
   */
  function sampleAnswers(kind) {
    var cfg = {
      inattentive: { ia: 4, hy: 1 },
      hyperactive: { ia: 2, hy: 4 },
      combined:    { ia: 4, hy: 4 },
      mild:        { ia: 1, hy: 1 }
    }[kind] || { ia: 4, hy: 1 };

    var out = {};
    var seen = { inattention: 0, hyperactive: 0 };
    var jitter = [0, 1, 0, -1, 0, 1, 0, 0, -1];

    QUESTIONS.forEach(function (q) {
      var base = q.domain === "inattention" ? cfg.ia : cfg.hy;
      var i = seen[q.domain]++;
      out[q.id] = Math.max(0, Math.min(4, base + jitter[i % jitter.length]));
    });
    return out;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function bullets(list) {
    return "<ul>" + list.map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul>";
  }

  /* ---------------- build ---------------- */

  function build() {
    var params = new URLSearchParams(window.location.search);
    var sample = params.get("sample");
    var answers = sample ? sampleAnswers(sample) : loadAnswers();
    var empty = document.getElementById("rpEmpty");
    var doc = document.getElementById("rpDoc");

    if (!answers || Object.keys(answers).length < QUESTIONS.length) {
      empty.classList.remove("hidden");
      return;
    }
    doc.classList.remove("hidden");

    if (sample) {
      var banner = document.getElementById("rpSample");
      if (banner) banner.classList.remove("hidden");
    }

    var r = computeScores(answers);
    var p = pickProfile(r);

    // cover
    document.getElementById("rpProfile").textContent = p.name;
    document.getElementById("rpTagline").textContent = p.tagline;
    document.getElementById("rpDate").textContent =
      new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
    var reportId = "FC-" + Math.abs(hash(JSON.stringify(answers))).toString(36).toUpperCase().slice(0, 8);
    document.getElementById("rpId").textContent = reportId;
    var foot = document.getElementById("rpIdFoot");
    if (foot) foot.textContent = reportId;

    // section 1 — interpretation (includes the three metric cards)
    var interp = document.getElementById("rpInterp");
    interp.innerHTML =
      "<p>You met <strong>" + r.positives + " of 6</strong> criteria on the Part A screener. " +
      "The validated threshold is <strong>4 or more</strong>. " +
      (r.flagged
        ? "Your result is <strong>at or above that threshold</strong>, which means your symptoms are " +
          "consistent with ADHD in adults and a professional evaluation is worth pursuing."
        : "Your result is <strong>below that threshold</strong>, which means your responses do not " +
          "currently indicate clinically significant ADHD symptoms — though the detail below still matters.") +
      "</p>" +
      "<p>Your answers were also split into two symptom clusters, which is where the useful detail " +
      "is. Rather than a single pass/fail number, this shows <em>which kind</em> of difficulty you " +
      "reported more of.</p>" +
      "<div class=\"metric-grid\">" +
        "<div class=\"metric\"><div class=\"k\">Screener</div><div class=\"v\">" + r.positives +
          "<small>/6</small></div><div class=\"d\">Criteria met</div></div>" +
        "<div class=\"metric\"><div class=\"k\">Inattention</div><div class=\"v\">" + r.inattention +
          "<small>%</small></div><div class=\"d\">Of maximum symptom load</div></div>" +
        "<div class=\"metric\"><div class=\"k\">Hyperactivity</div><div class=\"v\">" + r.hyperactive +
          "<small>%</small></div><div class=\"d\">Of maximum symptom load</div></div>" +
      "</div>" +
      "<div class=\"callout\"><strong>How to read the percentages.</strong> These are not scores out " +
      "of 100 in the usual sense — they express how much of the maximum possible symptom load you " +
      "reported in each cluster. A large gap between the two is the most informative part.</div>";

    // section 2 — profile
    document.getElementById("rpProfileName").textContent = p.name;
    document.getElementById("rpOverview").textContent = p.overview;

    // strongest signals
    var hot = QUESTIONS.filter(function (q) { return answers[q.id] >= 3; });
    var sig = document.getElementById("rpSignals");
    if (hot.length) {
      sig.innerHTML =
        "<p>These are the specific statements you rated <strong>Often</strong> or " +
        "<strong>Very Often</strong> — they are the strongest signals in your result:</p>" +
        "<div class=\"tag-list\">" +
        hot.map(function (q) {
          return "<span class=\"tag" + (answers[q.id] === 4 ? " hot" : "") + "\">" +
                 esc(shortLabel(q)) + "</span>";
        }).join("") + "</div>";
    } else {
      sig.innerHTML = "<p>You did not rate any statement as <strong>Often</strong> or " +
        "<strong>Very Often</strong>, which is consistent with the low symptom load in your result.</p>";
    }

    // section 3 — where it shows up
    document.getElementById("rpAreas").innerHTML = p.areas.map(function (a) {
      return "<h3>" + a[0] + "</h3><p>" + a[1] + "</p>";
    }).join("");

    // section 4 — strategies
    document.getElementById("rpStrategies").innerHTML =
      "<p>These are practical, evidence-informed approaches — not cures. Most people find that two " +
      "or three of them, applied consistently, make a bigger difference than trying all of them at once.</p>" +
      "<div class=\"strat\">" + p.strategies.map(function (s, i) {
        return "<div class=\"s\"><div class=\"i\">" + (i + 1) + "</div><div>" +
               "<h3>" + s[0] + "</h3><p>" + s[1] + "</p></div></div>";
      }).join("") + "</div>";

    // section 6 — 30 day plan
    var plan = buildPlan(r, p);
    document.getElementById("rpPlan").innerHTML = plan.map(function (s) {
      return "<div class=\"plan-step\"><div class=\"w\">" + s[0] + "</div>" +
             "<div class=\"c\"><h3>" + s[1] + "</h3><p>" + s[2] + "</p></div></div>";
    }).join("");

    // appendix table
    document.getElementById("rpTable").innerHTML =
      "<thead><tr><th style=\"width:34px\">#</th><th>Statement</th><th style=\"width:110px\">Your answer</th></tr></thead>" +
      "<tbody>" + QUESTIONS.map(function (q) {
        var v = answers[q.id];
        var cls = v >= 3 ? "hi" : (v <= 1 ? "lo" : "");
        return "<tr><td>" + q.id + "</td><td>" + esc(q.text) + "</td>" +
               "<td class=\"ans " + cls + "\">" + SCALE[v].label + "</td></tr>";
      }).join("") + "</tbody>";
  }

  function shortLabel(q) {
    var map = {
      1: "Finishing the last 10% of a project", 2: "Getting organised", 3: "Forgetting appointments",
      4: "Avoiding tasks that need deep thought", 5: "Fidgeting when seated", 6: "Feeling driven by a motor",
      7: "Careless mistakes", 8: "Losing focus on repetitive work", 9: "Not absorbing what people say",
      10: "Misplacing things", 11: "Distracted by noise", 12: "Leaving your seat",
      13: "Feeling restless", 14: "Difficulty unwinding", 15: "Talking too much",
      16: "Finishing others' sentences", 17: "Waiting your turn", 18: "Interrupting others"
    };
    return map[q.id] || ("Item " + q.id);
  }

  function buildPlan(r, p) {
    var base = [
      ["Week 1", "Capture everything in one place",
        "Pick a single system — paper, notes app, whiteboard — and put every commitment, idea and " +
        "task into it. The goal this week is not productivity, it is closing the gap between " +
        "\u201Cremembered\u201D and \u201Crecorded\u201D."],
      ["Week 2", "Make time visible",
        "Add a visible clock and a timer to where you work. Start timing how long things actually " +
        "take. Most people with attention difficulties underestimate task duration substantially."],
      ["Week 3", "Install one physical habit",
        "Choose a single intervention that fits your profile — movement breaks, a two-minute first " +
        "step, or a deliberate pause before purchases and replies. Run it every day for seven days."],
      ["Week 4", "Book the conversation",
        "If your result was at or above the threshold, book an appointment with a doctor or " +
        "psychologist. Bring this report and your appendix of responses — it makes the appointment " +
        "far more productive."]
    ];
    if (p.name.indexOf("Hyperactive") === 0) {
      base[2][1] = "Install one physical habit";
      base[2][2] = "Choose one intervention that fits your profile — structured exercise, a " +
        "physical pause before purchases, or a fidget outlet during meetings. Run it daily for " +
        "seven days.";
    }
    return base;
  }

  function hash(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; }
    return h;
  }

  document.addEventListener("DOMContentLoaded", build);

  /* Exposed so report-ai.js can reuse the same scoring and sample logic. */
  window.FocusCheckReport = {
    storageKey: KEY,
    loadAnswers: loadAnswers,
    scoreAnswers: computeScores,
    pickProfile: pickProfile,
    sampleAnswers: sampleAnswers
  };
})();
