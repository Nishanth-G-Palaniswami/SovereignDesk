# Lane 6, channel and UI

**You own the human-in-the-loop surface: a Matrix homeserver running on the box, the bridge that posts memos and parses broker replies, the read-only projector board, and the BuilderBase submission.**

Everything below is checkable against the repo. Read this top to bottom once, then start at the work queue.

---

## 1. The architecture change. Read this before you touch anything

The plan used to be Telegram. It is now Matrix, with the homeserver running **on the GB10 itself**.

This is not a cosmetic swap. It changes the central claim of the entry:

| | Telegram | Matrix on the box |
|---|---|---|
| OpenShell egress allowlist | `api.telegram.org` | one loopback/LAN address on the box |
| Public internet destinations | one | **zero** |
| Pitch line | "only a short text memo leaves" | "nothing leaves" |

Customs documents carry supplier pricing and customer lists that brokers are contractually barred from sending to third parties. With the homeserver on the box, the memo travels from a sandbox to a process on the same machine. There is no public destination on the allowlist at all. That sentence is the whole entry. You are the person who makes it true.

Say it precisely on camera, because a judge who knows networking will check: **no public internet destination is on the allowlist; the single allowed destination is the box's own homeserver.** Do not say "the allowlist is literally empty" if lane 2's policy file has one RFC1918 line in it. Precision here is worth more than the stronger-sounding version.

Non-goal, state it out loud: no federation, no `.well-known`, no matrix.org account, no TLS certificate. Plain HTTP on a local address. Federation off is a feature here, not a shortcut.

---

## 2. Done definition

Four observable outcomes. Not "the bridge works", these:

1. **Round trip.** You type `status` in Element on the laptop. Within 5 seconds the bridge's stdout shows the parsed command as one JSON line, and the agent's reply lands back in the room.
2. **The sovereignty proof, in one shell.** From inside the OpenShell sandbox:
   ```bash
   node lanes/6-channel-ui/matrix_bridge.mjs --post "bridge online"   # lands in the room
   curl -m 5 https://hts.usitc.gov                                    # fails, default-deny
   ```
   Both, same terminal, on camera. Lane 2 owns the policy, you own the half that still works.
3. **The board flips.** Projector shows `SHP-2026-0822-006` as `NEEDS_REVIEW`. Broker replies `reclassify` from the phone. Next tick the same card reads `READY` with a precedent badge: `8513.10.20.00 conf 0.60 -> 9405.11.60.10 conf 0.95`, duty `$2,362.50 -> $2,053.80`.
4. **Submitted** on BuilderBase at least 20 minutes before the deadline, with repo link, backup video, and two screenshots.

---

## 3. First 15 minutes, before any code

Two questions for the organizers at check-in. You own submission, so you ask them:

1. **Team size.** `docs/HACKATHON_BIBLE.md` section 1 records teams as 2 to 4 builders, and the SF edition gave small teams a scoring bonus. **We are six.** Confirm this is allowed before anyone writes a line. If it is not, the team needs to know at T+0, not at T+5. Do not bury this and do not assume it is fine.
2. **The exact submission deadline**, and the pitch length. Post both in the team chat and write the deadline on the table in marker.

Then open the BuilderBase portal, https://builderbase.com/event/dell-x-nvidia-ai-hackathon-nyc, and save a draft submission with the team name and a one-paragraph description. An empty draft that exists beats a perfect one you start at T+5:40.

---

## 4. What you must NOT do

- **No npm install. Nothing.** The rest of this repo is zero-dependency `.mjs` and the venue Wi-Fi is contested. `fetch` is global in Node 18+ and the whole Matrix Client-Server API is HTTP with JSON bodies. `matrix-js-sdk` and `matrix-bot-sdk` are both banned. So is any board framework.
- **No Docker, no Synapse container.** The box is ARM64 (aarch64). x86 images will not run, and a pull on venue Wi-Fi is the exact failure mode the whole plan avoids. Conduit is a single static binary on your USB.
- **The board gets no write path.** Not a hidden one, not a "just for testing" one. Reason in section 8.
- **Only one process writes `decisions/`.** Either the agent does it (per `agent/AGENTS.md`) or your bridge does. Pick one before T+3 and tell lane 5. Two writers racing on the same file during a live demo is how the loop breaks on stage.
- **Do not edit `engine/*.mjs`** (lane 3) **or `agent/AGENTS.md`** (lane 5). If the reply grammar has to change, lane 5 changes both sides.
- **Do not merge to main.** Lane 5 has sole merge authority. Open the PR, tell them.
- **The access token never enters git, a command you paste in chat, or a screenshot.** It lives in `.env` on the box. `.gitignore` already covers `.env`. Blur or crop the token out of every screenshot before it goes near the submission.

---

## 5. Work queue against the T+0 to T+6 clock

| When | Task | Blocked on |
|---|---|---|
| T+0 to T+0:15 | Team-size question, deadline, BuilderBase draft saved | organizers |
| T+0:15 to T+1 | Conduit up on the box, agent user registered, token in `.env`, room created, you can see it in a client | SSH to the box (lane 1) |
| T+1 to T+2 | `matrix_bridge.mjs --whoami`, then `--post`. **Test Element on the phone here, not later.** | nothing |
| T+2 to T+3 | `matrix_bridge.mjs --listen` end to end: quote stripping, hand-off to the agent. Give lane 2 the address to allowlist | lane 2 policy, lane 5 agent loop |
| T+3 to T+4 | Board: write `lanes/6-channel-ui/board/serve.mjs` plus `index.html`, polling `results/*.json` | lane 3 result shape (frozen) |
| T+4 to T+4:30 | Precedent badge, cold-vs-warm snapshot, rehearse the flip with lane 4 | lane 4 |
| T+4:30 to T+5 | Freeze. Screenshots and board footage to lane 2 for the backup video | lane 2 |
| T+5 to T+5:30 | **Submit.** 20 minutes early, minimum | everyone |
| T+5:30 to T+6 | Rehearse twice with a timer, board on the projector | lane 2 |

Hard stop: if Conduit is not accepting a login by **T+1:30**, go to the fallback ladder in section 10 and do not debate it.

---

## 6. Standing up the homeserver

Conduit is a Matrix homeserver in one Rust binary with an embedded database. Synapse is the reference implementation and is the fallback, but it is Python plus a service tree plus a config generator, and you have six hours on an ARM64 box. Conduit is the time-pressure pick.

**On the laptop, before the venue** (this is a USB item, do not plan to download it there):

```powershell
# Conduit releases: https://gitlab.com/famedly/conduit/-/releases
# take the aarch64 / arm64 static (musl) asset. Confirm the exact asset name on the page,
# names change between releases. Drop it on the USB as:
#   E:\hackathon\channel\conduit-aarch64
# beside it: Element Desktop's Windows installer and an element-web tarball
```

`docs/HACKATHON_BIBLE.md` section 7 lists the USB as `project/ models/ ollama/ data/`. There is no `channel/` folder in that list, so nobody else will pack it. It is yours.

**On the box:**

```bash
mkdir -p ~/sovereigndesk/channel && cp /media/$USER/hackathon/channel/conduit-aarch64 ~/sovereigndesk/channel/conduit
chmod +x ~/sovereigndesk/channel/conduit
mkdir -p ~/sovereigndesk/channel/db

export CONDUIT_CONFIG=""                       # required: tells Conduit to read env vars, not a TOML file
export CONDUIT_SERVER_NAME=sovereigndesk.local
export CONDUIT_DATABASE_PATH=$HOME/sovereigndesk/channel/db
export CONDUIT_DATABASE_BACKEND=rocksdb
export CONDUIT_PORT=6167
export CONDUIT_ADDRESS=0.0.0.0                 # deliberate: the sandbox and the phone must reach it. Tell lane 2.
export CONDUIT_ALLOW_REGISTRATION=true
export CONDUIT_ALLOW_FEDERATION=false          # non-negotiable
export CONDUIT_TRUSTED_SERVERS='[]'

nohup ~/sovereigndesk/channel/conduit > ~/conduit.log 2>&1 &
sleep 2 && curl -s http://127.0.0.1:6167/_matrix/client/versions
```

That last curl returning a JSON list of versions is your "homeserver is up" check.

Two things that will bite, in order of likelihood:

- **Registration token.** Recent Conduit refuses to start (or refuses registration) when registration is open with no token. If the log says so, set `CONDUIT_REGISTRATION_TOKEN=<something>` and use the token flow below.
- **`CONDUIT_ADDRESS=0.0.0.0`.** The default binds loopback only, and loopback inside the OpenShell sandbox is the *sandbox's* loopback, not the host's. Binding the host interface is what makes the sandbox able to reach it at all. This is a policy-relevant decision: tell lane 2 the address and port the moment you set it.

  **Timing collision, sort it out with lane 2 at T+1 rather than at T+2:30.** Their README puts a hands-off freeze on the policy from T+1 to T+3 so that a broken inference route cannot be mistaken for a policy bug, and your allowlist entry is due to them at T+2. One of those has to give. Agree at T+1 on a single named window (ten minutes, announced, with lane 5 told to stop tuning while it happens) in which lane 2 adds exactly one entry and re-runs `policy-list`. Do not discover the conflict by being told to wait an hour.

- **The `.env` question that will cost twenty minutes if you skip it.** If the share mount means the host and the sandbox read the *same* `/workspace/sovereigndesk/.env`, then one `MATRIX_HOMESERVER` value has to work from both sides, and `127.0.0.1` does not. Set it to the box address you gave lane 2, then re-run `--whoami` **on the host as well** to confirm the host-side bridge and board still work with it. Tell lane 5 the value you landed on; they are the ones debugging the post path at T+2.

### Agent user and access token

```bash
HS=http://127.0.0.1:6167
PW='<generate one, put it in .env, never paste it anywhere else>'

curl -s -X POST "$HS/_matrix/client/v3/register?kind=user" \
  -H 'Content-Type: application/json' \
  -d '{"username":"customsdesk","password":"'"$PW"'",
       "auth":{"type":"m.login.dummy"},
       "device_id":"BRIDGE","initial_device_display_name":"Customs Desk bridge"}'
```

Response carries `user_id`, `access_token`, `device_id`. If you get a 401 with a `flows` list containing `m.login.registration_token`, repeat the call with the `session` value it handed back:

```bash
-d '{"username":"customsdesk","password":"'"$PW"'",
     "auth":{"type":"m.login.registration_token","token":"<CONDUIT_REGISTRATION_TOKEN>","session":"<session from the 401>"}}'
```

Register a second human account the same way (`--data '{"username":"broker",...}'`). That is the account you sign into Element with.

To mint a fresh token later without re-registering:

```bash
curl -s -X POST "$HS/_matrix/client/v3/login" -H 'Content-Type: application/json' \
  -d '{"type":"m.login.password","identifier":{"type":"m.id.user","user":"customsdesk"},"password":"'"$PW"'"}'
```

### Room

```bash
TOK=<access_token>
curl -s -X POST "$HS/_matrix/client/v3/createRoom" \
  -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
  -d '{"name":"Customs Desk","topic":"triage memos and broker replies",
       "preset":"private_chat","invite":["@broker:sovereigndesk.local"]}'
```

Fill `.env` on the box from `.env.example`, which already has the fields:

```
MATRIX_HOMESERVER=http://127.0.0.1:6167
MATRIX_USER=@customsdesk:sovereigndesk.local
MATRIX_ACCESS_TOKEN=<from register or login>
MATRIX_ROOM_ID=!<from createRoom>:sovereigndesk.local
```

`MATRIX_HOMESERVER` is correct for a host-side process. **If the bridge runs inside the sandbox, change it to the box's host address**, the same one lane 2 allowlists. Do not leave `127.0.0.1` in a sandbox-side `.env` and then spend twenty minutes wondering why connect refuses.

### Client

Test this at **T+1, not at T+4**. Element on a phone may refuse a plain-HTTP custom homeserver. If it does, the phone demo is dead and you fall back to **Element Desktop on the laptop**, which accepts it. Do not burn time on a self-signed certificate: browsers and mobile clients will fight you for longer than you have.

Phone and box also have to be on the same network. Ethernet from the box to a switch, or the box joined to a phone hotspot. LAN traffic, not internet traffic, so the sovereignty claim holds either way.

If you need a web client and have no installer, `serve.mjs` (section 8, you write it) is a static file server. Point it at an `element-web` tarball from the USB and you have one. That is a reason to build the board before T+4, not after.

---

## 7. The bridge. It already exists, run it

`lanes/6-channel-ui/matrix_bridge.mjs` is in the repo: zero dependencies, plain `fetch`, Client-Server API v3. **Do not write a second one.** It has never been run against a live homeserver, because there was no homeserver when it was written. Your job is to point it at Conduit.

```bash
node lanes/6-channel-ui/matrix_bridge.mjs --whoami        # run this FIRST
node lanes/6-channel-ui/matrix_bridge.mjs --login         # mint a token from a password on stdin, once
node lanes/6-channel-ui/matrix_bridge.mjs --post "bridge online"
node lanes/6-channel-ui/matrix_bridge.mjs --post-file ~/sovereigndesk/workspace/memos/SHP-2026-0822-006.memo.md
node lanes/6-channel-ui/matrix_bridge.mjs --listen        # one JSON line per recognised command
```

`--whoami` is first for a reason: it proves homeserver address, access token and reachability from wherever you ran it, before anything else can confuse you. The file reads `.env` from the repo root itself, BOM stripped, so nothing needs exporting.

Then spend five minutes, no more, on `openclaw channels --help` and `nemoclaw <sandbox> channels add --help`. Both tools are alpha, so confirm the exact subcommand with `--help` on the day rather than trusting any doc including this one. If a native Matrix channel type exists, use it and tell lane 5 the channel name. The bible only documents `channels add telegram`, so plan on the bridge carrying the memos.

Four things the file already handles, so do not re-derive them:

1. `ev.sender === selfId` is skipped. Without it the bridge answers its own reply, forever, live, on the projector.
2. The first `/sync` runs with `timeout: 0` only to take a baseline `next_batch`, and the backlog is discarded. Without it every old `reclassify` in the room re-fires on startup. Know the trade: `since` is held in memory, so a restart drops anything sent while it was down. That is the right trade on a demo floor. Do not "improve" it into a disk cache at T+4.
3. Txn ids are `sd-<epoch>-<counter>`, unique per send. Reuse one and the second message vanishes with a 200 OK and no error. The counter is deliberate over `Math.random`: it stays readable in the homeserver log while you debug on stage.
4. A `/sync` error retries after 3 seconds instead of killing the process, so a homeserver restart mid-demo does not end the bridge.

### Reply grammar, exact

These five forms and nothing else. They must match `agent/AGENTS.md` character for character, because the agent and the bridge are two independent readers of the same human input.

```
approve <id>
reclassify <id> line <n> to <hts> [because <reason>]
status
why <id>
precedents
```

`parseCommand` in `matrix_bridge.mjs` already implements all five and is exported, so you can unit-test it without a homeserver. An unrecognised line returns `{ cmd: "unknown", text }`; answer that by posting the five forms verbatim and doing nothing else. **Never guess at a near miss.** `reclassify 006 line one to 9405` must be rejected, not interpreted, and it is: `line one` fails `(\d+)`. A bridge that helpfully infers an HTS code has reintroduced exactly the hallucination risk the whole architecture exists to remove.

**The one real gap, and it is yours:** `parseCommand` only calls `.trim()`. It does not collapse internal whitespace and it does not strip an Element reply quote, so a reply typed as a quote (`> 📦 SHP-...` then `approve SHP-...`) parses as `unknown`. Drop the `>` lines and collapse runs of whitespace before matching. Test it by replying to a memo in Element rather than typing a fresh message, because a broker on a phone will hit reply.

### Handing the command to the engine

`--listen` deliberately executes nothing. It prints and stops there, because the agent is the only thing allowed to write decisions or record precedents, and two writers into `decisions/` is exactly how a live demo breaks.

**Primary:** the bridge validates, then the parsed command reaches the agent session so the agent executes it per `agent/AGENTS.md`. The agent already knows all five verbs and already knows to run

```bash
node engine/record_precedent.mjs --shipment <id> --line <n> --hts <hts> --reason "<reason>" --root .
```

**Fallback**, if there is no clean way to inject a message into the OpenClaw session: add an `--execute` mode to `matrix_bridge.mjs` that runs that exact command with `execFileSync` and writes `decisions/<id>.decision.json` for `approve`. This is deterministic and cannot hallucinate, so it is a legitimate demo path, not a cheat. But it makes the bridge the writer, so **tell lane 5 and make sure the agent stops writing decisions**. One writer.

Either way, post a confirmation back to the room within a couple of seconds. Silence on the phone in front of judges reads as broken even when it is working.

---

## 8. The projector board

This does not exist yet, you write it. Put it beside the bridge, the way lanes 1 and 4 keep their tools: `lanes/6-channel-ui/board/serve.mjs` plus `lanes/6-channel-ui/board/index.html`, zero dependencies, run **on the host**:

```bash
node lanes/6-channel-ui/board/serve.mjs --root ~/sovereigndesk/workspace --port 8080
```

**Read-only, and this is a design decision, not laziness.** `serve.mjs` answers `GET /` and `GET /api/board` and returns **405 to every other method**. There is no route that writes anything under `workspace/`.

Why: the loop is a round trip. Files land in `inbox/`, the engine writes `results/`, the agent writes `memos/` and `decisions/`. A second write path into `decisions/` from a browser competes with the chat round trip for the same file, and the failure shows up as a decision that appears and then gets overwritten mid-demo. It also puts a network-facing input on the box, which is the thing your entire pitch says does not exist. Read-only means the board can never be the thing that breaks the loop, and it means you can leave it running on a projector all day unattended.

The board's own snapshot cache under `board/cold/` is not a control surface. It is fine.

### Data

Poll `GET /api/board` every 3 seconds. The server reads `results/*.json`. Shape verified against `engine/triage.mjs:358-388` and against a real sweep of sample 006:

```
shipment_id, importer, origin_country, generated_at
shipment_summary: { status, entered_value, estimated_duty, effective_rate, flags[],
                    lines_needing_human[], precedents_applied[], missing_documents[] }
lines[]: { line, description, qty, unit_value, entered_value, hts, hts_candidates[],
           confidence, pga[], lpco[], flags[], needs_human,
           duty: { mfn_rate, surcharges[], total_rate, duty_est, notes[] },
           precedent: { hts, reason, by, at, source_shipment, similarity,
                        cold_hts, cold_confidence, changed_outcome } | null,
           declared_check: { declared, engine, declared_total_rate,
                             engine_total_rate, duty_delta } | null }
```

**Every rate in that JSON is a fraction, not a percent.** Sample 006 warm carries `effective_rate: 0.326`, `total_rate: 0.326`, `mfn_rate: 0.076`. Multiply by 100 exactly once. A board that prints `0.33%` on the projector at the moment the precedent lands is the worst possible bug and it is one character away.

One card per shipment, newest `generated_at` first, at most four visible:

- shipment id, importer, origin
- status badge: `READY` or `NEEDS_REVIEW`
- entered value, estimated duty, effective rate as a percent
- per line: HTS, confidence, total rate
- flags as chips: `LOW_CONFIDENCE`, `LPCO_MISSING`, `PGA_CONFIRM`, `DECLARED_DIFFERS`, `PRECEDENT_APPLIED`
- missing-document count

**Render status and flags independently.** A shipment can be `READY` and still carry `LPCO_MISSING` and `PGA_CONFIRM`; sample 006 warm does exactly that. A board that infers status from flags will show the wrong thing at the most important moment of the demo.

### The precedent badge

When any line has `precedent.changed_outcome === true`, that card gets a badge, large, above the fold:

```
PRECEDENT APPLIED
cold  8513.10.20.00   conf 0.60   NEEDS_REVIEW   $2,362.50   37.5%
warm  9405.11.60.10   conf 0.95   READY          $2,053.80   32.6%
swing $308.70   (broker override, similarity 1.0)
```

Those figures are verified against the shipped config. Anything quoting a `$541.80` swing, or `$2,992.50` / `$2,450.70`, is stale and predates the USITC data swap.

The cold half is not in the warm file: `process_inbox.mjs` overwrites `results/<id>.result.json` on the re-run (`engine/process_inbox.mjs`, `fs.writeFileSync(resultPath, ...)`). So the server keeps the previous parse in memory whenever a result file's mtime changes, and writes a copy to `board/cold/<id>.<generated_at>.json` so a board restart does not lose the comparison. Alternatively, before the flip:

```bash
mkdir -p lanes/6-channel-ui/board/cold
cp ~/sovereigndesk/workspace/results/SHP-2026-0822-006.result.json lanes/6-channel-ui/board/cold/
```

You can produce both halves on your laptop at T+1 while you wait for lane 1, and build the badge against them before the box exists. Run workspace dirs are gitignored, so generate them, do not look for them in the repo:

```bash
WS=/tmp/sd-board && mkdir -p $WS/inbox
cp engine/samples/shipment_006_precedent_test.json $WS/inbox/
node engine/process_inbox.mjs --root $WS                       # cold: NEEDS_REVIEW, 0.60
cp $WS/results/SHP-2026-0822-006.result.json /tmp/cold.json
node engine/record_precedent.mjs --shipment SHP-2026-0822-006 --line 1 \
  --hts 9405.11.60.10 --reason "Mains lamp, not a portable torch." --root $WS
cp engine/samples/shipment_006_precedent_test.json $WS/inbox/
node engine/process_inbox.mjs --root $WS                       # warm: READY, 0.95
```

Then swap the board's `--root` to the live workspace on the box.

Do both. The manual copy costs two seconds and it is insurance on the single strongest beat in the demo.

### Legibility

A hackathon projector is 1280x800, washed out, and the back row is fifteen feet away.

- Body text 20px minimum. Shipment id 42px or larger. Duty figures 32px.
- Dark ground (`#0b0f14`), near-white text (`#e8edf2`).
- `READY` green `#35d07f`, `NEEDS_REVIEW` amber `#ffb020`. Do not use thin red on black; it is the first thing a projector destroys.
- No animation except a one-second flash when a card's `generated_at` changes. Motion on a projector reads as a glitch.
- Test it by standing fifteen feet back from the actual projector before the pitch. Not from your chair.

The board is also your **fallback demo surface**: if the homeserver never comes up, the loop is still visibly autonomous on the projector, driven by `openclaw cron run <job-id>` (id from `openclaw cron list`, and confirm both with `--help` on the day, OpenClaw is alpha). It carries the demo without the phone.

---

## 9. Handoffs

**You give:**

| To | What | By |
|---|---|---|
| lane 2 | homeserver address and port to allowlist, and confirmation the sandbox reaches it | T+2 |
| lane 2 | **the demo phone**: a handset with Element installed, signed into the `@broker` account, proven to reach the box from the venue network, with the five reply forms tested by hand. Agree with lane 2 who is physically holding it during the pitch and who is at the keyboard | T+4 |
| lane 2 | board footage and Matrix room screenshots for the backup video | T+4:30 |
| lane 5 | the BuilderBase draft link and shared portal access, so somebody other than you can press submit if you are still fighting the homeserver at T+5 | T+4:30 |
| lane 5 | which process writes `decisions/`, bridge or agent | T+3 |
| lane 5 | the five grammar forms, confirmed identical to `agent/AGENTS.md` | T+2 |
| lane 5 | `MATRIX_ROOM_ID`, and either the channel name for `openclaw cron add --channel` or the fact that no native Matrix channel exists and the agent must shell out to `matrix_bridge.mjs --post-file`. `lanes/5-orchestration/README.md` is blocked on exactly this | T+2 |
| everyone | board URL and room invite | T+3 |
| everyone | submission draft text for a read-through | T+4:30 |

**You are waiting on:**

- **lane 1** for the box and SSH. Nothing you do works before this. If lane 1 is behind, write the bridge and the board on your laptop against a local workspace directory, using the samples. That work ports unchanged.
- **lane 2** for the egress allowlist entry. Until it exists, run the bridge on the host and prove the round trip there.
- **lane 3** for the result shape. It is frozen. If it changes, your board breaks silently, so ask before assuming.
- **lane 4** for the precedent flip rehearsal. The source-line question is already settled in `lanes/4-memory/README.md`: it reclassifies sample 006's own line 1. Sample 003 line 2, "LED night light lamp, USB rechargeable, portable", gives byte-identical figures anyway, because the signature is sorted unique tokens and 006 line 1 is the same seven tokens in a different order, so similarity is 1.0 either way. On camera that is an order-independent signature match, not a fuzzy one. Say it that way. The fractional-similarity cases are lane 4's to demo.
- **lane 5** to merge your PR.

---

## 10. Fallback ladder

Decide inside five minutes at each rung. Do not debate.

| Symptom | Move | Cost |
|---|---|---|
| Conduit will not start or register | Synapse on the host, in a venv because Ubuntu 24.04 refuses a bare `pip install` (PEP 668): `python3 -m venv ~/syn && ~/syn/bin/pip install matrix-synapse`, then `~/syn/bin/python -m synapse.app.homeserver -c homeserver.yaml --server-name sovereigndesk.local --generate-config --report-stats=no`. Same C-S API, `matrix_bridge.mjs` is unchanged | 30 to 40 minutes you do not have, **plus a PyPI download over venue Wi-Fi**, which is the failure mode the whole plan avoids. Stage the wheels on the USB beforehand or treat this rung as dead. Only if before T+1:30 |
| Element mobile refuses a plain-HTTP homeserver | Element Desktop on the laptop | Phone demo dies, round trip survives |
| Phone cannot reach the box | Box onto a phone hotspot, or laptop client over an SSH tunnel | Still local traffic, story intact |
| No homeserver at all by T+2 | Projector board plus `openclaw cron run <job-id>` on stage, no chat surface | Lose the human-in-the-loop beat, keep autonomy and the blocked egress |
| Board will not render in time | `nemoclaw <sandbox> logs --follow` on the projector (confirm the subcommand with `nemoclaw <sandbox> --help`, it is alpha) and read the engine JSON aloud | Ugly, still true |
| Everything chat-shaped fails | Telegram per `docs/HACKATHON_BIBLE.md` section 8, `.env` fields already exist | **This costs the empty-allowlist story.** `api.telegram.org` goes on the allowlist and the claim drops back to "only a text memo leaves". Last rung. Say the downgrade out loud in the pitch rather than hoping nobody notices |

Bitchat over Bluetooth LE mesh was raised. It is a talking point, not a demo path: it is phone-centric, a headless Linux agent needs a working BLE stack, and a floor with 40 teams is a hostile RF environment. Say that plainly if asked. Do not try it today.

---

## 11. Submission checklist, BuilderBase

Portal: https://builderbase.com/event/dell-x-nvidia-ai-hackathon-nyc

- [ ] Team name: **SovereignDesk**. Two names are live in the repo: `docs/HACKATHON_BIBLE.md` section 12 says "Customs Desk" and `agent/AGENTS.md` still introduces the agent as Customs Desk. You own the submission, so you pick, and the pitch uses the same one. Do not leave both running.
- [ ] One paragraph: always-on import-compliance triage agent for U.S. customs brokers. Shipment files land in a watched folder, a deterministic Node engine classifies HTS against a USITC Harmonized Tariff Schedule export (2026 rev 7), flags PGA requirements, computes the duty stack and lists missing LPCO documents. A local LLM writes the memo. A broker approves or reclassifies from their phone over a Matrix homeserver running on the box. Every override is stored as institutional precedent that survives a full sandbox rebuild.
- [ ] Stack line: OpenClaw, NVIDIA NemoClaw, OpenShell, Qwen3.6-35B-A3B local via Ollama or managed vLLM, Node zero-dependency rules engine, USITC HTS 2026 rev 7, **Matrix (Conduit) homeserver on the box**. Not Telegram. Fix this if you copy the old line out of the bible. Matches lane 2's line, keep them identical.
- [ ] Repo link. **Public**, so: no `.env`, no access token, no bot token, no real customer data. `.gitignore` covers `.env` and `precedents.jsonl`; confirm with `git status` rather than trusting it.
- [ ] Backup video link, recorded at T+4:30 whether or not the loop looked pretty on the day.
- [ ] Screenshots: OpenShell `policy-list` (lane 2), the projector board showing the precedent badge, the Matrix room with a memo and a broker reply. **Token cropped out of all three.**
- [ ] Non-goals stated honestly: no CBP ACE filing, no OCR, no binding-ruling lookups, no authoritative classification. PGA and LPCO tables are still demo data; only the tariff rates are real.
- [ ] The demo runs **on the GB10**, not on a laptop. Anything else is a disqualification.
- [ ] **Submitted at least 20 minutes before the deadline.** Not five. Portals queue and Wi-Fi dies.

After submitting, re-run the full loop once so the box is in a known-good state for judges walking past the table.
