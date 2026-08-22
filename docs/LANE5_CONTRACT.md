# Lane 5, integrator: the working contract for branch `ajit`

**Subordinate to `PLAN.md`.** PLAN.md is the single plan and wins over this file on any
conflict. This is one lane's working contract, scoped to the `ajit` branch, inherited from
the "SovereignDesk Integrator (#5) Task Brief v1.0". It adds a status format, an escape
hatch and a merge discipline. It does not add a plan.

## Provenance, read this before you follow the brief

The Integrator #5 Task Brief describes a Python build: `contracts.py`, pydantic, FastAPI,
SQLite plus embeddings, llama.cpp on :8080, hand-rolled nftables. That substrate comes from
`SovereignDesk_Build_Plan_v2.pdf`, which `PLAN.md:3` supersedes by name, and it collides
with `CLAUDE.md`: "There is no Python in this repo and the engine is not being rewritten.
It works. Never propose a rewrite."

**What is inherited:** the brief's authority, its five non-negotiables, its swap order, its
gate discipline, its status format, its escape hatch. All of it survives.

**What is re-pointed:** the substrate. Same contract, real repo.

| Brief says | This branch does | Why |
|---|---|---|
| `contracts.py`, pydantic, frozen 09:45 | the result shape at `engine/triage.mjs:13`, already frozen | Same role, already exists. The brief's own snippet is textually damaged (`class TriageResult(BaseMode str`) and would not parse. |
| `evaluate` / `recall` / `commit` / `write_memo` | `engine/triage.mjs`, precedent lookup inside the sweep, `engine/record_precedent.mjs`, the memo prompt in `agent/AGENTS.md` | Four seams, four owners, same boundaries. |
| SQLite `shipments` table for state | `results/<id>.result.json` on the host mount, console SSE watches the directory | No SQLite in the repo. The seam the brief flags as unspecified does not exist here, so it cannot mismatch. |
| NemoClaw = memory, SQLite + embeddings | `precedents.jsonl`, append-only, Jaccard over sorted tokens. NemoClaw is inference and sandbox provisioning. | `CLAUDE.md`: "NemoClaw is not the memory layer." Correct this out loud if a lane repeats it. |
| llama.cpp, port 8080 | NemoClaw-served Qwen via the `inference.local` proxy | `127.0.0.1` inside the sandbox is the sandbox. |
| FastAPI + SSE console | `lanes/6-channel-ui/server.mjs`, zero deps, `127.0.0.1:7777` | Already built and serving. |
| hand-rolled `nft` rules, `docker network --internal` | OpenShell policy DROP, no allowlist | Never hand-roll iptables or nftables. Never `docker build`: the box is aarch64. |
| `feat/<lane>` branches | `lane/<n>-<slug>`, per `PLAN.md` | One convention, not two. This branch is `ajit`; it is lane 5's working branch. |
| `make smoke` | `bash scripts/smoke.sh` | No Makefile in the repo. Same gate, same job. |
| 5 synthetic shipments, #1 and #2 must pair | 6 samples in `engine/samples/`; the pair is 003 and 006 | The demo pair is already built and asserted by smoke. |
| memo prompt, four lines max | the memo format in `agent/AGENTS.md`, under 1,200 characters | Non-negotiable #2 is satisfied there, in the prompt text, by the safety block. Keep the constraint, keep the live format. |
| clock times 09:00 to 15:30 | ordered, not timeboxed | The team is past the event window. Phases still gate. |

## The five non-negotiables, inherited intact

1. **Shipment 006's memo must cite the precedent set on 003.** The entire thesis. Memo
   quality, UI polish and the firewall demo are all negotiable in service of it.
2. **The LLM never chooses the HTS code.** It explains a deterministic classification and
   flags disagreement with a precedent. This lives in the prompt text itself
   (`agent/AGENTS.md`, safety block), not in a comment near it.
3. **Zero network egress from anything written here.** If code wants a URL that is not
   loopback or a local path, stop before writing it.
4. **Lane 5 is the only merge to `main`.** Everyone else pushes their lane branch and stops.
   No exceptions, including when the author is certain it is trivial.
5. **The result shape is frozen** (`engine/triage.mjs:13`). A field rename needs lane 5
   sign-off plus a heads-up to lane 5 (prompt) and lane 6 (console), which both parse it.
   Never a silent edit.

## Zero internet, always

The box is aarch64. No `pip install`, no `docker pull`, no `apt install` expecting a
registry to answer. The engine is Node with zero dependencies precisely so nothing needs
fetching. If something needed is not vendored, report it, do not retry against a network
that is not there.

## Queue

Off-box first. Nothing in items 1 to 4 needs the GB10.

1. **Git spine.** Six branches off `main`, `lane/<n>-<slug>`. Only `main` and `ajit` exist
   today; five people are blocked on branches that are not there. Prepare the push, hand it
   over, do not run it.
2. **Pin the workspace root and broadcast it.** Four lanes are guessing what `--root` is.
   It must be on the host mount: `engine/process_inbox.mjs:33` puts `precedents.jsonl` at
   `<root>/precedents.jsonl`, and a sandbox-local path kills lane 4's teardown. Read
   `precedent_store.path` back from a sweep, do not assume it.
3. **Audit `agent/AGENTS.md` against real result JSON.** Every placeholder in the memo block
   must map to a field that exists. A wrong memo is a prompt bug, never an engine edit.
   Known past drifts, both fixed 2026-08-22: Telegram references, and `[]` versus
   `{shipments: []}`. Re-read rather than trust.
4. **Hold the gate.** `bash scripts/smoke.sh` before every merge. Green on this laptop as of
   2026-08-22.
5. **On the box:** `cp agent/AGENTS.md ~/.openclaw/workspace/AGENTS.md` after every edit (no
   live reload), then `openclaw cron add --name sweep --every 2m --session isolated
   --message "sweep"`. Confirm every verb with `--help` first: alpha CLI.
6. **Merge queue.** The box runs a USB copy. Merges land on GitHub and six laptops, not the
   GB10. Move `main` across after every merge or the demo runs old code.

## Swap order, one at a time, full demo run after each

| Order | Swap | Owner | Verify before the next merge |
|---|---|---|---|
| 1 | real engine behind the watcher | 3 | memo shows a real HTS code and real duty arithmetic |
| 2 | real LLM memo | **5** | reads like English, carries the PGA flags, holds the format |
| 3 | real memory | 4 | 006's memo cites the precedent set on 003 |
| 4 | real console | 6 | approve writes `decisions/`, reclassify appends a precedent |
| 5 | drop policy, LAST | 2 | everything above still works under policy DROP |

Firewall last on purpose: lock the network before the loop is green and a firewall problem
looks exactly like a code bug.

**Gate:** 006 cold `8513.10.20.00` / 0.60 / NEEDS_REVIEW / $2,362.50, reclassify, re-sweep,
warm `9405.11.60.10` / 0.95 / READY / $2,053.80, twice from cold, while
`curl -m 5 https://hts.usitc.gov` fails inside the sandbox and the loop keeps running.

**The scope call, lane 5 alone, no group debate:** if the loop is not green by the Phase 3
gate, drop the memory A/B toggle and keep plain recall. Retrieval is two tier as of
2026-08-22: `PRECEDENT_FLOOR` (`engine/triage.mjs:180`, 0.55) gates whether a past override is
mentioned at all, `PRECEDENT_BIND` (:186, 0.90) gates whether it binds and rewrites the code.
Below the bar it surfaces as `PRECEDENT_SUGGESTED` with `needs_human` forced true and the cold
classification kept. Lowering the floor surfaces more suggestions, it does not change what binds.
Lane 4 has the numbers.

## Never

- Never let another lane merge.
- Never add a dependency or a `package.json`.
- Never rewrite the engine.
- Never weaken the safety block in `agent/AGENTS.md`. It is the prompt-injection answer.
- Never add `Co-Authored-By` or any AI attribution to a commit.
- Never push. Prepare the command and hand it over.
- Never write a U+2014 into a tracked file. `scripts/smoke.sh` fails the repo on it.

## Status format, after every gate and every merge

```
GATE: <n, name>
STATUS: GREEN | RED | BLOCKED
JUST LANDED: <one line>
NEXT: <one line>
BLOCKER: none | <specific ask>
```

## Escape hatch

If something here is genuinely ambiguous, or an incoming PR does not match the contract, do
not patch around it and do not guess. Report it in one line: what is ambiguous, the two
readings, what you would merge if forced to pick right now. Then keep working on whatever
does not depend on the answer.

## Phase 5

Nothing to build. Lane 5 drives the keyboard for the shipment drop, the correction and the
payoff. Rehearse the `a` and `r` shortcuts blind. On stage, clicking is slower than it looks.
Lane 5 also owns the freeze: after it, only lane 5 commits, and only for a demo-breaking bug.
