# Judge Q&A crib, lane 3

Rehearsal sheet. Answers are written the way you say them, not the way you document them.
Reference detail and citations live in `PLAN.md` and `docs/DATA_SWAP.md`; this is what comes
out of your mouth. Every figure re-verified against the live engine 2026-08-22.

Three delivery rules:

1. **Number first, source second, stop.** "12.5 percent, that is the USITC line rate" beats a
   paragraph. Silence after a complete answer reads as confidence.
2. **Never bluff.** The honest fallback is: "I did not verify that. What I did verify is..."
   and pivot to the nearest thing you own. A judge who catches one bluff discounts everything.
3. **Hand off out-of-lane questions by name.** You are the customs brain. Infra goes to #1,
   security and pitch to #2, memory internals to #4, orchestration to #5, console to #6.

---

## The numbers card, cold

| number | value |
|---|---|
| Demo flip, sample 006 | cold `8513.10.20.00` conf 0.60, NEEDS_REVIEW, duty $2,362.50 on $6,300; warm `9405.11.60.10` conf 0.95, READY, $2,053.80; swing **$308.70** |
| 006 payable (duty + fees) | cold $2,403.96, warm $2,095.26 |
| Thresholds | classify floor **0.70**; precedent surfaces at **0.55**, binds only at **0.90** |
| Tariff data | USITC 2026 rev 7 export, 35,496 rows, **19,856** ten-digit lines, committed in the repo |
| Section 301 | **1,184** prefixes, each citing the Chapter 99 heading that states its rate |
| FY2026 MPF | 0.3464%, min **$33.58**, max **$651.50** (CBP Dec. 25-10, 90 FR 34665); rolls 2026-10-01 |
| HMF | 0.125%, vessel only, uncapped, statutory (26 USC 4461) |
| Cold sweep | 001 READY, 005 READY, 002/003/004/006 NEEDS_REVIEW |
| Sample 001 | `8413.91.90.96` at 0.77, READY (a casing is a part of a pump) |
| Sample 004 audit catch | declared 4016.93.50.50 vs engine 8413.91.90.96, delta $165 on $6,600 |

---

## Guaranteed questions

**"How accurate is the classification?"**
It is a deterministic keyword scorer over real USITC lines, so the honest answer is: accurate
enough to triage, never trusted to decide. Confidence is top score against runner-up; anything
under 0.70 goes to a human, and any mismatch with the declared code goes to a human regardless.
In production you would also curate keywords per client. The design point is that wrongness is
visible: every line carries a full trace and a confidence, so the clerk sees exactly why.

**"Why not let the LLM classify?"**
Because a wrong tariff code is a penalty, not a typo. The model never picks a code, a rate, or
a flag; the engine decides, the model explains. Every number in a memo traces to a field in the
engine output. Worst case for the model is awkward prose over a correct JSON.

**"Isn't this just a rules engine with an LLM wrapper?"**
The rules engine is the trust story, not the product. The product is the memory: the broker
corrects a classification once, with a reason, and every future similar shipment gets that
correction and that reason automatically. We destroy the sandbox live and the knowledge
survives, because it lives on the host, not in the model or the sandbox. The LLM is the
disposable part; that is the point.

**"Why does this need to be local?"**
Brokers are contractually barred from sending supplier pricing and customer lists to third
party SaaS, so cloud AI is off the table for them; that is why nobody has automated this desk.
Local is not our constraint, it is the reason the customer exists. Plus zero marginal token
cost on an always-on loop, and it works when the port office WAN is down.

**"Your engine got something wrong before, didn't it?"**
Yes, twice, and we will show you both. A pump casing scored as a whole pump because our real
data swap put "part thereof" from the chapter heading into every 8413 description; the
confidence floor caught it, we fixed the parts test, and the gate now asserts it. And retrieval
matched a reading lamp to a ceiling-fixture precedent at 0.75 similarity; we changed the design
so nothing below 0.90 auto-applies, it only suggests. A system for a regulated desk should be
judged on whether errors are visible and survivable, and ours were both.

---

## Domain probes, your specialty

**"Where do the duty numbers come from?"**
One public file: the USITC tariff schedule export, committed in the repo. The MFN rate is on
the line. Section 301 is a footnote pointing at a Chapter 99 heading, and that heading states
its own surcharge, so we read the rate instead of assuming it. Ask the engine where 25 percent
came from and it answers "heading 9903.88.03", not "a config file".

**"What are these fees on the total?"**
MPF, 0.3464 percent with a per-entry floor and cap, FY2026 figures $33.58 and $651.50 from
CBP's July notice, and HMF, 0.125 percent on vessel cargo, statutory and uncapped. We compute
them on the entry, not the line, because the clamp cannot be expressed per line; the floor
actually fires on four of our six samples. Those figures roll on October 1 with the FY2027
notice, and the config says so.

**"Why does the shrimp shipment need so much paperwork?"**
Three regimes stack on frozen shrimp. FDA Prior Notice before arrival, under the Bioterrorism
Act. FSVP, where seafood is the interesting case: a HACCP-compliant supplier makes the importer
exempt, filed as an affirmation, and our table encodes exactly that fork. And NOAA's Seafood
Import Monitoring Program: shrimp has been covered since the end of 2018, the importer of
record holds the trade permit, and the catch data go in the ACE entry itself, with two years
of chain-of-custody records behind them.

**"Why did the hex bolt NOT trigger antidumping?"**
Because no general AD/CVD order on steel fasteners from China exists; the 2009 petition died
at the ITC unanimously. Threaded rod is covered by two active orders, plain hex bolts are not,
and lock washers were revoked in 2022. Scope is the written product description, not the HTS
number, so the engine runs a scope check and disclaims when the description says hex bolt.
Getting this wrong in the cautious direction is how brokers waste money; we encode the real
boundary.

**"The toy line?"**
Children's product, so CPSIA section 14: the importer certifies based on third-party testing
at a CPSC-accepted lab against ASTM F963. And as of July 8 this year the certificate is
electronic and filed at entry through ACE. That rule is seven weeks old and our table already
says so.

**"Why do the FCC and DOE items never block a shipment?"**
Because neither is an entry document, and flagging them as blockers would be wrong. The FCC
entry form died in 2017; declarations are records you produce on request, and a WiFi radio
needs certification rather than just a declaration. DOE efficiency certification is filed in
the department's system before you distribute, not at the border. The engine lists them as
records to have and only hard statutory requirements force review.

**"What is a PGA? LPCO?"** (jargon check, answer in one breath)
Partner Government Agency: FDA, NOAA, CPSC, the agencies that regulate the goods beyond
customs duty. LPCO: the licenses, permits, certificates and other documents those agencies
expect. The engine flags the agencies per tariff prefix and builds the document checklist.

**"Are these agency rules real or did you make them up?"**
Both real and cited. Every rule in the table carries the regulation it rests on, verified this
morning: eCFR sections, Federal Register documents, NOAA's own compliance guide. What we do
not claim is coverage: eleven rules spanning our samples, not the full agency tables. A real
deployment ports the rest the same way, source by source.

**"Tariff rates change constantly right now. How do you keep up?"**
The rates are read, never typed. One script rebuilds every table from a fresh USITC export and
walks the heading hierarchy, which is the part everyone gets wrong because rates live on
ancestor rows. New revision, re-run, diff, done. Our own swap caught a wrong placeholder rate
and two invalid statistical suffixes the moment real data went in.

**"Could a broker rely on this legally?"**
No, and it never pretends otherwise. The engine proposes with a confidence and a trace; a
licensed broker decides, and the system never files anything. That split is also the liability
answer: the tool narrows each decision to one question, the human owns the decision.

---

## Trap questions

**"What happens when the model hallucinates?"**
It structurally cannot touch a decision. The code, the rate, the flags come from the engine
output; the only write path for a change is the reclassify tool, which appends to an audit
trail. A hallucination is a badly worded memo over a correct JSON, and the clerk reviews memos
anyway.

**"What if someone poisons the memory?"**
Every precedent requires a reason and is append-only; nothing is ever edited or deleted, a
wrong one is superseded by a new correction, so the audit trail survives. And a fuzzy match
cannot act on its own: below 0.90 similarity a precedent only suggests, a human confirms. To
poison the memory you need to be the human whose job it is to make these calls, and your name
is on the record.

**"Prompt injection through a malicious invoice?"**
The agent cannot reach the network, cannot write outside memos and decisions, and cannot
change a code without the human path. Worst case is a weird memo, which is exactly the
artifact a human already reviews. #2 can show you the kernel side of that answer.

**"Why is your READY shipment listing missing documents?"**
Deliberate. READY means the classification needs no human judgment. Documents are a chase
list, and only a hard statutory requirement blocks. The alternative, blocking on every
record-on-request, would bury the clerk in false alarms, which is the disease this desk
already has.

**"Why keyword matching in 2026? Why not embeddings?"**
For deciding, determinism beats cleverness: same input, same output, full trace, auditable by
a regulator. Embeddings are the right upgrade for the memory retrieval, and it is on the
roadmap; the two-tier bind rule was designed so a better retriever drops in without changing
the trust model.

**"Is your demo data real?"**
The tariff corpus is entirely real and public: USITC schedule, Chapter 99 headings, CBP fee
notice, agency regulations. The six shipments are synthetic on purpose, because using a real
broker's pricing without consent is exactly the thing this product exists to prevent. Same
argument, both directions.

**"What would production take?"**
Three things, honestly: the full agency tables ported the way we did these eleven, curated
keywords or a retriever over the full 19,856-line schedule for classification, and ACE filing
integration, which we deliberately did not build. The rates layer is already production-shaped
because it is already the full real schedule.

---

## Hand-off map

| Question smells like | Who answers |
|---|---|
| GPU, model serving, NemoClaw, "what hardware is this" | #1 |
| OpenShell internals, seccomp, the blocked curl, pitch narrative | #2 |
| Jaccard, similarity numbers, teardown mechanics | #4, you back them up on the two-tier rule |
| Cron, agent prompt, "how does the model get invoked" | #5 |
| Console, SSE, BuilderBase submission | #6 |
| Anything with an HTS number, a rate, a fee, an agency, a document | **you** |

If a judge asks the team and nobody moves in two seconds, you take it; a beat of dead air
costs more than an imperfect owner.
