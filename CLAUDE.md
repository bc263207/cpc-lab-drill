# CP-C Question Generator — Build Spec

Working document. Covers what is decided, what is open, and the rules any item must follow. Claude Code reads this file at the start of every session. Follow it.

## What this is

A practice app for the IBSC CP-C exam. Primary purpose: **exam pass rate.** Two arms.

- **Arm A: lab value drill.** Three-way classification: normal, abnormal, or abnormal-but-baseline-for-this-patient.
- **Arm B: disposition scenarios.** The main product. A lab value is one input among several, never the deciding factor on its own.

Arm A is the drill layer feeding Arm B.

## Build and hosting

- Static website. No backend, no login, no live AI generation.
- Item bank stored as JSON in this repo. Randomization runs in the browser.
- Hosted on Netlify, deployed automatically from this GitHub repo.
- Ungraded drill only. Instant feedback with rationale, reference range, and source.
- Collect no student names, emails, or other identifiers.
- Moodle integration deferred. Keep the item bank format clean so a Moodle XML export can be added later.
- Build Arm A first. Arm B waits for the patient model.

## Source documents

| Source | Status |
|---|---|
| IBSC CP-C Detailed Content Outline, 2019 | Governs blueprint alignment and item proportions. 18 + 20 + 27 + 13 + 21 + 11 = 110 scored items. |
| AAOS *Community Health Paramedicine*, Jones & Bartlett, ©2018 (1st ed.) | Governs reference ranges. Students cross-check against it. |
| ASCP C/SC Chemistry Content Guideline | Cross-reference only. Its ranges were not adopted. |

## Blueprint domains

Item proportions mirror this split.

| Domain | Items |
|---|---|
| Patient/Client Centric Care | 27 |
| Wellness and Safety | 21 |
| Preventative Care and Education | 20 |
| Patient/Client Centric Care — assessment | 18 |
| Community Based Needs | 13 |
| Ethical and Legal | 11 |

Lab interpretation is a small slice: lab values (3ff), point-of-care testing (3e), specimen collection (3f), glucometers (3p). Disposition reasoning reaches further: 3ii, 3jj, 3kk, 3ll, 2d, 2e, 2i, 2h, 3mm, 2a, 2b, 3k.

## Data

- `data/lab-master-table.json` — exported from the lab master table artifact. Single source of truth for both arms. 40 analytes, 13 panels.
- Each row carries: provenance (field or record review), units and SI conversion, reference range, three abnormality bands each with a disposition consequence, baseline note, common causes in a homebound population, specimen integrity, source, and a verified flag.
- Do not add analytes for now. Future additions need a table row first.

## Era boundary — hard rule

Effective literature cutoff is roughly 2016.

**Excluded:** SGLT2 inhibitors and euglycemic DKA, DOACs, age-adjusted D-dimer, AUC-guided vancomycin, COVID-19 testing, sacubitril-valsartan, high-sensitivity troponin, metformin dosed by eGFR, CKD-EPI 2021.

**Included despite being dated:** digoxin 0.8–2.0, heavy warfarin coverage, creatinine-based metformin cutoff (1.5 mg/dL men, 1.4 women), Cockcroft-Gault and 24-hour urine creatinine clearance, PT and aPTT.

**Rejected:** theophylline, phenytoin, phenobarbital, anion gap, osmolal gap, lipid panel, uric acid, split bilirubin.

Era tags only where standards contradict: troponin, lactate units, digoxin.

## Arm A difficulty levels

- **Basic:** normal vs abnormal. Values clearly inside or clearly outside the range. Units always shown.
- **Advanced:** the gap areas: baseline-abnormal-is-normal, trend vs snapshot, medication-lab interactions, outpatient anticoagulation, BNP nuance, rule-out logic.
- **Fiendish:** test-taking traps.
  - Near-normal values, but always with a safety margin from the cutoff (see validation rules). Never a value that could be normal on one lab's report and abnormal on another's.
  - Look-alike distractors: answer choices that mirror similar labs (for example, PT vs aPTT, BUN vs creatinine, troponin vs CK-MB).
  - Specimen integrity traps (hemolyzed potassium).
  - Unit traps (lactate mg/dL vs mmol/L).
  - Values that look alarming but do not change today's plan.
  - Blood ketone (beta-hydroxybutyrate) meters, including why urine dipsticks can under-read early in DKA. Fiendish only.
  - Designed to expand later with more test-taking techniques.

## Arm B disposition tiers

1. Emergent ED transport now
2. Same-day evaluation, non-emergent
3. PCP or clinic within 24–48 hours
4. Manage in place with follow-up or care coordination

Breaking the medic's transport-or-refusal habit is most of the work.

Ketones in scenarios are urine dipstick results only. Never use blood ketone meter values in Arm B.

## Settled decisions

- Content targets the knowledge gap, not the basics.
- Arm A provenance: about 70% field-obtainable, 30% record review. Arm B mixes freely.
- Record-review values mostly generate care-plan, reconciliation, and coordination items, not disposition items.
- Every item quoting creatinine, hemoglobin, BNP, or troponin must state a baseline. Enforced in the template.
- Albumin, hematinics, HbA1c, and pending cultures are designed with no correct transport answer. Preserve this.
- **Sepsis:** Sepsis-3. Lactate over 4 mmol/L threshold stands.
- **Troponin:** the textbook (0–0.4 ng/mL) and the conventional troponin I cutoff (about 0.04 ng/mL) differ tenfold. Randomized troponin values must never fall between 0.04 and 0.4. Normal items use values at or below 0.02. Abnormal items use values of 0.5 or higher. The row notes the discrepancy.

## Open

1. **Arm B patient model.** Next content step. Fields likely needed: demographics, diagnoses, baseline labs with dates, current medications, social and functional context (transportation, support at home, adherence history), and protocol authority.
2. **Mechanical mitral valve INR target (2.5–3.5).** Textbook gives only 2.0–3.0. Noted in the row, not removed.
3. **Public health vocabulary arm.** Community Based Needs plus Preventative Care is 33 of 110 items. Terms like "windshield assessment" live here. Likely needs its own arm or glossary drill.
4. **Additional analytes** for fiendish. Deferred.
5. **Moodle export.** Deferred.

## Item-writing rules

1. Ranges come from the course textbook. Where a clinical range differs materially, note it in the row.
2. State units on every value.
3. No value without patient context where the row's baseline note requires it.
4. Every item carries a rationale, the reference range, and a source.
5. Randomize values inside the defined band. Never outside it.
6. Arm B answer keys must come from the same table Arm A uses.
7. Do not quote critical-value cutoffs until verified against the local lab.

## Multiple-choice construction — hard rules

A knowledgeable learner identifies the correct answer because they understand the content, never because of a pattern in the choices. Every multiple-choice item, in both arms:

- The correct answer must not be identifiable from wording, length, tone, specificity, formatting, or level of explanation. Do not make it systematically longer, more detailed, more qualified, more specific, or more sophisticated than the distractors.
- Keep all choices approximately equal in length, specificity, grammatical complexity, and detail. Longest choice no more than 20–25% longer than the shortest unless there is a compelling content reason (enumerated drug or test names may carry `"lengthException": true`). If the correct answer needs more explanation, shorten it while preserving accuracy or raise the distractors to match. Never sacrifice accuracy to equalize length.
- Distractors must be plausible and closely related to the tested concept. Do not pad weak distractors to match length. Avoid one nuanced, clinically realistic answer surrounded by short, simplistic ones.
- No grammatical clues between stem and correct answer. No absolutes ("always," "never," "only," "must") disproportionately in distractors. No qualifiers ("typically," "most appropriate," "unless," "generally," "when indicated," "likely") appearing only in the correct answer.
- No overlapping choices where one option partially or completely includes another.
- Across the set, vary whether the correct answer is the shortest, longest, or middle-length option, and distribute correct answers across positions A–D. The browser shuffles options, but the file order still matters for the Moodle export.
- Before finishing any batch, silently review every item against these points and revise before output. Do not show the review.

## Language — hard requirement

U.S. English exclusively, in every item, choice, rationale, table row, and UI string. Standard American medical and EMS terminology: hemoglobin, hematology, anemia, edema, acetaminophen, epinephrine, albuterol, pediatric, anesthesia, hemorrhage, fetus, behavior, center, color, organization. Convert British spelling from any source material rather than reproducing it, unless a direct quotation must be preserved. `scripts/americanize.py` converts; the validator fails the build on any non-U.S. spelling.

## Automatic checks

A validation script runs before every deploy. The build fails if any item has:

- a value outside its band
- a near-normal value inside the safety margin around a cutoff
- a missing unit
- a creatinine, hemoglobin, BNP, or troponin value with no baseline
- a troponin value between 0.04 and 0.4 ng/mL
- an excluded (post-2016) drug or test
- a blood ketone meter value in an Arm B scenario or in basic or advanced Arm A items
- a missing rationale, reference range, or source
- a non-U.S. spelling anywhere in the item bank, band file, or master table
- multiple-choice options whose longest is more than 50% longer than the shortest (warning above 25%)

It also warns on: a qualifier only in the correct answer; absolutes in two or more distractors but not the correct answer; overlapping choices; and, across the bank, the correct answer being the longest or the shortest choice in more than 40% of items or sitting in one position more than 40% of the time.
