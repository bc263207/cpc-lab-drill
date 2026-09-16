/* CP-C Lab Drill — Arm A
 * Static, no build step. Loads the master table, the numeric band layer and the
 * item bank, randomizes values in the browser, gives instant feedback.
 * Collects nothing. State lives in memory for the current page only.
 */
(function () {
  "use strict";

  var DATA = {};          // table, bands, items
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
    var pool = poolFor(selectedLevel(), selectedPanels());
    var f = pool.filter(function (i) { return i.provenance === "field"; }).length;
    $("pool-note").textContent = pool.length
      ? pool.length + " items available (" + f + " field, " + (pool.length - f) + " record review)."
      : "No items match this selection.";
    $("start").disabled = !pool.length;
  }

  function startSession(items) {
    session = { items: items.map(renderItem), idx: 0, correct: 0, answered: 0, missed: [] };
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

    $("item-level").textContent = item.level;
    $("item-level").className = "chip level " + item.level;
    $("item-lab").textContent = item.lab;
    $("item-prov").textContent = item.provenance === "field" ? "field-obtainable" : "record review";
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
    session.items[session.idx] = renderItem(r.item);
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
    showView("summary");
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
    ["setup", "drill", "summary", "table", "about"].forEach(function (v) {
      $("view-" + v).classList.toggle("hidden", v !== name);
    });
    document.querySelectorAll("nav a").forEach(function (a) {
      a.classList.toggle("active", a.getAttribute("data-nav") === name || (name === "drill" && a.getAttribute("data-nav") === "setup"));
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
      var lab = el("label");
      var cb = el("input");
      cb.type = "checkbox"; cb.value = p.id; cb.checked = true;
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(" " + p.name));
      pc.appendChild(lab);
    });
    $("panels-all").addEventListener("click", function () { pc.querySelectorAll("input").forEach(function (i) { i.checked = true; }); updatePoolNote(); });
    $("panels-none").addEventListener("click", function () { pc.querySelectorAll("input").forEach(function (i) { i.checked = false; }); updatePoolNote(); });
    $("setup-form").addEventListener("change", updatePoolNote);
    $("setup-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var pool = poolFor(selectedLevel(), selectedPanels());
      var c = selectedCount();
      var n = c === "all" ? pool.length : Math.min(parseInt(c, 10), pool.length);
      startSession(buildSession(pool, n));
    });
    $("btn-next").addEventListener("click", next);
    $("btn-quit").addEventListener("click", function () {
      if (session && session.idx > 0) return showSummary();
      showView("setup");
    });
    $("btn-reroll").addEventListener("click", reroll);
    $("btn-again").addEventListener("click", function () { showView("setup"); });
    $("btn-retry-missed").addEventListener("click", function () { startSession(shuffle(session.missed.slice())); });
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
    fetchJSON("data/arm-a-items.json")
  ]).then(function (res) {
    DATA.table = res[0];
    DATA.bands = res[1];
    DATA.items = res[2].items;
    DATA.table.labs.forEach(function (l) { LAB[l.name] = l; });
    DATA.table.panels.forEach(function (p) { PANEL[p.id] = p; });
    buildTable();
    wire();
  }).catch(function (e) {
    $("main").innerHTML = "<p class='error'>Could not load the item bank: " + e.message + "</p>";
  });
})();
