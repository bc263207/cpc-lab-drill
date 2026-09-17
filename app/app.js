/* CP-C Lab Drill — Arm A
 * Static, no build step. Loads the master table, the numeric band layer and the
 * item bank, randomizes values in the browser, gives instant feedback.
 * Collects nothing. State lives in memory for the current page only.
 */
(function () {
  "use strict";

  var DATA = {};          // table, bands, items, scenarios, calls, protocol, tiers, glossary
  var LAB = {};           // lab name -> master table row
  var PANEL = {};         // panel id -> panel
  var session = null;     // { items: [rendered...], idx, correct, missed: [] }
  var FIELD_SHARE = 0.7;  // settled decision: about 70% field-obtainable per session

  var CLASSIFY_OPTIONS = {
    basic: [
      { key: "normal", text: "Normal" },
      { key: "abnormal", text: "Abnormal" }
    ],
    three: [
      { key: "normal", text: "Normal" },
      { key: "abnormal", text: "Abnormal" },
      { key: "baseline", text: "Abnormal, but this patient's baseline" }
    ]
  };

  // ---------- utilities ----------
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  function getSet(v, item) {
    var lab = v.lab || item.lab;
    var spec = DATA.bands.labs[lab];
    var s = spec && spec.sets[v.set];
    if (!s) throw new Error("No band set for " + lab + "/" + v.set + " in " + item.id);
    return s;
  }

  // Draw one value from a spec on the set's grid (decimals or explicit step).
  function drawValue(v, item) {
    var s = getSet(v, item);
    var n;
    if (v.fixed != null) {
      n = v.fixed;
    } else {
      var step = v.step || Math.pow(10, -s.decimals);
      var steps = Math.round((v.max - v.min) / step);
      n = v.min + step * Math.floor(Math.random() * (steps + 1));
    }
    n = Number(n.toFixed(s.decimals));
    return { n: n, text: formatValue(n, s) };
  }

  function formatValue(n, s) {
    var txt = s.decimals === 0 && Math.abs(n) >= 1000
      ? n.toLocaleString("en-US")
      : n.toFixed(s.decimals);
    if (!s.suffix) return txt;
    return txt + (s.nospace ? "" : " ") + s.suffix;
  }

  function fill(template, vals) {
    return (template || "").replace(/\{([a-zA-Z0-9_]+)\}/g, function (m, k) {
      return vals[k] ? vals[k].text : m;
    });
  }

  // Produce a concrete rendering of an item: numbers drawn, text filled, options shuffled.
  function renderItem(item) {
    var vals = {};
    Object.keys(item.values || {}).forEach(function (k) {
      vals[k] = drawValue(item.values[k], item);
    });
    var r = {
      item: item,
      vals: vals,
      stem: fill(item.stem, vals),
      baseline: item.baseline ? fill(item.baseline, vals) : "",
      rationale: fill(item.rationale, vals),
      options: []
    };
    if (item.type === "classify") {
      var opts = item.level === "basic" ? CLASSIFY_OPTIONS.basic : CLASSIFY_OPTIONS.three;
      r.options = opts.map(function (o) { return { text: o.text, correct: o.key === item.answer }; });
    } else {
      r.options = shuffle(item.options.map(function (o) { return { text: fill(o.text, vals), correct: !!o.correct }; }));
    }
    return r;
  }

  // ---------- vocabulary (Arm D) ----------
  var VSTYLES = ["define", "name", "apply"];
  var VSTYLE_LABEL = { define: "Define the term", name: "Name the term", apply: "Spot it in a vignette" };

  function vocabByCat(cat) { return DATA.glossary.terms.filter(function (t) { return t.cat === cat; }); }

  // Does the question text name this term? Such a term cannot be a distractor: it would be eliminable on sight.
  function mentioned(text, t) {
    var escaped = t.term.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(^|[^a-z])" + escaped + "([^a-z]|$)").test(text.toLowerCase());
  }

  // Three distractors: the term's listed confusables first, then random terms from the same category,
  // never one that the question text itself names.
  function vocabDistractors(term, stemText) {
    var byId = DATA.glossary.byId;
    var ok = function (t) { return t && t.id !== term.id && t.cat === term.cat && !mentioned(stemText, t); };
    var picks = shuffle((term.confusable || []).map(function (c) { return byId[c]; }).filter(ok)).slice(0, 3);
    if (picks.length < 3) {
      var pool = shuffle(vocabByCat(term.cat).filter(function (t) { return ok(t) && picks.indexOf(t) < 0; }));
      picks = picks.concat(pool.slice(0, 3 - picks.length));
    }
    return picks;
  }

  // Build one drill item from a term. Returns the same shape renderItem() produces, tagged kind: "vocab".
  function makeVocabItem(term, style) {
    var cat = DATA.glossary.categories[term.cat];
    var stemText = style === "define" ? term.term : (style === "name" ? term.definition : term.example);
    var others = vocabDistractors(term, stemText);
    var stem, opts;
    if (style === "define") {
      stem = "Which statement best defines " + term.term + "?";
      opts = [term].concat(others).map(function (t) { return { text: t.definition, correct: t === term, t: t }; });
    } else if (style === "name") {
      stem = term.definition + "  Which term does this describe?";
      opts = [term].concat(others).map(function (t) { return { text: t.term, correct: t === term, t: t }; });
    } else {
      stem = term.example + "  Which concept does this illustrate?";
      opts = [term].concat(others).map(function (t) { return { text: t.term, correct: t === term, t: t }; });
    }
    return {
      kind: "vocab",
      item: { kind: "vocab-seed", termId: term.id, style: style, lab: term.term, level: VSTYLE_LABEL[style], provenance: "" },
      term: term,
      style: style,
      cat: cat,
      stem: stem,
      baseline: "",
      rationale: term.term + ": " + term.definition + " Example: " + term.example,
      options: shuffle(opts),
      others: others
    };
  }

  function selectedVocabCats() {
    return Array.prototype.slice.call(document.querySelectorAll("#vcat-choices input:checked")).map(function (i) { return i.value; });
  }
  function selectedVocabStyle() { return document.querySelector("input[name=vstyle]:checked").value; }

  function vocabPool() {
    var cats = selectedVocabCats();
    return DATA.glossary.terms.filter(function (t) { return cats.indexOf(t.cat) >= 0; });
  }

  function buildVocabSession(n) {
    var style = selectedVocabStyle();
    return shuffle(vocabPool()).slice(0, n).map(function (t) {
      return makeVocabItem(t, style === "mixed" ? pick(VSTYLES) : style);
    });
  }

  // Concrete rendering of a scenario: numbers drawn, every text filled, follow-up shuffled.
  function renderScenario(sc) {
    var vals = {};
    Object.keys(sc.values || {}).forEach(function (k) {
      vals[k] = drawValue(sc.values[k], { id: sc.id, lab: sc.focus });
    });
    var f = function (t) { return fill(t, vals); };
    var p = sc.patient;
    var labs = (sc.labs || []).map(function (l) {
      return { label: f(l.label), value: l.text != null ? f(l.text) : (vals[l.key] ? vals[l.key].text : "") };
    });
    var fu = sc.followUp;
    // Primary question: fixed-order tiers (Arm B) or a shuffled recommendation set (Arm C).
    var primary;
    if (sc.ask) {
      primary = { kind: "ask", stem: f(sc.ask.stem), options: shuffle(sc.ask.options.map(function (o) { return { text: f(o.text), correct: !!o.correct }; })) };
    } else {
      primary = { kind: "tier", options: ["1", "2", "3", "4"].map(function (k) { return { tier: k, text: DATA.tiers[k], correct: String(sc.tier) === k }; }) };
    }
    return {
      sc: sc,
      vals: vals,
      primary: primary,
      call: sc.call ? f(sc.call) : "",
      patient: {
        title: p.age + "-year-old " + p.sex,
        living: f(p.living),
        diagnoses: p.diagnoses.map(f),
        medications: p.medications.map(f),
        baselines: p.baselines.map(f),
        social: p.social,
        goals: f(p.goals)
      },
      visit: { reason: f(sc.visit.reason), history: f(sc.visit.history), vitals: f(sc.visit.vitals), exam: f(sc.visit.exam) },
      labs: labs,
      rationale: f(sc.rationale),
      factors: (sc.factors || []).map(f),
      followUp: {
        stem: f(fu.stem),
        rationale: f(fu.rationale),
        options: shuffle(fu.options.map(function (o) { return { text: f(o.text), correct: !!o.correct }; }))
      }
    };
  }

  // Which master-table band does the primary value sit in? Returns {level, disp} or null.
  function primaryBand(item) {
    var vals = item.values || {};
    var v = vals.value;
    if (!v) {
      var keys = Object.keys(vals).filter(function (k) { return !vals[k].context && (vals[k].lab || item.lab) === item.lab; });
      v = keys.length ? vals[keys[0]] : null;
    }
    if (!v || v.context) return null;
    var band = String(v.band);
    var row = LAB[v.lab || item.lab];
    if (band === "0") return { level: 0, disp: "Inside the reference range." };
    var b = (row.bands || []).filter(function (x) { return String(x.level) === band; })[0];
    return b ? { level: b.level, disp: b.disp, val: b.val } : null;
  }

  // ---------- session building ----------
  function selectedPanels() {
    return Array.prototype.slice.call(document.querySelectorAll("#panel-choices input:checked")).map(function (i) { return i.value; });
  }
  function selectedLevel() { return document.querySelector("input[name=level]:checked").value; }
  function selectedMode() { return document.querySelector("input[name=mode]:checked").value; }
  function selectedCount() { return document.querySelector("input[name=count]:checked").value; }

  function poolFor(level, panels) {
    return DATA.items.filter(function (it) {
      if (level !== "mixed" && it.level !== level) return false;
      var row = LAB[it.lab];
      return panels.indexOf(row.panel) >= 0;
    });
  }

  // Weighted draw: ~70% field / 30% record, filling from the other pool when one runs dry.
  function buildSession(pool, n) {
    var field = shuffle(pool.filter(function (i) { return i.provenance === "field"; }));
    var record = shuffle(pool.filter(function (i) { return i.provenance !== "field"; }));
    var out = [];
    var wantField = Math.round(n * FIELD_SHARE);
    while (out.length < n && (field.length || record.length)) {
      var takeField = field.length && (out.filter(function (i) { return i.provenance === "field"; }).length < wantField || !record.length);
      out.push(takeField ? field.pop() : record.pop());
    }
    return shuffle(out);
  }

  function updatePoolNote() {
    var mode = selectedMode();
    document.querySelectorAll("#setup-form fieldset[data-mode]").forEach(function (fs) {
      fs.classList.toggle("hidden", fs.getAttribute("data-mode") !== mode);
    });
    if (mode === "D") {
      var vp = vocabPool().length;
      $("pool-note").textContent = vp ? vp + " terms available." : "No terms match this selection.";
      $("start").disabled = !vp;
      $("start").textContent = "Start vocabulary";
      return;
    }
    if (mode === "B" || mode === "C") {
      var n = (mode === "B" ? DATA.scenarios : DATA.calls).length;
      $("pool-note").textContent = n + " scenarios available.";
      $("start").disabled = !n;
      $("start").textContent = mode === "B" ? "Start scenarios" : "Start calls";
      return;
    }
    $("start").textContent = "Start drill";
    var pool = poolFor(selectedLevel(), selectedPanels());
    var f = pool.filter(function (i) { return i.provenance === "field"; }).length;
    $("pool-note").textContent = pool.length
      ? pool.length + " items available (" + f + " field, " + (pool.length - f) + " record review)."
      : "No items match this selection.";
    $("start").disabled = !pool.length;
  }

  function startSession(items) {
    var rendered = items.map(function (i) {
      if (i.kind === "vocab") return i;
      if (i.kind === "vocab-seed") return makeVocabItem(DATA.glossary.byId[i.termId], i.style);
      return renderItem(i);
    });
    session = { items: rendered, idx: 0, correct: 0, answered: 0, missed: [] };
    showView("drill");
    showItem();
  }

  // ---------- drill view ----------
  function showItem() {
    var r = session.items[session.idx];
    var item = r.item;
    $("progress-bar").style.width = (100 * session.idx / session.items.length) + "%";
    $("drill-count").textContent = "Item " + (session.idx + 1) + " of " + session.items.length;
    $("drill-score").textContent = session.idx ? session.correct + " correct so far" : "";

    if (r.kind === "vocab") {
      $("item-level").textContent = VSTYLE_LABEL[r.style];
      $("item-level").className = "chip level vocab";
      $("item-lab").textContent = r.cat.name;
      $("item-prov").textContent = "";
    } else {
      $("item-level").textContent = item.level;
      $("item-level").className = "chip level " + item.level;
      $("item-lab").textContent = item.lab;
      $("item-prov").textContent = item.provenance === "field" ? "field-obtainable" : "record review";
    }
    $("item-prov").classList.toggle("hidden", r.kind === "vocab");
    $("btn-reroll").textContent = r.kind === "vocab" ? "Same term, new choices" : "Same item, new values";
    $("item-stem").textContent = r.stem;
    $("item-baseline").textContent = r.baseline ? "Baseline: " + r.baseline : "";
    $("item-baseline").classList.toggle("hidden", !r.baseline);

    var box = $("item-options");
    box.innerHTML = "";
    r.options.forEach(function (o, i) {
      var b = el("button", "option", o.text);
      b.type = "button";
      b.addEventListener("click", function () { answer(i); });
      box.appendChild(b);
    });
    $("feedback").classList.add("hidden");
    window.scrollTo({ top: 0 });
  }

  function answer(i) {
    var r = session.items[session.idx];
    var item = r.item;
    var chosen = r.options[i];
    var buttons = $("item-options").querySelectorAll("button");
    buttons.forEach(function (b, j) {
      b.disabled = true;
      if (r.options[j].correct) b.classList.add("is-correct");
      else if (j === i) b.classList.add("is-wrong");
    });
    session.answered++;
    if (chosen.correct) session.correct++; else session.missed.push(item);

    if (r.kind === "vocab") {
      $("fb-verdict").textContent = chosen.correct ? "Correct" : "Not quite";
      $("fb-verdict").className = "verdict " + (chosen.correct ? "ok" : "bad");
      var ct = r.options.filter(function (o) { return o.correct; })[0].text;
      $("fb-answer").textContent = chosen.correct ? "" : "Correct answer: " + ct;
      $("fb-rationale").textContent = r.rationale;
      $("fb-ref-block").classList.add("hidden");
      $("fb-band-block").classList.add("hidden");
      $("fb-source").textContent = r.cat.source;
      $("fb-row-title").textContent = "The other choices";
      var vdl = $("fb-row");
      vdl.innerHTML = "";
      r.others.forEach(function (t) {
        vdl.appendChild(el("dt", null, t.term));
        vdl.appendChild(el("dd", null, t.definition));
      });
      $("feedback").classList.remove("hidden");
      $("feedback").scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    $("fb-ref-block").classList.remove("hidden");
    $("fb-row-title").textContent = "Master table row";

    var row = LAB[item.lab];
    $("fb-verdict").textContent = chosen.correct ? "Correct" : "Not quite";
    $("fb-verdict").className = "verdict " + (chosen.correct ? "ok" : "bad");
    var correctText = r.options.filter(function (o) { return o.correct; })[0].text;
    $("fb-answer").textContent = chosen.correct ? "" : "Correct answer: " + correctText;
    $("fb-rationale").textContent = r.rationale;
    $("fb-ref").textContent = row.ref + (row.units && row.units !== "—" && row.units !== "qualitative" ? " (" + row.units + ")" : "");
    var band = primaryBand(item);
    $("fb-band-block").classList.toggle("hidden", !band);
    if (band) {
      $("fb-band").textContent = band.level ? "Band " + band.level + " (" + band.val + "): " + band.disp : band.disp;
    }
    $("fb-source").textContent = item.source || row.source;

    var dl = $("fb-row");
    dl.innerHTML = "";
    var panel = PANEL[row.panel];
    [
      ["Panel", panel ? panel.name + " — " + panel.device : row.panel],
      ["Provenance", row.origin ? row.origin : "field (point-of-care)"],
      ["Units / SI", row.units + (row.si && row.si !== "—" ? "; SI " + row.si : "")],
      ["Variants", row.variants],
      ["Baseline note", row.baseline],
      ["Common causes", row.causes],
      ["Specimen", row.specimen]
    ].forEach(function (pair) {
      if (!pair[1]) return;
      dl.appendChild(el("dt", null, pair[0]));
      dl.appendChild(el("dd", null, pair[1]));
    });
    (row.bands || []).forEach(function (b) {
      dl.appendChild(el("dt", null, "Band " + b.level + ": " + b.val));
      dl.appendChild(el("dd", null, b.disp));
    });

    $("feedback").classList.remove("hidden");
    $("feedback").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function next() {
    session.idx++;
    if (session.idx >= session.items.length) return showSummary();
    showItem();
  }

  function reroll() {
    var r = session.items[session.idx];
    // Undo the tally for this item and re-render it with fresh numbers.
    var wasMissed = session.missed.indexOf(r.item);
    if (wasMissed >= 0) session.missed.splice(wasMissed, 1); else session.correct--;
    session.answered--;
    session.items[session.idx] = r.kind === "vocab" ? makeVocabItem(r.term, r.style) : renderItem(r.item);
    showItem();
  }

  function showSummary() {
    var n = session.answered;
    $("summary-score").textContent = n ? session.correct + " of " + n + " correct" : "No items answered";
    var box = $("summary-missed");
    box.innerHTML = "";
    if (session.missed.length) {
      box.appendChild(el("h3", null, "Missed"));
      var ul = el("ul", "missed");
      session.missed.forEach(function (it) {
        ul.appendChild(el("li", null, it.lab + " (" + it.level + ")"));
      });
      box.appendChild(ul);
    }
    $("btn-retry-missed").classList.toggle("hidden", !session.missed.length);
    bSession = null;
    showView("summary");
  }

  // ---------- scenario session ----------
  var bSession = null; // { items: [rendered...], idx, tierCorrect, fuCorrect, answered, missed: [] }

  function startScenarioSession(list) {
    bSession = { items: list.map(renderScenario), idx: 0, tierCorrect: 0, fuCorrect: 0, answered: 0, missed: [] };
    showView("scenario");
    showScenario();
  }

  function ul(id, arr) {
    var u = $(id);
    u.innerHTML = "";
    arr.forEach(function (t) { u.appendChild(el("li", null, t)); });
  }

  function showScenario() {
    var r = bSession.items[bSession.idx];
    var sc = r.sc;
    $("sc-progress").style.width = (100 * bSession.idx / bSession.items.length) + "%";
    $("sc-count").textContent = "Scenario " + (bSession.idx + 1) + " of " + bSession.items.length;
    $("sc-score").textContent = bSession.answered ? bSession.tierCorrect + " correct so far" : "";
    $("sc-focus").textContent = sc.focus;
    $("sc-domain").textContent = "domain " + sc.domain;

    $("sc-patient-title").textContent = r.patient.title;
    $("sc-living").textContent = r.patient.living;
    ul("sc-dx", r.patient.diagnoses);
    ul("sc-meds", r.patient.medications);
    ul("sc-baselines", r.patient.baselines);
    var dl = $("sc-social");
    dl.innerHTML = "";
    [["Transportation", "transport"], ["Support", "support"], ["Adherence", "adherence"], ["Cognition", "cognition"], ["Mobility", "mobility"]].forEach(function (pair) {
      dl.appendChild(el("dt", null, pair[0]));
      dl.appendChild(el("dd", null, r.patient.social[pair[1]]));
    });
    $("sc-goals").textContent = r.patient.goals;

    $("sc-reason").textContent = r.visit.reason;
    $("sc-history").textContent = r.visit.history;
    $("sc-vitals").textContent = r.visit.vitals;
    $("sc-exam").textContent = r.visit.exam;

    var t = $("sc-labs");
    t.innerHTML = "";
    r.labs.forEach(function (l) {
      var tr = el("tr");
      tr.appendChild(el("th", null, l.label));
      tr.appendChild(el("td", null, l.value));
      t.appendChild(tr);
    });

    var isAsk = r.primary.kind === "ask";
    $("sc-primary-title").textContent = isAsk ? "Recommendation" : "Disposition";
    $("sc-primary-stem").textContent = isAsk ? r.primary.stem : "";
    $("sc-primary-stem").classList.toggle("hidden", !isAsk);
    $("sc-factors-title").textContent = isAsk ? "What drove the recommendation" : "What drove the tier";
    var box = $("sc-tiers");
    box.innerHTML = "";
    r.primary.options.forEach(function (o, i) {
      var b = el("button", isAsk ? "option" : "option tier");
      b.type = "button";
      if (isAsk) {
        b.textContent = o.text;
      } else {
        b.appendChild(el("span", "tier-num", "Tier " + o.tier));
        b.appendChild(el("span", null, o.text));
      }
      b.addEventListener("click", function () { answerPrimary(i); });
      box.appendChild(b);
    });
    $("sc-feedback").classList.add("hidden");
    $("sc-followup").classList.add("hidden");
    $("fu-feedback").classList.add("hidden");
    window.scrollTo({ top: 0 });
  }

  function answerPrimary(i) {
    var r = bSession.items[bSession.idx];
    var sc = r.sc;
    var opts = r.primary.options;
    var correct = !!opts[i].correct;
    $("sc-tiers").querySelectorAll("button").forEach(function (b, j) {
      b.disabled = true;
      if (opts[j].correct) b.classList.add("is-correct");
      else if (j === i) b.classList.add("is-wrong");
    });
    bSession.answered++;
    if (correct) bSession.tierCorrect++; else bSession.missed.push(sc);

    var row = LAB[sc.focus];
    var right = opts.filter(function (o) { return o.correct; })[0];
    $("sc-verdict").textContent = correct ? "Correct" : "Not quite";
    $("sc-verdict").className = "verdict " + (correct ? "ok" : "bad");
    $("sc-answer").textContent = correct ? "" : (r.primary.kind === "tier"
      ? "Correct disposition: Tier " + right.tier + " — " + right.text
      : "Correct recommendation: " + right.text);
    $("sc-call-block").classList.toggle("hidden", !r.call);
    $("sc-call").textContent = r.call;
    $("sc-rationale").textContent = r.rationale;
    ul("sc-factors", r.factors);
    $("sc-ref").textContent = row.name + ": " + row.ref + (row.units && row.units !== "—" && row.units !== "qualitative" ? " (" + row.units + ")" : "");
    $("sc-source").textContent = sc.source || row.source;
    var dl = $("sc-row");
    dl.innerHTML = "";
    [["Baseline note", row.baseline], ["Common causes", row.causes], ["Specimen", row.specimen]].forEach(function (pair) {
      if (!pair[1]) return;
      dl.appendChild(el("dt", null, pair[0]));
      dl.appendChild(el("dd", null, pair[1]));
    });
    (row.bands || []).forEach(function (b) {
      dl.appendChild(el("dt", null, "Band " + b.level + ": " + b.val));
      dl.appendChild(el("dd", null, b.disp));
    });
    $("sc-feedback").classList.remove("hidden");

    // Follow-up question.
    $("fu-stem").textContent = r.followUp.stem;
    var fo = $("fu-options");
    fo.innerHTML = "";
    r.followUp.options.forEach(function (o, i) {
      var b = el("button", "option", o.text);
      b.type = "button";
      b.addEventListener("click", function () { answerFollowUp(i); });
      fo.appendChild(b);
    });
    $("sc-followup").classList.remove("hidden");
    $("sc-feedback").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function answerFollowUp(i) {
    var r = bSession.items[bSession.idx];
    var chosen = r.followUp.options[i];
    $("fu-options").querySelectorAll("button").forEach(function (b, j) {
      b.disabled = true;
      if (r.followUp.options[j].correct) b.classList.add("is-correct");
      else if (j === i) b.classList.add("is-wrong");
    });
    if (chosen.correct) bSession.fuCorrect++;
    $("fu-verdict").textContent = chosen.correct ? "Correct" : "Not quite";
    $("fu-verdict").className = "verdict " + (chosen.correct ? "ok" : "bad");
    var ct = r.followUp.options.filter(function (o) { return o.correct; })[0].text;
    $("fu-answer").textContent = chosen.correct ? "" : "Correct answer: " + ct;
    $("fu-rationale").textContent = r.followUp.rationale;
    $("fu-feedback").classList.remove("hidden");
    $("fu-feedback").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function nextScenario() {
    bSession.idx++;
    if (bSession.idx >= bSession.items.length) return showScenarioSummary();
    showScenario();
  }

  function showScenarioSummary() {
    var n = bSession.answered;
    $("summary-score").textContent = n
      ? bSession.tierCorrect + " of " + n + (bSession.items[0].primary.kind === "tier" ? " dispositions" : " recommendations") + " correct; " + bSession.fuCorrect + " of " + n + " follow-ups"
      : "No scenarios answered";
    var box = $("summary-missed");
    box.innerHTML = "";
    if (bSession.missed.length) {
      box.appendChild(el("h3", null, "Missed dispositions"));
      var u = el("ul", "missed");
      bSession.missed.forEach(function (sc) { u.appendChild(el("li", null, sc.title + (sc.tier ? " (tier " + sc.tier + ")" : ""))); });
      box.appendChild(u);
    }
    $("btn-retry-missed").classList.toggle("hidden", !bSession.missed.length);
    session = null;
    showView("summary");
  }

  function renderProtocol(container) {
    container.innerHTML = "";
    DATA.protocol.sections.forEach(function (sec) {
      container.appendChild(el("h3", null, sec.title));
      var u = el("ul", "proto");
      sec.items.forEach(function (t) { u.appendChild(el("li", null, t)); });
      container.appendChild(u);
    });
  }

  // ---------- table view ----------
  function buildTable() {
    var body = $("table-body");
    body.innerHTML = "";
    DATA.table.panels.forEach(function (p) {
      var sec = el("section", "panel");
      sec.appendChild(el("h2", null, p.name));
      sec.appendChild(el("p", "muted", p.device));
      DATA.table.labs.filter(function (l) { return l.panel === p.id; }).forEach(function (l) {
        var d = el("details", "card lab-row");
        var s = el("summary");
        s.appendChild(el("b", null, l.name));
        s.appendChild(el("span", "muted", " " + l.ref + (l.units && l.units !== "—" ? " " + l.units : "")));
        if (l.origin) s.appendChild(el("span", "chip prov", l.origin));
        if (l.gap) s.appendChild(el("span", "chip gap", "gap area"));
        d.appendChild(s);
        var dl = el("dl");
        [["Variants", l.variants], ["Baseline note", l.baseline], ["Common causes", l.causes], ["Specimen", l.specimen], ["Source", l.source]].forEach(function (pair) {
          if (!pair[1]) return;
          dl.appendChild(el("dt", null, pair[0]));
          dl.appendChild(el("dd", null, pair[1]));
        });
        l.bands.forEach(function (b) {
          dl.appendChild(el("dt", null, "Band " + b.level + ": " + b.val));
          dl.appendChild(el("dd", null, b.disp));
        });
        d.appendChild(dl);
        sec.appendChild(d);
      });
      body.appendChild(sec);
    });
  }

  // ---------- navigation ----------
  function showView(name) {
    ["setup", "drill", "scenario", "summary", "table", "about"].forEach(function (v) {
      $("view-" + v).classList.toggle("hidden", v !== name);
    });
    document.querySelectorAll("nav a").forEach(function (a) {
      a.classList.toggle("active", a.getAttribute("data-nav") === name);
    });
    window.scrollTo({ top: 0 });
  }

  function wire() {
    document.querySelectorAll("[data-nav]").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        showView(a.getAttribute("data-nav"));
      });
    });

    var pc = $("panel-choices");
    DATA.table.panels.forEach(function (p) {
      var lab = el("label", "pill");
      var cb = el("input");
      cb.type = "checkbox"; cb.value = p.id; cb.checked = true;
      lab.appendChild(cb);
      lab.appendChild(el("span", null, p.name));
      pc.appendChild(lab);
    });
    var vc = $("vcat-choices");
    Object.keys(DATA.glossary.categories).forEach(function (cid) {
      var lab = el("label", "pill");
      var cb = el("input");
      cb.type = "checkbox"; cb.value = cid; cb.checked = true;
      lab.appendChild(cb);
      lab.appendChild(el("span", null, DATA.glossary.categories[cid].name));
      vc.appendChild(lab);
    });
    $("vcats-all").addEventListener("click", function () { vc.querySelectorAll("input").forEach(function (i) { i.checked = true; }); syncSelection(); updatePoolNote(); });
    $("vcats-none").addEventListener("click", function () { vc.querySelectorAll("input").forEach(function (i) { i.checked = false; }); syncSelection(); updatePoolNote(); });

    // Mirror input state onto the styled labels (cards, pills, segments).
    function syncSelection() {
      document.querySelectorAll("#setup-form label").forEach(function (lab) {
        var i = lab.querySelector("input");
        if (i) lab.classList.toggle("selected", i.checked);
      });
    }
    $("panels-all").addEventListener("click", function () { pc.querySelectorAll("input").forEach(function (i) { i.checked = true; }); syncSelection(); updatePoolNote(); });
    $("panels-none").addEventListener("click", function () { pc.querySelectorAll("input").forEach(function (i) { i.checked = false; }); syncSelection(); updatePoolNote(); });
    $("setup-form").addEventListener("change", function () { syncSelection(); updatePoolNote(); });
    syncSelection();
    $("setup-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var c = selectedCount();
      if (selectedMode() === "D") {
        var vp = vocabPool().length;
        startSession(buildVocabSession(c === "all" ? vp : Math.min(parseInt(c, 10), vp)));
        return;
      }
      if (selectedMode() === "B" || selectedMode() === "C") {
        var all = shuffle((selectedMode() === "B" ? DATA.scenarios : DATA.calls).slice());
        var m = c === "all" ? all.length : Math.min(parseInt(c, 10), all.length);
        startScenarioSession(all.slice(0, m));
        return;
      }
      var pool = poolFor(selectedLevel(), selectedPanels());
      var n = c === "all" ? pool.length : Math.min(parseInt(c, 10), pool.length);
      startSession(buildSession(pool, n));
    });
    $("sc-next").addEventListener("click", nextScenario);
    $("sc-quit").addEventListener("click", function () {
      if (bSession && bSession.answered > 0) return showScenarioSummary();
      showView("setup");
    });
    $("btn-next").addEventListener("click", next);
    $("btn-quit").addEventListener("click", function () {
      if (session && session.idx > 0) return showSummary();
      showView("setup");
    });
    $("btn-reroll").addEventListener("click", reroll);
    $("btn-again").addEventListener("click", function () { showView("setup"); });
    $("btn-retry-missed").addEventListener("click", function () {
      if (session) startSession(shuffle(session.missed.slice()));
      else if (bSession) startScenarioSession(shuffle(bSession.missed.slice()));
    });
    renderProtocol($("sc-protocol"));
    renderProtocol($("about-protocol"));
    $("protocol-title").textContent = DATA.protocol.name;
    $("protocol-summary").textContent = DATA.protocol.summary;
    updatePoolNote();
  }

  function fetchJSON(url) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ": " + r.status);
      return r.json();
    });
  }

  Promise.all([
    fetchJSON("data/lab-master-table.json"),
    fetchJSON("data/bands.json"),
    fetchJSON("data/arm-a-items.json"),
    fetchJSON("data/arm-b-scenarios.json"),
    fetchJSON("data/protocol.json"),
    fetchJSON("data/arm-c-calls.json"),
    fetchJSON("data/arm-d-glossary.json")
  ]).then(function (res) {
    DATA.calls = res[5].scenarios;
    DATA.glossary = res[6];
    DATA.glossary.byId = {};
    DATA.glossary.terms.forEach(function (t) { DATA.glossary.byId[t.id] = t; });
    DATA.table = res[0];
    DATA.bands = res[1];
    DATA.items = res[2].items;
    DATA.scenarios = res[3].scenarios;
    DATA.tiers = res[3].tiers;
    DATA.protocol = res[4];
    DATA.table.labs.forEach(function (l) { LAB[l.name] = l; });
    DATA.table.panels.forEach(function (p) { PANEL[p.id] = p; });
    buildTable();
    wire();
  }).catch(function (e) {
    $("main").innerHTML = "<p class='error'>Could not load the item bank: " + e.message + "</p>";
  });
})();
