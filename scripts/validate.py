#!/usr/bin/env python3
"""Pre-deploy validation for the CP-C lab drill item bank.

Runs on every Netlify build (see netlify.toml) and locally with:
    python scripts/validate.py

Exits non-zero, failing the build, if any item breaks a rule in CLAUDE.md:
  - a value outside its band
  - a near-normal value inside the safety margin around a cutoff
  - a missing unit
  - a creatinine, hemoglobin, BNP or troponin value with no baseline
  - a troponin value between 0.04 and 0.4 ng/mL
  - an excluded (post-2016) drug or test
  - a blood ketone meter value in basic or advanced Arm A items (or any Arm B scenario)
  - a missing rationale, reference range or source
Plus structural checks (ids, labs, option keys, placeholders) and table-specific
prohibitions (no chloride items; no classification items on analytes the course
gives no range for), U.S. English spelling, and multiple-choice construction rules
(choice length balance, qualifiers, absolutes, overlap, answer-position patterns).

Python 3.8+ compatible, no third-party dependencies.
"""
import json
import os
import re
import sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")

LEVELS = ("basic", "advanced", "fiendish")
TYPES = ("classify", "mcq")
ANSWERS = ("normal", "abnormal", "baseline")
PROVENANCE = ("field", "record")

# Era boundary (CLAUDE.md). Matched case-insensitively against stem, baseline,
# rationale and option text.
EXCLUDED_TERMS = [
    (r"\bsglt2\b", "SGLT2 inhibitors"),
    (r"\b\w+gliflozin\b", "SGLT2 inhibitors (-gliflozin)"),
    (r"\beuglyc(a)?emic\b", "euglycemic DKA"),
    (r"\bdoacs?\b", "DOACs"),
    (r"\bnoacs?\b", "DOACs"),
    (r"\bapixaban\b|\brivaroxaban\b|\bdabigatran\b|\bedoxaban\b", "DOACs"),
    (r"\bage[- ]adjusted d-?dimer\b", "age-adjusted D-dimer"),
    (r"\bauc[- ]guided\b", "AUC-guided vancomycin"),
    (r"\bcovid\b|\bsars-cov-2\b|\bcoronavirus\b", "COVID-19 testing"),
    (r"\bsacubitril\b|\bentresto\b", "sacubitril-valsartan"),
    (r"\bhigh[- ]sensitivity troponin\b|\bhs-?ctn\w*\b|\bhs-?troponin\b", "high-sensitivity troponin"),
    (r"\bckd-epi\b", "CKD-EPI 2021"),
    # Rejected analytes
    (r"\btheophylline\b", "theophylline (rejected)"),
    (r"\bphenytoin\b", "phenytoin (rejected)"),
    (r"\bphenobarbital\b", "phenobarbital (rejected)"),
    (r"\banion gap\b", "anion gap (rejected)"),
    (r"\bosmolal gap\b", "osmolal gap (rejected)"),
    (r"\blipid panel\b|\bldl\b|\bhdl\b|\btriglycerides?\b", "lipid panel (rejected)"),
    (r"\buric acid\b", "uric acid (rejected)"),
    (r"\b(direct|indirect|conjugated|unconjugated) bilirubin\b", "split bilirubin (rejected)"),
]

BLOOD_KETONE_TERMS = [
    r"beta-?hydroxybutyrate", r"\bbhb\b", r"blood ketone", r"ketone meter", r"capillary ketone",
]

BASELINE_KEY_NAMES = ("baseline",)

# U.S. English is a hard requirement (CLAUDE.md). Any match is a build failure.
BRITISH_PATTERNS = [
    r"haem", r"\w+aemi[ac]\b", r"oedema", r"\bpaed", r"anaesth", r"\bfoet", r"paracetamol", r"dyspnoea", r"orthopnoea",
    r"melaena", r"diarrhoea", r"leucocyt", r"sulph", r"\boesoph", r"oestrogen", r"\bfaec", r"gynaec", r"orthopaed", r"aetiolog",
    r"\badrenaline\b", r"\bsalbutamol\b", r"\bfrusemide\b", r"nebuliser", r"catheterised",
    r"\b(colour|favour|behaviour|labour|tumour|honour|humour|odour|vapour|rigour|vigour|neighbour|harbour|flavour|savour|armour|endeavour)\w*\b",
    r"\b(centre|litre|millilitre|fibre|metre|theatre|calibre|sabre)s?\b",
    r"\b(programme|whilst|amongst|ageing|catalogue|aluminium|mould|judgement|licence|defence|offence|towards|travelling|cancelled|labelling|modelling|counselling|counsellor|fulfil|enrol|enrolment|skilful|tyre|kerb|cheque|draught|plough|grey|analyse|analysed|analysing|catalyse|paralyse|dialyse|hydrolyse)\b",
    r"\bA&E\b",
]
BRITISH_RE = [re.compile(p, re.I) for p in BRITISH_PATTERNS]

# -ise / -isation words are checked against an allowlist of words that are
# spelled that way in U.S. English too.
ISE_RE = re.compile(r"\b\w+is(e|ed|es|ing|ation|ations)\b", re.I)
ISE_OK = set("""advise advised advises advising arise arises arising comprise comprised comprises comprising compromise
compromised compromises compromising concise devise devised devises devising disguise exercise exercised exercises exercising
expertise franchise noise otherwise precise premise premises promise promised promises promising raise raised raises raising
revise revised revises revising rise rises rising supervise supervised supervises supervising surprise surprised surprises
surprising wise likewise clockwise demise excise incise incised reprise treatise enterprise merchandise paradise televise
chastise advertise advertised advertising apprise despise improvise improvised improvising bruise bruised bruises bruising
cruise guise poise turquoise anise valise reassure sunrise moonrise uprise arisen elise denise louise""".split())


def british_hit(text):
    for rx in BRITISH_RE:
        m = rx.search(text)
        if m:
            return m.group(0)
    for m in ISE_RE.finditer(text):
        w = m.group(0)
        stem = re.sub(r"(d|s|ing|ation|ations)$", "", w.lower())
        stem = stem if stem.endswith("ise") else stem + "e"
        if w.lower() not in ISE_OK and stem not in ISE_OK:
            return w
    return None


ABSOLUTES = re.compile(r"\b(always|never|only|must|all|none|every|any)\b", re.I)
QUALIFIERS = re.compile(r"\b(typically|generally|usually|often|may|might|most appropriate|unless|when indicated|as needed|if necessary|probably|likely)\b", re.I)
MCQ_LENGTH_WARN = 1.25
MCQ_LENGTH_FAIL = 1.5

# Labs the settled decisions say never produce a correct transport answer.
NO_TRANSPORT_LABS = ("HbA1c", "Albumin", "Hematinics — ferritin, B12, vitamin D", "Pending cultures and outstanding results at discharge")
URINE_KETONE_RESULTS = ("negative", "trace", "small", "moderate", "large")
TIERS = ("1", "2", "3", "4")

MCQ_SETS = []  # (id, options) for bank-level answer-pattern statistics

errors = []
warnings = []


def err(item_id, msg):
    errors.append("[%s] %s" % (item_id, msg))


def warn(item_id, msg):
    warnings.append("[%s] %s" % (item_id, msg))


def load(name):
    with open(os.path.join(DATA, name), encoding="utf-8") as fh:
        return json.load(fh)


def inside(lo, hi, interval):
    return interval[0] - 1e-9 <= lo and hi <= interval[1] + 1e-9


def overlaps(lo, hi, interval):
    return not (hi < interval[0] - 1e-9 or lo > interval[1] + 1e-9)


def fmt(v):
    return ("%g" % v)


def check_master_table(table):
    """Structural sanity on the source of truth."""
    labs = table.get("labs", [])
    panels = {p["id"] for p in table.get("panels", [])}
    if len(labs) != 40:
        err("table", "expected 40 analytes, found %d" % len(labs))
    if len(panels) != 13:
        err("table", "expected 13 panels, found %d" % len(panels))
    names = Counter(l["name"] for l in labs)
    for n, c in names.items():
        if c > 1:
            err("table", "duplicate lab name %r" % n)
    for l in labs:
        for key in ("panel", "name", "units", "ref", "bands", "baseline", "specimen", "source"):
            if key not in l or l[key] in ("", None):
                err("table", "%r missing %s" % (l.get("name"), key))
        if l.get("panel") not in panels:
            err("table", "%r references unknown panel %r" % (l.get("name"), l.get("panel")))
        levels = sorted(b.get("level") for b in l.get("bands", []))
        if levels != [1, 2, 3]:
            err("table", "%r bands are %s, expected [1, 2, 3]" % (l.get("name"), levels))
    return {l["name"]: l for l in labs}


def check_bands_file(bands, table_by_name):
    for lab, spec in bands["labs"].items():
        if lab not in table_by_name:
            err("bands", "lab %r is not in the master table" % lab)
        for set_name, s in spec.get("sets", {}).items():
            tag = "bands:%s/%s" % (lab, set_name)
            if not s.get("units"):
                err(tag, "set has no units")
            if "suffix" not in s:
                err(tag, "set has no suffix (use \"\" when the name carries the unit, e.g. pH, INR)")
            if "decimals" not in s or "plausible" not in s:
                err(tag, "set needs decimals and plausible")
            pl = s.get("plausible", [0, 0])
            nrm = s.get("normal")
            if nrm and not inside(nrm[0], nrm[1], pl):
                err(tag, "normal range %s outside plausible %s" % (nrm, pl))
            key = "ratioBands" if spec.get("relative") else "bands"
            for band, ivs in s.get(key, {}).items():
                ivs_list = [ivs] if spec.get("relative") else ivs
                for iv in ivs_list:
                    if iv[0] > iv[1]:
                        err(tag, "band %s interval %s is inverted" % (band, iv))
                    if not spec.get("relative") and not inside(iv[0], iv[1], pl):
                        err(tag, "band %s interval %s outside plausible %s" % (band, iv, pl))
            for iv in s.get("exclude", []):
                if iv[0] > iv[1]:
                    err(tag, "exclusion %s is inverted" % iv)
    for lab in bands.get("baselineRequired", []):
        if lab not in table_by_name:
            err("bands", "baselineRequired names unknown lab %r" % lab)


def resolve_set(bands, lab, set_name):
    spec = bands["labs"].get(lab)
    if not spec:
        return None, None
    return spec, spec.get("sets", {}).get(set_name)


def value_bounds(v):
    if "fixed" in v:
        return float(v["fixed"]), float(v["fixed"])
    return float(v["min"]), float(v["max"])


def check_value(item, key, v, bands, table_by_name):
    iid = item["id"]
    lab = v.get("lab", item["lab"])
    if lab not in table_by_name:
        err(iid, "value %r references unknown lab %r" % (key, lab))
        return None
    spec, s = resolve_set(bands, lab, v.get("set"))
    if spec is None:
        err(iid, "value %r: lab %r has no entry in bands.json" % (key, lab))
        return None
    if s is None:
        err(iid, "value %r: lab %r has no set %r" % (key, lab, v.get("set")))
        return None
    if not s.get("units"):
        err(iid, "value %r: set has no units (missing unit)" % key)

    if "fixed" not in v and ("min" not in v or "max" not in v):
        err(iid, "value %r needs min/max or fixed" % key)
        return None
    lo, hi = value_bounds(v)
    if lo > hi:
        err(iid, "value %r: min > max" % key)
        return None
    pl = s["plausible"]
    if not inside(lo, hi, pl):
        err(iid, "value %r: %s–%s outside plausible bounds %s" % (key, fmt(lo), fmt(hi), pl))

    step = v.get("step", 10 ** (-int(s["decimals"])))
    if step <= 0:
        err(iid, "value %r: step must be positive" % key)
    # step must be representable at the set's decimals
    if round(step, int(s["decimals"])) != step:
        err(iid, "value %r: step %s has more decimals than the set allows (%d)" % (key, step, s["decimals"]))

    if v.get("context"):
        return {"lab": lab, "set": s, "spec": spec, "lo": lo, "hi": hi, "context": True}

    band = v.get("band")
    if band is None:
        err(iid, "value %r has no band" % key)
        return None
    band = str(band)

    # Safety margins: never inside an exclusion zone.
    for iv in s.get("exclude", []):
        if overlaps(lo, hi, iv):
            err(iid, "value %r: %s–%s overlaps safety-margin exclusion %s (%s %s)" % (key, fmt(lo), fmt(hi), iv, lab, s["units"]))

    if spec.get("relative"):
        # Ratio bands relative to the baseline value spec.
        bkey = v.get("baselineKey", "baseline")
        base = item.get("values", {}).get(bkey)
        if not base or not base.get("context"):
            err(iid, "value %r: relative lab %r needs a context value spec named %r (or set baselineKey)" % (key, lab, bkey))
            return None
        blo, bhi = value_bounds(base)
        rlo, rhi = lo / bhi, hi / blo
        rb = s.get("ratioBands", {}).get(band)
        if rb is None:
            err(iid, "value %r: unknown ratio band %r" % (key, band))
        elif not inside(rlo, rhi, rb):
            err(iid, "value %r: today/baseline ratio %.3f–%.3f outside ratio band %s %s" % (key, rlo, rhi, band, rb))
        return {"lab": lab, "set": s, "spec": spec, "lo": lo, "hi": hi, "band": band, "ratio": (rlo, rhi)}

    if band == "0":
        nrm = s.get("normal")
        if nrm is None:
            err(iid, "value %r: set %r has no reference range, so band 0 is impossible" % (key, v.get("set")))
        elif not inside(lo, hi, nrm):
            err(iid, "value %r: %s–%s outside reference range %s" % (key, fmt(lo), fmt(hi), nrm))
    else:
        ivs = s.get("bands", {}).get(band)
        if ivs is None:
            err(iid, "value %r: set %r has no band %r" % (key, v.get("set"), band))
        elif not any(inside(lo, hi, iv) for iv in ivs):
            err(iid, "value %r: %s–%s not wholly inside any band-%s interval %s" % (key, fmt(lo), fmt(hi), band, ivs))

    # Hard rule: troponin never between 0.04 and 0.4 (and normal <= 0.02, abnormal >= 0.5).
    if lab == "Troponin":
        if overlaps(lo, hi, [0.03, 0.49]):
            err(iid, "troponin value %s–%s falls in the forbidden zone 0.04–0.4 ng/mL" % (fmt(lo), fmt(hi)))
        if band == "0" and hi > 0.02:
            err(iid, "normal troponin items must use values at or below 0.02 ng/mL")
        if band != "0" and lo < 0.5:
            err(iid, "abnormal troponin items must use values of 0.5 ng/mL or higher")
    return {"lab": lab, "set": s, "spec": spec, "lo": lo, "hi": hi, "band": band}


PLACEHOLDER = re.compile(r"\{([a-zA-Z0-9_]+)\}")


def item_texts(item):
    texts = [item.get("stem", ""), item.get("baseline", "") or "", item.get("rationale", "")]
    for o in item.get("options", []) or []:
        texts.append(o.get("text", ""))
    return texts


def check_mcq(iid, opts, length_exception=False):
    """Answer-choice construction rules (CLAUDE.md). Shared by Arm A items and Arm B follow-ups."""
    MCQ_SETS.append((iid, opts))
    if len(opts) < 3:
        err(iid, "mcq needs at least 3 options")
    correct = [o for o in opts if o.get("correct")]
    wrong = [o for o in opts if not o.get("correct")]
    if len(correct) != 1:
        err(iid, "mcq needs exactly one correct option, found %d" % len(correct))
    for o in opts:
        if not (o.get("text") or "").strip():
            err(iid, "empty option text")
    lens = [len(o.get("text", "")) for o in opts]
    ratio = float(max(lens)) / max(1, min(lens))
    if length_exception:
        pass  # enumerated names (drug lists, test names) differ in length for content reasons
    elif ratio > MCQ_LENGTH_FAIL:
        err(iid, "answer choices differ in length by %.0f%% (longest %d, shortest %d chars); keep within 25%%" % ((ratio - 1) * 100, max(lens), min(lens)))
    elif ratio > MCQ_LENGTH_WARN:
        warn(iid, "answer choices differ in length by %.0f%% (limit 25%% unless content requires it)" % ((ratio - 1) * 100))
    if correct:
        ct = correct[0].get("text", "")
        q = QUALIFIERS.search(ct)
        if q and not any(QUALIFIERS.search(o.get("text", "")) for o in wrong):
            warn(iid, "only the correct answer carries a qualifier (%r)" % q.group(0))
        if not ABSOLUTES.search(ct) and sum(1 for o in wrong if ABSOLUTES.search(o.get("text", ""))) >= 2:
            warn(iid, "absolutes appear in two or more distractors but not in the correct answer")
        for o in wrong:
            a, b = o.get("text", "").lower().rstrip("."), ct.lower().rstrip(".")
            if a and b and a != b and (a in b or b in a):
                warn(iid, "overlapping choices: %r and %r" % (o.get("text"), ct))


def scenario_texts(sc):
    """Every human-readable string in a scenario, for spelling, era and placeholder checks."""
    out = []
    p = sc.get("patient", {}) or {}
    out += [p.get("living", ""), p.get("goals", "")]
    out += list(p.get("diagnoses", []) or []) + list(p.get("medications", []) or []) + list(p.get("baselines", []) or [])
    out += [str(v) for v in (p.get("social", {}) or {}).values()]
    v = sc.get("visit", {}) or {}
    out += [v.get("reason", ""), v.get("history", ""), v.get("vitals", ""), v.get("exam", "")]
    out += [l.get("label", "") + " " + l.get("text", "") for l in sc.get("labs", []) or []]
    out += [sc.get("rationale", "")] + list(sc.get("factors", []) or [])
    fu = sc.get("followUp", {}) or {}
    out += [fu.get("stem", ""), fu.get("rationale", "")] + [o.get("text", "") for o in fu.get("options", []) or []]
    ask = sc.get("ask", {}) or {}
    out += [ask.get("stem", ""), sc.get("call", "")] + [o.get("text", "") for o in ask.get("options", []) or []]
    return [t for t in out if t]


def check_scenario(sc, bands, table_by_name, seen_ids, kind="B"):
    """kind B: disposition tier + follow-up. kind C: provider-call recommendation ('ask') + follow-up."""
    iid = sc.get("id")
    if not iid:
        errors.append("[?] scenario without id: %s" % json.dumps(sc)[:80])
        return
    if iid in seen_ids:
        err(iid, "duplicate id")
    seen_ids.add(iid)

    focus = sc.get("focus")
    if focus not in table_by_name:
        err(iid, "focus lab %r is not in the master table" % focus)
        return
    row = table_by_name[focus]
    if kind == "B":
        if str(sc.get("tier")) not in TIERS:
            err(iid, "tier must be 1-4")
    else:
        if "tier" in sc:
            err(iid, "provider-call scenarios carry no tier; every one is managed in place")
        ask = sc.get("ask")
        if not ask or not ask.get("stem") or not ask.get("options"):
            err(iid, "missing ask (the recommendation question)")
        else:
            check_mcq(iid + "/ask", ask["options"], ask.get("lengthException"))
        if not (sc.get("call") or "").strip():
            err(iid, "missing call (model phrasing of the recommendation)")
    if not sc.get("domain"):
        warn(iid, "no blueprint domain tag")
    if not (sc.get("title") or "").strip():
        err(iid, "missing title")

    # Patient card completeness (the Arm B patient model, CLAUDE.md).
    p = sc.get("patient") or {}
    for key in ("age", "sex", "living", "diagnoses", "medications", "baselines", "social", "goals"):
        if key not in p or p[key] in ("", None, [], {}):
            err(iid, "patient card missing %s" % key)
    for key in ("transport", "support", "adherence", "cognition", "mobility"):
        if not (p.get("social", {}) or {}).get(key):
            err(iid, "patient.social missing %s" % key)
    v = sc.get("visit") or {}
    for key in ("reason", "history", "vitals", "exam"):
        if not v.get(key):
            err(iid, "visit missing %s" % key)

    # Rationale, factors, reference range, source.
    if not (sc.get("rationale") or "").strip():
        err(iid, "missing rationale")
    if not sc.get("factors"):
        err(iid, "missing factors (the findings that drove the tier)")
    if not (row.get("ref") or "").strip():
        err(iid, "reference range could not be resolved from the focus row")
    if not ((sc.get("source") or row.get("source") or "").strip()):
        err(iid, "missing source")

    # Values: same engine as Arm A. Every value must name its lab.
    values = sc.get("values", {}) or {}
    pseudo = {"id": iid, "lab": focus, "values": values}
    resolved = {}
    for key, val in values.items():
        if not isinstance(val, dict):
            err(iid, "value %r must be an object" % key)
            continue
        if not val.get("lab"):
            err(iid, "value %r must name its lab" % key)
            continue
        r = check_value(pseudo, key, val, bands, table_by_name)
        if r:
            resolved[key] = r

    # Today's labs list.
    shown = set()
    for l in sc.get("labs", []) or []:
        if not l.get("label"):
            err(iid, "lab entry without a label")
        if "text" in l:
            txt = (l.get("text") or "").strip()
            if not txt:
                err(iid, "lab %r has an empty text result" % l.get("label"))
            if re.search(r"ketone", l.get("label", ""), re.I) and txt.lower() not in URINE_KETONE_RESULTS:
                err(iid, "urine ketone result must be one of %s, got %r" % (URINE_KETONE_RESULTS, txt))
            continue
        k = l.get("key")
        if k not in values:
            err(iid, "lab entry %r references unknown value %r" % (l.get("label"), k))
            continue
        if values[k].get("context"):
            err(iid, "lab entry %r shows a context (baseline) value as today's result" % l.get("label"))
        shown.add(k)

    # Placeholders resolve; every non-context value is shown as a lab or referenced in text.
    texts = scenario_texts(sc)
    used = set()
    for t in texts:
        for m in PLACEHOLDER.finditer(t):
            used.add(m.group(1))
            if m.group(1) not in values:
                err(iid, "placeholder {%s} has no value spec" % m.group(1))
    for key, val in values.items():
        if key not in used and key not in shown:
            err(iid, "value %r is defined but never shown" % key)

    # Baseline rule: creatinine, hemoglobin, BNP, troponin quoted today need a stated baseline.
    for key, r in resolved.items():
        if r.get("context"):
            continue
        lab = r["lab"]
        if lab in bands.get("baselineRequired", []):
            has_ctx = any(rr.get("context") and rr["lab"] == lab for rr in resolved.values())
            mentioned = any(re.search(re.escape(lab.split(" ")[0]), b, re.I) for b in p.get("baselines", []) or [])
            if not (has_ctx or mentioned):
                err(iid, "quotes %s today but the patient card states no baseline for it" % lab)

    # Focus lab must actually be quoted or be a qualitative row.
    focus_spec = bands["labs"].get(focus, {})
    if not focus_spec.get("qualitative") and focus not in [r["lab"] for r in resolved.values()]:
        warn(iid, "focus lab %r is not quoted in any value (acceptable when the missing test is the teaching point)" % focus)

    # Settled decisions.
    if kind == "B" and focus in NO_TRANSPORT_LABS and str(sc.get("tier")) in ("1", "2"):
        err(iid, "%s scenarios must not resolve to a transport tier (settled decision)" % focus)

    joined = "\n".join(texts).lower()
    for pattern in BLOOD_KETONE_TERMS:
        if re.search(pattern, joined):
            err(iid, "blood ketone meter content is not allowed in Arm B (matched %r)" % pattern)
    for pattern, label in EXCLUDED_TERMS:
        if re.search(pattern, joined):
            err(iid, "mentions excluded content: %s" % label)
    if re.search(r"\bmetformin\b.{0,60}\begfr\b|\begfr\b.{0,60}\bmetformin\b", joined, flags=re.S):
        err(iid, "metformin dosed by eGFR is excluded; build it on the creatinine cutoff")
    for t in texts:
        hit = british_hit(t)
        if hit:
            err(iid, "non-U.S. spelling %r" % hit)
            break

    # Follow-up question.
    fu = sc.get("followUp")
    if not fu or not fu.get("stem") or not fu.get("options"):
        err(iid, "missing followUp question")
    else:
        if not (fu.get("rationale") or "").strip():
            err(iid, "followUp missing rationale")
        check_mcq(iid + "/followUp", fu["options"], fu.get("lengthException"))


def check_item(item, bands, table_by_name, seen_ids):
    iid = item.get("id")
    if not iid:
        errors.append("[?] item without id: %s" % json.dumps(item)[:80])
        return
    if iid in seen_ids:
        err(iid, "duplicate id")
    seen_ids.add(iid)

    lab = item.get("lab")
    if lab not in table_by_name:
        err(iid, "unknown lab %r" % lab)
        return
    row = table_by_name[lab]
    if lab in bands.get("noItems", {}):
        err(iid, "items on %r are prohibited: %s" % (lab, bands["noItems"][lab]))

    if item.get("level") not in LEVELS:
        err(iid, "level must be one of %s" % (LEVELS,))
    if item.get("type") not in TYPES:
        err(iid, "type must be one of %s" % (TYPES,))
    if item.get("provenance") not in PROVENANCE:
        err(iid, "provenance must be one of %s" % (PROVENANCE,))
    if not item.get("domain"):
        warn(iid, "no blueprint domain tag")

    # Rationale, reference range, source.
    if not (item.get("stem") or "").strip():
        err(iid, "missing stem")
    if not (item.get("rationale") or "").strip():
        err(iid, "missing rationale")
    if not (row.get("ref") or "").strip():
        err(iid, "reference range could not be resolved from the master table")
    if not ((item.get("source") or row.get("source") or "").strip()):
        err(iid, "missing source")

    # Values.
    values = item.get("values", {}) or {}
    resolved = {}
    for key, v in values.items():
        if not isinstance(v, dict):
            err(iid, "value %r must be an object" % key)
            continue
        r = check_value(item, key, v, bands, table_by_name)
        if r:
            resolved[key] = r

    # Placeholders must resolve, and every value must be shown somewhere.
    used = set()
    for t in item_texts(item):
        for m in PLACEHOLDER.finditer(t):
            used.add(m.group(1))
            if m.group(1) not in values:
                err(iid, "placeholder {%s} has no value spec" % m.group(1))
    for key in values:
        if key not in used:
            err(iid, "value %r is defined but never shown (units would be missing)" % key)

    # Bare numbers that look like lab values written literally in the stem are
    # not validated; flag them so authors use a generator spec instead.
    stem = item.get("stem", "")
    stripped = PLACEHOLDER.sub("", stem)
    stripped = re.sub(r"\b\d{1,3}-year-old\b", "", stripped)
    stripped = re.sub(r"\b(type|stage|grade|day|cycle)\s*\d[ab]?\b", "", stripped, flags=re.I)
    stripped = re.sub(r"\b\d+(\.\d+)?\s*(kg|hours?|days?|weeks?|months?|years?|minutes?|%|°C|mL|g|mg|/day|tablets?|gauge|-gauge)\b", "", stripped)
    stripped = re.sub(r"\b(heart rate|pulse|blood pressure|saturation)\s*(of\s*)?\d+(/\d+)?%?", "", stripped, flags=re.I)
    stripped = re.sub(r"\b\d+\s*(to|:)\s*\d+\b", "", stripped)
    for m in re.finditer(r"(?<![\w.])\d+(\.\d+)?(?![\w.])", stripped):
        if item.get("type") == "mcq" and lab in ("Warfarin — dietary and drug influences on the INR", "White blood cell count", "BNP", "Rapid antigen testing — influenza and group A strep"):
            # These rows legitimately quote counts, hours and prior literal values noted in the baseline line.
            continue
        warn(iid, "literal number %r in stem; prefer a generator spec so units and bands are checked" % m.group(0))

    # Baseline requirement.
    labs_quoted = {lab} | {r["lab"] for r in resolved.values()}
    if labs_quoted & set(bands.get("baselineRequired", [])):
        if not (item.get("baseline") or "").strip():
            err(iid, "quotes %s but states no baseline" % sorted(labs_quoted & set(bands["baselineRequired"])))

    # Type-specific.
    if item.get("type") == "classify":
        if item.get("answer") not in ANSWERS:
            err(iid, "classify answer must be one of %s" % (ANSWERS,))
        if item.get("options"):
            err(iid, "classify items do not carry options")
        primary = resolved.get("value")
        if "value" not in values:
            err(iid, "classify items need a primary value spec named 'value'")
        elif primary:
            s = primary["set"]
            if s.get("normal") is None:
                err(iid, "classification item on a set with no reference range (%s/%s)" % (primary["lab"], values["value"].get("set")))
            ans = item.get("answer")
            if primary["spec"].get("relative"):
                nrm = s["normal"]
                abs_normal = inside(primary["lo"], primary["hi"], nrm)
                if ans == "normal" and not (abs_normal and primary["band"] == "0"):
                    err(iid, "answer 'normal' but value is not inside the reference range at ratio band 0")
                if ans == "baseline" and (abs_normal or primary["band"] not in ("0", "1")):
                    err(iid, "answer 'baseline' requires an abnormal absolute value within 25% of baseline")
                if ans == "abnormal" and abs_normal:
                    err(iid, "answer 'abnormal' but value is inside the reference range")
            else:
                if ans == "normal" and primary["band"] != "0":
                    err(iid, "answer 'normal' but primary value is band %s" % primary["band"])
                if ans in ("abnormal", "baseline") and primary["band"] == "0":
                    err(iid, "answer %r but primary value is in the reference range" % ans)
        if item.get("answer") == "baseline":
            if item.get("level") == "basic":
                err(iid, "basic items are normal-vs-abnormal only; 'baseline' answers belong in advanced or fiendish")
            if not (item.get("baseline") or "").strip():
                err(iid, "answer 'baseline' but no baseline is stated")
    elif item.get("type") == "mcq":
        if not item.get("options"):
            err(iid, "mcq needs options")
        if item.get("answer"):
            err(iid, "mcq items use options, not answer")
        if item.get("level") == "basic":
            err(iid, "basic items are classification only")

    # U.S. English.
    for t in item_texts(item):
        hit = british_hit(t)
        if hit:
            err(iid, "non-U.S. spelling %r" % hit)
            break

    # Multiple-choice construction (CLAUDE.md, item-writing rules).
    if item.get("type") == "mcq" and item.get("options"):
        check_mcq(iid, item["options"], item.get("lengthException"))

    # Era boundary and rejected content.
    joined = "\n".join(item_texts(item)).lower()
    for pattern, label in EXCLUDED_TERMS:
        if re.search(pattern, joined):
            err(iid, "mentions excluded content: %s" % label)
    if re.search(r"\bmetformin\b.{0,60}\begfr\b|\begfr\b.{0,60}\bmetformin\b", joined, flags=re.S):
        err(iid, "metformin dosed by eGFR is excluded; build it on the creatinine cutoff (1.5 men / 1.4 women)")

    # Blood ketone meters: fiendish Arm A only.
    if item.get("level") != "fiendish":
        for pattern in BLOOD_KETONE_TERMS:
            if re.search(pattern, joined):
                err(iid, "blood ketone meter content is fiendish-only (matched %r)" % pattern)

    # Table-specific prohibitions.
    if lab == "Amylase and lipase" and item.get("type") == "classify":
        err(iid, "the table forbids normal-vs-abnormal items on amylase/lipase")
    if lab == "Serum osmolality" and item.get("type") == "classify":
        err(iid, "the table forbids numeric classification items on osmolality")
    if lab == "HbA1c" or lab == "Albumin" or lab == "Hematinics — ferritin, B12, vitamin D" or lab == "Pending cultures and outstanding results at discharge":
        for o in item.get("options") or []:
            if o.get("correct") and re.search(r"\btransport\b", o.get("text", "").lower()) and not re.search(r"\b(no|not|never|nothing)\b.*\btransport\b|\btransport\b.*\b(is not|never)\b", o.get("text", "").lower()):
                err(iid, "%s items must not have a transport answer (settled decision)" % lab)

    return resolved


def main():
    table = load("lab-master-table.json")
    bands = load("bands.json")
    bank = load("arm-a-items.json")
    scen = load("arm-b-scenarios.json")
    calls = load("arm-c-calls.json")
    protocol = load("protocol.json")

    table_by_name = check_master_table(table)
    check_bands_file(bands, table_by_name)

    def walk(node, path):
        if isinstance(node, dict):
            for k, v in node.items():
                walk(v, path + "." + str(k))
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk(v, path + "[%d]" % i)
        elif isinstance(node, str):
            hit = british_hit(node)
            if hit:
                err(path, "non-U.S. spelling %r" % hit)
    walk(table, "table")
    walk(bands, "bands")
    walk(protocol, "protocol")
    if not protocol.get("sections"):
        err("protocol", "protocol.json has no sections")

    items = bank.get("items", [])
    seen = set()
    for item in items:
        check_item(item, bands, table_by_name, seen)

    scenarios = scen.get("scenarios", [])
    seen_b = set()
    for sc in scenarios:
        check_scenario(sc, bands, table_by_name, seen_b)
    call_scenarios = calls.get("scenarios", [])
    seen_c = set()
    for sc in call_scenarios:
        check_scenario(sc, bands, table_by_name, seen_c, kind="C")

    # Summary.
    by_level = Counter(i.get("level") for i in items)
    by_prov = Counter(i.get("provenance") for i in items)
    by_lab = Counter(i.get("lab") for i in items)
    total = len(items) or 1
    field_pct = 100.0 * by_prov.get("field", 0) / total

    print("CP-C lab drill — item bank validation")
    print("  items: %d  (basic %d, advanced %d, fiendish %d)" % (len(items), by_level.get("basic", 0), by_level.get("advanced", 0), by_level.get("fiendish", 0)))
    print("  provenance: field %d / record %d  (%.0f%% field; target about 70%%)" % (by_prov.get("field", 0), by_prov.get("record", 0), field_pct))
    if abs(field_pct - 70) > 12:
        warn("bank", "bank is %.0f%% field-obtainable (target about 70%%); the app samples sessions at 70/30 regardless" % field_pct)
    unused = [n for n in table_by_name if n not in by_lab and n not in bands.get("noItems", {})]
    if unused:
        warn("bank", "analytes with no items: %s" % ", ".join(unused))
    print("  analytes covered: %d of %d" % (len(by_lab), len(table_by_name)))

    # Arm B summary.
    by_tier = Counter(str(sc.get("tier")) for sc in scenarios)
    by_focus = Counter(sc.get("focus") for sc in scenarios)
    print("  scenarios (Arm B): %d  (tier 1 %d, tier 2 %d, tier 3 %d, tier 4 %d); focus labs covered: %d"
          % (len(scenarios), by_tier["1"], by_tier["2"], by_tier["3"], by_tier["4"], len(by_focus)))
    print("  provider calls (Arm C): %d; focus labs covered: %d" % (len(call_scenarios), len(set(sc.get("focus") for sc in call_scenarios))))
    if scenarios:
        for t in TIERS:
            share = 100.0 * by_tier[t] / len(scenarios)
            if share > 40 or share < 12:
                warn("bank", "tier %s is %.0f%% of scenarios; keep each tier between roughly 15%% and 35%%" % (t, share))

    # Answer-key patterns across every multiple-choice set (Arm A items and Arm B follow-ups).
    mcqs = MCQ_SETS
    if mcqs:
        pos = Counter()
        longest = middle = shortest = 0
        for _, opts in mcqs:
            ci = [k for k, o in enumerate(opts) if o.get("correct")]
            if not ci:
                continue
            pos["ABCD"[ci[0]] if ci[0] < 4 else str(ci[0])] += 1
            lens = sorted(len(o.get("text", "")) for o in opts)
            cl = len(opts[ci[0]].get("text", ""))
            if cl == lens[-1] and cl != lens[0]:
                longest += 1
            elif cl == lens[0] and cl != lens[-1]:
                shortest += 1
            else:
                middle += 1
        n = len(mcqs)
        print("  mcq sets: %d; correct answer is longest %d (%.0f%%), middle %d, shortest %d; key position A %d / B %d / C %d / D %d"
              % (n, longest, 100.0 * longest / n, middle, shortest, pos["A"], pos["B"], pos["C"], pos["D"]))
        if longest > 0.4 * n:
            warn("bank", "correct answer is the longest choice in %.0f%% of MCQ items; vary it" % (100.0 * longest / n))
        if shortest > 0.4 * n:
            warn("bank", "correct answer is the shortest choice in %.0f%% of MCQ items; vary it" % (100.0 * shortest / n))
        for k, v in pos.items():
            if v > 0.4 * n:
                warn("bank", "correct answer sits in position %s in %.0f%% of MCQ items" % (k, 100.0 * v / n))

    if warnings:
        print("\n%d warning(s):" % len(warnings))
        for w in warnings:
            print("  " + w)
    if errors:
        print("\n%d error(s):" % len(errors))
        for e in errors:
            print("  " + e)
        print("\nVALIDATION FAILED")
        sys.exit(1)
    print("\nVALIDATION PASSED")


if __name__ == "__main__":
    main()
