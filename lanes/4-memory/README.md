# Lane 4: precedent memory and the teardown proof

**You own the evidence that SovereignDesk remembers.** The memory layer is already built and
already passes end to end. Your job today is not to write it, it is to prove it holds up under
rewording, under conflict, and under a full sandbox destruction, on camera.

Two things to fix in your head before you talk to anyone:

- **NemoClaw is not the memory layer.** NemoClaw is install and stack: it puts OpenClaw,
  OpenShell and inference on the box. The memory layer is one append-only JSON Lines file that
  the Node engine reads and writes. If a teammate or a judge says "NemoClaw stores the
  precedents", correct it.
- **The store lives on the host mount, never inside the sandbox.** That is the entire reason
  the teardown demo works. Guard this fact.

**Raise at check-in, before you start:** `docs/HACKATHON_BIBLE.md` section 1 records teams as
2 to 4 builders and notes the SF edition gave small teams a scoring bonus. We are six. Somebody
has to confirm with the organizers. If nobody has, say it out loud now.

---

## 1. Prove it works in the next 60 seconds

Run this on your laptop right now, before the box is even up. Node 18+, zero dependencies,
nothing to install.

```bash
cd <repo>
WS=/tmp/lane4 && mkdir -p $WS/inbox
cp engine/samples/shipment_006_precedent_test.json $WS/inbox/
node engine/process_inbox.mjs --root $WS
```

PowerShell on Windows:

```powershell
$WS = "$env:TEMP\lane4"; New-Item -ItemType Directory -Force "$WS\inbox" | Out-Null
Copy-Item engine\samples\shipment_006_precedent_test.json "$WS\inbox\"
node engine\process_inbox.mjs --root $WS
```

You get the **cold** run. Then record the override and re-run the same file:

```bash
node engine/record_precedent.mjs \
  --shipment SHP-2026-0822-006 --line 1 --hts 9405.11.60.10 \
  --reason "Mains-independent LED night lights are luminaires under 9405, not portable electric lamps under 8513" \
  --by "M. Okafor, LCB" --root $WS

cp engine/samples/shipment_006_precedent_test.json $WS/inbox/
node engine/process_inbox.mjs --root $WS
```

That is the **warm** run. If you got both, the memory layer works and you can skip straight to
section 5.

---

## 2. Verified numbers. Do not quote any others.

Measured from a clean run of the shipped config. Line 1 is
`"USB rechargeable LED night light lamp, portable"`, 1,500 units at $4.20, origin CN, $6,300
entered.

| | cold | warm (precedent applied) |
|---|---|---|
| HTS | 8513.10.20.00 | 9405.11.60.10 |
| confidence | 0.60 | 0.95 |
| status | NEEDS_REVIEW | READY |
| rate | 37.5% (12.5 MFN + 25 Section 301) | 32.6% (7.6 MFN + 25 Section 301) |
| duty on $6,300 | **$2,362.50** | **$2,053.80** |
| flags | LOW_CONFIDENCE, PGA_CONFIRM | PRECEDENT_APPLIED, LPCO_MISSING, PGA_CONFIRM |

**The swing is $308.70.** Any script quoting $541.80, or $2,992.50 / $2,450.70, is stale: those
came from the placeholder 3.9% rate and a fabricated Section 122 surcharge that is now disabled.
See `docs/DATA_SWAP.md`.

One thing you will be asked on camera: **the warm run is READY even though it has
LPCO_MISSING.** That is correct behaviour, not a bug. Moving to 9405 pulls in a DOE lamp
requirement whose semantic is `may`, so it resolves to `CONFIRM`, not `REQUIRED`.
`engine/triage.mjs:355` only escalates a missing document to a human when some PGA flag is
`REQUIRED`. The memo still lists the missing DOE certification. Know this answer cold.

---

## 3. What the store actually is

**Path:** `<workspace root>/precedents.jsonl`. Set in two places, both of which follow `--root`:
`engine/process_inbox.mjs:33` and the default at `engine/triage.mjs:47`. Never a sandbox-local
path. `.gitignore` already excludes it, so no broker data reaches the public repo.

**One record per broker override**, appended, one line of JSON, written only by
`engine/record_precedent.mjs:61-73`:

```json
{"sig":"lamp led light night portable rechargeable usb",
 "description":"USB rechargeable LED night light lamp, portable",
 "hts":"9405.11.60.10",
 "reason":"Mains-independent LED night lights are luminaires under 9405, not portable electric lamps under 8513",
 "by":"M. Okafor, LCB",
 "shipment_id":"SHP-2026-0822-006",
 "line":1,
 "at":"2026-08-22T16:45:55.722Z"}
```

`sig` is the retrieval key: sorted unique content tokens of the description, stopwords dropped,
crude plural stem (`engine/triage.mjs:169`). Sorting is what makes it order independent, so
"pump seal kit with impeller" and "impeller and seal kit for pump" produce the same signature.

**Retrieval** is Jaccard similarity over those token sets, `engine/triage.mjs:170-186`:
`|A n B| / |A u B|`, best match wins, and `PRECEDENT_FLOOR = 0.55` at `triage.mjs:176` is the
bar for treating a past override as binding. On a hit, the engine swaps the code, raises
confidence to `min(0.99, 0.75 + similarity * 0.2)`, adds `PRECEDENT_APPLIED`, and writes a
trace line naming who set it and what the cold engine would have said
(`triage.mjs:300-321`).

**Append-only is a rule, not an implementation detail.** `agent/AGENTS.md:65-66`: a precedent is
superseded by a new `reclassify`, never erased. The file is the audit trail. A broker who cannot
show why a code was used cannot defend a CBP audit. Nothing in the codebase ever deletes or
rewrites a line, and nothing you build today may either.

**Failure behaviour, already verified:**

- Precedent HTS not in `engine/data/hts_subset.csv` -> flag `PRECEDENT_UNKNOWN_CODE`, status
  `NEEDS_REVIEW`, cold classification kept. Nothing silently breaks.
- A corrupt or half-written line is skipped by the per-line try/catch at `triage.mjs:101`.
  A crash mid-append cannot poison the store.
- Caveat worth knowing: `process_inbox.mjs:78-80` reports `precedent_store.entries` by counting
  non-blank lines, so a corrupt line still gets counted there while `triage.mjs` ignores it.
  Do not use that number as a validity check.

---

## 4. Done means this, not a feeling

You are done when all five hold:

1. `node engine/process_inbox.mjs --root <ws>` on sample 006 prints `NEEDS_REVIEW` /
   `8513.10.20.00` / `2362.5` cold, and `READY` / `9405.11.60.10` / `2053.8` /
   `PRECEDENT_APPLIED` warm, **on the GB10**, not on your laptop.
2. `lanes/4-memory/sim_probe.mjs` (section 6) exists and prints a similarity table you can put
   on screen.
3. The sandbox has been destroyed with `nemoclaw <sandbox> rebuild` and the warm result
   reproduces afterwards with zero re-entry of the override.
4. That teardown is **recorded**, not just performed.
5. Lane 2 and lane 5 have your one-paragraph answer for "what happens when the memory is wrong".

---

## 5. What you must not do

- **Do not build a vector store, an embedding index, a database, or a RAG pipeline.** Jaccard
  over token sets is the design. It is inspectable, it is one file, it survives teardown, and a
  judge can read it. Anything with a model in the retrieval path re-opens the hallucination
  question that our whole architecture closes.
- **Do not edit or delete `precedents.jsonl` by hand**, not even to reset a demo. To reset,
  point `--root` at a fresh empty directory. The file being untouched-by-hand is the claim.
- **Do not put the store inside the sandbox filesystem.** If `--root` resolves to a path that is
  not on the share mount, the teardown demo dies and nobody notices until it is on camera.
  Check this explicitly with lane 1.
- **Do not edit `engine/triage.mjs` yourself.** That is lane 3's file. You report, they change,
  lane 5 merges. Nobody else merges to main.
- **Do not touch anything in `engine/data/`.** Lane 3 owns the tables.

---

## 6. Work queue

### T+0 to T+1, while lane 1 fights the box (do this on your laptop)

Nothing here needs the GB10. Get it all done before the box is ready and you will be the first
lane with results.

**A. Reproduce cold and warm.** Section 1. Confirm the numbers in section 2 match to the cent.
If they do not, stop and tell lane 3 before doing anything else.

**B. Build the similarity probe.** This is the deliverable that answers "does it survive
rewording". Paste this whole block:

```bash
cat > lanes/4-memory/sim_probe.mjs <<'EOF'
#!/usr/bin/env node
// Lane 4: Jaccard probe. Same tokenizer as engine/triage.mjs:117-127 and :169-175.
// usage: node lanes/4-memory/sim_probe.mjs <precedents.jsonl> <probes.json>
import fs from "node:fs";
const STOP = new Set(["the","a","an","of","for","and","or","with","in","to","by","on","at","from","other","nesoi","n.e.s.o.i","x","pcs","pc","each","set","sets"]);
const tokenize = (s) => (s||"").toLowerCase().replace(/[^a-z0-9%.\s-]/g," ").split(/\s+/)
  .map(t=>t.replace(/^[-.]+|[-.]+$/g,"")).filter(t=>t&&!STOP.has(t))
  .map(t=>(t.length>4&&t.endsWith("s")?t.slice(0,-1):t));
const signature = (d) => [...new Set(tokenize(d))].sort().join(" ");
const jaccard = (a,b) => { const A=new Set(a.split(" ").filter(Boolean)), B=new Set(b.split(" ").filter(Boolean));
  if(!A.size||!B.size) return 0; let i=0; for(const t of A) if(B.has(t)) i++; return i/(A.size+B.size-i); };
const FLOOR = 0.55;   // must equal PRECEDENT_FLOOR in engine/triage.mjs:176
const store = fs.readFileSync(process.argv[2],"utf8").split("\n").filter(l=>l.trim()).map(l=>JSON.parse(l));
const probes = JSON.parse(fs.readFileSync(process.argv[3],"utf8"));
for (const p of probes) {
  const sig = signature(p); let best=null, bs=0;
  for (const r of store) { const s = r.sig===sig ? 1 : jaccard(sig,r.sig); if (s>bs) { bs=s; best=r; } }
  const hit = best && bs>=FLOOR;
  console.log(`${(Math.round(bs*100)/100).toFixed(2)}  ${hit?"MATCH  -> "+best.hts:"no match       "}  ${p}`);
}
EOF
```

```bash
cat > lanes/4-memory/probes.json <<'EOF'
["USB rechargeable LED night light lamp, portable",
 "Portable rechargeable USB LED night light lamp",
 "LED night light lamp, USB rechargeable, portable",
 "Rechargeable USB LED night light lamp",
 "USB rechargeable LED night light lamps, portable, 5V",
 "Portable LED night lamp with USB charging",
 "Portable USB rechargeable LED reading light lamp",
 "USB-powered LED nightlight",
 "Rechargeable lamp, LED, portable, for night use",
 "LED desk lamp, 120V mains powered, non-portable",
 "Cast iron pump casing for centrifugal liquid pump, without engine",
 "Frozen shrimp, farmed, headless shell-on"]
EOF
node lanes/4-memory/sim_probe.mjs $WS/precedents.jsonl lanes/4-memory/probes.json
```

**This is the measured baseline. Your run must reproduce it.** Floor is 0.55.

```
1.00  MATCH  -> 9405.11.60.10  USB rechargeable LED night light lamp, portable
1.00  MATCH  -> 9405.11.60.10  Portable rechargeable USB LED night light lamp
1.00  MATCH  -> 9405.11.60.10  LED night light lamp, USB rechargeable, portable
0.86  MATCH  -> 9405.11.60.10  Rechargeable USB LED night light lamp
0.88  MATCH  -> 9405.11.60.10  USB rechargeable LED night light lamps, portable, 5V
0.63  MATCH  -> 9405.11.60.10  Portable LED night lamp with USB charging
0.75  MATCH  -> 9405.11.60.10  Portable USB rechargeable LED reading light lamp
0.11  no match         USB-powered LED nightlight
0.63  MATCH  -> 9405.11.60.10  Rechargeable lamp, LED, portable, for night use
0.17  no match         LED desk lamp, 120V mains powered, non-portable
0.00  no match         Cast iron pump casing for centrifugal liquid pump, without engine
0.00  no match         Frozen shrimp, farmed, headless shell-on
```

Read it out loud like this, because these are the honest answers:

- **Word order and plurals are free.** Three reorderings all score 1.00. That is the sorted
  signature doing its job, and it is the strongest thing you can say about the retrieval.
- **Synonym swaps degrade gracefully.** "with USB charging" instead of "USB rechargeable" costs
  you 0.63, still above floor.
- **Compounding is the failure mode.** "USB-powered LED nightlight" collapses to 0.11 and
  misses, because `nightlight` is not `night light` and `usb-powered` is not `usb`. The
  tokenizer keeps hyphens (`triage.mjs:121`) and does no compound splitting. Say this plainly.
  It is a bag-of-words method, it has bag-of-words limits.
- **Unrelated commodities score 0.00.** A pump casing and frozen shrimp cannot accidentally
  inherit a lamp precedent. That is the cross-contamination question, answered.
- **0.75 on a reading light is the false positive.** See below.

**C. The false positive, already reproduced.** Feed a shipment whose line is
`"Portable USB rechargeable LED reading light lamp"` against the lamp precedent:

```
status READY, confidence 0.90, hts 9405.11.60.10, flags PRECEDENT_APPLIED
precedent.similarity 0.75, cold_hts 8513.10.20.00, cold_confidence 0.54
```

A **different product** matched at 0.75, and the precedent pushed a line that would have been
`LOW_CONFIDENCE` / `NEEDS_REVIEW` at 0.54 all the way to `READY` at 0.90. Nobody looked at it.
That is the real risk in this design and you should present it as a known limit rather than let
a judge find it.

The mitigating fact: `precedent.similarity` is in the result JSON and the trace line names the
broker, the source shipment and the reason, so it is auditable after the fact. The gap is that
the memo format at `agent/AGENTS.md:51` prints the precedent block **without the similarity**.
Ask lane 5 for a one-line prompt change so a fuzzy match reads
`(similarity 0.75)` in the memo. Cheap, and it closes the question.

Your recommendation to lane 3, in one line: leave `PRECEDENT_FLOOR` at 0.55 for the demo, and
surface similarity in the memo instead of tightening the floor. Raising the floor to 0.9 would
kill the "survives rewording" claim, which is the more valuable one.

**D. Conflicting precedents. This one is a confirmed bug, hand it to lane 3 immediately.**

Append a second override for the same line with a different code, exactly as a senior broker
reverting a junior would:

```bash
node engine/record_precedent.mjs --shipment SHP-2026-0822-006 --line 1 \
  --hts 8513.10.20.00 --reason "SUPERSEDE: it is battery powered and portable" \
  --by "R. Vance, LCB" --root $WS
cp engine/samples/shipment_006_precedent_test.json $WS/inbox/
node engine/process_inbox.mjs --root $WS
```

**The old precedent wins.** The engine returns `9405.11.60.10` by M. Okafor, and R. Vance's
supersede is ignored forever. Cause is one character at `engine/triage.mjs:182`:

```js
if (sim > bestSim) { bestSim = sim; best = p; }
```

Strictly greater, so on a similarity tie the **first** record read is kept and no later record
can displace it. That directly contradicts `agent/AGENTS.md:65-66`, which promises a precedent
"must be superseded by a new reclassify". Today, it cannot be.

Fix, verified working: change `>` to `>=`. With that one character, the same test returns
`8513.10.20.00` by R. Vance, newest wins, append-only supersede works, and higher-similarity
records still beat lower-similarity ones. **This is lane 3's edit, not yours.** Report it,
give them the repro, let lane 5 merge it.

**E. Signature drift, a risk you own.** `engine/record_precedent.mjs:38-46` contains a **copy**
of the tokenizer and STOP list from `engine/triage.mjs:117-127`. If lane 3 edits one and not the
other, signatures diverge, every new precedent stops matching, and the demo dies quietly with no
error message. There is a comment saying "keep these two in sync"; comments do not enforce
anything. Tell lane 3 you are watching this, and re-run section 1 after **any** engine merge.

### T+1 to T+3, while lane 5 gets one shipment end to end

You are blocked on lane 1 and lane 5 here, so do not sit idle. Two jobs:

1. **Confirm the store path resolves to the share mount.** The single most important
   verification of your day. Inside the sandbox, and on the host, both must show the same file:

   ```bash
   # inside the sandbox
   node engine/process_inbox.mjs --root <ws> | head -5     # read precedent_store.path
   # on the host, same file must exist and grow
   wc -l ~/sovereigndesk/workspace/precedents.jsonl
   sha256sum ~/sovereigndesk/workspace/precedents.jsonl
   ```

   If the path inside the sandbox is not under the share mount, escalate to lane 1 now.
   Note the docs disagree on the root: `agent/AGENTS.md:11` says `--root .`,
   `docs/HACKATHON_BIBLE.md` section 8 says `--root workspace`, `.env.example` says
   `WORKSPACE_ROOT=/workspace/sovereigndesk/workspace`. They put `precedents.jsonl` in
   different places. Pick one with lane 5 and make everyone use it.

2. **Write the memo-side answer.** One paragraph for lane 2's pitch and lane 5's prompt:
   what the memory is, why it is a file and not a database, and what happens when it is wrong.

### T+3 to T+4.5, your headline beat

The teardown demo. Section 7. Rehearse it once, then record it. Do not leave the recording to
the live run.

### T+4.5 onward

Code freeze. Your artifacts for the submission: the similarity table screenshot, the teardown
recording, and `precedents.jsonl` shown with `cat`.

---

## 7. The teardown demo, and its shot list

**The claim:** destroy the sandbox completely and the broker's override still applies, because
the institutional memory was never in the sandbox. This is the strongest 30 seconds the entry
has. "The LLM is transient and swappable. The memory is permanent and lives on the box."

Confirm the sandbox name and the rebuild verb with lane 1 first. The CLI is alpha; run
`nemoclaw <sandbox> --help` before you trust any flag. Substitute the real name everywhere
below (the installer may have called it `my-assistant`).

```bash
# 1. state before, on the HOST
cat ~/sovereigndesk/workspace/precedents.jsonl
wc -l ~/sovereigndesk/workspace/precedents.jsonl
sha256sum ~/sovereigndesk/workspace/precedents.jsonl

# 2. prove the warm result exists right now
cp engine/samples/shipment_006_precedent_test.json ~/sovereigndesk/workspace/inbox/
nemoclaw customs-desk connect
#   inside: node engine/process_inbox.mjs --root <ws>   -> READY, 9405.11.60.10, PRECEDENT_APPLIED

# 3. destroy it
nemoclaw customs-desk rebuild

# 4. it is gone. show that.
nemoclaw customs-desk status

# 5. same file, untouched, on the host
sha256sum ~/sovereigndesk/workspace/precedents.jsonl     # identical hash

# 6. re-run the sweep in the NEW sandbox, nothing re-entered
cp engine/samples/shipment_006_precedent_test.json ~/sovereigndesk/workspace/inbox/
nemoclaw customs-desk connect
#   inside: node engine/process_inbox.mjs --root <ws>
#   -> READY, 9405.11.60.10, confidence 0.95, PRECEDENT_APPLIED, duty 2053.8
```

**Shot list, target 45 seconds:**

| # | shot | on screen | said |
|---|---|---|---|
| 1 | 0:00-0:06 | `cat precedents.jsonl`, one line, highlight `by` and `reason` | "One line. A broker's decision, with their name and their reasoning." |
| 2 | 0:06-0:14 | sweep output, `PRECEDENT_APPLIED`, `9405.11.60.10`, `$2,053.80` | "The agent applies it. Duty drops $308.70 against the cold classification." |
| 3 | 0:14-0:22 | `nemoclaw customs-desk rebuild` running, then `status` | "Now I destroy the agent's entire sandbox." |
| 4 | 0:22-0:30 | `sha256sum` before and after, side by side, identical | "The memory is on the host mount. It was never in there." |
| 5 | 0:30-0:42 | drop the same file, sweep in the new sandbox, `PRECEDENT_APPLIED` again | "Same override. Nobody re-entered anything." |
| 6 | 0:42-0:45 | the one-liner | "The model is swappable. The institution's memory is not." |

Keep two terminals side by side for the whole take: host on the left, sandbox on the right.
Shots 1, 2 and 4 must be legible at pitch-screen size, so bump the font before you record.

**Fallbacks, decide in under five minutes each:**

| symptom | fallback |
|---|---|
| `rebuild` is not the verb, or the flag changed | `nemoclaw <sandbox> --help`; if nothing destructive is exposed, stop and remove and recreate |
| rebuild breaks the share mount | re-run the `nemoclaw share mount` command from lane 1's notes, then re-run the sweep. Budget one attempt |
| rebuild takes longer than 5 minutes | `nemoclaw <sandbox> stop` then `start`. Weaker proof. Say on camera that it is a restart, not a rebuild. Do not overclaim |
| rebuild is too risky at T+4 with the loop working | Portability version: `cp precedents.jsonl` into a second empty workspace and sweep there. Proves the store is the only state that matters, does not prove teardown survival. Label it accurately |
| the whole box is unstable | Run the teardown on your laptop against the same repo and say clearly that the recording is from the reference environment. Last resort. The submission requires the demo run on the GB10 |

---

## 8. Handoffs

**You give:**

- **lane 3 (Nishanth, rules engine):** the `triage.mjs:182` supersede bug with the repro from
  6D, and the tokenizer-duplication risk from 6E. Both today, both early.
- **lane 5 (orchestration):** the request to print `similarity` in the memo's precedent line
  (`agent/AGENTS.md:51`), and the decision on which `--root` everyone uses.
- **lane 2 (sandbox and pitch):** the teardown recording, the similarity table, and the
  "what happens when the memory is wrong" paragraph.
- **lane 6 (channel and UI):** whether the read-only board shows precedent count and the last
  override. It reads `results/` and `precedents.jsonl`; it must never write either.

**You are waiting on:**

- **lane 1:** box online, sandbox name, and the confirmed share mount path. Everything in
  section 7 blocks on this. Section 6 does not, so start there.
- **lane 5:** the agent actually running `record_precedent.mjs` from a chat reply rather than
  you typing it. Your proof does not depend on this, the pitch does.

**Also worth flagging while you are in the code:** `agent/AGENTS.md:14` tells the agent to reply
"no new shipments" when the output is `[]`, but `process_inbox.mjs:80` prints an object,
`{ precedent_store, shipments: [] }`. Lane 5's problem, but you are the one who found it.

---

## 9. Answers you own in judge Q&A

- **"Is that a vector database?"** No. It is an append-only JSON Lines file with Jaccard
  retrieval over sorted description tokens. You can read it with `cat`. A broker can audit it.
  Nothing in the retrieval path is a model, so nothing in it can hallucinate.
- **"What if the retrieved precedent is wrong?"** It is disclosed in the memo with the broker's
  name, the source shipment and the reason, the cold classification is preserved in the result
  JSON, and a new `reclassify` supersedes it. Nothing is ever deleted, because the file is the
  audit trail. Known limit: a partial match around 0.75 can promote a line to READY without a
  human seeing it, which is why similarity goes in the memo.
- **"Does it survive rewording?"** Reordering and plurals are exact matches. Synonym swaps stay
  above the floor. Compound words like "nightlight" miss. Measured, table available.
- **"Why not fine-tune the model on the overrides?"** Because then the knowledge is inside a
  model artifact you cannot audit, cannot supersede, and lose when you swap models. The whole
  point is that the model is transient and the memory is permanent. Customs is the first
  vertical, not the product.
