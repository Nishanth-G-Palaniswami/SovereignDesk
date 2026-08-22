# Lane 3, rules engine and domain truth

**Owner: Nishanth.** You own `engine/` and every factual claim the entry makes about tariffs,
agency flags and duty. You are the person a judge means when they ask "how accurate is this?"

---

## Read this before you touch anything

1. **The engine is already written and it works.** Three `.mjs` files, zero dependencies,
   Node 18+. It classifies, flags, computes duty and emits a full trace today, on this laptop,
   with real USITC rates. Confirm that yourself in 30 seconds with the first command in
   [Commands](#commands-you-will-actually-type).
2. **This lane is correctness work, not a rewrite.** Two data defects and one placeholder
   surface. That is the whole job.
3. **There is no Python in this repo and there will not be.** Node is guaranteed inside the
   NemoClaw / OpenShell sandbox because OpenClaw runs on it. `python3` is not guaranteed.
   A port costs six hours you do not have and buys nothing. If anyone proposes one, the answer
   is no, and this line is the reason.
4. Unrelated to your lane but nobody has confirmed it yet: `docs/HACKATHON_BIBLE.md` §1 records
   teams as **2 to 4 builders** and notes the SF edition gave small teams a scoring bonus. We
   are six. Somebody has to ask the organizers at check-in before the build clock starts.

---

## Done, defined as observable outcomes

You are done when all four of these are true. None of them is a feeling.

```bash
# 1. six samples sweep clean, no crash, no quarantine
node engine/process_inbox.mjs --root ws        # prints JSON, ws/inbox/_failed/ stays empty

# 2. sample 001 line 1 resolves to 8413.91.90.96 with confidence above 0.70
#    (today it resolves to 8413.70.20.05 at 0.54, which is wrong; see P1)

# 3. the precedent flip still produces exactly these numbers
#    cold  8513.10.20.00  conf 0.60  NEEDS_REVIEW  duty $2,362.50 on $6,300  (37.5%)
#    warm  9405.11.60.10  conf 0.95  READY         duty $2,053.80            (32.6%)
#    swing $308.70

# 4. no file under engine/data/ still says "Replace with your real ... table"
```

Plus one non-command deliverable: the accuracy answer card in [P3](#p3-own-the-accuracy-answer),
handed to lane 2 (pitch) before T+4.5.

---

## Do not do these, and why

| Do not | Why |
|---|---|
| Rewrite the engine, in any language | It works. Six hours. See point 3 above. |
| Rename any field in `result.json` | Lane 5's prompt and lane 6's board parse this shape. `triage.mjs:13` calls the contract frozen for the day. Adding a field is fine, renaming one breaks two lanes silently. |
| Point the engine at `hts_full.csv` | Verified: it loads, and classification collapses. Sample 001 line 1 goes to `8413.30.10.00` (pumps for internal combustion engines) at confidence 0.50, line 2 to `4009.11.00.00` (rubber tubing) instead of a gasket heading. `hts_full.csv` has no `keywords` column, so scoring falls back to bare token overlap across 19,856 lines. It is the provenance artifact, not a runtime table. |
| Port a PGA or LPCO table out of a previous employer's codebase | Two reasons and either one is fatal. It is someone else's IP, and this repo goes public in the BuilderBase submission. Re-derive the ten rules from the agencies' own published requirements. See [P2](#p2-pga-and-lpco-the-last-placeholder-surface). |
| Edit `triage.mjs` tokenizer without mirroring it | `record_precedent.mjs:39-46` duplicates `STOP` and `tokenize()` on purpose, and the comment at `record_precedent.mjs:38` warns about it. Change one and precedent signatures stop matching, silently. Lane 4's whole demo dies. |
| Touch `engine/data/` after T+4.5 | Data freeze rides with code freeze. Every number in the pitch script and the backup video comes from these files. |
| Turn `section_122` back on | It fabricated a flat 10% on every line. No `9903` subchapter implementing it exists in the 2026 rev 7 schedule. Re-enable only with a citation to a live Chapter 99 heading. |

---

## Engine contract

### Entry points

| File | What it does | Invocation |
|---|---|---|
| `engine/triage.mjs` (392 lines) | Classifies ONE shipment, prints `result.json` to stdout | `node engine/triage.mjs <shipment.json> [--data <dir>] [--precedents <file>] [--out <file>] [--pretty]` |
| `engine/process_inbox.mjs` | Sweeps `<root>/inbox/`, writes `<root>/results/<id>.result.json`, moves the input to `processed/`. **The one command the agent runs each cron tick.** | `node engine/process_inbox.mjs --root <workspace>` |
| `engine/record_precedent.mjs` | Appends one broker override to `<root>/precedents.jsonl` | `node engine/record_precedent.mjs --shipment <id> --line <n> --hts <code> --reason "..." --root <workspace>` |

Exit codes on `triage.mjs`: `0` ok, `2` bad input, `3` data load failure.
`process_inbox.mjs` never throws on one bad file: it quarantines it to `inbox/_failed/` and
reports `status: "ENGINE_ERROR"` for that entry (`process_inbox.mjs:72-76`).

Workspace layout under `--root`: `inbox/`, `processed/`, `results/`, `memos/`, `decisions/`,
and `precedents.jsonl` at the root itself. The precedent store sits at the workspace root **on
the host mount**, never inside the sandbox (`triage.mjs:45-47`, `process_inbox.mjs:32-33`).
That is deliberate and it is lane 4's demo: destroy the sandbox, the override still applies.

### Data tables

All four live in `engine/data/` and load at `triage.mjs:77-93`. A load failure exits 3.

**`hts_subset.csv`**, 16 curated lines. Columns:

```
hts,description,mfn_rate,unit,keywords,source
```

- `mfn_rate` is a decimal fraction, not a percent: `0.076` is 7.6%.
- `keywords` is pipe delimited, lowercased, and is what classification actually scores on.
  Multi token keywords are worth more (see below). These are hand curated and the build script
  deliberately does not regenerate them.
- `source` carries provenance, e.g. `USITC hts_2026_rev_7.json general="7.6%"`.

**`pga_flags.json`**, keyed by HTS prefix (digits, dots optional), value is an array of flag
objects. Today: 11 prefixes, 17 entries, 10 distinct `requirement_id`s, 9 `must` and 8 `may`.

```json
"9405": [
  { "agency": "FCC", "requirement_id": "FCC_SDOC",
    "requirement": "Supplier's Declaration of Conformity (digital device)",
    "semantic": "may", "disclaim_if_any": ["non-electronic", "candle", "oil lamp"] }
]
```

Semantics, implemented at `triage.mjs:199-223`:

- `semantic: "must"` becomes status **`REQUIRED`** unconditionally.
- `semantic: "may"` becomes **`DISCLAIMABLE`** if any phrase in `disclaim_if_any` has all of its
  tokens present in the line description, otherwise **`CONFIRM`**.
- `DISCLAIMABLE` flags contribute no LPCO documents (`triage.mjs:260`). That is the point of the
  may / disclaim distinction: it is what stops the memo demanding an EPA engine declaration for
  a pump casing.

Prefix matching is longest prefix on digits only, so `8413` matches `8413.91.90.96`, and keys
beginning with `_` are ignored (`triage.mjs:187-196`). Every table in `engine/data/` uses that
same matcher, so `_comment` keys are safe everywhere.

**`lpco_rules.json`**, `requirement_id` to a list of document strings, plus a `BASE` list applied
to every entry. Today: `BASE` plus the same 10 `requirement_id`s.

- Any `BASE` entry whose text matches `/ocean shipments only/i` is dropped for non ocean modes
  (`triage.mjs:256`). That is the ISF row.
- Document matching against `shipment.documents_on_file` is loose substring matching on the text
  **before the em dash separator** in each doc string, split further on the word `or`
  (`triage.mjs:267-275`). Keep using the same separator style when you add rows or matching
  silently degrades to comparing whole sentences.
- Status per document is `ON_FILE` or `MISSING`.

**`surcharges.json`**, 58 KB, generated. Three sections:

- `section_301`: `origin: ["CN","HK"]`, `rates_by_prefix` (1,184 four digit prefixes) and
  `authority_by_prefix` (the same 1,184 keys, each naming the Chapter 99 heading that set the
  rate). `8471` is `0.25` under `9903.88.03`. `9503` is absent, so toys carry none.
  When a judge asks where 25% came from, the answer is a heading, not a config file.
- `section_122`: `"enabled": false`. Leave it false.
- `ad_cvd.watch_prefixes`: one entry today, `7318` steel fasteners. Adds a note to the line and
  pulls in the AD/CVD scope memo document. It does not add duty.

`hts_full.csv` (19,856 ten digit lines) is a build artifact for provenance. Nothing loads it.

### Classification and confidence

Scoring, `triage.mjs:131-147`, per candidate row:

```
+3   every token of a single word keyword present in the line description
+4   every token of a multi word keyword present
+1   per line token that also appears in the row description
+4   parts-heading boost   (line looks like a part AND the row is a parts heading)
x0.5 whole-machine penalty (line looks like a part AND the row is NOT a parts heading
                            AND the row description mentions "pump")
```

"Looks like a part" means the line description contains one of
`casing, housing, impeller, part, kit, component, spare, bracket` (`triage.mjs:130`).

Confidence, `triage.mjs:155`:

```
two or more candidates:  confidence = topScore / (topScore + secondScore)
exactly one candidate:   confidence = min(1, 0.6 + topScore * 0.05)
```

`CONFIDENCE_FLOOR = 0.70` (`triage.mjs:27`). Strictly below the floor raises `LOW_CONFIDENCE`
and sets `needs_human`. Exactly 0.70 passes. Do not build a fix that lands on 0.70 exactly.

Precedent retrieval, `triage.mjs:166-186`: signature is the sorted unique content tokens of the
line description, similarity is Jaccard over those tokens, `PRECEDENT_FLOOR = 0.55`. Order
independent, so rewording still matches. That is lane 4's territory, do not tune the floor
without telling them.

### Flags and statuses

`shipment_summary.status` is `READY` or `NEEDS_REVIEW` (`triage.mjs:367`). `NEEDS_REVIEW` iff any
line has `needs_human`.

| Flag | Raised when | Sets `needs_human` |
|---|---|---|
| `NO_CANDIDATE` | nothing scored above zero | yes |
| `LOW_CONFIDENCE` | confidence < 0.70 | yes |
| `DECLARED_DIFFERS` | filer's `hts_declared` differs from the engine pick | yes |
| `DECLARED_NOT_IN_TABLE` | `hts_declared` is not in `hts_subset.csv` | yes |
| `PRECEDENT_UNKNOWN_CODE` | a precedent names an HTS not in the table | yes |
| `PRECEDENT_APPLIED` | a stored override matched at similarity >= 0.55 | no |
| `LPCO_MISSING` | any required document absent | **only if some PGA flag is `REQUIRED`** |
| `PGA_CONFIRM` | any may-flag landed on `CONFIRM` | no |

That `LPCO_MISSING` rule is at `triage.mjs:355` and it is the one a judge can trip you on.
Sample 006 warm is `READY` while reporting a missing DOE certification, because the DOE flag is
a may-flag sitting at `CONFIRM`, not `REQUIRED`. **This is correct and you should not change it
on demo day**, it is the difference between a checklist and a triage tool. Have the sentence
ready: "the document is listed because the flag is open, not because it is required; the entry
is not blocked until the importer confirms the flag applies."

On a declared / engine mismatch the engine keeps the **declared** code and flags it
(`triage.mjs:342`). It never silently overrides the filer.

---

## Work queue, in priority order

### P1: sample 001 misclassification. T+0 to T+0.5. Decide this first.

It changes the first beat of the demo, so lanes 2, 5 and 6 are all downstream of your answer.

Line 1 of `engine/samples/shipment_001_clean.json` reads
`"Cast iron pump casing for centrifugal liquid pump, without engine"`.
The engine scores `8413.70.20.05` (a complete centrifugal pump) at 15 and `8413.91.90.96`
(parts of pumps) at 13, giving 0.54 and `LOW_CONFIDENCE`. **The second choice is the right one.**
A casing is a part of a pump, not a pump.

`docs/DATA_SWAP.md` offers two one-line fixes. I ran both against all six samples. Results:

- **Option A, trim `liquid pump` from the keywords on `8413.70.20.05`.** Partially works. Line 1
  flips to `8413.91.90.96`, but confidence stays 0.54 (13 versus 11), so `LOW_CONFIDENCE` still
  fires and 001 is still `NEEDS_REVIEW`. Side effect: sample 004 line 1 confidence goes 0.73 to
  0.81, flags unchanged.
- **Option B, penalty `0.5` to `0.35`.** No effect whatsoever. Zero samples change. It is a
  no-op, do not spend time on it in isolation.

Option B does nothing because the halving at `triage.mjs:145` never fires. Root cause, and this
is the actual bug: `rowIsParts` at `triage.mjs:143` is `rowDesc.has("part")`, and after the
USITC swap every description in `hts_subset.csv` is the full ancestor-joined heading text, which
for all of chapter 8413 begins `"Pumps for liquids ... part thereof:"`. So `rowIsParts` is true
for the whole-machine row as well as the parts row. The `+4` boost at `:144` fires for both and
cancels out; the penalty at `:145` fires for neither. `docs/DATA_SWAP.md` says this logic is
"already there and firing". Half of it is not.

- **Option C, recommended.** One line, `triage.mjs:143`:

  ```js
  const rowIsParts = /(?:^|,)\s*parts:/i.test(row.description);
  ```

  Tests the heading path for an actual `Parts:` segment instead of the word "part" anywhere in
  200 characters of inherited text. Exactly one row in `hts_subset.csv` carries `, Parts:`
  (`8413.91.90.96`), so the blast radius is one row. Verified result: sample 001 becomes
  **`READY`**, line 1 `8413.91.90.96` at confidence **0.70**. That is exactly on the floor and
  passes only because the comparison is strictly less than. Too tight to stake a demo on.

- **Option C plus B together: land this one.** `rowIsParts` fixed *and* the penalty at `:145`
  moved from `0.5` to `0.35`. Verified across all six samples:

  | sample | before | after |
  |---|---|---|
  | 001 | `NEEDS_REVIEW`, L1 `8413.70.20.05` conf 0.54 | **`READY`**, L1 `8413.91.90.96` conf **0.77** |
  | 002 | unchanged | unchanged |
  | 003 | unchanged | unchanged |
  | 004 | `DECLARED_DIFFERS`, L1 conf 0.73 | `DECLARED_DIFFERS`, L1 conf 0.92 |
  | 005 | unchanged | unchanged |
  | 006 | unchanged (cold and warm) | unchanged (cold and warm) |

  Duty on 001 does not move either way ($1,015 on $4,000). Both 8413 lines are Free MFN plus 25%
  Section 301, so the correction is about being right, not about money. Say that out loud rather
  than letting a judge notice it.

**After whichever option you land: re-sweep all six and re-record the numbers.** Then push the
new number card to lane 2 (pitch script), lane 5 (memo prompt examples) and lane 6 (board).
Nobody else is allowed to quote a duty figure they did not get from you.

### P2: PGA and LPCO, the last placeholder surface. T+1 to T+3.5.

Tariff rates are real. `pga_flags.json` and `lpco_rules.json` are the only tables left that a
knowledgeable judge could call invented, and `pga_flags.json:2` still literally says
`"Replace with your real PGA flag table."` Delete that sentence by the end of the day, either by
replacing the table or by rewording the comment to state honestly what it is.

Roughly ten rules to re-derive, one per `requirement_id`:
`FDA_PRIOR_NOTICE`, `FDA_FSVP`, `FDA_FACILITY_REG`, `FDA_CERAMICWARE`, `NOAA_SIMP`, `CPSC_CPC`,
`EPA_ENGINE_3520_21`, `FCC_SDOC`, `DOE_CERT`, `CBP_ADCVD_CHECK`.

**Re-derive each one from the agency's own published requirement.** Do not port a table out of a
previous employer's codebase: it is not yours to publish, and the repo link goes into the
BuilderBase submission. Cite the rule in the `requirement` string itself where it fits, the way
`FCC_SDOC` already names 47 CFR 2.906. A judge who recognises a citation stops asking whether you
made the table up.

Work in this order, highest demo value first:

1. `NOAA_SIMP` and `FDA_PRIOR_NOTICE` / `FDA_FSVP` on `0306`, because sample 002 is the PGA trap
   beat and shrimp is the species everyone in the room can check.
2. `CPSC_CPC` on `9503`, sample 003.
3. `FCC_SDOC` and `DOE_CERT` on `9405` / `8513` / `8504`, because they carry sample 006 and the
   `READY`-with-a-missing-document conversation above.
4. Everything else.

Rules for edits: keep the JSON shapes exactly. The engine only reads `agency`, `requirement_id`,
`requirement`, `semantic` and `disclaim_if_any`. A new `requirement_id` in `pga_flags.json` with
no matching key in `lpco_rules.json` produces a flag with no documents, silently. Add both sides
together. Re-sweep after every edit: PGA changes move LPCO, LPCO changes move `needs_human`, and
`needs_human` moves the demo.

### P3: own the accuracy answer. T+3.5 to T+4.5.

Write these on a card and hand a copy to lane 2. You are the one who answers them, but the pitch
has to survive you being at the box.

- **"How accurate is the classification?"** Every MFN rate and every Section 301 surcharge in the
  demo is read from the USITC Harmonized Tariff Schedule 2026 revision 7 export committed at
  `engine/data/usitc/hts_2026_rev_7.json`, 35,496 rows. Not typed by us. Classification runs over
  a curated 16 heading subset, which is a demo scope decision, not a data limit: the full 19,856
  line table is in the repo at `engine/data/hts_full.csv` with real rates. Anything below 0.70
  confidence, any mismatch with the filer's declared code, and any open agency flag routes to a
  licensed broker. The agent never files with CBP.
- **"So swap in the full table and you are done?"** No, and be straight about it. I tried it:
  classification quality collapses, because `hts_full.csv` has no curated keywords and scoring
  falls back to raw token overlap. Sample 001 line 1 lands on `8413.30.10.00`, pumps for internal
  combustion engines, at 0.50. Production needs a real classifier over the full schedule. What is
  finished today is the rate and surcharge layer.
- **"Where did 25% come from?"** A Chapter 99 heading, cited per prefix in
  `surcharges.json.section_301.authority_by_prefix`. `8471` laptops resolve to `9903.88.03`.
  The placeholder table said 0% for laptops and 7.5% for toys, both wrong; the real schedule says
  25% and none. The corrections are the argument, not an embarrassment.
- **"Why not let the model classify?"** A wrong code is a penalty, not a typo. The engine decides
  and traces; the model only writes English. Every line of the memo maps to a `trace[]` entry you
  can read on stage with `why <shipment_id>`.
- **"What is still fake?"** PGA and LPCO tables are demo scope, sized for these six shipments.
  Section 122 is switched off because no Chapter 99 heading implements it, and leaving it on was
  adding a fabricated 10% to every line. Say this before a judge finds it.
- **"What did you not build?"** ACE filing, OCR, binding rulings, AD/CVD rate lookup (the engine
  flags the scope question, it does not compute the deposit).

---

## Commands you will actually type

Run from the repo root, `D:\Projects\summer26\Hackathon\SovereignDesk` on the laptop or
`/workspace/sovereigndesk` on the box. `ws/` is already gitignored.

```bash
# set up a scratch workspace and sweep all six samples (bash, on the box)
mkdir -p ws/inbox && cp engine/samples/*.json ws/inbox/
node engine/process_inbox.mjs --root ws
```

```powershell
# same thing on the Windows laptop
New-Item -ItemType Directory -Force ws\inbox | Out-Null
Copy-Item engine\samples\*.json ws\inbox\
node engine\process_inbox.mjs --root ws
```

```bash
# one shipment, readable, no workspace needed
node engine/triage.mjs engine/samples/shipment_001_clean.json --pretty | more

# just the numbers, after a sweep has written ws/results/
node -p "JSON.parse(require('fs').readFileSync('ws/results/SHP-2026-0822-001.result.json','utf8')).shipment_summary"

# why did it pick that code
node -p "JSON.parse(require('fs').readFileSync('ws/results/SHP-2026-0822-001.result.json','utf8')).trace.join('\n')"

# the precedent flip, end to end, verified
mkdir -p ws2/inbox && cp engine/samples/shipment_006_precedent_test.json ws2/inbox/
node engine/process_inbox.mjs --root ws2          # cold: 8513.10.20.00, 0.60, NEEDS_REVIEW, $2,362.50
node engine/record_precedent.mjs --shipment SHP-2026-0822-006 --line 1 \
  --hts 9405.11.60.10 --reason "portable LED lamp, not a flashlight" --root ws2
cp engine/samples/shipment_006_precedent_test.json ws2/inbox/
node engine/process_inbox.mjs --root ws2          # warm: 9405.11.60.10, 0.95, READY, $2,053.80
```

To re-run a sample after a data edit, copy it back into `inbox/` from `samples/`. The sweeper
moves inputs to `processed/` and only looks at `inbox/`.

### Rebuilding the tariff tables

```bash
node scripts/build_hts_from_usitc.mjs --archive engine/data/usitc/hts_2026_rev_7.json
```

Rewrites `hts_subset.csv` (rates, descriptions, units, provenance; **keywords are preserved**,
the curated ones classify better than anything derived), `surcharges.json` (the 301 map and its
authorities) and `hts_full.csv`. Originals are kept once as `*.placeholder.bak`, so re-running
never clobbers the pristine copy.

**The gotcha, repeated because it eats an hour:** rates and footnotes live on the nearest
**ancestor** with a value. Read a 10 digit line on its own and `general` is almost always blank.
You have to walk the `indent` hierarchy upward until you find one. That walk is
`build_hts_from_usitc.mjs:112-148`. The same walk is why every `hts_subset.csv` description is
now the full joined heading path, which is exactly what broke `rowIsParts` in P1. If you ever
regenerate descriptions, re-check the parts-versus-whole logic afterwards.

Section 301 is derived the same way and never hand entered: the line carries a footnote pointing
at a `9903.88.xx` heading, and that heading states its own surcharge in plain text
("the duty provided in the applicable subheading plus 25%"). The build script parses that
sentence (`build_hts_from_usitc.mjs:74-78`) and records which heading set which prefix.

---

## What you hand over, and what you wait on

**You hand out:**

| To | What | When |
|---|---|---|
| Lane 5 (orchestration) | The `result.json` field list, unchanged, and a real sweep output to tune the memo prompt against | T+1 |
| Lane 2 (sandbox and pitch) | The number card: six sample outcomes plus the cold and warm 006 figures | right after P1 lands, then again if P2 moves anything |
| Lane 6 (channel and UI) | Same number card, plus confirmation that the board is read only. Nothing outside `engine/` may write into `decisions/` | T+1 |
| Lane 4 (memory) | Warning that `tokenize()` and `STOP` are duplicated in `record_precedent.mjs:39-46`, and that `PRECEDENT_FLOOR` is 0.55 at `triage.mjs:176` | T+0, before they start |

**You wait on nobody for P1 and P2.** The engine runs on your laptop with plain Node. Do not
sit idle waiting for lane 1 to bring the box up. Your only real dependency is lane 1 confirming
`node --version` inside the sandbox, and lane 5 telling you the sandbox path of the workspace
root so `--root` is right in the cron job.

**Hard boundary:** you do not merge. Lane 5 has sole merge authority to main. Branch, hand over,
say what changed and what the six samples now produce.

---

## If it goes wrong

| Symptom | Do this |
|---|---|
| P1 fix regresses another sample | Revert to option A alone (keyword trim). 001 gets the right code with a `LOW_CONFIDENCE` flag, which is a defensible demo beat: "the engine flagged it rather than guessing." Do not keep debugging past T+1. |
| Both P1 options run out of time | Ship as is and change the story. Sample 001 becomes the low confidence beat, sample 006 becomes the clean one. Tell lane 2 within five minutes so the pitch script is written once. |
| PGA / LPCO rewrite is not finished by T+3.5 | Stop. Reword the `_comment` in both files to say plainly "demo tables sized for these six shipments, not a production flag set" and put the same sentence on the non-goals slide. Half a rewritten table is worse than an honest one. |
| A sweep starts throwing | Check `ws/inbox/_failed/`. The engine quarantines rather than crashing. `node engine/triage.mjs <the failed file> --pretty` prints the real error and exit code (2 = bad input, 3 = data load, usually malformed JSON you just edited). |
| A data edit breaks the demo after freeze | `engine/data/*.placeholder.bak` holds the pre-swap originals; git holds everything else. Restore, re-sweep, re-record. Never demo numbers you have not just seen printed. |

---

## Glossary

| Term | Meaning |
|---|---|
| **HTS** | Harmonized Tariff Schedule. The 10 digit U.S. classification code that sets the duty rate. |
| **PGA** | Partner Government Agency. Any agency other than customs with a say at the border: FDA, USDA, CPSC, EPA, NOAA, FCC, DOE. |
| **LPCO** | Licenses, Permits, Certificates, Other. The documents an entry packet has to carry. |
| **MFN** | Most Favored Nation. The base duty rate in the `general` column, before any surcharge. |
| **CBP** | U.S. Customs and Border Protection. The agency the entry is filed with. |
| **AD/CVD** | Antidumping / countervailing duty. Extra duty on specific goods from specific origins under a case order. The engine flags scope, it does not compute the deposit. |
| **SIMP** | Seafood Import Monitoring Program (NOAA). Harvest and landing traceability for covered species, shrimp included. |
| **FSVP** | Foreign Supplier Verification Program (FDA). The U.S. importer has to verify their foreign food supplier. |
| **CPC** | Children's Product Certificate (CPSC). Certifies third party testing against the applicable children's product rule. |
| **Section 301** | The China tariff action. Implemented through Chapter 99 subheadings that add a stated percentage on top of the MFN rate. |
| **Chapter 99** | The HTS chapter holding temporary duty modifications. Where every surcharge in this repo is cited from. |
| **ISF 10+2** | Importer Security Filing. Ocean shipments only, which is why `lpco_rules.json` drops it for air. |
