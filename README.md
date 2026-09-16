# CP-C Lab Drill

Practice app for the IBSC CP-C exam. Static site, no backend, no login, nothing collected.
`CLAUDE.md` is the build spec and governs every decision here.

## Layout

| Path | What |
|---|---|
| `index.html`, `app/` | The drill. Plain HTML/JS/CSS, no build step. |
| `data/lab-master-table.json` | **Single source of truth.** 40 analytes, 13 panels. Exported from the lab master table artifact; do not hand-edit. |
| `data/bands.json` | Numeric transcription of the master table's ranges and bands, plus the safety-margin exclusion zones. The generator and the validator both read it. If it ever disagrees with the master table, fix this file. |
| `data/arm-a-items.json` | Arm A item bank. Item format documented in the file header. |
| `data/arm-b-scenarios.json` | Arm B disposition scenarios: one patient per scenario, tier answer, follow-up question. Format in the file header. |
| `data/protocol.json` | The standard program protocol every scenario assumes; rendered on the About page and inside each scenario. |
| `scripts/validate.py` | Pre-deploy checks. Netlify runs it as the build command; a failure blocks the deploy. |

## Run locally

Any static server works. With Python:

```
python -m http.server 8765
```

then open http://127.0.0.1:8765/. (Opening `index.html` directly from disk will not work: the app fetches the JSON files.)

## Validate

```
python scripts/validate.py
```

Checks both banks. Fails on: a value outside its band, a value inside a safety margin, a missing unit, a creatinine / hemoglobin / BNP / troponin with no baseline, a troponin between 0.04 and 0.4 ng/mL, an excluded post-2016 drug or test, blood ketone meter content outside fiendish, a missing rationale / reference range / source, chloride items, and classification items on analytes the course gives no range for.

## Adding items

1. Pick the master-table row. `lab` must match its `name` exactly.
2. Quote numbers only through a value spec (`{"set": ..., "min": ..., "max": ..., "band": ...}`) and a `{placeholder}` in the text. The unit is rendered from the set, so it cannot be forgotten.
3. Creatinine, hemoglobin, BNP and troponin items need a `baseline` line.
4. Run the validator.

Values are drawn uniformly on the set's grid between `min` and `max`, so the range you give is the range students will see.

## Deploy

Netlify, from this repo. `netlify.toml` sets the validator as the build command and publishes the repo root.

## Not yet built

Moodle XML export is deferred; both banks resolve reference range and source from the table at export time. The public health vocabulary arm (open item 3 in CLAUDE.md) is not started.
