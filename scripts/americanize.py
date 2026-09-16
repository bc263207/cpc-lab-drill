#!/usr/bin/env python3
"""One-off (re-runnable) British -> U.S. English conversion for project text.

Usage: python scripts/americanize.py [--check] [files...]
Default files: data/*.json, index.html, app/app.js, README.md, CLAUDE.md
--check only reports what would change.
"""
import io, re, sys, glob

PAIRS = [
    # medical
    ("haemoglobinopathies", "hemoglobinopathies"), ("haemoglobin", "hemoglobin"), ("haematinics", "hematinics"),
    ("haematology", "hematology"), ("haematocrit", "hematocrit"), ("haemodynamic", "hemodynamic"),
    ("haemolysed", "hemolyzed"), ("haemolysis", "hemolysis"), ("haemolytic", "hemolytic"), ("haemorrhage", "hemorrhage"),
    ("anaemia", "anemia"), ("anaemic", "anemic"), ("oedema", "edema"), ("paediatric", "pediatric"),
    ("anaesthesia", "anesthesia"), ("foetus", "fetus"), ("foetal", "fetal"), ("paracetamol", "acetaminophen"),
    ("hypoglycaemia", "hypoglycemia"), ("hyperglycaemia", "hyperglycemia"), ("hypoglycaemic", "hypoglycemic"),
    ("hyperglycaemic", "hyperglycemic"), ("glycaemic", "glycemic"), ("hyponatraemia", "hyponatremia"),
    ("hypernatraemia", "hypernatremia"), ("hyperkalaemia", "hyperkalemia"), ("hypokalaemia", "hypokalemia"),
    ("hypomagnesaemia", "hypomagnesemia"), ("hypocalcaemia", "hypocalcemia"), ("hypercalcaemia", "hypercalcemia"),
    ("ketonaemia", "ketonemia"), ("bacteraemia", "bacteremia"), ("uraemic", "uremic"), ("uraemia", "uremia"),
    ("ischaemia", "ischemia"), ("ischaemic", "ischemic"), ("leucocytosis", "leukocytosis"), ("leucocyte", "leukocyte"),
    ("dyspnoea", "dyspnea"), ("orthopnoea", "orthopnea"), ("melaena", "melena"), ("diarrhoea", "diarrhea"),
    ("myxoedema", "myxedema"), ("oesophageal", "esophageal"), ("oesophagus", "esophagus"), ("oestrogen", "estrogen"),
    ("sulphate", "sulfate"), ("sulphonylurea", "sulfonylurea"), ("faeces", "feces"), ("faecal", "fecal"),
    ("gynaecology", "gynecology"), ("orthopaedic", "orthopedic"), ("caesarean", "cesarean"), ("aetiology", "etiology"),
    ("adrenaline", "epinephrine"), ("noradrenaline", "norepinephrine"), ("salbutamol", "albuterol"), ("frusemide", "furosemide"),
    ("nebuliser", "nebulizer"), ("catheterised", "catheterized"), ("cannulation", "cannulation"),
    # general
    ("individualised", "individualized"), ("finalised", "finalized"), ("finalises", "finalizes"), ("finalise", "finalize"),
    ("colonised", "colonized"), ("colonisation", "colonization"), ("hospitalisation", "hospitalization"), ("hospitalised", "hospitalized"),
    ("recognise", "recognize"), ("recognised", "recognized"), ("organisation", "organization"), ("minimise", "minimize"),
    ("stabilise", "stabilize"), ("standardised", "standardized"), ("randomised", "randomized"), ("utilise", "utilize"),
    ("generalised", "generalized"), ("localised", "localized"), ("characterised", "characterized"), ("emphasise", "emphasize"),
    ("realise", "realize"), ("summarise", "summarize"), ("prioritise", "prioritize"), ("optimise", "optimize"),
    ("analyse", "analyze"), ("analysed", "analyzed"), ("centre", "center"), ("litre", "liter"), ("millilitre", "milliliter"),
    ("fibre", "fiber"), ("favour", "favor"), ("behaviour", "behavior"), ("colour", "color"), ("labour", "labor"),
    ("tumour", "tumor"), ("honour", "honor"), ("humour", "humor"), ("odour", "odor"), ("vapour", "vapor"),
    ("grey", "gray"), ("programme", "program"), ("whilst", "while"), ("amongst", "among"), ("ageing", "aging"),
    ("catalogue", "catalog"), ("aluminium", "aluminum"), ("mould", "mold"), ("judgement", "judgment"),
    ("practise", "practice"), ("licence", "license"), ("defence", "defense"), ("offence", "offense"),
    ("towards", "toward"), ("travelling", "traveling"), ("cancelled", "canceled"), ("labelling", "labeling"), ("modelling", "modeling"),
    ("counselling", "counseling"), ("counsellor", "counselor"), ("fulfil", "fulfill"), ("enrol", "enroll"), ("enrolment", "enrollment"),
    ("skilful", "skillful"), ("tyre", "tire"), ("kerb", "curb"), ("cheque", "check"), ("draught", "draft"), ("plough", "plow"),
    ("A&E", "ED"),
    # catch-alls, applied last
    ("over-clinicalising", "over-clinicalizing"), ("finalisation", "finalization"), ("haematological", "hematological"),
    ("haemodilution", "hemodilution"), ("hyperlipidaemia", "hyperlipidemia"), ("hypertriglyceridaemia", "hypertriglyceridemia"),
    ("pseudohyponatraemia", "pseudohyponatremia"), ("haem", "hem"), ("aemia", "emia"), ("aemic", "emic"),
]

def repl_factory(us):
    def repl(m):
        src = m.group(0)
        if src.isupper():
            return us.upper()
        if src[0].isupper():
            return us[0].upper() + us[1:]
        return us
    return repl

# Prefixes that are converted wherever they occur inside a word (haemoglobin,
# hypokalaemia, ...). Everything else must match a whole word, so that "enrol"
# does not rewrite "Enrollment".
SUBSTRING = {"haem", "aemia", "aemic"}


def convert(text):
    for uk, us in PAIRS:
        if uk in SUBSTRING:
            text = re.sub(r"(?i)" + re.escape(uk), repl_factory(us), text)
        else:
            text = re.sub(r"(?i)\b" + re.escape(uk) + r"\b", repl_factory(us), text)
    return text

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    check = "--check" in sys.argv
    files = args or (glob.glob("data/*.json") + ["index.html", "app/app.js", "README.md", "CLAUDE.md"])
    changed = 0
    for f in files:
        try:
            s = io.open(f, encoding="utf-8").read()
        except FileNotFoundError:
            continue
        t = convert(s)
        if t != s:
            changed += 1
            n = sum(1 for a, b in zip(s.split("\n"), t.split("\n")) if a != b)
            print("%s: %d line(s) changed" % (f, n))
            if not check:
                io.open(f, "w", encoding="utf-8", newline="\n").write(t)
    print("%d file(s) %s" % (changed, "would change" if check else "updated"))

if __name__ == "__main__":
    main()
