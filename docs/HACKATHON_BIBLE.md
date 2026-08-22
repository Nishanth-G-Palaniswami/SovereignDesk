# Customs Desk: Hackathon Bible
### Dell x NVIDIA "Local AI on Dell Pro Max with GB10": NYC, Sat Aug 22, 2026, doors 9:00 AM

Everything needed to ship, demo, and pitch in one day. Read §0 first. Print §8 (runbook) or keep it open on the phone.

---

## 0. If you are short on time

Do only the starred items, in this order:

1. ★ **Team**, post in the BuilderBase dashboard and DM 3–5 people with Node/Docker/Linux in their profile (§13).
2. ★ **Ollama USB**, `ollama pull qwen3.6:35b` on the laptop, copy `~/.ollama/models` + the Linux ARM64 tarball to the USB (§5, Plan C). This is the only inference path that needs **no container image download** at the venue.
3. ★ **Engine sanity**, `node engine/process_inbox.mjs --root <tmp>` on your laptop with the 5 samples. It already works; just confirm Node runs.
4. ★ **Telegram bot**, @BotFather → `/newbot` → save the token. Get your numeric user ID from @userinfobot.
5. Everything else in §6 and §7 is nice-to-have.

---

## 1. Event facts

| Item | Detail |
|---|---|
| When | Saturday Aug 22, 2026, 9:00 AM start (GarysGuide listing). Evening: top-8 live pitches, winners, networking |
| Where | 601 W 26th St, New York, NY 10001, **Level 10** (Starrett-Lehigh, Chelsea). Nearest subway: 23rd St (C/E), 10-min walk |
| Organizer | BuilderBase Hackathons, hosts Sean Chiu, Somya Gupta, Sahar Mor (Bond AI). 502 registered on Luma |
| Hardware | 40 teams, 40 Dell Pro Max with GB10, one per team for the day |
| Challenge | Build an **always-on business/corporate AI agent** that runs **locally on the box, no cloud API** |
| Required stack | **OpenClaw + NVIDIA NemoClaw + OpenShell** |
| Teams | 2–4 builders. Solo registrants get matched via the BuilderBase dashboard or paired by organizers. SF edition: small teams received a scoring bonus |
| Submission | Working demo via the BuilderBase portal before the deadline (time announced on the day). Demo **must run on the GB10** |
| Judging | Top 8 submissions → short live pitch the same evening |
| Prizes | 1st: Dell Pro Max with GB10 per team (~$4.8k). 2nd/3rd: Dell laptop per team |
| Bring | Laptop (you code on it, SSH into the box), models on USB/external drive, power strip/extension |
| Wi-Fi | Too slow for model downloads. Assume it handles small pulls (npm, Telegram) and nothing else |

**Hard requirements checklist (any miss = disqualified):**
- [ ] Agent runs on the GB10, not on your laptop
- [ ] Inference is local (vLLM or Ollama on the box), zero cloud model calls
- [ ] Uses OpenClaw (agent/gateway), NemoClaw (install/stack), OpenShell (sandbox runtime)
- [ ] Business/corporate use case
- [ ] Submitted through the BuilderBase portal before the deadline

---

## 2. What judges reward (inferred from this series + NVIDIA's own examples)

- **Runs unattended.** "Always-on" is in the event title. Cron/trigger-driven work beats a chat window.
- **Real autonomy loop:** persistent memory + multi-step reasoning + live tool use, the sibling UCSC NemoClaw hackathon demanded exactly that and said "not a prototype, not a pitch deck."
- **OpenShell made visible.** That event also judged "demonstrate its security controls" as a separate merit. Show a blocked egress on stage.
- **Local-only as a feature.** Confidential data, zero per-token cost, works offline.
- **A single loop that completes end to end** beats breadth every time.

NVIDIA's reference agents (don't clone; know them so you can say "unlike the news digest…"): Daily News Digest (cron → Telegram), Software Development Agent (reads a project dir, plans, implements, reviews), Deck Reviewer (red-teams a doc), Calendar Negotiator.

---

## 3. PRD: Customs Desk

**One-liner.** An always-on import-compliance triage agent for customs brokers and importers: shipment documents land in a folder, the agent classifies HTS, flags PGA requirements, computes the duty stack, lists missing LPCO documents, and posts a triage memo to Telegram, entirely on a desk-side box that never leaks the data.

**Abbreviations.** HTS = Harmonized Tariff Schedule. PGA = Partner Government Agency (FDA, USDA, CPSC, EPA, NOAA, FCC, DOE…). LPCO = Licenses, Permits, Certificates, Other. MFN = Most-Favored-Nation base rate. CBP = U.S. Customs and Border Protection. AD/CVD = antidumping / countervailing duty. SIMP = Seafood Import Monitoring Program. FSVP = Foreign Supplier Verification Program. CPC = Children's Product Certificate.

### 3.1 Problem
An entry clerk at a brokerage triages every inbound shipment by hand: classify each line, check agency flags, chase documents, estimate duty, escalate anything odd. It's repetitive, error-prone, and the documents contain supplier pricing and customer lists that brokers are contractually barred from sending to third-party SaaS. Cloud LLMs are off the table for most of them.

### 3.2 Users
- **Entry clerk**, wants the packet pre-triaged and the questions narrowed to one decision each.
- **Compliance manager**, wants traceability (why this code, which rule fired) and a zero-exfiltration guarantee.

### 3.3 Scope

**Must (demo-critical)**
1. Watch-folder intake: new `shipment.json` in `inbox/` → processed within one cron tick.
2. Deterministic engine: HTS candidates + confidence, PGA flags with **must / may → disclaimable** semantics, duty stack (MFN + Section 301 + Section 122), LPCO checklist vs documents on file, declared-vs-engine audit check, full `trace[]`.
3. Agent writes a memo (fixed format) and posts it to Telegram (Web UI fallback).
4. Human reply `approve <id>` / `reclassify <id> line <n> to <hts>` → decision file written, confirmation returned.
5. OpenShell policy: filesystem scoped to the workspace mount; network egress = Telegram only; a blocked outbound attempt is demonstrable.

**Nice-to-have (only if ahead at 2:00 PM)**
- End-of-day summary cron: duty exposure by importer, count of shipments needing review.
- Second sandbox as a "reviewer" agent that critiques the memo (showcases multi-sandbox OpenShell).
- PDF invoice → JSON extraction by the LLM (risky with a 35B model; keep JSON intake as the demo path).

**Non-goals (say them out loud in the pitch)**
- No filing with CBP ACE. No OCR of scanned images. No authoritative classification, the engine proposes, a licensed broker decides. No binding-ruling lookups.

### 3.4 Success criteria (what "works" means at 3:00 PM)
- Drop 3 sample shipments → 3 memos on Telegram within 2 minutes, unattended.
- Sample 001 → READY. Samples 002/003/004 → NEEDS_REVIEW with the right reason (missing FDA/NOAA docs; ambiguous LED lamp + missing CPC; declared 4016 vs engine 8413 with $165 delta).
- `reclassify` round trip from the phone works.
- `curl https://hts.usitc.gov` from inside the sandbox is blocked and the block is visible.
- Memo never contains a code, rate, or document that isn't in the engine output.

### 3.5 Why local + OpenShell is the product, not a constraint
- Customs data is confidential by contract → the box is the compliance boundary.
- Default-deny network + kernel isolation (seccomp, Landlock, network namespaces) = "the data physically cannot leave."
- 128 GB unified memory → a 35B-A3B MoE model runs comfortably with room for a second sandbox.
- Zero per-token cost → the always-on loop is free to run every two minutes forever.

---

## 4. Architecture

```
 business drops shipment.json ─▶ ~/customs-desk/workspace/inbox/   (host folder, share-mounted into sandbox)
                                                 │
                 OpenClaw cron (every 2 min) ────▶ agent runs ONE command:
                                                 │   node engine/process_inbox.mjs --root .
                                                 ▼
                                   deterministic engine (Node, zero deps)
                                   HTS candidates · PGA flags · duty stack · LPCO · trace
                                                 │  results/<id>.result.json
                                                 ▼
                                   local LLM (vLLM/Ollama via OpenShell inference.local)
                                   writes memos/<id>.memo.md in the fixed format
                                                 │
                                                 ▼
                                   Telegram (only allowed egress) ◀──▶ human: approve / reclassify
                                                 │
                                                 ▼
                                   decisions/<id>.decision.json
```

Division of labor: **engine decides, LLM explains.** The model never picks a tariff code. That is the answer to every "what about hallucination?" question.

Contract, file layout, and role split: see `TEAMMATE_README.md`. Agent standing orders: `agent/AGENTS.md`. Engine: `engine/triage.mjs` (single shipment) and `engine/process_inbox.mjs` (sweep). Data tables: `engine/data/`. Five synthetic shipments: `engine/samples/`.

---

## 5. Models: download, stage, and load (the part everyone gets wrong)

### 5.1 Facts
- NemoClaw Express Install on DGX Spark/GB10 = **managed local vLLM** with the default model **`nvidia/Qwen3.6-35B-A3B-NVFP4`**, 23.5 GB on Hugging Face. MoE, 35B total / 3B active, NVFP4 (NVIDIA 4-bit floating point), Apache-2.0, tool calling works, 262K context.
- NemoClaw's managed vLLM **pulls a vLLM container image (~15–20 GB)** and downloads weights into **`~/.cache/huggingface`**, then starts `nemoclaw-vllm` on `localhost:8000`. It **reuses files already in `~/.cache/huggingface`**.
- NemoClaw also supports **`NEMOCLAW_PROVIDER=ollama`** with `NEMOCLAW_MODEL=<tag>`. Ollama starter picks in NemoClaw's own docs: `qwen3.6:35b`, `nemotron-3-nano:30b`, `qwen3.5:9b`.
- The sandbox cannot reach `localhost` directly; all inference goes through OpenShell's `inference.local` proxy. NemoClaw wires this for you, don't hand-roll it.
- The box is **ARM64 (aarch64)**, DGX OS = Ubuntu 24.04. x86 Docker images will not run.

### 5.2 Plan A: the box is pre-imaged (check first, takes 60 seconds)
GTC units shipped pre-configured with OpenClaw + Nemotron 3 Super 120B. Ask organizers at check-in. On the box:
```bash
nemoclaw --version; nemoclaw list; ls ~/.cache/huggingface/hub 2>/dev/null; ollama list 2>/dev/null; docker images | head
```
If a sandbox and a model already exist: **use them**. Skip to §8 step 4.

### 5.3 Plan B: managed vLLM with pre-staged weights (best quality, needs the ~15–20 GB image pull at the venue)

**On the laptop (PowerShell, see `scripts/prep_usb.ps1`):**
```powershell
python -m pip install -U "huggingface_hub[cli]"
$env:HF_TOKEN = "<optional read token, avoids 429 throttling>"
hf download nvidia/Qwen3.6-35B-A3B-NVFP4 --local-dir E:\hackathon\models\nvidia--Qwen3.6-35B-A3B-NVFP4
hf repo info nvidia/Qwen3.6-35B-A3B-NVFP4        # note the 40-char commit sha
```
If you have WSL, prefer the native cache layout (symlinks preserved by tar), which NemoClaw reuses directly:
```bash
hf download nvidia/Qwen3.6-35B-A3B-NVFP4              # lands in ~/.cache/huggingface/hub/...
tar -C ~/.cache/huggingface -czf /mnt/e/hackathon/models/qwen36-hfcache.tgz hub
```

**On the box:**
```bash
# WSL tarball path:
mkdir -p ~/.cache/huggingface && tar -C ~/.cache/huggingface -xzf /media/$USER/hackathon/models/qwen36-hfcache.tgz

# Plain-folder path (recreate the cache layout by hand):
COMMIT=<sha from commit.txt>
BASE=~/.cache/huggingface/hub/models--nvidia--Qwen3.6-35B-A3B-NVFP4
mkdir -p $BASE/snapshots/$COMMIT $BASE/refs
cp -r /media/$USER/hackathon/models/nvidia--Qwen3.6-35B-A3B-NVFP4/. $BASE/snapshots/$COMMIT/
rm -rf $BASE/snapshots/$COMMIT/.cache; echo -n $COMMIT > $BASE/refs/main

# then run the installer; Express should skip the weight download and only pull the image
curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash
```
**Rule:** if the installer starts downloading weights anyway, Ctrl+C once, try `HF_HUB_OFFLINE=1` in front of `nemoclaw onboard`, and if that fails go to Plan C. Do not spend more than 20 minutes here.

### 5.4 Plan C: Ollama, fully offline, zero container images (most robust; default if Wi-Fi is bad)

**On the laptop:** install Ollama for Windows, then
```powershell
ollama pull qwen3.6:35b      # ~22 GB
ollama pull qwen3.5:9b       # ~6 GB emergency fallback
robocopy "$env:USERPROFILE\.ollama\models" "E:\hackathon\ollama\models" /E
Invoke-WebRequest "https://ollama.com/download/ollama-linux-arm64.tgz" -OutFile "E:\hackathon\ollama\ollama-linux-arm64.tgz"
```
Ollama's blob store is platform-independent; the `manifests/` + `blobs/` folders copy straight across.

**On the box:**
```bash
sudo tar -C /usr -xzf /media/$USER/hackathon/ollama/ollama-linux-arm64.tgz
mkdir -p ~/.ollama && cp -r /media/$USER/hackathon/ollama/models ~/.ollama/
nohup ollama serve > ~/ollama.log 2>&1 &
ollama list                                  # must show qwen3.6:35b
ollama run qwen3.6:35b "Reply with the single word READY."
export NEMOCLAW_PROVIDER=ollama NEMOCLAW_MODEL=qwen3.6:35b
curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash      # NEMOCLAW_PROVIDER set => skips Express, uses Ollama
```
If the installer insists on a newer/system Ollama, run `nemoclaw onboard` interactively and pick **Local Ollama**.

### 5.5 What still needs the venue Wi-Fi (all plans)
The installer itself: Node.js, the OpenShell binary, a `git clone` of NemoClaw + npm build, and the **sandbox base image** (a few GB). Budget 20–40 minutes on congested Wi-Fi. Start the installer the moment you sit down, before team intros finish. Optional: tether to your phone for the installer step only (never for inference, the rule is local inference, not local npm).

### 5.6 Model choice rationale (for the judges' "why this model?")
- Qwen3.6-35B-A3B: strongest agentic/tool-calling open model that fits comfortably; 3B active params → fast enough for a 2-minute cron loop on one box.
- Nemotron 3 Nano 30B-A3B: NVIDIA-branded alternative, also NVFP4, tool calling, swap in if a judge asks for Nemotron and you have time.
- You are not fine-tuning anything. The deterministic engine carries the domain accuracy; the model only needs good instruction-following and tool use.

---

## 6. Data preparation

| Asset | Source | Status |
|---|---|---|
| `engine/data/hts_subset.csv` | 16 headings covering the 5 demo shipments. **All rates are placeholders**, replace from the USITC export before the demo if time allows | ✅ shipped |
| `engine/data/pga_flags.json` | Prefix → agency flags with must/may semantics and disclaim terms. Replace with your real PGA flag table | ✅ shipped (port yours) |
| `engine/data/lpco_rules.json` | Requirement → documents; BASE docs for every entry; ISF only for ocean | ✅ shipped |
| `engine/data/surcharges.json` | Section 301 by prefix for CN/HK; Section 122 toggle; AD/CVD watch list. **Verify 301 list assignments on USTR and whether §122 is still in force; flip `enabled:false` if not** | ✅ shipped (verify) |
| `engine/samples/*.json` | 5 synthetic shipments: clean / PGA trap / ambiguous / audit risk / mixed | ✅ shipped |
| Full HTS CSV | hts.usitc.gov → Export → CSV (~tens of MB). Keep on USB; mention in pitch as the swap-in for production | ⬜ download |
| Synthetic PDFs (optional) | One commercial invoice + packing list PDF per shipment, for the "documents land in a folder" visual | ⬜ optional |

Porting your real PGA/LPCO tables: keep the JSON shapes in `pga_flags.json` / `lpco_rules.json`; the engine only needs `agency`, `requirement_id`, `requirement`, `semantic`, and optional `disclaim_if_any`.

---

## 7. Pack list

- [ ] Laptop + charger; power strip / extension cord
- [ ] USB-C / USB-A **and** Ethernet adapter if you have one (the box has RJ45; a cable to the box avoids Wi-Fi entirely for SSH)
- [ ] USB drive (exFAT, ≥128 GB): `project/`, `models/`, `ollama/`, `data/`, optional `images/`
- [ ] Telegram bot token + your numeric user ID (in a password manager, not a sticky note)
- [ ] Hugging Face read token (optional)
- [ ] This folder printed or offline on the phone: `HACKATHON_BIBLE.md`, `TEAMMATE_README.md`
- [ ] Phone with Telegram installed, it's your demo remote
- [ ] Headphones, water, snacks, the day is 9:00 AM to ~9:00 PM

---

## 8. Day-of runbook (12-hour clock, Eastern)

**8:30 AM, arrive.** Check-in, find the team, claim a table near an outlet. Ask organizers: boxes pre-imaged? submission deadline? pitch length?

**9:00–9:30 AM, box online.**
```bash
ssh <user>@<box-ip>                         # or keyboard/monitor if provided
head -n 2 /etc/os-release; nvidia-smi; docker info --format '{{.ServerVersion}}'; df -h /; free -g
```
Plan A check (§5.2). Mount the USB: `lsblk` → `sudo mount /dev/sdX1 /media/$USER/hackathon` (exFAT mounts read-write by default on Ubuntu 24.04).

**9:30–10:30 AM, inference + NemoClaw (hard stop 10:30).** Plan B or C from §5. Expect:
```
OpenClaw is ready  Sandbox: customs-desk  Model: <model> (Local vLLM | Ollama)
```
Then:
```bash
nemoclaw customs-desk status
nemoclaw customs-desk dashboard-url --quiet          # http://127.0.0.1:<port>/#token=...
# on the laptop:  ssh -L <port>:127.0.0.1:<port> <user>@<box-ip>   → open the URL (use 127.0.0.1, not localhost)
```
If the installer named the sandbox `my-assistant`, keep it, renaming costs time. Substitute the name everywhere below.

**10:30 AM–1:00 PM, one shipment end to end.**
```bash
# host: workspace + engine
mkdir -p ~/customs-desk && cp -r /media/$USER/hackathon/project/. ~/customs-desk/ && mkdir -p ~/customs-desk/workspace/inbox
nemoclaw share --help                                 # confirm syntax, then:
nemoclaw share mount ~/customs-desk /workspace/customs-desk   # example; use the documented form
nemoclaw customs-desk connect
# inside the sandbox:
node --version && cd /workspace/customs-desk && cp engine/samples/shipment_001_clean.json workspace/inbox/ && node engine/process_inbox.mjs --root workspace
```
That must print a JSON array. Then install standing orders: copy `agent/AGENTS.md` into the OpenClaw workspace inside the sandbox (`openclaw` prints the workspace path; default `~/.openclaw/workspace/AGENTS.md`). Open the Web UI and type: `sweep`. The agent should run the command and produce a memo. Fix the prompt until the memo matches the format. **This is the milestone, nothing else until it works.**

**1:00–3:00 PM, autonomy + channel + security moment.**
```bash
nemoclaw customs-desk channels add telegram            # paste bot token; restrict to your user ID
nemoclaw customs-desk policy-list                      # confirm telegram egress preset present; add if not:
nemoclaw customs-desk policy-add telegram
# inside the sandbox:
openclaw cron add --name sweep --every 2m --session isolated --message "sweep" --announce --channel telegram --to "<your chat id>"
openclaw cron list
openclaw cron run <job-id>                             # fire immediately, this is your on-stage trigger
# the blocked-egress moment, inside the sandbox:
curl -m 5 https://hts.usitc.gov                        # should fail (default-deny)
```
On the host, `nemoclaw customs-desk logs --follow` in a second terminal shows the policy denial, keep that terminal for the demo. Test `approve` and `reclassify` from your phone.

**3:00–4:30 PM, freeze.** No new code. Record a backup screen video of the full loop (laptop screen + phone). Write the submission text (§12). Rehearse the 3-minute demo twice with a timer.

**4:30 PM–deadline, submit early.** Re-run the full loop once after submitting so the box is in a known-good state for judges walking by.

**Evening, top-8 pitch.** Phone charged, Telegram open, terminal with logs visible, two sample files ready to drop.

**Emergency fallbacks (decide within 5 minutes, don't debate):**
| Symptom | Fallback |
|---|---|
| vLLM container won't pull / OOM / kernel errors | Plan C Ollama (`NEMOCLAW_PROVIDER=ollama`) |
| 35B slow to load or answer | `qwen3.5:9b`, memos get slightly worse, loop still works |
| Telegram blocked / no Wi-Fi | Web UI + `openclaw cron run` on stage; say "channel-agnostic, Slack/Teams are one flag away" |
| `share mount` syntax fights you | `nemoclaw customs-desk connect` and `scp`/copy the project into the sandbox filesystem; lose live watch-folder, keep cron |
| Agent won't follow memo format | Drop the format to 4 lines; the engine JSON is the product, the memo is garnish |
| Cron misfires | Demo with `openclaw cron run`; say "every 2 minutes in production" |

---

## 9. Demo script (3 minutes) and pitch outline

**0:00–0:25, Problem.** "Every shipment into the U.S. gets hand-triaged by an entry clerk: tariff code, agency flags, documents, duty. The documents carry supplier pricing and customer lists that brokers can't send to a cloud. So nobody automates it."

**0:25–1:45, Live loop.** Drop two files into `inbox/`. Fire the cron: `openclaw cron run sweep`. Phone up: two Telegram memos arrive. Read the second aloud: "Declared 4016.93, engine says 8413.91, duty delta $165, audit risk." Reply `reclassify SHP-…-004 line 1 to 8413.91.90.96` from the phone; confirmation comes back.

**1:45–2:15, Security moment.** Switch to the terminal: `curl https://hts.usitc.gov` inside the sandbox → blocked. Show `policy-list`: Telegram only. "OpenShell default-deny. The customer's pricing data physically cannot leave this desk."

**2:15–2:45, Why it's trustworthy.** "The model never chooses a tariff code. A deterministic engine proposes candidates with confidence and a full trace; anything under 0.70 or any declared-code mismatch goes to a human. The LLM writes the memo and handles the conversation."

**2:45–3:00, Business.** "Brokers pay per entry. This runs 24/7 on a $5K box at zero marginal cost, on the broker's own premises. Swap in the full USITC schedule and their PGA table and it's deployable Monday."

**Slides (max 3, optional):** 1) problem + who pays, 2) architecture diagram (§4), 3) what's real vs. next (non-goals honestly listed).

---

## 10. Judge Q&A: prepared answers

- **"How accurate is the classification?"**, The engine is a rules layer over the tariff table with confidence scoring; in the demo it's a 16-heading subset with placeholder rates. Production swaps in the full USITC export and the broker's own PGA table. Low confidence and declared-vs-engine mismatches always go to a licensed broker. The agent never files.
- **"Why not just let the LLM classify?"**, Because a wrong code is a penalty, not a typo. Deterministic engine for decisions, LLM for language. Every memo line traces to an engine rule.
- **"Why local?"**, Contractual confidentiality on shipment documents; no per-token cost for an always-on loop; works when the WAN is down at a port office.
- **"What does OpenShell actually give you?"**, Kernel-level isolation (seccomp, Landlock, network namespaces), default-deny egress with an allowlist, filesystem scoped to the mount, inference routed through a controlled proxy. We showed the block live.
- **"What happens on prompt injection via a malicious invoice?"**, The agent can't reach the network except Telegram, can't write outside `memos/` and `decisions/`, and can't change a code without a human decision file. Worst case is a bad memo, which the human reviews anyway.
- **"Why Qwen / not Nemotron?"**, Express default for GB10; strongest open tool-calling model at this size. Nemotron 3 Nano is a one-line swap.
- **"How does this scale?"**, One box per desk; 128 GB runs a second sandbox as a reviewer; multi-Spark clustering exists for bigger models.
- **"What did you not build?"**, ACE filing, OCR, binding rulings. Said on the slide.

---

## 11. Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Venue Wi-Fi can't pull the vLLM image | High | Plan C Ollama on USB; start installer at 9:05 AM |
| NemoClaw alpha breakage (CLI flags changed) | Medium | `--help` everything; `nemoclaw onboard` interactive; Brev rehearsal if done |
| `share mount` / workspace path confusion | Medium | Copy project into the sandbox as fallback; keep cron |
| Model ignores memo format | Medium | Simplify format; show engine JSON directly |
| Telegram needs egress that policy blocks | Medium | `policy-add telegram`; Web UI fallback |
| Team mismatch / late merge | Medium | Arrive with the engine working; insist on one loop |
| Judges think it's "just a rules engine" | Low | Lead with the unattended loop and the blocked egress, not the engine |
| Placeholder tariff rates challenged | Low | Own it: "demo subset; production uses the USITC export" |

---

## 12. Submission checklist (BuilderBase portal)

- [ ] Team name: **Customs Desk**
- [ ] One-paragraph description (use §3 one-liner + "runs on Dell Pro Max with GB10 via NemoClaw/OpenShell, inference via local vLLM/Ollama, zero cloud")
- [ ] Stack line: OpenClaw · NVIDIA NemoClaw · OpenShell · Qwen3.6-35B-A3B-NVFP4 (local) · Node rules engine · Telegram
- [ ] Repo link (push the `customs-desk` folder; no tokens, no real data)
- [ ] Backup video link (phone recording is fine)
- [ ] Screenshot of `policy-list` and a Telegram memo
- [ ] Non-goals stated honestly
- [ ] Submitted **at least 20 minutes before the deadline**

---

## 13. Team plan (solo → matched)

- Target team of 2, max 3. Recruit one **infra owner** (Linux/Docker/Node). Optional third for demo/pitch.
- Red flags: anyone proposing cloud APIs, voice, RAG pipelines, fine-tuning, or a second product surface.
- Hand a new teammate `TEAMMATE_README.md`; they start at infra checklist step 1 while you run the engine on the laptop.
- If merged into another team: join only if they have an infra owner and a clear unattended loop. Otherwise pitch Customs Desk, you're the one with a working core on a USB.
- Keep the hackathon project unmistakably unrelated to restaurant/pricing data (internship IP boundary).

---

## 14. Links

- Event (Luma): https://luma.com/e9z7dmdj · BuilderBase: https://builderbase.com/event/dell-x-nvidia-ai-hackathon-nyc
- NemoClaw playbook (GB10): https://build.nvidia.com/spark/nemoclaw · example agents: https://build.nvidia.com/spark/nemoclaw-applications
- NemoClaw repo/docs: https://github.com/NVIDIA/NemoClaw · https://docs.nvidia.com/nemoclaw/latest/
- OpenShell: https://github.com/NVIDIA/OpenShell · OpenClaw docs: https://docs.openclaw.ai (cron: /automation/cron-jobs)
- Model: https://huggingface.co/nvidia/Qwen3.6-35B-A3B-NVFP4 · vLLM Spark recipes: https://recipes.vllm.ai/browse
- Brev (free rehearsal VM): https://brev.nvidia.com · DGX Spark forum: https://forums.developer.nvidia.com/c/accelerated-computing/dgx-spark-gb10
- Tariff data: https://hts.usitc.gov (Export → CSV) · USTR Section 301: https://ustr.gov
