# GB10 box setup: MongoDB + model staging

Lane 1 runbook for the parts of the stack that must exist on the box before Phase 4.
Everything here was prepped off-box on 2026-08-22; nothing downloads at the venue.

## What is on the USB

Staged from the laptop (source `repo.mongodb.org/apt/ubuntu`, noble/arm64, verified
against the live package index on 2026-08-22):

- `mongodb-org-server_8.0.29_arm64.deb` (40.7 MB)
- `mongodb-mongosh_2.10.0_arm64.deb` (58.4 MB)
- the Ollama install plus `llama3.3:70b` blobs (lane 1's existing staging; `qwen3.6:35b`
  stays staged as the fast fallback)

The box is aarch64. These debs are arm64 builds for Ubuntu 24.04 (noble), which is what
DGX OS is based on. x86 debs will not install; do not download substitutes at the venue.

## Install (on the box, from the USB)

```bash
uname -m                      # must print aarch64 before anything else
sudo dpkg -i mongodb-org-server_8.0.29_arm64.deb mongodb-mongosh_2.10.0_arm64.deb
mongod --version && mongosh --version
```

`dpkg -i` needs no network. If it reports missing libraries (unlikely; the server needs
only base-system libs that DGX OS ships), STOP and tell lane 5 before touching apt: an
`apt-get -f install` wants the network and that is a decision, not a reflex.

## Where mongod runs and why: INSIDE the sandbox, data on the host mount

```bash
mkdir -p <mount>/mongo
mongod --dbpath <mount>/mongo --bind_ip 127.0.0.1 --fork --logpath <mount>/mongo/mongod.log
```

- **Inside the sandbox**, because the sandbox has no route to host localhost (the same
  reason inference goes through `inference.local`). In-sandbox, the engine reaches it at
  `127.0.0.1:27017` over the sandbox's own loopback. The network policy stays DROP with
  no allowlist; mongod binds loopback and nothing leaves.
- **`--dbpath` on the host share mount**, never the sandbox filesystem. OpenShell is
  same-kernel isolation, so the mount is a bind mount and WiredTiger is safe on it. This
  is the teardown beat: destroy the sandbox, the data files survive on the host, restart
  mongod in the rebuilt sandbox, the memory is intact.

## Sync after every box move, rebuild, or doubt

The index is disposable; `precedents.jsonl` is the truth. That sentence is the prize
narrative, and these two commands make it real:

```bash
export MONGO_URI="mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=2000"
node scripts/mongo_sync.mjs --precedents <workspace>/precedents.jsonl
node scripts/mongo_load_tariff.mjs        # all 19,856 USITC lines, ~seconds
```

The engine refuses to run against a stale or wrong-workspace index (count-parity guard,
loud error naming mongo_sync). With mongod down and `MONGO_URI` set, sweeps fail loudly
and shipments quarantine to `inbox/_failed/`: that is intended. Unsetting `MONGO_URI` is
the explicit operator path back to JSONL-only retrieval; it is not automatic.

## Gate before calling it green

```bash
bash lanes/1-inference/doctor.sh    # [ mongodb ] section: versions, port 27017 open
bash scripts/smoke.sh               # MONGO_URI unset, must end SMOKE PASSED
bash scripts/smoke_mongo.sh         # must end MONGO SMOKE PASSED, never SKIPPED, on the box
```
