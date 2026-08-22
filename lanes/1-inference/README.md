# Lane 1: Inference and the box

**You own it:** the Dell Pro Max with GB10 is powered, reachable over SSH, running a local model,
running a NemoClaw/OpenShell sandbox with this project share-mounted into it, and it stays that way
for six hours.

**Everyone else is blocked on you.** Lanes 2 through 6 have nothing real to test against until your
done-definition goes green. Tell them to work on their laptops until you say the word. Do not let
five people watch you type.

Read this page and start. You do not need to read anything else in the repo to begin.

---

## Done-definition

Not a feeling. This exact sequence, typed inside the sandbox, printing JSON:

```bash
nemoclaw customs-desk connect
# now inside the sandbox:
cd /workspace/sovereigndesk
node --version
mkdir -p inbox
cp engine/samples/shipment_001_clean.json inbox/
node engine/process_inbox.mjs --root .
```

Expected output: a JSON object, not an array. Top-level keys `precedent_store` and `shipments`.
`shipments[0].shipment_id` is `SHP-2026-0822-001`, status `NEEDS_REVIEW`, flag `LOW_CONFIDENCE`,
confidence 0.54. That is the correct, expected output today (lane 3 owns whether 001 should reach
READY, it is a known open finding, it is not your bug and not a broken install).

Second half of the done-definition. The sandbox cannot reach `localhost`; NemoClaw wires inference
through OpenShell's `inference.local` proxy, so from inside the sandbox:

```bash
curl -s http://inference.local/v1/models | head -c 200
```

If that name does not resolve, do not guess. Read the endpoint NemoClaw actually wired:

```bash
env | grep -iE 'inference|base_url|openai'   # inside the sandbox
nemoclaw customs-desk status                 # on the host
```

The server itself is on the host, and you can check it there directly:
`curl -s http://127.0.0.1:8000/v1/models` for managed vLLM, `curl -s http://127.0.0.1:11434/api/tags`
for Ollama.

Model serving, plus `node engine/process_inbox.mjs --root .` printing JSON from inside the sandbox.
When both are true, say "box is green" out loud and hand over §Handoffs.

---

## What you must NOT do

- **Do not hand-roll Docker.** No `docker build`, no `docker compose`, no pulling images you found
  on Docker Hub. The box is ARM64 (aarch64) and most images you know are x86 and will not run, and
  the whole point of the Ollama path is to pull *zero* container images on venue Wi-Fi. NemoClaw owns
  container lifecycle. Fighting it costs you the hour that the rest of the team is waiting on.
- **Do not touch `engine/`.** It is written, it works, it is Node with zero dependencies, there is no
  Python in this repo. If someone suggests a rewrite, that is lane 3's call and the answer is no.
- **Do not open the egress allowlist to "fix" a failed curl.** A blocked outbound request from inside
  the sandbox is the demo, not a bug. Lane 2 owns policy. If you need a hole, ask lane 2.
- **Do not put the workspace inside the sandbox filesystem.** `precedents.jsonl` must live on the host
  mount so it survives `nemoclaw <sandbox> rebuild`. That teardown survival is lane 4's strongest demo
  beat and you can destroy it with one wrong mount.
- **Do not rename the sandbox** if the installer picked a name. Substitute the name everywhere below
  and move on. Renaming costs ten minutes and buys nothing.
- **Do not spend more than 20 minutes on managed vLLM.** See the hard stop.

---

## Work queue, against the T+0 to T+6 clock

| When | Task | Gate |
|---|---|---|
| T+0:00 to T+0:10 | Power, network, SSH in, `lsblk`, mount the USB. Then §3a in full, in this order: it needs no network and takes about a minute, and it is what lets the installer skip Express. Start the installer **before team intros finish**, with `NEMOCLAW_PROVIDER=ollama` already exported. Run it bare and it runs Express and starts a 15 to 20 GB image pull you did not ask for. | box reachable |
| T+0:05 | **Plan A check.** 60 seconds. If the box is pre-imaged with a sandbox and a model, use them and skip to the share mount. | |
| T+0:10 to T+0:40 | **Plan C by default: Ollama off the USB.** No container pull. This is the path unless Plan A already handed you a running model. | `ollama run` answers |
| T+0:10 to T+0:40 | **Plan B only if the wifi is genuinely fast:** managed vLLM with NVFP4 weights pre-staged into `~/.cache/huggingface`. Better memo quality. Higher risk. | image pulled |
| **T+1:00** | **HARD STOP.** If managed vLLM has not pulled by now, switch to Ollama and do not debate it. Set `NEMOCLAW_PROVIDER=ollama` and run the installer again. The team loses the day arguing about this. | |
| T+1:00 to T+1:20 | Share-mount the project, `connect`, run the done-definition. Announce green. | **the gate for lanes 2-6** |
| T+1:20 to T+3:00 | Stay on call. You are now support for lane 5 (prompt/cron) and lane 2 (policy). Do not start side projects. | |
| T+3:00 to T+4:30 | Keep it serving through the cron loop and the channel round trip. Watch memory and load. Second sandbox only if lane 2 asks. | |
| T+4:30 | Freeze. Leave the box in a known-good state, model loaded, sandbox up. Do not restart anything after this. | |
| T+5:00 to T+6:00 | Re-run the full loop once after submission so the box is warm for judges walking by. | |

---

## Commands you will actually type

### 0. Get on the box, first two minutes

```bash
ssh <user>@<box-ip>            # or keyboard and monitor if the organizers provide one
head -n 2 /etc/os-release      # expect Ubuntu 24.04 (DGX OS)
uname -m                       # expect aarch64. If this says x86_64 you are on the wrong machine.
nvidia-smi; df -h /; free -g   # expect ~128 GB unified memory
```

Prefer the RJ45 cable to the box over venue Wi-Fi for SSH. It removes a whole class of problem.

### 1. Plan A check, 60 seconds

```bash
nemoclaw --version; nemoclaw list
ls ~/.cache/huggingface/hub 2>/dev/null
ollama list 2>/dev/null
```

If a sandbox and a model already exist, **use them**. Jump to step 4. Ask the organizers at check-in
whether the boxes are pre-imaged before you assume anything.

### 2. Mount the USB

```bash
lsblk                                            # find the device, usually /dev/sda1 or /dev/sdb1
sudo mkdir -p /media/$USER/hackathon
sudo mount /dev/sdX1 /media/$USER/hackathon      # exFAT mounts read-write by default on Ubuntu 24.04
ls /media/$USER/hackathon                        # expect project/ ollama/ models/
```

### 3a. Plan C, Ollama off the USB (default path, no container pull)

```bash
sudo tar -C /usr -xzf /media/$USER/hackathon/ollama/ollama-linux-arm64.tgz
mkdir -p ~/.ollama && cp -r /media/$USER/hackathon/ollama/models ~/.ollama/
nohup ollama serve > ~/ollama.log 2>&1 &
ollama list                                      # must show qwen3.6:35b
ollama run qwen3.6:35b "Reply with the single word READY."

export NEMOCLAW_PROVIDER=ollama NEMOCLAW_MODEL=qwen3.6:35b
curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash
```

`NEMOCLAW_PROVIDER=ollama` makes the installer skip Express (and skip the vLLM image). Ollama's blob
store is platform independent, so `manifests/` and `blobs/` copied from a Windows laptop work here.
If the installer insists on a system Ollama, run `nemoclaw onboard` interactively and pick
**Local Ollama**.

The values above are the same ones in `.env.example` at the repo root. Copy it to `.env` on the box
and fill it in there. No token ever goes into a command line.

### 3b. Plan B, managed vLLM with pre-staged weights (upgrade path only)

Weights are `nvidia/Qwen3.6-35B-A3B-NVFP4`, 23.5 GB, already on the USB. NemoClaw reuses whatever is
already in `~/.cache/huggingface`, so stage the cache **before** running the installer.

```bash
# if you staged the WSL-native cache tarball (symlinks preserved):
mkdir -p ~/.cache/huggingface
tar -C ~/.cache/huggingface -xzf /media/$USER/hackathon/models/qwen36-hfcache.tgz

# if you staged a plain folder, rebuild the cache layout by hand:
COMMIT=<40-char sha from commit.txt>
BASE=~/.cache/huggingface/hub/models--nvidia--Qwen3.6-35B-A3B-NVFP4
mkdir -p $BASE/snapshots/$COMMIT $BASE/refs
cp -r /media/$USER/hackathon/models/nvidia--Qwen3.6-35B-A3B-NVFP4/. $BASE/snapshots/$COMMIT/
rm -rf $BASE/snapshots/$COMMIT/.cache; echo -n $COMMIT > $BASE/refs/main

curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash     # Express should now pull only the image
```

If the installer starts downloading weights anyway: Ctrl+C once, retry with `HF_HUB_OFFLINE=1` in
front of `nemoclaw onboard`, and if that fails go to Plan C. The vLLM container image is 15 to 20 GB
on a congested venue network. That is the risk you are accepting.

### 4. Sandbox up, then verify

```bash
nemoclaw customs-desk --help                    # CLI is alpha: confirm both subcommands before typing them
nemoclaw customs-desk status
nemoclaw customs-desk dashboard-url --quiet     # http://127.0.0.1:<port>/#token=...
```

Expect a line like `OpenClaw is ready  Sandbox: customs-desk  Model: <model> (Local vLLM | Ollama)`.

The sandbox cannot reach `localhost` directly. All inference goes through OpenShell's
`inference.local` proxy and **NemoClaw wires that for you**. Do not hand-roll it.

### 5. Tunnel the dashboard to your laptop

```bash
# on the LAPTOP, not the box:
ssh -L <port>:127.0.0.1:<port> <user>@<box-ip>
```

Then open the dashboard URL in the laptop browser. Use `127.0.0.1`, not `localhost`, or the token
fragment will not resolve.

### 6. Share-mount the project into the sandbox

```bash
# host: put the project where it will live for the day
mkdir -p ~/sovereigndesk
cp -r /media/$USER/hackathon/project/. ~/sovereigndesk/
mkdir -p ~/sovereigndesk/inbox

nemoclaw share --help                                          # CLI is alpha: confirm the syntax first
nemoclaw share mount ~/sovereigndesk /workspace/sovereigndesk  # use the documented form
nemoclaw customs-desk connect
```

Then run the done-definition at the top of this page.

Layout note that matters to lane 4: with `--root .` from `/workspace/sovereigndesk`, the engine
creates `inbox/ processed/ results/ memos/ decisions/` **at the mount root**, which is host storage.
That is exactly what you want. Verify it on the host side, in the other terminal:

```bash
ls ~/sovereigndesk/results ~/sovereigndesk/processed
# expect results/SHP-2026-0822-001.result.json and processed/shipment_001_clean.json
```

If those files exist inside the sandbox but not on the host, the mount is wrong. Stop and fix it
before lane 4 builds anything on top of it.

`precedents.jsonl` sits at that same root, but a sweep never creates it: only
`engine/record_precedent.mjs` appends to it, and that is lane 4's demo, not yours. Do not go looking
for the file and do not conclude the mount is broken when it is absent. What you check instead is the
path the sweep prints:

```
"precedent_store": { "path": "/workspace/sovereigndesk/precedents.jsonl", "entries": 0 }
```

That path must be the mount root. Anything else, including a path under the sandbox's own home
directory, means the store would die with the sandbox and lane 4's teardown demo is gone.

---

## Handoffs: what you give the other lanes when you go green

Post these five facts in the team channel. Do not make anyone ask.

| Fact | Example | Who needs it |
|---|---|---|
| Sandbox name | `customs-desk` (or whatever the installer chose) | all |
| Model tag and provider | `qwen3.6:35b` via Ollama, or `nvidia/Qwen3.6-35B-A3B-NVFP4` via managed vLLM | 5, 2 |
| Mount path inside the sandbox | `/workspace/sovereigndesk` | 3, 4, 5 |
| Host path of the same directory | `~/sovereigndesk` | 4, 6 |
| Dashboard URL plus the `ssh -L` line | `http://127.0.0.1:<port>/#token=...` | 2, 5, 6 |

## What you are waiting on

- **Nothing.** You are the front of the queue. Do not block on the repo being tidy or on anyone's
  branch. The USB copy of `project/` is enough to go green.
- Later: lane 2 will ask you for `nemoclaw customs-desk logs --follow` in a second terminal for the
  blocked-egress demo. Keep a terminal free for it.
- Later: lane 6 will need the local Matrix homeserver address reachable from the sandbox. Lane 2 adds
  that to the allowlist, not you. The outbound allowlist should end up **empty except the local
  homeserver**, which is the whole sovereignty claim.

---

## Fallbacks, decide in five minutes, do not debate

| Symptom | Do this |
|---|---|
| vLLM container will not pull, or OOM, or kernel errors | Plan C. `export NEMOCLAW_PROVIDER=ollama NEMOCLAW_MODEL=qwen3.6:35b`, rerun the installer. Non-negotiable at T+1. |
| 35B loads slowly or answers slowly | `ollama pull`-free fallback already on the USB: `NEMOCLAW_MODEL=qwen3.5:9b`. Memos get slightly worse, the loop still works. The engine carries the accuracy, not the model. |
| `share mount` syntax fights you | `nemoclaw customs-desk connect` and copy the project into the sandbox filesystem. You lose the live watched folder and the host-side precedent store, so tell lane 4 immediately: their teardown demo is gone and they need to re-plan. Keep cron. |
| USB will not mount | `sudo mount -t exfat /dev/sdX1 /media/$USER/hackathon`, or `sudo apt install exfatprogs` if the wifi allows. Last resort: `scp` the project from your laptop over the Ethernet link (small), but the model weights are too big for that path. |
| Installer stalls on the sandbox base image | It needs venue Wi-Fi and a few GB. Tether to a phone **for the installer step only**. Local inference is the rule, local npm is not. |
| NemoClaw CLI flag does not exist | It is alpha. `--help` everything, then `nemoclaw onboard` interactively. Do not guess flags from memory. |
| Box locks up | `nemoclaw customs-desk status`, then `nemoclaw <sandbox> rebuild` as a last resort. The precedent store is on the host mount, so a rebuild costs you the sandbox, not the memory. Prove that to lane 4 and they will use it on stage. |

---

## Two things to raise at check-in, before you start typing

1. **Team size.** `docs/HACKATHON_BIBLE.md` §1 records teams as 2 to 4 builders, and the SF edition
   gave small teams a scoring bonus. We are six. Confirm this with the organizers at check-in before
   anything else. Whoever gets to the desk first asks.
2. **Are the boxes pre-imaged, and what is the submission deadline?** Both change your first hour.

## Repo facts that will trip you up

- `scripts/prep_usb.ps1` is referenced in the bible but is **not in this repo**. Type the USB staging
  commands by hand from §5 of the bible. Do not go looking for the script.
- `.env.example` has `WORKSPACE_ROOT=/workspace/sovereigndesk/workspace`, while `agent/AGENTS.md` has
  the agent run `node engine/process_inbox.mjs --root .` from a directory that contains `engine/`.
  Those are two different conventions. This page uses the AGENTS.md one, since that is what the agent
  actually executes. Lane 5 owns reconciling `.env.example`.
- `HACKATHON_BIBLE.md` §8 and `agent/AGENTS.md` step 2 both say the sweep prints a JSON **array** and
  `[]` when idle. Stale. `engine/process_inbox.mjs:80` prints an object, `{ precedent_store, shipments }`.
  Your install is not broken. Lane 5 owns fixing AGENTS.md before the agent sees it.
- Node is guaranteed inside the sandbox because OpenClaw runs on it. `python3` is not guaranteed and
  is not needed.
