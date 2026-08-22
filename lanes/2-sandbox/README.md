# Lane 2, OpenShell lockdown and the pitch

You own the security story and the words. Nobody else on this team is allowed to describe
the product to a judge until they have read the pitch script in this file.

Read this top to bottom once (about 6 minutes), then start at "T+0" in the work queue.
You do not need to read anything else to begin. `docs/HACKATHON_BIBLE.md` and
`docs/DATA_SWAP.md` are background, read them during your blocked window at T+0 to T+1.

---

## Done definition

Not a feeling. Four observable outcomes, in order of how much they are worth:

1. From inside the sandbox, `curl -m 5 https://hts.usitc.gov` fails, and at the same
   moment a second terminal running `nemoclaw $SANDBOX logs --follow` prints a policy
   denial. Both are on camera.
2. `nemoclaw $SANDBOX policy-list` output is saved verbatim at
   `lanes/2-sandbox/evidence/policy-list.txt` and contains zero public internet
   destinations.
3. `lanes/2-sandbox/evidence/backup-video.mp4` exists by T+4.5, whatever state the demo
   is in.
4. You deliver the 3-minute script below twice against a stopwatch and land between
   2:45 and 3:00 both times.

If 1 and 3 are true and nothing else is, the entry still has a story. If 3 is false, one
crash at pitch time and you have nothing.

---

## What OpenShell actually gives you

Four mechanisms. Learn to say them in this order, because it goes from kernel outward and
each one is independently checkable.

| Mechanism | What it means | How you prove it on the box |
|---|---|---|
| Kernel isolation: seccomp, Landlock, network namespaces | The agent process is confined by the kernel, not by a config file the agent could edit. Landlock scopes filesystem reach, seccomp cuts the syscall surface, the netns means the sandbox has its own network stack | `ls /` inside vs outside, plus the curl failure below |
| Default-deny egress with an allowlist | No outbound destination works unless it is explicitly listed. This is deny-by-default, not block-a-list | `nemoclaw $SANDBOX policy-list`, then `curl` anything not on it |
| Filesystem scoped to the share mount | The sandbox sees the mounted workspace and nothing else of the host. Host home dir, USB, SSH keys are simply not there | pick a host path outside the mount, show it does not exist inside |
| Inference through the `inference.local` proxy | The sandbox cannot reach `localhost`. It is a separate network namespace, so `127.0.0.1` inside the sandbox is the sandbox. Model access is brokered through OpenShell's `inference.local` proxy, which NemoClaw wires up | `curl -s http://inference.local/v1/models` works inside, `curl -s http://127.0.0.1:11434` (Ollama) or `:8000` (managed vLLM) does not |

That last row is not trivia. It is the thing that makes the Matrix question below hard, and
it is the single most common way a team accidentally proves nothing.

---

## The allowlist, and why it changed today

The plan in `docs/HACKATHON_BIBLE.md` section 3.3 was Telegram, which needs real egress to
`api.telegram.org`. The team changed it this morning. The channel is now a Matrix
homeserver (Conduit, single Rust binary, ARM64-friendly) running **on the box**, with
Element as the client. See `.env.example`:

```
MATRIX_HOMESERVER=http://127.0.0.1:6167
```

Why this is strictly stronger, and the exact words to use:

- Telegram story: "only a plain text memo leaves the box, never the documents."
  A judge can reasonably ask what is in that memo, and the answer is HTS codes, importer
  names and duty figures, which is customer data.
- Matrix story: "the outbound allowlist contains no internet destination. Nothing leaves.
  The chat server, the model and the memory are all on this desk."

There is no version of the first sentence that beats the second.

### The one thing that can undercut this, resolve it with lane 6 by T+3

The homeserver is at `127.0.0.1:6167` **on the host**. Inside the sandbox that address is
the sandbox itself. Two ways out, and lane 6 picks one:

- **A.** Bind Conduit to the host's bridge address rather than loopback, then add exactly
  that address to the allowlist. The allowlist then has one entry, and that entry is a
  private address on this machine. Still a true claim, phrase it as "one entry, and it is
  this box."
- **B.** Get OpenShell to broker it the way it brokers `inference.local`. Cleaner if it
  exists, do not burn time inventing it. Check `nemoclaw $SANDBOX policy-add --help` and
  the OpenShell docs before assuming either way.

Say the true version on stage. "Empty allowlist" if it is empty, "one entry and it is a
private address on this box" if it is not. Do not round the second one up to the first,
a judge who asks to see `policy-list` will catch it and you lose the whole entry's
credibility in one screen.

**Bitchat / Bluetooth LE mesh.** Raised, not the demo path. If a judge asks: "Phone-centric,
a headless Linux agent needs its own BLE stack, and a floor with 40 teams is a hostile RF
environment. It is a real direction for a port office with no WAN, it is not something we
would claim to have working today." That answer scores better than pretending.

---

## What you must NOT do

- **Do not widen the allowlist to make something work.** If a lane says "just let it out",
  the answer is: name the exact host, take it to lane 5, and understand why it is needed.
  A permissive allowlist is not a smaller demo, it is a dead pitch.
- **Do not touch the policy between T+1 and T+3.** Lane 5 is fighting the loop in that
  window. A default-deny sandbox with a broken inference route looks exactly like a policy
  bug, and you will burn an hour of somebody else's time proving it was not you.
- **Do not edit `engine/`, `agent/AGENTS.md`, or anything under the workspace.** Lane 3
  owns the engine, lane 5 owns the standing orders and has sole merge authority to main.
- **Do not hand-roll Docker, iptables or nftables rules.** OpenShell owns the network
  namespace. Fighting it makes the demo unreproducible and the box is ARM64 anyway.
- **Do not screenshot a token.** If `policy-list` or a channel config prints a Telegram bot
  token or a Matrix access token, scrub it before it goes in `evidence/`. This repo is
  public and its link goes in the submission.
- **Do not fake a denial.** If nothing is actually blocked, say what is actually enforced.

---

## Work queue against the T+0 to T+6 clock

### T+0, first 15 minutes, at check-in. Do this before you sit down.

Ask the organizers, in this order, and post the answers to the team channel immediately:

1. **"We have six people. Our notes from the event listing (`docs/HACKATHON_BIBLE.md` §1)
   say teams are 2 to 4, and the SF edition gave small teams a scoring bonus. Are we
   eligible as six, or do we need to split?"** This is a real disqualification risk and it
   is yours to clear. Do not let it sit until the afternoon.
2. What is the submission deadline?
3. How long is the evening pitch slot? (Everything below assumes 3 minutes. If it is 2,
   you cut the precedent beat. If it is 5, you add the trace read-out.)
4. Are the boxes pre-imaged with OpenClaw and a model already?

### T+0 to T+1, you are blocked on lane 1. Do not touch the box.

Lane 1 owns getting inference up and it gates everyone. Useful work you can do with no box:

- Read `docs/DATA_SWAP.md` end to end. The tariff numbers in your pitch come from there.
- Write the pitch onto an index card in your own words. Reading this file aloud at a judge
  does not work.
- Set up the two-terminal layout on your laptop now: left terminal will be the sandbox
  shell, right terminal will be `logs --follow`. Font size large enough to read on a
  projector, which is bigger than you think.
- Draft the submission stack line and hand it to lane 6:
  `OpenClaw · NVIDIA NemoClaw · OpenShell · Qwen3.6-35B-A3B (local, Ollama or vLLM) · Node rules engine, zero deps · Matrix homeserver on-box · USITC HTS 2026 rev 7`
  Before you hand it over, replace "Ollama or vLLM" with whichever one lane 1 actually
  landed, and "Matrix" with "Telegram" if lane 6 fell back.

### T+1, the sandbox exists. Baseline it, change nothing.

```bash
nemoclaw list                                     # find the real sandbox name
export SANDBOX=customs-desk                       # or whatever the installer called it
export MOUNT=/workspace/sovereigndesk             # inside the sandbox, from lane 1
export ROOT=~/sovereigndesk                       # the same directory on the host, from lane 1
nemoclaw $SANDBOX status
nemoclaw $SANDBOX --help                          # the CLI is alpha, read it, do not guess
nemoclaw $SANDBOX policy-add --help               # write the real syntax down before you need it
mkdir -p $ROOT/lanes/2-sandbox/evidence
nemoclaw $SANDBOX policy-list | tee $ROOT/lanes/2-sandbox/evidence/policy-list-baseline.txt
```

`nemoclaw` and `openclaw` are alpha. Every subcommand above appears in
`docs/HACKATHON_BIBLE.md` §8, but confirm each one with `--help` on the day before you type
it in front of a judge. The only documented `policy-add` form in the bible is the preset
`policy-add telegram`. Anything else is unknown until you read `--help`. Put the real syntax
in `evidence/policy-syntax.txt` so nobody has to rediscover it at T+4 under pressure.

**One question to ask lane 5 at T+1, then never again.** Does the engine's workspace root sit
at the mount root or in a `workspace/` subdirectory under it? `.env.example` says
`WORKSPACE_ROOT=/workspace/sovereigndesk/workspace`; lane 1's done-definition runs
`--root .` from the mount root. Lane 5 pins it. You do not have to wait for an answer: every
sweep prints it as `precedent_store.path` in the result JSON, so read one and set
`export WS=$ROOT` or `export WS=$ROOT/workspace` to match. `inbox/`, `processed/`, `results/`
and `precedents.jsonl` all sit directly under `$WS`.

### T+1 to T+3, hands off the policy. Rehearse instead.

Watch lane 5's loop come up. When the first memo lands, that is your cue. Meanwhile
practice the script out loud with a timer. Twice now is worth four times at T+5.

### T+3 to T+4, the security proof. This is your real hour.

Two terminals. Host, right side:

```bash
nemoclaw $SANDBOX logs --follow
```

Sandbox, left side:

```bash
nemoclaw $SANDBOX connect
```

Then, inside:

```bash
# 1. the headline: a public URL, default-deny
curl -m 5 https://hts.usitc.gov ; echo "exit=$?"
curl -m 5 https://google.com    ; echo "exit=$?"

# 2. the contrast: what IS allowed still works
curl -m 5 -s http://inference.local/v1/models | head -c 200 ; echo
curl -m 5 -s http://127.0.0.1:11434 ; echo "exit=$? (expected to fail: netns, not the host)"

# 3. filesystem scope: a host path that is not under the mount
ls ~/.ssh 2>&1 | head -1
ls /media/$USER/hackathon 2>&1 | head -1
ls /workspace                                    # the mount IS there

# 4. the workspace the agent actually uses
ls /workspace/sovereigndesk/workspace
```

Capture everything. Run the whole block under `script` or paste the terminal output into
`lanes/2-sandbox/evidence/egress-denied.txt`, and grab the matching denial line from the
logs terminal into the same file. Screenshot both terminals side by side into
`lanes/2-sandbox/evidence/`. That screenshot is a submission deliverable, lane 6 needs it.

Then re-run `policy-list` and save the final version:

```bash
nemoclaw $SANDBOX policy-list | tee ~/sovereigndesk/lanes/2-sandbox/evidence/policy-list.txt
```

Re-run this **again** right before the pitch. Somebody will have added something.

### T+4 to T+4.5, freeze and hand off.

Give lane 6 the policy-list text, the side-by-side screenshot, and the stack line. Confirm
with lane 3 whether sample 001 now reaches READY, because it changes your first beat (see
"Fallbacks").

### T+4.5, record the backup video. Hard commitment.

This is not conditional on the loop being pretty. At T+4.5 you stop whatever you are doing
and record. A rough video of a working loop beats a polished plan for a video. Teams lose
this hackathon by having a demo that worked at 3pm and a box that is wedged at 7pm.

### T+4.5 to T+5, video handed to lane 6 for the submission.

### T+5 to T+6, rehearse twice with a timer, then re-run the full loop once after
submitting so the box is in a known-good state for judges walking past.

---

## The 3-minute pitch

Built from `HACKATHON_BIBLE.md` section 9, updated for the mesh channel and the real USITC
data. Every number below was verified against the committed result files this morning. Do
not improvise numbers.

**0:00 to 0:20, the problem.**
"Every shipment entering the US gets hand-triaged by an entry clerk: tariff code, agency
flags, missing documents, duty. Those documents carry supplier pricing and customer lists
that brokers are contractually barred from sending to a cloud API. So nobody automates it."

**0:20 to 1:05, the live loop.**
Drop two shipment files into `inbox/`. Fire the tick: `openclaw cron run sweep`.
Phone up, Element open. Two memos arrive.
Read the audit-risk one aloud: "This one was declared 4016.93.50.50, rubber gaskets. The
engine says 8413.91.90.96, pump parts. Duty delta $165 on a $6,600 entry. Flagged
DECLARED_DIFFERS, routed to a human. The engine never silently overrides the filer."

**1:05 to 1:50, the memory beat. This is your strongest 45 seconds.**
"Same box, different shipment. An LED night light. Cold, the engine says 8513.10.20.00,
confidence 0.60, below our 0.70 floor, so NEEDS_REVIEW. $2,362.50 of duty at 37.5%."
Reply from the phone: `reclassify SHP-2026-0822-006 line 1 to 9405.11.60.10`.
Re-drop the same file. "Warm: 9405.11.60.10, confidence 0.95, READY, $2,053.80 at 32.6%.
The swing is $308.70, and the memo says which human made that call and why."
"That precedent is a line in an append-only JSONL file on the host mount. Tear the sandbox
down completely and the broker's decision still applies. The model is transient and
swappable. The memory is permanent and it lives on this desk."

**1:50 to 2:25, the security moment.** Switch to the two terminals.
`curl https://hts.usitc.gov` inside the sandbox, it hangs and fails. Point at the logs
terminal showing the denial. Then `policy-list`.
"OpenShell default-deny: seccomp, Landlock, its own network namespace. The chat server is
a Matrix homeserver running on this box, so there is no internet destination on the
allowlist at all. Not 'only the memo leaves'. Nothing leaves."
(If lane 6 landed option A above, the line is: "one entry on the allowlist, and it is a
private address on this box.")

**2:25 to 2:45, why you can trust it.**
"The model never picks a tariff code. A deterministic Node engine does, with a confidence
score and a full trace, and anything under 0.70 goes to a licensed broker. The rates are
not made up: MFN comes from the USITC schedule, 2026 revision 7, 19,856 ten-digit lines,
and every Section 301 surcharge cites the Chapter 99 heading that sets it, 9903.88.03. We
also switched Section 122 off, because there is no heading in the 2026 schedule that
implements it and we were not willing to add ten fabricated points of duty to every memo."

**2:45 to 3:00, the business, and the honest part.**
"Brokers pay per entry. This runs 24/7 on a $5K box at zero marginal cost, on their own
premises. It does not file with CBP, it does not OCR scans, it does not look up binding
rulings. It proposes, a licensed broker decides. Customs is the first vertical, not the
product."

**Slides, max 3, optional:** problem and who pays / architecture / what is real versus
what is next with the non-goals written on it.

---

## Backup video shot list

One take per shot, no editing beyond concatenation. Under 3 minutes total. Phone recording
of the screen is fine, audio matters more than resolution.

1. **0:15** Terminal: `nemoclaw $SANDBOX status` and `openclaw cron list`. Establishes
   this is running on the GB10, not a laptop. Say the box name out loud.
2. **0:25** `cp engine/samples/shipment_004_audit_risk.json` and
   `shipment_006_precedent_test.json` into `inbox/`, then `ls inbox/`.
3. **0:20** `openclaw cron run sweep`, let the engine output scroll.
4. **0:25** Phone: Element, two memos arriving. Hold the phone still, this is the shot
   people remember.
5. **0:35** Phone: type the `reclassify SHP-2026-0822-006 line 1 to 9405.11.60.10` reply,
   show the confirmation, re-drop 006, show the warm memo with PRECEDENT_APPLIED and
   $2,053.80.
6. **0:30** Two terminals side by side: the failing `curl https://hts.usitc.gov` and the
   denial in `logs --follow`. Then `policy-list` filling the screen.
7. **0:20** `cat` the last line of `precedents.jsonl` on the host, outside the sandbox.
   Say: "this file is on the host mount, the sandbox can be destroyed and rebuilt."
   (If lane 4 has the teardown demo ready, use their footage here instead, it is better.)

Save as `lanes/2-sandbox/evidence/backup-video.mp4`, hand the link to lane 6.

---

## Judge Q&A, the answers you deliver

Accuracy and tariff questions go to lane 3 (Nishanth). Everything below is yours.

**"What does OpenShell actually give you?"**
Kernel-level isolation: seccomp, Landlock, network namespaces. Default-deny egress with an
explicit allowlist. Filesystem scoped to the share mount, so the host home directory and
the USB are not visible. Inference brokered through the `inference.local` proxy rather than
the sandbox reaching localhost. We showed the block live, and the `policy-list` is in the
submission.

**"Is it the model that is sandboxed, or the agent?"**
The agent process and every tool it runs. The model is served outside and reached through
the proxy. That is the right boundary: the risky thing is the code the agent executes on
untrusted documents, not the weights.

**"What happens if a malicious invoice contains a prompt injection?"**
Three layers. It cannot reach the network, there is no destination to exfiltrate to. It
cannot write outside `memos/` and `decisions/`, and `agent/AGENTS.md` refuses instructions
to fetch, upload or delete. And it cannot change a tariff code at all: codes come from the
engine, and the only path that changes one is a human `reclassify` that writes an
append-only precedent. Worst case is a badly worded memo, which a human reads anyway.

**"Empty allowlist is a nice claim. Show me."**
`nemoclaw $SANDBOX policy-list`, on the box, right now. Have it up.

**"Why not just unplug the network entirely?"**
Because the broker still needs to approve a shipment from their phone, and the box still
needs to be a normal machine on their LAN. Default-deny with a reviewable allowlist is a
policy an IT department can audit. An air gap is a policy that gets worked around within a
week.

**"Isn't this just a rules engine with a chatbot on top?"**
The rules engine is deliberate: a wrong tariff code is a penalty, not a typo. What makes it
a product is that it runs unattended on a cron tick, and that a human correction from a
phone becomes institutional memory that survives destroying the sandbox. That memory layer
is the thing, customs is just where we pointed it first.

**"What did you not build?"**
No CBP ACE filing. No OCR of scanned images. No binding-ruling lookups. MFN rates and
Section 301 surcharges are real USITC data, but the PGA and LPCO tables are still demo
tables, and the engine says so in its own output disclaimer. The engine proposes, a
licensed broker decides.

**"Why does the memo say NEEDS_REVIEW so often?"**
Because that is correct behavior, not a failure. Five of our six samples route to a human
on purpose: missing FDA and NOAA documents, a missing Children's Product Certificate, a
declared-versus-engine mismatch worth $165. A triage tool that returns READY on everything
is a liability.

---

## Handoffs and dependencies

**You are waiting on:**

| From | What | By |
|---|---|---|
| Lane 1 | Sandbox exists and has a name, share mount live | T+1 |
| Lane 5 | The loop produces a memo, so there is something to film | T+3 |
| Lane 6 | Homeserver address and whether it needs an allowlist entry (option A or B above) | T+3 |
| Lane 3 | Does sample 001 reach READY after the keyword fix, yes or no | T+4 |

**You hand over:**

| To | What | By |
|---|---|---|
| Lane 6 | `evidence/policy-list.txt`, side-by-side denial screenshot, backup video, stack line | T+4.5 |
| Lane 5 | The exact allowlist entries the loop needs, if any | T+3 |
| Everyone | The pitch script, so nobody contradicts it on the floor | T+1 |

---

## Fallbacks, decide in under 5 minutes, do not debate

| Symptom | What you do |
|---|---|
| `curl` succeeds, nothing is actually blocked | Do not fake it. Pivot to the filesystem proof (`ls ~/.ssh` empty inside, mount present) and say plainly what is enforced. Then spend 10 minutes with lane 1 on whether the policy is applied at all, and if it is not, drop the claim rather than the honesty |
| `logs --follow` shows nothing on the denial | Run the curl and show the timeout next to `policy-list` on the same screen. A 5-second timeout to a public URL while the memo lands in Element is still a demonstration |
| Matrix will not come up, team falls back to Telegram | Change your words. `api.telegram.org` will be in the allowlist. The line becomes "one allowlisted destination, a text memo, never the documents." Never say "nothing leaves" with Telegram on the list |
| Sample 001 still NEEDS_REVIEW at pitch time | Do not open with it. Open with 004, the $165 declared-versus-engine catch, which is a better story anyway because the engine caught a real error |
| The loop is broken when your slot is called | Play the video. This is the entire reason T+4.5 is non-negotiable |
| Box is wedged or unplugged | Video plus the repo. Say what happened, do not narrate a fake live run |
| Organizers rule six people ineligible | You found this out at T+0, so there is time. Split into a 4 and a 2 by name, agree who submits, and tell everyone before T+1 |

---

## Files you create

```
lanes/2-sandbox/evidence/policy-list-baseline.txt    # T+1
lanes/2-sandbox/evidence/policy-syntax.txt           # T+1, real --help output
lanes/2-sandbox/evidence/egress-denied.txt           # T+3, curl output + the denial line
lanes/2-sandbox/evidence/policy-denial.png           # T+3, two terminals side by side
lanes/2-sandbox/evidence/policy-list.txt             # T+4, final
lanes/2-sandbox/evidence/backup-video.mp4            # T+4.5, hard commitment
```

Scrub tokens from every one of these before they are committed. The repo is public and the
link goes in the submission.
