# SovereignDesk

An always-on import-compliance agent that runs entirely inside one Dell Pro Max with GB10.
Shipment files land in a watched folder. A deterministic engine classifies the tariff code,
flags agency requirements, computes the duty stack and lists the missing documents. A local
model writes a plain-English memo. A broker approves or corrects it on a web console served
by the box itself, and every correction becomes permanent institutional knowledge.

Nothing leaves the box. The network policy is drop, with no allowlist and no exceptions.
That is not a constraint working against the product, it is the product: customs brokers
are contractually barred from sending supplier pricing and customer lists to third-party
SaaS, which is why nobody automates this work today.

The architectural story is a hedge fund that doesn't forget. The model is transient and you
can swap it tomorrow. The memory is permanent and it lives on this box. Customs is the first
vertical, not the product.

**Read [PLAN.md](PLAN.md).** It is the single plan: architecture, data, build phases, the
six lanes, the demo script, and the risks. Everything else here is reference.

## Quickstart

Node 24. No dependencies, no build step, no box required.

```bash
bash scripts/smoke.sh
```

That runs the whole loop and asserts every number in the plan. Green means the engine, the
real tariff data, the entry fees and the precedent round trip all work.

Drive it by hand:

```bash
mkdir -p ws/inbox && cp engine/samples/*.json ws/inbox/
node engine/process_inbox.mjs --root ws
```

Then the part that matters. Teach it something, and watch it not forget:

```bash
node engine/record_precedent.mjs --shipment SHP-2026-0822-003 --line 2 \
  --hts 9405.11.60.10 --reason "Ceiling mounted, mains powered, not portable." --root ws
cp engine/samples/shipment_006_precedent_test.json ws/inbox/
node engine/process_inbox.mjs --root ws
```

Sample 006 moves from `8513.10.20.00`, confidence 0.60, NEEDS_REVIEW, $2,362.50 duty, to
`9405.11.60.10`, confidence 0.95, READY, $2,053.80. A $308.70 swing on one shipment line.
Nothing was retrained, and the broker's reasoning is now attached to every future shipment
that looks like this one.

The console:

```bash
node lanes/6-channel-ui/server.mjs --root ws --port 7777
```

Loopback only. Press `a` to approve, `r` to reclassify, `m` for the memory A/B that reruns
the same file with the precedent store switched off and on, side by side.

## Layout

```
PLAN.md                     the single plan. start here.
engine/                     the deterministic engine. Node, zero dependencies.
  triage.mjs                one shipment: classify, flag, price, check documents
  process_inbox.mjs         sweep the inbox
  record_precedent.mjs      the only sanctioned way a precedent is ever written
  data/                     tariff tables, rebuilt from the USITC export
  data/usitc/               the committed USITC export, 19,856 ten-digit lines
  samples/                  six synthetic shipments
agent/AGENTS.md             standing orders the OpenClaw agent reads at run time
lanes/                      per-lane code (box doctor, retrieval eval, console)
scripts/smoke.sh            the pre-merge gate. Node only.
scripts/build_hts_from_usitc.mjs   rebuild the tariff tables from the export
docs/DATA_SWAP.md           data provenance and what the real-data swap corrected
docs/superseded/            older plans. contradictory. do not brief from them.
CLAUDE.md                   instructions for Claude Code sessions
```

## Data provenance

The tariff data is real and public. `engine/data/usitc/hts_2026_rev_7.json` is a Harmonized
Tariff Schedule export published by the U.S. International Trade Commission: 35,496 rows,
19,856 ten-digit lines. Both halves of the duty stack come out of that one file. The MFN
rate is the line's `general` field, and Section 301 membership is a footnote pointing at a
Chapter 99 heading whose own text states the surcharge, so each surcharge cites the heading
that set it across 1,184 prefixes. Nothing is hand-typed.

The six shipment transactions are synthetic, on purpose. You cannot use a real broker's
pricing and customer data without consent, which is the same argument the product rests on.

## Non-goals, stated out loud

No filing with CBP ACE. No OCR of scanned documents. No binding-ruling lookups. No
authoritative classification: the engine proposes with a confidence and a full trace, and a
licensed broker decides. The agent never files anything.

Two weaknesses we measured rather than hid, both written up in `PLAN.md`: the precedent
similarity floor is set too conservatively, and sample 001 is classified at low confidence
where the engine's second choice is the correct one.

Not legal or customs advice.
