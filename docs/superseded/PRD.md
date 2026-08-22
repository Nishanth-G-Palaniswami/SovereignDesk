# SovereignDesk

Product requirements. Entry for the Dell x NVIDIA "Local AI on Dell Pro Max with GB10"
hackathon, NYC, Saturday 2026-08-22.

This is the one document a judge or a new teammate reads first. Everything in it is
checkable against the repo. Lane detail lives in `lanes/<n>-<slug>/README.md`; where this
page and a lane README overlap, they agree, and the lane README carries the commands.

---

## 1. One-liner and the problem

**An always-on import-compliance triage agent for U.S. customs brokers, running entirely on
one desk-side box.** Shipment files land in a watched folder. A deterministic engine
classifies HTS, flags PGA requirements, computes the duty stack and lists missing LPCO
documents. A local LLM writes a plain-English memo. A human approves or reclassifies from
their phone. Every reclassification is stored as institutional precedent.

**The problem.** An entry clerk at a brokerage hand-triages every inbound shipment:
classify each line, check agency flags, chase documents, estimate duty, escalate anything
odd. It is repetitive and error-prone. And the documents carry supplier pricing and
customer lists that brokers are contractually barred from sending to third-party SaaS. So
nobody automates it. Cloud LLMs are off the table for most brokerages before the technical
conversation even starts.

That contractual bar is why local is the product and not a constraint. The box is the
compliance boundary. A default-deny sandbox plus an on-box chat server means the answer to
"where does our data go?" is "nowhere", and that is a sentence a broker's counsel can sign
off on. Zero per-token cost is what makes an always-on two-minute loop free to run forever.

**The architectural story:** build a hedge fund that does not forget. The LLM is transient
and swappable. The memory layer is permanent and lives on the box. Customs is the first
vertical, not the product.

**Abbreviations.** HTS = Harmonized Tariff Schedule. PGA = Partner Government Agency (FDA,
USDA, CPSC, EPA, NOAA, FCC, DOE). LPCO = Licenses, Permits, Certificates, Other.
MFN = Most-Favored-Nation base rate. CBP = U.S. Customs and Border Protection.
AD/CVD = antidumping / countervailing duty. LCB = Licensed Customs Broker.

---

## 2. Users

**Entry clerk.** Wants the packet pre-triaged and every open question narrowed to a single
decision. Not a research tool: a memo that says which line is uncertain, what the engine's
second choice was, which document is missing and what one reply resolves it. Works from a
phone, because they are on a warehouse floor as often as at a desk.

**Compliance manager.** Wants traceability and a zero-exfiltration guarantee. Traceability
means every code in a memo maps to a rule in a `trace[]` they can read back, and every
human override is on record with a name, a timestamp and a reason. Zero exfiltration means
an auditable policy file, not a vendor's promise. Both are also what defends a CBP audit:
a broker who cannot show why a code was used cannot defend it.

---

## 3. Scope

### Must (demo critical)

1. **Watch-folder intake.** A new `shipment.json` in `inbox/` is processed within one cron
   tick (2 minutes), unattended.
2. **Deterministic engine.** HTS candidates with a confidence score, PGA flags with
   must / may to disclaimable semantics, the duty stack (MFN plus Section 301), an LPCO
   checklist against documents on file, a declared-versus-engine audit check, and a full
   `trace[]`. Already written: `engine/triage.mjs`, `engine/process_inbox.mjs`,
   `engine/record_precedent.mjs`.
3. **Memo.** The local LLM writes `memos/<id>.memo.md` in the fixed format at
   `agent/AGENTS.md:40-57` and posts the same text to the room.
4. **Human round trip.** `approve <id>` and `reclassify <id> line <n> to <hts>` from a
   phone. `approve` writes `decisions/<id>.decision.json`; `reclassify` runs
   `engine/record_precedent.mjs`, which appends one line to `precedents.jsonl`.
5. **Precedent applied automatically.** The same file re-swept picks up the override, with
   the memo naming who made the call and what the cold engine would have said.
6. **OpenShell policy.** Filesystem scoped to the share mount, no public internet
   destination on the egress allowlist, and a blocked outbound attempt demonstrable on
   camera while the memo still lands.
7. **It runs on the GB10.** Not on a laptop. A laptop-only demo is a disqualification.

### Nice to have (only if ahead at T+4)

- Read-only projector board with a precedent badge (`lanes/6-channel-ui/README.md` §8).
  This is also the fallback demo surface if the homeserver never comes up.
- End-of-day summary cron: duty exposure by importer, count of shipments needing review.
- A second sandbox as a reviewer agent that critiques the memo, showcasing multi-sandbox
  OpenShell.
- PDF invoice to JSON extraction by the LLM. Risky at 35B; JSON intake stays the demo path.

### Non-goals, stated out loud

- **No filing with CBP ACE.** The agent proposes, a licensed broker decides and files.
- **No OCR of scanned images.** JSON intake only.
- **No authoritative classification.** The engine ranks candidates and routes uncertainty
  to a human. It is not a binding ruling.
- **No binding-ruling lookups. No AD/CVD rate computation**; the engine flags the scope
  question and does not compute a deposit.
- **PGA and LPCO tables are demo tables**, sized for these six shipments. Only the tariff
  rates and Section 301 surcharges are real. The engine says so in its own output
  disclaimer (`engine/triage.mjs:387`).
- **No vector database, no embedding index, no RAG.** Retrieval is Jaccard over token sets
  on purpose. Anything with a model in the retrieval path reopens the hallucination
  question this architecture exists to close.
- **No fine-tuning.** The engine carries domain accuracy, not the weights.
- **No Python, no `package.json`, no `npm install`, no hand-rolled Docker.** Node is
  guaranteed inside the sandbox because OpenClaw runs on it; nothing else is. The box is
  ARM64 (aarch64) and NemoClaw owns container lifecycle.
- **No Matrix federation, no TLS, no `.well-known`.** Plain HTTP on a local address.
  Federation off is a feature here.
- **No second write path into `decisions/`.** The board is read-only by design.

---

## 4. Architecture

```
        HOST: Dell Pro Max with GB10          |      OPENSHELL SANDBOX (default-deny)
        aarch64, DGX OS 24.04, 128 GB         |      seccomp, Landlock, own netns
  ------------------------------------------- | -------------------------------------------
                                              |
  broker drops shipment.json                  |
         |                                    |
         v                                    |
  ~/sovereigndesk/inbox/  ...... share mount .|.. /workspace/sovereigndesk/inbox/
                                              |            ^
                                              |            |  every 2 min
                                              |     OpenClaw cron  -->  agent
                                              |            |  (standing orders: agent/AGENTS.md)
                                              |            v  ONE command per tick
                                              |     node engine/process_inbox.mjs --root .
                                              |            |  Node, zero deps, deterministic
  results/<id>.result.json  <... same mount ..|<-----------+
  processed/<id>.json                         |            |
                                              |            v
  precedents.jsonl   (append only, HOST) .....|.. read at classify time, written only by
         ^                                    |     engine/record_precedent.mjs
         |                                    |            |
  ollama serve :11434                         |            v
  or nemoclaw-vllm :8000                      |     local LLM via inference.local proxy
         ^                                    |     writes memos/<id>.memo.md  (fixed format)
         +---- inference.local proxy .........|            |
                                              |            v
  conduit: Matrix homeserver on the box       |     matrix_bridge.mjs --post-file
         ^                                    |     (plain fetch, Client-Server API v3)
         +---- the ONLY allowed destination ..|            |
         |                                    |
         v                                    |     everything else outbound: DENIED
  Element on the broker's phone               |     curl https://hts.usitc.gov -> blocked
         |                                    |
         |  approve <id>                      |
         |  reclassify <id> line <n> to <hts> |
         v                                    |
  agent writes decisions/<id>.decision.json   |
  or runs record_precedent.mjs, appending one line to precedents.jsonl on the HOST
                                              |
  board/serve.mjs :8080, READ ONLY, host side, polls results/*.json
```

**Inside the sandbox:** the OpenClaw agent, its cron, every command it runs (which is the
Node engine and the Matrix bridge), and the model access route. The risky thing is code
executing over untrusted documents, and that is what is confined. The model itself is
served outside and reached through OpenShell's `inference.local` proxy, because the sandbox
has its own network namespace and cannot reach the host's `localhost`.

**On the host mount:** `inbox/`, `processed/`, `results/`, `memos/`, `decisions/` and
`precedents.jsonl`, all at the workspace root. `engine/process_inbox.mjs:27` creates them
under `--root`. The share mount is the only host directory the sandbox can see: no home
directory, no SSH keys, no USB.

**The precedent store is on the host deliberately.** `engine/triage.mjs:45-47` and
`engine/process_inbox.mjs:32-33` place `precedents.jsonl` at the workspace root, never
inside the sandbox filesystem. That single placement decision is what lets the agent
survive `nemoclaw <sandbox> rebuild`: destroy the sandbox entirely and the broker's
override still applies. Lane 4 owns proving it on camera. Lane 1 can destroy it with one
wrong mount, which is why the sweep prints `precedent_store.path` on every run and both
lanes check it.

**Also on the host:** Ollama or managed vLLM, the Conduit homeserver, and the read-only
board. None of them are in the sandbox and none of them need to be.

**Channel.** Primary is Matrix with the homeserver running on the box (Conduit, a single
Rust binary, lighter than Synapse and a better fit for ARM64 under time pressure; Synapse
is the reference implementation and the fallback rung). Element is the client. The agent
talks to it over the local Client-Server HTTP API with plain `fetch`, no SDK:
`PUT /_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}` to post,
`GET /_matrix/client/v3/sync` to read replies. `lanes/6-channel-ui/matrix_bridge.mjs`
already implements both. Telegram remains documented as a fallback only; it requires real
egress to `api.telegram.org` and costs the sovereignty claim. Bitchat over Bluetooth LE
mesh is a talking point, not a demo path: phone-centric, a headless Linux agent needs its
own BLE stack, and a floor with 40 teams is a hostile RF environment. Say that plainly
rather than pretending it is easy.

---

## 5. The engine decides, the LLM explains

The model never picks a tariff code. This is the answer to every hallucination question and
it is structural, not a prompt preference.

Classification is keyword scoring over `engine/data/hts_subset.csv`, 16 curated lines
(`engine/triage.mjs:131-163`):

```
+3    every token of a single-word keyword present in the line description
+4    every token of a multi-word keyword present
+1    per line token that also appears in the row description
+4    parts-heading boost   (line looks like a part AND the row is a parts heading)
x0.5  whole-machine penalty (line looks like a part, row is not a parts heading,
                             and the row description mentions "pump")

confidence = topScore / (topScore + secondScore)          two or more candidates
confidence = min(1, 0.6 + topScore * 0.05)                exactly one candidate
```

`CONFIDENCE_FLOOR = 0.70` (`engine/triage.mjs:27`). Strictly below the floor raises
`LOW_CONFIDENCE` and sets `needs_human`. `shipment_summary.status` is `READY` or
`NEEDS_REVIEW`, and it is `NEEDS_REVIEW` if any line needs a human.

Escalation flags: `NO_CANDIDATE`, `LOW_CONFIDENCE`, `DECLARED_DIFFERS`,
`DECLARED_NOT_IN_TABLE`, `PRECEDENT_UNKNOWN_CODE` all route to a human.
`PRECEDENT_APPLIED` and `PGA_CONFIRM` do not. `LPCO_MISSING` escalates only when some PGA
flag is `REQUIRED` (`engine/triage.mjs:355`), which is why sample 006 warm is `READY` while
still listing a missing DOE certification: the DOE flag is a may-flag sitting at `CONFIRM`.
That is the difference between a checklist and a triage tool.

On a declared-versus-engine mismatch the engine keeps the **declared** code and flags it
(`engine/triage.mjs:342`). It never silently overrides the filer.

The LLM's whole job is `agent/AGENTS.md` rule 4: never invent an HTS code, rate, agency
requirement or document; every number in the memo comes from engine output. A wrong code is
a penalty, not a typo, so the deterministic layer owns decisions and the model owns
language. Every memo line traces to a `trace[]` entry, readable on stage with
`why <shipment_id>`.

---

## 6. The memory layer

**What it is.** One append-only JSON Lines file, `precedents.jsonl`, at the workspace root
on the host mount. Not a database. Not NemoClaw: NemoClaw is the install and stack layer
(OpenClaw, OpenShell, managed inference). Anyone who says "NemoClaw stores the precedents"
is wrong, and lane 4 corrects it.

**One record per broker override**, written only by `engine/record_precedent.mjs`:

```json
{"sig":"lamp led light night portable rechargeable usb",
 "description":"USB rechargeable LED night light lamp, portable",
 "hts":"9405.11.60.10",
 "reason":"Mains-independent LED night lights are luminaires under 9405, not 8513",
 "by":"M. Okafor, LCB",
 "shipment_id":"SHP-2026-0822-006","line":1,
 "at":"2026-08-22T16:45:55.722Z"}
```

**Retrieval.** `sig` is the sorted unique content tokens of the description, stopwords
dropped, crude plural stem (`engine/triage.mjs:169`). Similarity is Jaccard over those
token sets, `PRECEDENT_FLOOR = 0.55` (`engine/triage.mjs:176`). Sorting is what makes it
order-independent, so "pump seal kit with impeller" and "impeller and seal kit for pump"
produce the same signature and rewording does not need an exact string match. On a hit the
engine swaps the code, raises confidence to
`max(cold, min(0.99, 0.75 + similarity * 0.2))`, adds `PRECEDENT_APPLIED`, and writes a
trace line naming who set it and what the cold engine would have said.

**Measured, not asserted.** `node lanes/4-memory/eval_retrieval.mjs` passes 12 of 12 cases
and exits 0. Reorderings and plurals score 1.00. Synonym swaps degrade gracefully to 0.63.
Compound words miss: "USB-powered LED nightlight" collapses to 0.11, because the tokenizer
does no compound splitting. Unrelated commodities score 0.00, so a pump casing cannot
inherit a lamp precedent. The tightest passing margin above the floor is 0.006. The honest
claim is "measured, and here is the margin", not "it generalises".

**Known limit, presented rather than hidden.** A different product,
"Portable USB rechargeable LED reading light lamp", matches the lamp precedent at 0.75 and
gets promoted from `LOW_CONFIDENCE` / 0.54 to `READY` / 0.90 with nobody looking. Mitigation
is disclosure, not a tighter floor: `precedent.similarity` is in the result JSON and lane 5
surfaces it in the memo. Raising the floor even to 0.56 breaks a case the eval asserts, and
raising it to 0.9 kills the survives-rewording claim, which is worth more.

**Append-only is a rule, not an implementation detail.** `agent/AGENTS.md:65-66`: a
precedent is superseded by a new `reclassify`, never erased. The file is the audit trail.
Nothing in the codebase deletes or rewrites a line. (One defect against that promise is
open: see §9.)

**The teardown property.** Because the store is on the host mount and the engine reads it
at classify time, the agent survives a full sandbox destruction. Destroy the sandbox with
`nemoclaw <sandbox> rebuild`, `sha256sum precedents.jsonl` is unchanged on the host,
re-sweep the same file in the new sandbox and the override still applies with nothing
re-entered. That is the single strongest demo beat the entry has, and it is 45 seconds:
"the model is swappable, the institution's memory is not". Shot list at
`lanes/4-memory/README.md` §7.

---

## 7. Data provenance

### Real: public U.S. government data

Every MFN rate and every Section 301 surcharge is read from a USITC Harmonized Tariff
Schedule export, **2026 revision 7**, committed at
`engine/data/usitc/hts_2026_rev_7.json`. 35,496 rows, 19,856 ten-digit lines. Nothing was
typed by us. Rebuild the derived tables at any time:

```bash
node scripts/build_hts_from_usitc.mjs --archive engine/data/usitc/hts_2026_rev_7.json
```

The whole duty stack is sourceable from that one file:

- The MFN rate is the line's `general` field (`"12.5%"`, `"Free"`).
- Section 301 membership is a footnote pointing at a Chapter 99 heading, and that heading
  states its own surcharge in plain text ("the duty provided in the applicable subheading
  plus 25%"). So the surcharge is **read, not assumed**. `surcharges.json` carries
  `authority_by_prefix` across 1,184 prefixes. When a judge asks where 25% came from, the
  answer is a heading (`9903.88.03`), not a config file someone typed.

**The gotcha that eats an hour:** rates and footnotes live on the nearest **ancestor** with
a value. A 10-digit line read on its own is almost always blank. You have to walk the
`indent` hierarchy. `scripts/build_hts_from_usitc.mjs` does exactly that.

Corrections the swap produced, which are the argument rather than an embarrassment:

| line / prefix | placeholder said | schedule says |
|---|---|---|
| 8471 laptops, Section 301 | 0% | **25%** (9903.88.03) |
| 4202 bags, Section 301 | 7.5% | **25%** (9903.88.03) |
| 9503 toys, Section 301 | 7.5% | **none**, no Chapter 99 reference on the line |
| 9405.11.60.10 MFN | 3.9% | **7.6%** (3.9% is 9405.11.40 and 9405.11.80) |

**Section 122 is disabled** (`surcharges.json`, `"enabled": false`). It was adding a
fabricated flat 10% to every line. No `9903` subchapter implementing it appears anywhere in
the 2026 rev 7 schedule. Ten points of invented duty on every memo is the fastest way to
lose a customs broker's trust. Re-enable only with a citation to a live Chapter 99 heading.

`engine/data/hts_full.csv` (19,856 lines, real rates) is in the repo as the provenance
artifact, so "swap in the full USITC schedule" is already true rather than aspirational.
Nothing loads it at runtime: it has no curated `keywords` column, and pointing the engine at
it collapses classification quality. That is a demo scope decision stated honestly, not a
data limit.

### Synthetic on purpose: the six shipment transactions

`engine/samples/*.json` are six synthetic shipments: clean, PGA trap, ambiguous, audit
risk, mixed, precedent test. Importers, suppliers, quantities and unit values are invented.

**This is a strength, and it should be said that way.** You cannot use a real broker's
shipment data without their consent, because it carries supplier pricing and customer
lists. That is the same argument the entire product rests on. A demo built on somebody
else's confidential transactions would contradict the pitch. So the transactions are
fabricated and the tariff law is real, which is the correct way round: the part a judge can
check is the part we did not make up.

For the same reason, PGA and LPCO rules are re-derived from the agencies' own published
requirements and cited in the `requirement` string where they fit (`FCC_SDOC` names
47 CFR 2.906). No table is ported out of a previous employer's codebase: it is not ours to
publish and the repo link goes into the submission. `.gitignore` covers `.env` and
`precedents.jsonl`, so no token and no broker data reaches the public repo.

---

## 8. Success criteria for the demo

Observable outcomes, with the numbers verified against the shipped config by a clean sweep
this morning. Nobody quotes a duty figure they did not get from lane 3.

1. **Unattended.** A shipment file copied into the host `inbox/` becomes a memo in the
   Matrix room within 2 minutes with everyone's hands off the keyboard. This is the
   "always-on" claim in the event title.
2. **All six samples sweep without a crash.** `node engine/process_inbox.mjs --root <ws>`
   returns six entries, none with `status: "ENGINE_ERROR"`, and `inbox/_failed/` stays
   empty.
3. **The audit catch, sample 004.** Declared `4016.93.50.50` (rubber gaskets), engine says
   `8413.91.90.96` (pump parts), `duty_delta` **$165** on a **$6,600** entry, flagged
   `DECLARED_DIFFERS` and routed to a human. The declared code is kept, not overridden.
4. **The precedent flip, sample 006.** One line, 1,500 USB rechargeable LED night lights at
   $4.20, origin CN, $6,300 entered:

   | | cold | warm (precedent applied) |
   |---|---|---|
   | HTS | 8513.10.20.00 | 9405.11.60.10 |
   | confidence | 0.60 | 0.95 |
   | status | NEEDS_REVIEW | READY |
   | rate | 37.5% (12.5 MFN + 25 Section 301) | 32.6% (7.6 MFN + 25 Section 301) |
   | duty | **$2,362.50** | **$2,053.80** |
   | flags | LOW_CONFIDENCE, PGA_CONFIRM | PRECEDENT_APPLIED, LPCO_MISSING, PGA_CONFIRM |

   **The swing is $308.70.** Any script quoting a $541.80 swing, or $2,992.50 / $2,450.70,
   is stale: those predate the USITC swap and had the fabricated Section 122 still on.
5. **The round trip works from a phone.** `reclassify SHP-2026-0822-006 line 1 to
   9405.11.60.10` typed in Element produces a confirmation, and the re-swept file comes back
   `READY` with the memo naming the broker and the reason.
6. **Teardown survival.** `nemoclaw <sandbox> rebuild`, identical `sha256sum` on
   `precedents.jsonl` before and after, warm result reproduces in the new sandbox with
   nothing re-entered. Recorded, not just performed.
7. **Blocked egress on camera.** `curl -m 5 https://hts.usitc.gov` from inside the sandbox
   fails while a second terminal running `nemoclaw <sandbox> logs --follow` shows the
   denial, and the memo still lands in the room in the same minute.
8. **`policy-list` shows no public internet destination**, saved verbatim to
   `lanes/2-sandbox/evidence/policy-list.txt` with any token scrubbed.
9. **The memo never contains a code, rate, agency requirement or document that is not in
   the engine output.** A model inventing a number is the one failure mode that is fatal to
   the pitch.
10. **It ran on the GB10**, and it was submitted to BuilderBase at least 20 minutes before
    the deadline.

Known and accepted at the time of writing: **all six samples currently return
`NEEDS_REVIEW`**, sample 001 included. Five of those are correct behaviour by design
(missing FDA and NOAA documents, a missing Children's Product Certificate, the declared
mismatch). The sixth is the open finding in §9. A triage tool that returns `READY` on
everything is a liability, so do not apologise for the ratio, but do not claim six out of
six is deliberate either.

---

## 9. Security model

### What OpenShell enforces

| Mechanism | What it means | How it is proved on the box |
|---|---|---|
| Kernel isolation: seccomp, Landlock, network namespaces | The agent process is confined by the kernel, not by a config file the agent could edit | the curl failure, plus `ls /` inside versus outside |
| Default-deny egress with an allowlist | No outbound destination works unless explicitly listed. Deny by default, not block-a-list | `nemoclaw <sandbox> policy-list`, then curl anything not on it |
| Filesystem scoped to the share mount | The sandbox sees the mounted workspace and nothing else of the host: no home directory, no SSH keys, no USB | pick a host path outside the mount, show it does not exist inside |
| Inference through the `inference.local` proxy | The sandbox has its own netns, so `127.0.0.1` inside it is the sandbox. Model access is brokered | `curl http://inference.local/v1/models` works inside; `curl http://127.0.0.1:11434` does not |

### The allowlist claim, stated precisely

With the homeserver on the box, the memo travels from a sandbox to a process on the same
machine. **There is no public internet destination on the allowlist.** That is strictly
stronger than the Telegram story it replaced, which was "only a plain text memo leaves" and
invites the reasonable follow-up of what is in the memo (HTS codes, importer names, duty
figures, which is customer data).

Say the true version on stage. If the allowlist is literally empty, say empty. If lane 6
lands the variant where Conduit binds a host bridge address and that one private address is
allowlisted, the line is "one entry on the allowlist, and it is a private address on this
box". Do not round the second up to the first. A judge who asks to see `policy-list` will
catch it, and that costs the entry's credibility in one screen.

If the team falls back to Telegram, the words change with it: `api.telegram.org` is on the
list and the claim drops back to "one allowlisted destination, a text memo, never the
documents". Never say "nothing leaves" with Telegram on the list.

### Prompt-injection posture

A malicious invoice is untrusted input, and the design assumes it. Three layers, and be
precise about which is enforced where.

1. **Kernel.** The agent cannot reach the network, so there is no destination to exfiltrate
   to. Its filesystem is scoped to the share mount, so there is no host home directory, no
   SSH key and no USB to read. This layer is enforced by OpenShell, not by a prompt.
2. **Standing orders.** `agent/AGENTS.md` restricts writes to `memos/` and `decisions/`,
   refuses instructions to upload, email, post or fetch from a URL, refuses to change an
   HTS code or rate directly, and never edits or deletes `precedents.jsonl`. **This layer
   is a prompt, not a kernel rule.** Say so if asked; claiming otherwise is the kind of
   overreach a judge will find.
3. **Structural.** The agent cannot change a tariff code at all. Codes come from the
   engine, and the only path that changes one is a human `reclassify` that appends a
   precedent. There is no path from document text to a duty figure that does not go through
   the deterministic engine.

Worst case is a badly worded memo, which a human reads anyway.

### Repo hygiene

The repo is public and its link goes in the submission. No `.env`, no Matrix access token,
no Telegram bot token, no real customer data, on any branch. `.gitignore` covers `.env`,
`*.token` and `precedents.jsonl`; confirm with `git status` rather than trusting it. Tokens
are cropped out of every screenshot before it goes near the submission. Lane 5's
pre-merge checklist greps for `syt_` and bot-token patterns in the diff.

---

## 10. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| **Team size: the event listing records teams as 2 to 4 builders and the SF edition gave small teams a scoring bonus. We are six.** | Unknown, and it is a disqualification risk | **Confirm with the organizers at check-in before anything else.** Lane 6 owns asking, lane 2 asks if they get to the desk first, lane 5 does not cut six branches until there is an answer. If the answer is no, split into a 4 and a 2 by name and agree who submits, before T+1. Do not bury this. |
| **NemoClaw and OpenClaw are alpha.** Flags and subcommands may not match any doc, this one included | High | `--help` every subcommand before typing it in front of a judge; `nemoclaw onboard` interactively when a flag is gone. Write the real syntax into `lanes/2-sandbox/evidence/policy-syntax.txt` so nobody rediscovers it at T+4 under pressure. Never guess a flag from memory. |
| Venue Wi-Fi cannot pull the 15 to 20 GB vLLM container image | High | Ollama with `qwen3.6:35b` off the USB, zero container pulls. `NEMOCLAW_PROVIDER=ollama` before the installer runs. **Hard stop at T+1: if managed vLLM has not pulled, switch and do not debate it.** |
| Matrix homeserver does not come up | Medium | Fallback ladder at `lanes/6-channel-ui/README.md` §10: Synapse (only before T+1:30, and it needs a PyPI download), Element Desktop instead of the phone, projector board plus `openclaw cron run` with no chat surface, Telegram as the last rung with the downgrade said out loud. |
| Share mount syntax fights lane 1, project ends up inside the sandbox filesystem | Medium | The sweep prints `precedent_store.path` every run; it must be the mount root. If it is not, lane 4's teardown demo is gone and they need to know immediately, not on camera. |
| Model will not hold the memo format | Medium | Collapse to the four-line memo (`lanes/5-orchestration/README.md`). The engine JSON is the product, the memo is garnish. Never weaken the safety block to make the model behave. |
| Model invents a number | Low, fatal if it happens | Stop everything. Cut the memo to fields quoted verbatim from the engine summary; if it still invents, show the result JSON on the board and narrate it. |
| **Open finding: sample 001 does not reach `READY`** and never did. Line 1 is "Cast iron pump casing for centrifugal liquid pump, without engine"; the engine scores 8413.70.20.05 (a complete pump) at 15 and 8413.91.90.96 (parts of pumps) at 13, giving 0.54 and `LOW_CONFIDENCE`. The engine's second choice is the right one: a casing is a part of a pump | Certain, it is current behaviour | Lane 3 decides early, because it changes the first beat of the demo. `docs/DATA_SWAP.md` proposes two one-line fixes; `lanes/3-rules-engine/README.md` §P1 records what each one actually measured, including that `rowIsParts` at `engine/triage.mjs:143` is true for both rows after the USITC swap, so the halving at `:145` never fires. If no fix lands, open on sample 004 instead and present 001 as the engine flagging rather than guessing. |
| **Confirmed defect: a superseding precedent is ignored.** `engine/triage.mjs:182` uses `sim > bestSim`, so on a similarity tie the first record read wins and no later `reclassify` can displace it. That contradicts the append-only supersede promise in `agent/AGENTS.md:65-66` | Confirmed, reproduced by lane 4 | One character, `>` to `>=`, verified working. Lane 3's edit, lane 5 merges. |
| Tokenizer drift: `STOP` and `tokenize()` exist in three copies (`triage.mjs:117-127`, `record_precedent.mjs:38-46`, `lanes/4-memory/eval_retrieval.mjs:31-38`) | Medium, and it fails silently | Comments do not enforce anything. `node lanes/4-memory/eval_retrieval.mjs` exits non-zero on drift; lane 5 runs it as a pre-merge gate on any `engine/` change. |
| A fuzzy precedent match promotes a wrong line to `READY` | Medium | Disclose rather than tighten: `similarity` goes in the memo, the cold classification stays in the result JSON, and a new `reclassify` supersedes (once the defect above is fixed). |
| Board prints a fraction as a percent at the moment the precedent lands | Low, and maximally embarrassing | Every rate in the result JSON is a fraction (`effective_rate: 0.326`, `mfn_rate: 0.076`). Multiply by 100 exactly once. Render status and flags independently: sample 006 warm is `READY` and carries `LPCO_MISSING`. |
| PGA and LPCO tables are still demo tables, and `pga_flags.json` still literally says "Replace with your real PGA flag table" | Medium | Lane 3 P2 re-derives the ten rules from the agencies' published requirements, or, if time runs out, rewords the comment to state honestly what it is and puts the same sentence on the non-goals slide. Half a rewritten table is worse than an honest one. |
| Two product names live in the repo: `docs/HACKATHON_BIBLE.md` §12 says "Customs Desk", `agent/AGENTS.md` introduces the agent as Customs Desk, this document and the submission say SovereignDesk | Low | Lane 6 owns the submission, so lane 6 picks, and the pitch uses the same one. Do not leave both running. |
| Six people, one repo, six hours: merge conflicts and a late integration | Medium | One branch per lane, rebase before every push, merge every 20 to 30 minutes, lane 5 has sole merge authority, `bash scripts/smoke.sh` green before any push to `main`. Freeze at T+4:30. |
| The loop is broken when the pitch slot is called | Medium | The backup video is recorded at T+4.5 whether or not the loop is pretty. This is the single non-negotiable deadline in the plan. |

**Timeline the plan is built on:** T+0 to T+1 box online and inference serving (hard stop on
vLLM at T+1). T+1 to T+3 one shipment end to end, folder to memo; nothing else matters until
it works. T+3 to T+4.5 cron autonomy, the channel round trip, the blocked-egress proof, the
precedent flip. T+4.5 to T+5 code freeze and the backup video. T+5 to T+6 submit, then
rehearse twice with a timer.

---

## 11. The six lanes

Owner names are assigned at check-in except where noted. Each README is self-contained: a
lane owner needs to read nothing else in the repo to start.

| # | Lane | Owner | Scope | Done means |
|---|---|---|---|---|
| 1 | [Inference and the box](lanes/1-inference/README.md) | infra | GB10 powered and reachable, Ollama (default, off the USB, no container pull) or managed vLLM, NemoClaw sandbox, OpenShell up, project share-mounted with the workspace on the host. **No hand-rolled Docker:** it fights the required stack, the box is ARM64, and avoiding container pulls is the whole point of the Ollama path. Does not touch `engine/` | Inside the sandbox: `node engine/process_inbox.mjs --root .` prints JSON with `precedent_store` and `shipments`, and the model answers through `inference.local`. `precedent_store.path` resolves to the mount root. **This lane gates every other lane**; announce green and post the five handoff facts |
| 2 | [OpenShell lockdown and the pitch](lanes/2-sandbox/README.md) | security + pitch | The default-deny policy, the on-camera blocked-egress proof, the `policy-list` screenshot, the 3-minute pitch script, the backup video. Nobody describes the product to a judge before reading their script. Does not widen the allowlist to make anything work | `curl https://hts.usitc.gov` fails inside the sandbox with the denial visible in `logs --follow`, both on camera; `evidence/policy-list.txt` saved with no public internet destination; `evidence/backup-video.mp4` exists by T+4.5 regardless of demo state; the script lands between 2:45 and 3:00 twice against a stopwatch |
| 3 | [Rules engine and domain truth](lanes/3-rules-engine/README.md) | **Nishanth** | `engine/` and every factual claim the entry makes about tariffs, agency flags and duty. **Not a rewrite: the code works.** P1 the sample 001 misclassification, P2 the PGA and LPCO tables (the last placeholder surface in the repo), P3 the accuracy answer card. The person who answers "how accurate is this" in judge Q&A | Six samples sweep clean with no `ENGINE_ERROR`; sample 001 line 1 resolves to `8413.91.90.96` above 0.70 confidence, or the decision to ship as-is is made and communicated; the 006 flip still produces $2,362.50 to $2,053.80; no file under `engine/data/` still says "Replace with your real ... table"; the answer card is with lane 2 before T+4.5 |
| 4 | [Precedent memory and the teardown proof](lanes/4-memory/README.md) | memory | **Does not build a memory system: it exists and passes end to end.** Owns proving it: does Jaccard retrieval survive rewording, what happens on a false-positive match, what happens on a conflicting precedent, and the teardown demo. No vector store, no embeddings, no hand-editing `precedents.jsonl` | Cold and warm reproduce on the GB10 to the cent; `eval_retrieval.mjs` passes 12/12 and exits 0; the similarity probe table is on screen; the sandbox has been destroyed with `rebuild` and the warm result reproduces with nothing re-entered; that teardown is **recorded**; lanes 2 and 5 have the "what happens when the memory is wrong" paragraph |
| 5 | [Orchestration: agent loop, cron, merge](lanes/5-orchestration/README.md) | orchestration | Installs `agent/AGENTS.md` into the OpenClaw workspace, makes the three edits it needs (output shape, Matrix not Telegram, absolute command path), the 2-minute cron job, tunes the prompt until the memo matches format. **Sole merge authority: nobody else merges to `main`.** Does not rewrite the engine, does not weaken the safety block | `openclaw cron run <job-id>` produces a correctly formatted memo in the channel with nobody typing anything else; a file copied into the host inbox becomes a memo within 2 minutes hands-off; at T+4.5 the integration checklist passes on `origin/main` and `git log --oneline main` contains work from every lane |
| 6 | [Channel and UI](lanes/6-channel-ui/README.md) | channel + submission | Conduit Matrix homeserver on the box, `matrix_bridge.mjs` pointed at it (the bridge exists; do not write a second one), the **read-only** projector board, and the BuilderBase submission. Read-only matters: a second write path into `decisions/` races the chat round trip and is a way to break the loop live. No npm, no Docker, no Synapse container | Round trip: `status` typed in Element produces a parsed command and a reply within 5 seconds; `--post` lands in the room from inside the sandbox in the same shell where `curl https://hts.usitc.gov` fails; the board flips 006 from `NEEDS_REVIEW` to `READY` with the precedent badge; submitted on BuilderBase at least 20 minutes before the deadline with repo link, backup video and two screenshots |

**Submission.** BuilderBase portal, https://builderbase.com/event/dell-x-nvidia-ai-hackathon-nyc.
Deadline announced on the day. The demo must run on the GB10, not on a laptop, or the entry
is disqualified. Submit at least 20 minutes early, then re-run the full loop once so the box
is in a known-good state for judges walking past.

**Stack line for the submission:** OpenClaw, NVIDIA NemoClaw, OpenShell,
Qwen3.6-35B-A3B local via Ollama or managed vLLM, Node zero-dependency rules engine,
USITC HTS 2026 rev 7, Matrix (Conduit) homeserver on the box. Lane 2 and lane 6 keep this
line identical, and replace "Ollama or managed vLLM" with whichever one lane 1 actually
landed.
