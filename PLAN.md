# SovereignDesk: the build plan

**This is the single plan. It replaces the v1 and v2 build plan PDFs, `PRD.md`,
`docs/HACKATHON_BIBLE.md` and the six per-lane READMEs**, which contradicted each other on
the review channel, the tariff data and the stack. Superseded copies are kept under
`docs/superseded/` for reference only. If something here disagrees with them, this wins.

Two other files stay live and are not duplicated here: `agent/AGENTS.md` (the standing
orders the OpenClaw agent actually reads at run time) and `CLAUDE.md` (instructions for
Claude Code sessions). `docs/DATA_SWAP.md` remains as the detailed data-provenance
appendix.

Entry for the Dell x NVIDIA "Local AI on Dell Pro Max with GB10" hackathon, NYC,
2026-08-22. Six builders. Submission via the BuilderBase portal, and the demo must run on
the GB10 rather than a laptop.

## Quickstart, works on any laptop right now

No dependencies, no build step, no box required. Node 24.

```bash
git clone https://github.com/Nishanth-G-Palaniswami/SovereignDesk.git
cd SovereignDesk
bash scripts/smoke.sh
```

That runs the whole loop and asserts every number in this document. If it is green, the
engine, the real tariff data, the entry fees and the precedent round trip all work.

Drive it by hand:

```bash
mkdir -p ws/inbox && cp engine/samples/*.json ws/inbox/
node engine/process_inbox.mjs --root ws
node engine/record_precedent.mjs --shipment SHP-2026-0822-003 --line 2   --hts 9405.11.60.10 --reason "Ceiling mounted, mains powered, not portable." --root ws
cp engine/samples/shipment_006_precedent_test.json ws/inbox/
node engine/process_inbox.mjs --root ws
node lanes/6-channel-ui/server.mjs --root ws --port 7777
```

Sample 006 goes from `8513.10.20.00` at confidence 0.60, NEEDS_REVIEW, $2,362.50 duty, to
`9405.11.60.10` at confidence 0.95, READY, $2,053.80. Nothing was retrained. Open the
console and press `m` for the memory A/B.

---

## Overview, architecture and the non-negotiables

SovereignDesk is an always-on import-compliance triage agent for U.S. customs brokers, running entirely on one Dell Pro Max with GB10. Shipment JSON lands in a watched folder; a deterministic Node engine classifies HTS, flags PGA requirements, builds the duty and fee stack and lists missing LPCO documents; a local Qwen writes a plain-English memo; a broker approves or reclassifies on a console the box itself serves at 127.0.0.1:7777. Every reclassification appends to a precedent store on the host, so the desk gets better at this importer's goods each time a broker corrects it.

**The problem.** An entry clerk hand-triages every shipment: classify each line, check agency flags, chase documents, estimate duty, escalate anything odd. Those documents carry supplier pricing and customer lists that brokers are contractually barred from sending to third-party SaaS, so cloud LLMs are out before the technical conversation starts. Local is the product, not a constraint: the box is the compliance boundary, and the answer to "where does our data go" is "nowhere".

**Pitch line: a hedge fund that does not forget.** The LLM is transient and swappable; the memory layer is permanent, local, and deliberately outside the sandbox. Customs is the first vertical, not the product.

### The three non-negotiables

1. **The engine decides, the LLM only explains.** The model never picks a code, a rate, a flag or a duty figure. Structural, not a prompt preference. It answers every hallucination question.
2. **Nothing leaves the box.** OpenShell network policy is DROP, loopback only, no allowlist, no exceptions. Stronger than "only a memo leaves", and it deletes the biggest venue risk, which is wifi. Proof on camera: `curl -m 5 https://hts.usitc.gov` fails inside the sandbox while the pipeline keeps running.
3. **The second memo must cite the first shipment's precedent.** The thesis, protected above memo quality and UI polish. Everything else degrades first.
4. The system never guesses outside its operating envelope. Unknown or contradictory cases are frozen for human adjudication.

### Architecture

```
 HOST: GB10, aarch64, DGX OS 24.04, 128 GB | OPENSHELL SANDBOX (policy: DROP)
 ------------------------------------------|---------------------------------------
 broker drops shipment.json                |
   v                                       |
 <ws>/inbox/ ..... share mount ............|.. /workspace/.../inbox/
                                           |     ^
                                           |   OpenClaw cron, 2 min tick, ONE command:
                                           |   node engine/process_inbox.mjs --root .
 <ws>/results/<id>.result.json <.. mount ..|<----+  Node, zero deps, deterministic
 <ws>/processed/ memos/ decisions/         |     v
 <ws>/precedents.jsonl  HOST, DELIBERATE ..|.. read at classify time; written only by
   ^                                       |   engine/record_precedent.mjs
 Qwen served by NemoClaw                   |     v
   +-- inference.local proxy --------------|   memos/<id>.memo.md, fixed format
                                           |   own netns: no route to host localhost
 console 127.0.0.1:7777, host side,        |   all other egress: DROPPED
 SSE off results/ + memos/ + precedents    |   curl https://hts.usitc.gov -> blocked
   |  broker presses a (approve), r (reclassify), m (memory-off/on replay)
   v
 a -> decisions/<id>.decision.json ; r -> console shells out to record_precedent.mjs,
 which appends the one line to precedents.jsonl
```

**In the sandbox:** the OpenClaw agent, its cron, and every command it runs. Code executing over untrusted invoice text is the risky thing, and that is what is confined. **On the host mount:** `inbox/`, `processed/`, `results/`, `memos/`, `decisions/`, `precedents.jsonl` (`engine/process_inbox.mjs:33`). The store is on the host on purpose: destroy the sandbox, rebuild it, the broker's override still applies. One writer per artefact: the agent writes memos, the console writes decisions and shells out for precedents.

### Components

| Layer | Choice | Fallback if it fights you |
|---|---|---|
| Inference | NemoClaw managed vLLM, `nvidia/Qwen3.6-35B-A3B-NVFP4` | `NEMOCLAW_PROVIDER=ollama NEMOCLAW_MODEL=qwen3.6:35b`, USB-staged, zero image pull |
| Sandbox | OpenShell, policy DROP, FS scoped to the share mount | narrow the FS scope; DROP is never what gets relaxed |
| Agent | OpenClaw cron, 2 minute tick | `node engine/process_inbox.mjs --root <ws>` by hand |
| Engine | Node `.mjs`, zero deps, no `package.json`, no build | none, `bash scripts/smoke.sh` is green today |
| Memory | `precedents.jsonl`, Jaccard over sorted description tokens | lower `PRECEDENT_FLOOR` (`engine/triage.mjs:176`) from 0.55 toward 0.40 |
| Review | `node lanes/6-channel-ui/server.mjs --root <ws> [--port 7777]` | `node engine/record_precedent.mjs ...` in a terminal, on camera |
| Tariff data | `engine/data/usitc/hts_2026_rev_7.json`, 35,496 rows, committed | none, nothing downloads at the venue |

The console exists: `lanes/6-channel-ui/server.mjs` plus `index.html`, zero deps, binds 127.0.0.1 only. Verified up on 2026-08-22: `curl -s http://127.0.0.1:7777/api/health`. Lane 6 owns polish and the BuilderBase submission.

**Not built, say it out loud.** `engine/data/pga_flags.json` and `engine/data/lpco_rules.json` are still demo tables (lane 3 owns re-deriving them). Sample 001 does not reach READY. No CBP ACE filing, no OCR, no binding-ruling lookup, no authoritative classification.

### The required stack, stated exactly

- **NemoClaw**: connection and inference layer. Provisions the sandbox, serves the model. **Not a memory database.** "NemoClaw stores the precedents" is wrong; `precedents.jsonl` is a file on the host mount.
- **OpenClaw**: the agent. Runs the cron loop, calls the engine, writes the memo.
- **OpenShell**: container and sandbox runtime. Kernel isolation plus the DROP policy.
- **Qwen**: the model, served locally, zero cloud calls.

All four are load-bearing. Confirm every NemoClaw and OpenClaw subcommand with `--help` on the day; `bash lanes/1-inference/doctor.sh` prints one screen of box state and probes for all three binaries.

### aarch64, before you install anything

The box is ARM64. **x86 wheels and x86 container images do not run.** This kills more teams than bad ideas do. Hence Node with zero dependencies: Node is guaranteed inside the sandbox because OpenClaw runs on it, and it needs no compiled wheels. No Python in this repo, ever. Do not hand-roll Docker; NemoClaw owns container lifecycle. The sandbox has no route to host localhost, so inference goes through OpenShell's `inference.local` proxy.

*Forward-looking only:* remote approval over a self-hosted Matrix homeserver plus Bitchat BLE mesh, off-site approval without touching the public internet, is a later extension. Not built, not demoed, not in any lane's done-definition. `lanes/6-channel-ui/matrix_bridge.mjs` is the retained starting point.

---

## Data, provenance and the duty stack

Real: every tariff rate, public U.S. government data, in the repo, checkable line by line.
Synthetic: the six shipments in `engine/samples/`, invented and labelled invented, because
broker invoices cannot ship without their consent. Their data stays on their box.

### The USITC export

`engine/data/usitc/hts_2026_rev_7.json`, committed. USITC HTS export (hts.usitc.gov,
Export, JSON), 2026 rev 7, 35,496 rows, 19,856 ten-digit lines. Both halves of the duty
stack come from it. Nothing is downloaded at the venue.

- MFN rate is the line's `general` field (`"12.5%"`, `"Free"`).
- Section 301 membership is a footnote (`"See 9903.88.03."`) pointing at a Chapter 99
  heading whose own `general` text states the surcharge (`"...plus 25%"`), so the surcharge
  is read, not assumed. `surcharges.json` carries `section_301.rates_by_prefix` and
  `section_301.authority_by_prefix` across 1,184 prefixes.

Rebuild:

```bash
node scripts/build_hts_from_usitc.mjs --archive engine/data/usitc/hts_2026_rev_7.json
```

- `engine/data/hts_subset.csv`, 16 curated lines, real rates. The only table
  `engine/triage.mjs` loads (line 79).
- `engine/data/hts_full.csv`, 19,856 lines. Provenance artifact, nothing loads it: no
  `keywords` column, so pointing the engine at it collapses classification.

Never hand-edit a rate, rebuild. (`backupOnce()` writes `*.placeholder.bak` for the subset
and `surcharges.json` on first run; gitignored, absent from a fresh clone.) Keywords in
`hts_subset.csv` are curated and not regenerated: editing a keyword is a legitimate
classification fix, editing a rate is not.

### Indent-inheritance gotcha

Rates and footnotes live on the nearest ANCESTOR with a value: a ten-digit line read on its
own has a blank `general` almost every time. Walk the `indent` hierarchy.
`scripts/build_hts_from_usitc.mjs` does; anything else reading the USITC JSON directly must
too, or it silently produces zeros.

### Corrections the swap produced

| item | was | is |
|---|---|---|
| 8471 laptops, 301 | 0% | 25% (9903.88.03) |
| 4202 bags, 301 | 7.5% | 25% |
| 9503 toys, 301 | 7.5% | none, no prefix in `rates_by_prefix` |
| 9405.11.60.10 MFN | 3.9% | 7.6% |
| `4016.93.50.00` | invalid suffix | `4016.93.50.50` |
| `0306.17.00.40` | invalid suffix | `0306.17.00.41` |

Section 122 is disabled (`surcharges.json`, `section_122.enabled: false`): it added a
fabricated flat 10% to every line and no 9903 subchapter implementing an s.122 surcharge
exists in the 2026 rev 7 schedule. Re-enabling needs a citation to a live Chapter 99
heading, not a config edit.

Not modelled: specific duties (cents/kg). `parseRate()` in the build script keeps the
ad-valorem part and writes the rest to a `rate_note` column of `hts_full.csv`; the subset
has no such column, so the engine cannot surface it yet.

### Entry-level fees, `feesFor()` at engine/triage.mjs:265

- MPF: 0.3464% of the ENTRY's total entered value, clamped to a per-entry minimum and
  maximum (committed $32.71 and $634.62, `surcharges.json` `fees.mpf`).
- HMF: 0.125% of entered value, no minimum or maximum, vessel only, keyed off the shipment's
  `mode` field. Not charged on air, truck or rail.
- Entry-level on purpose: folding MPF into a per-line rate breaks the clamp on any
  multi-line entry.
- CBP resets the min and max every fiscal year; `fees.mpf.source` is `VERIFY-CBP-FY2026`,
  so confirm both before quoting a number.
- Measured: the MPF minimum clamp fires on four of the six samples (001, 003, 004, 006),
  exactly what a per-line rate would have got wrong. 004 draws no HMF, mode is not vessel.
- Reported as `shipment_summary.fees[]`, `estimated_fees`, `estimated_total_payable`.
  `effective_rate` deliberately stays duty-only.

Sample 006 cold: duty $2,362.50 on $6,300, MPF $32.71 (raised to the minimum), HMF $7.88,
total payable $2,403.09.

### Still placeholder

`engine/data/pga_flags.json` and `engine/data/lpco_rules.json` are demo tables (`_comment`:
"Replace with your real PGA flag table"). Last placeholder surface in the repo, lane 3 owns
it. Re-derive from the agencies' published requirements; do not port a table out of a
previous employer's codebase.

---

## How to build it: phases and gates

Two rules stop six people from wrecking one pipeline:

1. **Only lane 5 merges to `main`.** Everyone else pushes `lane/<n>-<slug>` and stops. Rebase before every push: `git pull --rebase --autostash origin main`.
2. **The contracts are frozen before any real module is written.** They are the only place the six lanes touch.

Phases are ordered, not timeboxed. A phase ends when its gate is true for everyone.

### Phase 0: prove the box

Lane 1 owns it. Lanes 2 to 6 work on laptops until it is green.

```bash
bash lanes/1-inference/doctor.sh          # aarch64, nvidia-smi, memory, disk
nemoclaw <sandbox> connect                # then, inside:
mkdir -p inbox && cp engine/samples/shipment_001_clean.json inbox/
node engine/process_inbox.mjs --root .
curl -s http://inference.local/v1/models | head -c 200
```

No hand-rolled Docker: the box is ARM64 and NemoClaw owns container lifecycle.

**Gate:** the model answers from inside the sandbox, `doctor.sh` is clean, the sweep prints `{ precedent_store, shipments }` (an object, not an array), and `precedent_store.path` is the mount root on **host** storage. A sandbox-local path kills the teardown demo.

### Phase 1: freeze the contracts, then fake everything

The engine result shape is already the contract and already frozen (`engine/triage.mjs:13`). Do not redefine it. What gets pinned here is the console and agent boundary:

- console API, from `node lanes/6-channel-ui/server.mjs --root <workspace> --port 7777`, bound to `127.0.0.1` only: `GET /api/shipments`, `GET /api/shipment/:id`, `GET /api/stream` (SSE), `POST /api/review {shipment_id, action: APPROVE|RECLASSIFY, line, hts, reason}`, `POST /api/replay {shipment_id, memory}`.
- one writer per artefact: the agent writes `memos/`, the console writes `decisions/` and shells out to `record_precedent.mjs`. Never both.
- the state machine and event names below.

Then every module returns hardcoded data: fake memo, fake precedent hit, fake feed.

**Gate:** `bash scripts/smoke.sh` green against fakes. Run it on the box or in WSL, never Git Bash (MSYS paths break Node's resolution).

### Phase 2: wire the full pipeline on fakes

Watcher, state machine, agent, console with a live feed. All lies, real wiring.

**States.** Every transition appends `{shipment_id, from, to, at}` to `events.jsonl` at the workspace root, which the console feed tails:

| state | entered when | event |
|---|---|---|
| `NEW` | file lands in `inbox/` | `shipment.received` |
| `RULED` | engine wrote `results/<id>.result.json` | `shipment.ruled` |
| `RECALLED` | precedent lookup done, hit or miss | `precedent.checked` |
| `MEMO_READY` | memo written to `memos/<id>.memo.md` | `memo.written` |
| `AWAITING_REVIEW` | card on the console | `review.requested` |
| `RESOLVED` | `decisions/<id>.decision.json` written, or a precedent appended and re-swept | `review.resolved` |

**Gate:** drop a file, a fake memo appears on the console, press `r` to reclassify, a fake precedent shows in the memory panel.

### Phase 3: build the real modules, lanes in parallel, nobody merges

- **1** keeps Qwen serving, stays on call.
- **2** drafts the drop policy and the blocked-egress shot list. Does not apply the policy yet.
- **3** sample 001 (`triage.mjs:141-145`: the greedy `liquid pump` keyword outruns the halving penalty), then `pga_flags.json` and `lpco_rules.json` re-derived from the agencies' published requirements. Re-sweep all six samples after every edit.
- **4** `node lanes/4-memory/eval_retrieval.mjs`, then the teardown rehearsal. Does not rebuild the store.
- **5** the memo prompt in `agent/AGENTS.md`, the cron job, the merge queue.
- **6** the console and the BuilderBase draft. `lanes/6-channel-ui/matrix_bridge.mjs` is a future-work spike (remote approval over a private mesh), not part of this build.

**Gate:** each lane's done-definition passes on its branch, `bash scripts/smoke.sh` green.

### Phase 4: swap in real modules one at a time

Full demo run after each swap. When it breaks you know which swap did it.

1. **Engine.** Real `process_inbox.mjs` behind the watcher.
2. **LLM memo.** Prompt, near enough verbatim:

   > Read `results/<id>.result.json`. Memo under 1,200 characters. Header: shipment id, importer, origin. Status `READY` or `NEEDS_REVIEW`, entered value, estimated duty, effective rate, estimated fees, total payable. Per line: HTS with confidence, MFN plus surcharges as a total rate, PGA requirement and status, flags. If a precedent applied: who set it, on which shipment, why, its similarity, and what the cold engine would have said. If `declared_check` is present: declared versus engine and the duty delta. Then missing documents, then one next action. **You may not change an HTS code, a rate, a flag or any figure: every number is copied from the JSON. If a precedent contradicts the engine's own pick, say so and show both codes.** Invent nothing. No preamble.

3. **Memory.** Point `--root` at the host mount, confirm `precedent_store.path` again.
4. **Console.** Repoint `server.mjs --root` at the live workspace.
5. **The drop policy, LAST.** Loopback only, no allowlist.

The firewall goes last because a drop-policy sandbox with a broken inference route looks exactly like a code bug: lock down first and you cannot tell them apart.

**Gate:** on the GB10: drop sample 006, cold memo `8513.10.20.00` 0.60 `NEEDS_REVIEW` $2,362.50, reclassify on the console, re-sweep, warm `9405.11.60.10` 0.95 `READY` $2,053.80, and `curl -m 5 https://hts.usitc.gov` fails inside the sandbox while the loop keeps running.

### Phase 5: record, rehearse, freeze, submit

Record the backup video before you think you need it: a rough video of a working loop beats a polished plan for a video. Then freeze (lane 5 only, only for a demo-breaking bug), rehearse with a timer, submit on BuilderBase at least 20 minutes early, and re-run the loop once after submitting so the box is warm for judges.

---

## Who does what: the six lanes

One branch per lane, `lane/<n>-<slug>`. Only lane 5 merges to `main`; everyone else pushes and
stops. Each lane fakes its piece first, then swaps in real parts one at a time.

### Lane 1, inference and the box

**Owns:** GB10 over SSH, Qwen served, NemoClaw/OpenShell sandbox up with the project
share-mounted. Gates every other lane.

**Done:** inside the sandbox `node engine/process_inbox.mjs --root .` prints
`{precedent_store, shipments}`, `shipments[0]` = `SHP-2026-0822-001` / `NEEDS_REVIEW` /
`LOW_CONFIDENCE` / 0.54 (correct today, lane 3's open finding), and `precedent_store.path` is the
mount root.

**Never:** hand-roll Docker (aarch64, x86 images will not run, NemoClaw owns container
lifecycle); put the workspace inside the sandbox filesystem, which kills lane 4's teardown;
touch `engine/`.

**Queue:** doctor; check for a pre-imaged box and use it; Ollama off the USB, no container pull;
managed vLLM only on fast wifi, abandon rather than debate; share-mount; announce green.

```bash
bash lanes/1-inference/doctor.sh                             # box state, one screen
export NEMOCLAW_PROVIDER=ollama NEMOCLAW_MODEL=qwen3.6:35b   # skips Express and the vLLM pull
nemoclaw customs-desk --help                                 # alpha CLI, confirm every verb
nemoclaw share mount ~/sovereigndesk /workspace/sovereigndesk && nemoclaw customs-desk connect
```

`127.0.0.1` inside the sandbox is the sandbox; inference goes through OpenShell's
`inference.local` proxy, wired by NemoClaw.

**Hands over:** sandbox name, model tag and provider, sandbox mount path, host path.

### Lane 2, sandbox policy and pitch

**Owns:** the drop policy, the on-camera egress proof, the pitch, the backup video.

**Done:** `curl -m 5 https://hts.usitc.gov` inside the sandbox fails while a sweep keeps working,
both on camera; the policy listing saved under `lanes/2-sandbox/evidence/` with no destinations
on it; `evidence/backup-video.mp4` exists; the pitch lands 2:45 to 3:00 twice on a stopwatch.

**Never:** add an allowlist entry (policy is drop, loopback only, nothing to widen); hand-roll
iptables or nftables; apply the policy before lane 5's loop is green, or a firewall problem looks
exactly like a code problem; fake a denial; screenshot a token.

**Queue:** capture the real policy syntax with `--help` into `evidence/policy-syntax.txt`;
rehearse while blocked; apply drop LAST; capture the proof; record the backup video before you
think you need it; freeze.

```bash
nemoclaw $SANDBOX logs --follow                    # right terminal, host
nemoclaw $SANDBOX connect                          # left terminal
curl -m 5 https://hts.usitc.gov ; echo "exit=$?"   # inside: the headline
ls ~/.ssh 2>&1 | head -1                           # host paths are not there
```

The console is on loopback, the one thing drop does not touch, so review keeps working while
nothing leaves. The line is "nothing leaves", not "only the memo leaves".

**Hands over:** evidence, denial screenshot, backup video and stack line to lane 6; the pitch
script to everyone.

### Lane 3, rules engine and domain truth

**Owner: Nishanth.** Owns `engine/` and every factual claim about tariffs, agency flags, duty.

**Done:** `bash scripts/smoke.sh` ends `SMOKE PASSED`; sample 001 line 1 resolves to
`8413.91.90.96` above 0.70 after a six-sample re-sweep; nothing under `engine/data/` still says
"Replace with your real ... table"; MPF min and max confirmed against CBP FY2026 or unquoted.

**Never:** rewrite in Python (aarch64 wheels; Node needs none); rename a `result.json` field,
which lane 5's prompt and lane 6's console parse; edit the `triage.mjs` tokenizer without
mirroring `record_precedent.mjs:39-46`, or signatures diverge silently; point the engine at
`hts_full.csv`; re-enable `section_122`.

**Queue:**

1. Sample 001. `8413.70.20.05` (whole pump) scores 15, `8413.91.90.96` (parts) 13, conf 0.54;
   the parts line is right. Trim the greedy `liquid pump` keyword, or move the halving penalty at
   `engine/triage.mjs:145` from 0.5 to about 0.35, then re-sweep all six. Decide first: it
   changes the demo's first beat.
2. `engine/data/pga_flags.json` and `lpco_rules.json`, the last placeholder surface;
   `pga_flags.json:2` still says "Replace with your real PGA flag table." Re-derive the ten
   `requirement_id` rules from the agencies' own published requirements. Do not port a table out
   of a previous employer's codebase; this repo goes public.
3. Fees at `engine/triage.mjs:265`: `surcharges.json` carries MPF min 32.71 / max 634.62 marked
   `VERIFY-CBP-FY2026` and CBP resets both each fiscal year, so confirm or they stay off stage.
   The 0.3464% rate and HMF 0.125% (vessel only) are stable.
4. The accuracy answer card to lane 2.

```bash
mkdir -p ws/inbox && cp engine/samples/*.json ws/inbox/ && node engine/process_inbox.mjs --root ws
node engine/triage.mjs engine/samples/shipment_001_clean.json --pretty
node scripts/build_hts_from_usitc.mjs --archive engine/data/usitc/hts_2026_rev_7.json
```

**Gotcha:** rates and footnotes sit on the nearest ancestor with a value; a ten-digit line read
alone is almost always blank. Walk the `indent` hierarchy.

**Hands over:** the number card to lanes 2, 4, 5, 6. Nobody quotes a duty figure they did not get
from lane 3.

### Lane 4, precedent memory

**Owns:** proving retrieval survives rewording and a full sandbox teardown; exposes the memory
ON/OFF toggle for the A/B moment.

**Done:** `node lanes/4-memory/eval_retrieval.mjs` exits 0 on all 12 cases; the sandbox is
destroyed and the warm result reproduces with nothing re-entered, recorded not just performed;
`POST /api/replay` on 006 returns `8513.10.20.00` / 0.60 memory off and `9405.11.60.10` / 0.95
memory on from the same input file.

**Never:** rebuild the store (`precedents.jsonl`, append-only, workspace root on the host mount,
written only by `record_precedent.mjs`); build a vector store, embedding index or database, since
a model in the retrieval path reopens the hallucination question the architecture closes;
hand-edit the file, even to reset (point `--root` at a fresh directory); edit `engine/triage.mjs`.

**Queue:** reproduce cold and warm; run the eval; confirm the `precedent_store.path` the sweep
prints resolves to the share mount (read it, do not assume); rehearse and record the teardown.

```bash
node engine/record_precedent.mjs --shipment SHP-2026-0822-006 --line 1 \
  --hts 9405.11.60.10 --reason "portable LED lamp, not a torch" --root $WS
node lanes/4-memory/eval_retrieval.mjs
sha256sum $WS/precedents.jsonl   # identical before and after nemoclaw <sandbox> rebuild
curl -s -X POST 127.0.0.1:7777/api/replay -H 'content-type: application/json' \
  -d '{"shipment_id":"SHP-2026-0822-006","memory":false}'
```

**Say the weakness first:** the tightest passing paraphrase clears the 0.55 floor by 0.006 while
the worst false positive sits 0.35 below it, so the floor is far too conservative and could drop
to roughly 0.40. "LED lamp", the terse description real invoices are full of, scores 0.286 and
does not fire.

**Hands over:** the A/B endpoint and its numbers to lane 6; the teardown recording to lane 2;
the floor recommendation to lane 3.

### Lane 5, orchestration and merge authority

**Owns:** the OpenClaw agent running unattended (standing orders, cron, memo format), and sole
merge authority to `main`.

**Done:** `openclaw cron run <job-id>` produces a memo matching `agent/AGENTS.md` with nobody
typing anything else; a file dropped into the host inbox becomes a memo within 2 minutes hands
off; `bash scripts/smoke.sh` ends `SMOKE PASSED` before every push.

**Never:** let another lane merge, especially when they are sure it is trivial; add a dependency
or a `package.json`; rewrite the engine, because a wrong memo means a wrong prompt; weaken the
`AGENTS.md` safety block, which is the prompt-injection answer.

**Queue:** git spine and six branches first (the only work here not needing the box); fix
`agent/AGENTS.md` if it drifts (the Telegram references and the `[]` versus
`{shipments: []}` mismatch were both fixed on 2026-08-22, so re-read before assuming either); pin the absolute `--root` and broadcast it,
because four lanes are guessing; install and tune; cron; merge and smoke; move `main` onto the
box.

```bash
bash scripts/smoke.sh                              # Git Bash, WSL or the box: it uses relative paths
cp agent/AGENTS.md ~/.openclaw/workspace/AGENTS.md # no live reload, re-copy after every edit
openclaw cron add --name sweep --every 2m --session isolated --message "sweep"
openclaw cron list && openclaw cron run <job-id>
```

The box runs a USB copy: merges land on GitHub and six laptops, not the GB10. Move them across
after every merge or the demo runs old code. One writer per artefact: the agent writes `memos/`,
the console writes `decisions/` and shells out to `record_precedent.mjs`.

**Hands over:** the cron job id and on-stage trigger line to lane 2; the pinned workspace root to
everyone.

### Lane 6, local review console and submission

**Owns:** the review console served from the box on `127.0.0.1:7777`, and the BuilderBase
submission.

**Done:** the console loads at `http://127.0.0.1:7777`; the broker approves or reclassifies by
click or the `a` / `r` keys; `decisions/<id>.decision.json` appears or a precedent is appended;
next tick the same card flips `NEEDS_REVIEW` to `READY` with cold and warm side by side.
Submitted 20 minutes early minimum, with repo link, backup video, screenshots.

**Never:** `npm install`, or any framework; add a write path beyond `POST /api/review`, since the
console must never be what breaks the loop; edit `engine/*.mjs` or `agent/AGENTS.md`; merge.

**Queue:**

1. `lanes/6-channel-ui/index.html`, the one missing file. `server.mjs` is complete and returns
   500 "index.html is missing next to server.mjs" until you write it.
2. The memory ON/OFF toggle against `POST /api/replay`, which re-runs one shipment with and
   without the precedent store and writes nothing into `results/`, so it is safe on stage.
3. The precedent badge: cold `8513.10.20.00` conf 0.60 `$2,362.50`, warm `9405.11.60.10` conf
   0.95 `$2,053.80`, swing `$308.70`. `/api/replay` gives you both halves.
4. BuilderBase draft saved early; then legibility at fifteen feet on a washed-out projector.

```bash
node lanes/6-channel-ui/server.mjs --root <ws> --port 7777
curl -s 127.0.0.1:7777/api/health
curl -s -X POST 127.0.0.1:7777/api/review -H 'content-type: application/json' \
  -d '{"shipment_id":"SHP-2026-0822-006","action":"RECLASSIFY","line":1,"hts":"9405.11.60.10","reason":"portable LED lamp"}'
```

**Gotchas:** every rate in the result JSON is a fraction, so `effective_rate: 0.326` is 32.6%;
multiply by 100 exactly once. Render status and flags independently: 006 warm is `READY` and
still carries `LPCO_MISSING`, correctly. A reclassify with no reason returns 400 on purpose: the
reason is the institutional memory.

**Hands over:** console URL to everyone; screenshots to lane 2; submission text for a
read-through.

**Forward note, not this build:** `lanes/6-channel-ui/matrix_bridge.mjs` is a zero-dependency
Matrix Client-Server spike, kept as the starting point for later remote approval over a
self-hosted homeserver or a Bitchat BLE mesh, still without touching the public internet. Not
built, not demoed, not in any done-definition.

---

## The demo, the pitch and judge Q&A

Inputs are JSON from `engine/samples/`. PDF and OCR intake is a stated non-goal.

### Three minutes

| Time | On screen | Drives |
|---|---|---|
| 0:00-0:20 | Problem. Entries are hand-triaged, and the documents carry pricing and customer lists that cannot go to a cloud. So nobody automates it. | 2 |
| 0:20-0:50 | **Lockdown.** `nemoclaw $SANDBOX connect` left, `nemoclaw $SANDBOX logs --follow` right. Inside: `curl -m 5 https://hts.usitc.gov ; echo exit=$?` fails, the denial hits the log, the drop count climbs. Then `policy-list`. "Policy is drop. There is no allowlist, there is no exception." | 2 |
| 0:50-1:20 | **First shipment.** `cp engine/samples/shipment_004_audit_risk.json engine/samples/shipment_006_precedent_test.json $WS/inbox/`, then `openclaw cron run <job-id>` (`cron list` for the id; `sweep` is the message, not a job name). The console on `127.0.0.1:7777` lights up over SSE: 004 declared 4016.93.50.50 vs engine 8413.91.90.96, delta $165 on $6,600, DECLARED_DIFFERS. Memo on-box in `$WS/memos/`. | 5, 6 |
| 1:20-1:50 | **Correction.** Open SHP-2026-0822-006. Cold: 8513.10.20.00, conf 0.60, NEEDS_REVIEW, duty $2,362.50 on $6,300 (37.5%), MPF $32.71 at the entry minimum, HMF $7.88, total payable $2,403.09. Press `r`, enter 9405.11.60.10 and a reason (required, the reason is the memory). The memory panel flashes; the console shells out to `record_precedent.mjs`, the only sanctioned writer. | 6, 4 |
| 1:50-2:20 | **Payoff.** `cp $WS/processed/shipment_006_precedent_test.json $WS/inbox/`, re-run the tick. Warm: 9405.11.60.10, conf 0.95, READY, $2,053.80 (32.6%), PRECEDENT_APPLIED citing the broker's words. Swing $308.70. `m` runs the A/B: memory off gets 8513, on gets 9405, same file, nothing retrained. | 4, 6 |
| 2:20-2:40 | **Teardown.** `tail -1 $WS/precedents.jsonl` on the host. Destroy the sandbox, rebuild, re-run 006: still 9405, still READY. The store was never inside it. | 4 |
| 2:40-3:00 | Business and non-goals: zero marginal cost on the broker's premises; no ACE filing, OCR or binding rulings; it proposes, a broker decides. Close: **the model is transient and swappable, the memory is permanent and it lives on this desk.** | 2 |

Record the backup video early, same beats, to `lanes/2-sandbox/evidence/backup-video.mp4`.
Lane 6 also needs `policy-list` output and the two-terminal screenshot.

### Judge Q&A

- **Accuracy?** Keyword scoring over `engine/data/hts_subset.csv`, cut from the committed USITC
  2026 rev 7 export (35,496 rows, 19,856 ten-digit lines). `confidence = top/(top+second)`; under
  0.70 (`triage.mjs:27`) it goes to a human. Five of six samples do, by design.
- **Why not let the LLM classify?** A wrong code is a penalty, not a typo. Engine decides, model
  writes language, every memo line traces to a rule in the result JSON.
- **Why local?** Confidentiality, no per-token cost on an always-on loop, works with the WAN
  down at a port office.
- **OpenShell?** seccomp, Landlock, network namespaces; egress drop; filesystem scoped to the
  share mount, so host home, USB and SSH keys are absent; inference via `inference.local`, since
  `127.0.0.1` inside the sandbox is the sandbox.
- **Prompt injection via a malicious invoice?** Kernel: no reachable destination, no host
  filesystem. Standing orders (`agent/AGENTS.md`): writes confined to `memos/` and `decisions/`,
  refuses fetch, upload, delete, and that layer is a prompt, not a kernel rule, say so.
  Structural: it cannot change a code, codes come from the engine and only a human reclassify
  appends a precedent. Worst case is a bad memo a human reads anyway.
- **Why Qwen?** NemoClaw's Express default on GB10, strongest open tool-caller at that size,
  one-line swap.
- **Scale?** One box per desk, 128 GB runs a second sandbox as reviewer, append-only JSONL merges
  across desks by concatenation.
- **Not built?** ACE filing, OCR, binding rulings. `engine/data/pga_flags.json` and
  `lpco_rules.json` are demo tables and the engine's disclaimer says so. Mesh approval
  (self-hosted Matrix, Bitchat BLE) is a future extension off the public internet;
  `lanes/6-channel-ui/matrix_bridge.mjs` is a spike, not demoed.

Name these before a judge finds them.

- **The precedent floor is too tight.** `node lanes/4-memory/eval_retrieval.mjs`: the tightest
  passing paraphrase clears PRECEDENT_FLOOR (`triage.mjs:176`, 0.55) by 0.006, the nearest false
  positive has 0.35 of headroom. It should drop toward 0.40. "LED lamp", the terse description
  real invoices use, scores 0.286 and does not fire.
- **Sample 001 never reached READY.** Pump casing: 8413.70.20.05 scores 15, 8413.91.90.96 scores
  13, confidence 0.54. The second choice is right, a casing is a part. The parts-vs-whole logic
  at `triage.mjs:141-145` fires but the keyword "liquid pump" outruns it. One-line fix, trim the
  keyword or move 0.5 to about 0.35 at `triage.mjs:145`, then re-sweep all six.
- **Warm 006 reads READY while listing a missing DOE certification**: 9405 pulls a requirement
  8513 did not, and status comes from confidence and the declared check, not the LPCO list.
  Do not read that line aloud; if asked, say exactly that.

---

## Risks, non-goals, and what comes later

### Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| aarch64 image or Python wheel incompatibility | High | `uname -m` must print `aarch64`. No `docker build`, no Docker Hub pull, no `pip`. OpenShell is the container runtime, NemoClaw provisions. The engine is Node: zero dependencies, no build step. |
| NemoClaw or OpenClaw alpha CLI flags have changed | High | Every subcommand in this plan is unverified against the installed build. Confirm with `nemoclaw --help` and `openclaw --help` on the day. |
| `share mount` puts the workspace in the wrong place | Medium | Fallback is `connect` plus copying the project in, but that lands `precedents.jsonl` inside the sandbox and kills lane 4's teardown. Tell lane 4. |
| Model slow, or the agent will not hold the memo format | Medium | Smaller Qwen staged on the USB; cut the format to four lines. The engine carries the accuracy and the console renders its JSON directly, so the memo is garnish. Fix the prompt, never the engine. |
| Judges read it as "just a rules engine" | Medium | Lead with the unattended loop, `curl` failing inside the sandbox while the pipeline runs, and an override surviving a sandbox rebuild. A wrong code is a penalty, not a typo: determinism is the pitch. |
| Team size. The brief records 2 to 4 builders and we are 6 | Medium | Confirm with the organizers at check-in, before anyone opens a laptop. Lane 6 asks, lane 2 if it gets to the desk first. |
| A fee figure quoted on camera is wrong | Medium | MPF min (`32.71`) and max (`634.62`) in `engine/data/surcharges.json` are tagged `VERIFY-CBP-FY2026` and CBP resets both each fiscal year. Confirm, or quote the 0.3464% rate and not the clamp. |
| Sample 001 still lands `NEEDS_REVIEW` | Known, open | Lane 3. Trim the greedy `liquid pump` keyword on `8413.70.20.05`, or raise the penalty at `engine/triage.mjs:145` from 0.5 to about 0.35. Re-sweep all six samples. Not after freeze. |
| `pga_flags.json` and `lpco_rules.json` read as fabricated | Low | Demo tables, the last placeholder surface in the repo. Say so before a judge asks. |

### Non-goals

- No CBP ACE filing. The agent files nothing, anywhere.
- No OCR (JSON intake only) and no binding ruling lookups.
- No authoritative classification. The engine proposes candidates with confidence and a trace; a licensed broker decides. Below `CONFIDENCE_FLOOR = 0.70` (`engine/triage.mjs:27`) or on a declared-code mismatch, the line routes to a human.
- No remote approval and no mesh. Review is the loopback console on `127.0.0.1:7777` and nothing else.

### What comes later

**Remote approval without the public internet**: a self-hosted Matrix homeserver on the box, or a Bluetooth LE mesh such as Bitchat. The zero-dependency Client-Server API spike at `lanes/6-channel-ui/matrix_bridge.mjs` is the starting point. Not built, not demoed, not in any lane's done-definition.

Also later:

- Classification over all 19,856 ten-digit lines in `engine/data/usitc/hts_2026_rev_7.json`. Keyword scoring runs on the 16 curated rows of `engine/data/hts_subset.csv`; the duty stack reads the full export.
- Embeddings instead of Jaccard. The tightest passing paraphrase clears `PRECEDENT_FLOOR = 0.55` (`engine/triage.mjs:176`) by 0.006; "LED lamp", the description that dominates real invoices, scores 0.286 and never fires. The floor could drop to roughly 0.40.
- Real PGA and LPCO tables re-derived from the agencies' published requirements, not ported out of a previous employer's codebase.
- Multi-entry duty reporting. Fees are modelled at entry level (`engine/triage.mjs:265`), one shipment per entry.
