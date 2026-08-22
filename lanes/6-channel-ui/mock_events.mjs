/**
 * mock_events.mjs, a scripted replay of the demo beat for console development.
 *
 * WHY THIS EXISTS. The console has to be buildable and rehearsable without the box, the
 * sandbox, the agent or the model. This file fires the whole shipment lifecycle on a timer
 * so index.html can be developed against it, and so the demo can be replayed on demand
 * between rehearsals.
 *
 * WHAT IT IS NOT. It is not a second source of truth. Every figure below was produced by
 * running the real engine and pasted back:
 *
 *   node engine/triage.mjs engine/samples/shipment_006_precedent_test.json --pretty
 *   node engine/triage.mjs engine/samples/shipment_006_precedent_test.json \
 *     --precedents <ws>/precedents.jsonl --pretty
 *
 * The shape is the frozen contract at engine/triage.mjs:13. If the engine output and this
 * file ever disagree, this file is the one that is wrong.
 *
 * The mock writes nothing to disk. server.mjs holds these in memory and drops them on
 * POST /api/reset, so results/, decisions/ and precedents.jsonl are never touched.
 */

const ev = (type, shipment_id, payload = {}) => ({
  type,
  shipment_id,
  ts: new Date().toISOString(),
  payload,
});

// The two fee lines are identical cold and warm: MPF clamps to the FY2026 entry minimum on
// $6,300 either way, and HMF is 0.125% because the mode is ocean.
const FEES = [
  {
    name: "MPF",
    amount: 33.58,
    basis: "0.3464% of $6300, raised to the $33.58 entry minimum",
    source: "CBP Dec. 25-10, 90 FR 34665 (FY2026 COBRA adjustment, effective 2025-10-01)",
  },
  {
    name: "HMF",
    amount: 7.88,
    basis: "0.125% of $6300, mode ocean",
    source: "26 USC 4461-4462 (statutory, not inflation-adjusted)",
  },
];

const LPCO_BASE = [
  { doc: "Commercial invoice", required_by: "CBP entry", status: "ON_FILE" },
  { doc: "Packing list", required_by: "CBP entry", status: "ON_FILE" },
  { doc: "Bill of lading or air waybill, transport document", required_by: "CBP entry", status: "ON_FILE" },
  { doc: "ISF 10+2 filing confirmation, ocean shipments only", required_by: "CBP entry", status: "ON_FILE" },
  { doc: "CBP Form 7501, draft entry summary", required_by: "CBP entry", status: "ON_FILE" },
  {
    doc: "FCC SDoC compliance statement supplied with product, 47 CFR 2.1077, records on request, no CBP filing",
    required_by: "FCC Supplier's Declaration of Conformity (digital device)",
    status: "MISSING",
  },
];

const PGA_FCC = [
  {
    agency: "FCC",
    requirement_id: "FCC_SDOC",
    requirement: "Supplier's Declaration of Conformity (digital device)",
    semantic: "may",
    status: "CONFIRM",
    reason: "May-flag; no disclaim evidence in description, confirm with importer",
  },
];

const HEAD = {
  engine_version: "0.1.0",
  shipment_id: "SHP-2026-0822-006",
  importer: "Toyland Imports Corp.",
  supplier: "Guangdong Brightway Lighting Co.",
  origin_country: "CN",
  incoterm: "FOB",
  mode: "ocean",
  currency: "USD",
};

const CANDIDATES = [
  {
    hts: "8513.10.20.00",
    score: 18,
    matched: ["portable lamp", "usb lamp", "night light", "rechargeable lamp"],
    description:
      "Portable electric lamps designed to function by their own source of energy (for example, dry batteries, storage batteries, magnetos), other than lighting equipment of heading 8512; parts thereof:, Lamps:, Flashlights",
  },
  {
    hts: "9405.11.60.10",
    score: 12,
    matched: ["led lamp", "led light", "led"],
    description:
      "Luminaires and lighting fittings including searchlights and spotlights and parts thereof, not elsewhere specified or included; illuminated signs, illuminated nameplates and the like, having a permanently fixed light sour",
  },
];

/** Cold: no precedent in the store. 8513.10.20.00 at 0.60, NEEDS_REVIEW, $2,362.50. */
export const FAKE_COLD = {
  ...HEAD,
  generated_at: "2026-08-22T19:54:27.573Z",
  precedent_store: { path: "<workspace>/precedents.jsonl", entries: 0 },
  lines: [
    {
      line: 1,
      description: "USB rechargeable LED night light lamp, portable",
      qty: 1500,
      unit_value: 4.2,
      entered_value: 6300,
      hts: "8513.10.20.00",
      hts_candidates: CANDIDATES,
      confidence: 0.6,
      precedent: null,
      declared_check: null,
      pga: PGA_FCC,
      duty: {
        mfn_rate: 0.125,
        surcharges: [
          {
            name: "Section 301",
            rate: 0.25,
            basis: "prefix 8513, origin CN, per heading 9903.88.03",
            authority: "9903.88.03",
          },
        ],
        total_rate: 0.375,
        duty_est: 2362.5,
        notes: [],
      },
      lpco: LPCO_BASE,
      flags: ["LOW_CONFIDENCE", "LPCO_MISSING", "PGA_CONFIRM"],
      needs_human: true,
    },
  ],
  shipment_summary: {
    status: "NEEDS_REVIEW",
    entered_value: 6300,
    estimated_duty: 2362.5,
    effective_rate: 0.375,
    fees: FEES,
    estimated_fees: 41.46,
    estimated_total_payable: 2403.96,
    flags: ["LOW_CONFIDENCE", "LPCO_MISSING", "PGA_CONFIRM"],
    lines_needing_human: [1],
    precedents_applied: [],
    missing_documents: [
      "FCC SDoC compliance statement supplied with product, 47 CFR 2.1077, records on request, no CBP filing",
    ],
  },
  trace: [
    'L1: classify "USB rechargeable LED night light lamp, portable" -> 8513.10.20.00(18), 9405.11.60.10(12) conf=0.6',
    "L1: PGA FCC Supplier's Declaration of Conformity (digital device) -> CONFIRM (May-flag; no disclaim evidence in description, confirm with importer)",
    "L1: Section 301 lookup prefix=8513 origin=CN rate=0.25 authority=9903.88.03",
    "fees: MPF computed 21.82 applied 33.58 (0.3464% of $6300, raised to the $33.58 entry minimum)",
    "fees: HMF 7.88 on ocean shipment",
  ],
};

/**
 * Warm: the broker's precedent from SHP-2026-0822-003 matches at 1.00 and BINDS
 * (>= PRECEDENT_BIND 0.90). 9405.11.60.10 at 0.95, READY, $2,053.80.
 *
 * Note READY while still listing two missing documents. That is correct and intended:
 * READY means the classification needs no human judgment. Missing documents are a chase
 * list, and 9405 pulls a DOE requirement that 8513 did not.
 */
export const FAKE_WARM = {
  ...HEAD,
  generated_at: "2026-08-22T19:56:03.114Z",
  precedent_store: { path: "<workspace>/precedents.jsonl", entries: 1 },
  lines: [
    {
      line: 1,
      description: "USB rechargeable LED night light lamp, portable",
      qty: 1500,
      unit_value: 4.2,
      entered_value: 6300,
      hts: "9405.11.60.10",
      hts_candidates: CANDIDATES,
      confidence: 0.95,
      precedent: {
        applied: true,
        hts: "9405.11.60.10",
        reason: "Ceiling mounted, mains powered, not portable.",
        by: "broker",
        at: "2026-08-22T19:54:27.537Z",
        source_shipment: "SHP-2026-0822-003",
        similarity: 1,
        cold_hts: "8513.10.20.00",
        cold_confidence: 0.6,
        changed_outcome: true,
      },
      declared_check: null,
      pga: PGA_FCC,
      duty: {
        mfn_rate: 0.076,
        surcharges: [
          {
            name: "Section 301",
            rate: 0.25,
            basis: "prefix 9405, origin CN, per heading 9903.88.03",
            authority: "9903.88.03",
          },
        ],
        total_rate: 0.326,
        duty_est: 2053.8,
        notes: [],
      },
      lpco: [
        ...LPCO_BASE,
        {
          doc: "DOE compliance certification report, Compliance Certification Management System",
          required_by: "DOE energy conservation standards",
          status: "MISSING",
        },
      ],
      flags: ["PRECEDENT_APPLIED", "LPCO_MISSING", "PGA_CONFIRM"],
      needs_human: false,
    },
  ],
  shipment_summary: {
    status: "READY",
    entered_value: 6300,
    estimated_duty: 2053.8,
    effective_rate: 0.326,
    fees: FEES,
    estimated_fees: 41.46,
    estimated_total_payable: 2095.26,
    flags: ["PRECEDENT_APPLIED", "LPCO_MISSING", "PGA_CONFIRM"],
    lines_needing_human: [],
    precedents_applied: [{ line: 1, hts: "9405.11.60.10", changed_outcome: true, similarity: 1 }],
    missing_documents: [
      "FCC SDoC compliance statement supplied with product, 47 CFR 2.1077, records on request, no CBP filing",
      "DOE compliance certification report, Compliance Certification Management System",
    ],
  },
  trace: [
    'L1: classify "USB rechargeable LED night light lamp, portable" -> 8513.10.20.00(18), 9405.11.60.10(12) conf=0.6',
    "L1: precedent sim=1 >= 0.9 -> BIND 9405.11.60.10 (SHP-2026-0822-003, broker)",
    "L1: Section 301 lookup prefix=9405 origin=CN rate=0.25 authority=9903.88.03",
    "fees: MPF computed 21.82 applied 33.58 (0.3464% of $6300, raised to the $33.58 entry minimum)",
    "fees: HMF 7.88 on ocean shipment",
  ],
};

/**
 * The second tier, and the honest one. A reading lamp matches the same precedent at 0.75:
 * over PRECEDENT_FLOOR (0.55) but under PRECEDENT_BIND (0.90). The engine SUGGESTS it,
 * keeps its own cold classification, and forces needs_human. This used to bind silently
 * and that was the bug lane 4 found. Script 3 exists so the console's second memory state
 * can be rehearsed, because it is the one a judge is most likely to probe.
 */
export const FAKE_SUGGESTED = {
  ...HEAD,
  shipment_id: "SHP-2026-0822-099",
  generated_at: "2026-08-22T19:57:41.802Z",
  precedent_store: { path: "<workspace>/precedents.jsonl", entries: 1 },
  lines: [
    {
      line: 1,
      description: "Portable USB rechargeable LED reading light lamp",
      qty: 1500,
      unit_value: 4.2,
      entered_value: 6300,
      hts: "8513.10.20.00",
      hts_candidates: CANDIDATES,
      confidence: 0.54,
      precedent: {
        applied: false,
        hts: "9405.11.60.10",
        reason: "Ceiling mounted, mains powered, not portable.",
        by: "broker",
        at: "2026-08-22T19:54:27.537Z",
        source_shipment: "SHP-2026-0822-003",
        similarity: 0.75,
        cold_hts: "8513.10.20.00",
        cold_confidence: 0.54,
        changed_outcome: false,
      },
      declared_check: null,
      pga: PGA_FCC,
      duty: {
        mfn_rate: 0.125,
        surcharges: [
          {
            name: "Section 301",
            rate: 0.25,
            basis: "prefix 8513, origin CN, per heading 9903.88.03",
            authority: "9903.88.03",
          },
        ],
        total_rate: 0.375,
        duty_est: 2362.5,
        notes: [],
      },
      lpco: LPCO_BASE,
      flags: ["PRECEDENT_SUGGESTED", "LOW_CONFIDENCE", "LPCO_MISSING", "PGA_CONFIRM"],
      needs_human: true,
    },
  ],
  shipment_summary: {
    status: "NEEDS_REVIEW",
    entered_value: 6300,
    estimated_duty: 2362.5,
    effective_rate: 0.375,
    fees: FEES,
    estimated_fees: 41.46,
    estimated_total_payable: 2403.96,
    flags: ["PRECEDENT_SUGGESTED", "LOW_CONFIDENCE", "LPCO_MISSING", "PGA_CONFIRM"],
    lines_needing_human: [1],
    precedents_applied: [],
    missing_documents: [
      "FCC SDoC compliance statement supplied with product, 47 CFR 2.1077, records on request, no CBP filing",
    ],
  },
  trace: [
    'L1: classify "Portable USB rechargeable LED reading light lamp" -> 8513.10.20.00(14), 9405.11.60.10(12) conf=0.54',
    "L1: precedent sim=0.75 in [0.55,0.9) -> SUGGEST only, cold classification kept, needs_human forced",
    "L1: Section 301 lookup prefix=8513 origin=CN rate=0.25 authority=9903.88.03",
  ],
};

const MEMO_COLD = `SHP-2026-0822-006 | Toyland Imports Corp. | origin CN | ocean

STATUS: NEEDS_REVIEW
Entered value $6,300.00 | Estimated duty $2,362.50 | Effective rate 37.50%
Estimated fees $41.46 (MPF $33.58, HMF $7.88) | Total payable $2,403.96

Line 1: USB rechargeable LED night light lamp, portable
  HTS 8513.10.20.00 at confidence 0.60, below the 0.70 floor.
  12.5% MFN plus 25% Section 301 (heading 9903.88.03) = 37.50%.
  FCC Supplier's Declaration of Conformity: CONFIRM with importer.
  Flags: LOW_CONFIDENCE, LPCO_MISSING, PGA_CONFIRM.

No precedent in the store matched this description.

Missing documents: FCC SDoC compliance statement (47 CFR 2.1077, records on
request, no CBP filing).

NEXT ACTION: a licensed broker confirms or reclassifies line 1.`;

const MEMO_WARM = `SHP-2026-0822-006 | Toyland Imports Corp. | origin CN | ocean

STATUS: READY
Entered value $6,300.00 | Estimated duty $2,053.80 | Effective rate 32.60%
Estimated fees $41.46 (MPF $33.58, HMF $7.88) | Total payable $2,095.26

Line 1: USB rechargeable LED night light lamp, portable
  HTS 9405.11.60.10 at confidence 0.95.
  7.6% MFN plus 25% Section 301 (heading 9903.88.03) = 32.60%.
  Flags: PRECEDENT_APPLIED, LPCO_MISSING, PGA_CONFIRM.

PRECEDENT APPLIED. A broker set 9405.11.60.10 on SHP-2026-0822-003, reason:
"Ceiling mounted, mains powered, not portable." Similarity 1.00, at or above
the 0.90 binding bar. The cold engine would have said 8513.10.20.00 at
confidence 0.60. Duty falls $308.70.

Missing documents: FCC SDoC compliance statement; DOE compliance certification
report (Compliance Certification Management System).

NEXT ACTION: approve, or reclassify if the broker's earlier call does not hold.`;

const MEMO_SUGGESTED = `SHP-2026-0822-099 | Toyland Imports Corp. | origin CN | ocean

STATUS: NEEDS_REVIEW
Entered value $6,300.00 | Estimated duty $2,362.50 | Effective rate 37.50%
Estimated fees $41.46 (MPF $33.58, HMF $7.88) | Total payable $2,403.96

Line 1: Portable USB rechargeable LED reading light lamp
  HTS 8513.10.20.00 at confidence 0.54, below the 0.70 floor.
  Flags: PRECEDENT_SUGGESTED, LOW_CONFIDENCE, LPCO_MISSING, PGA_CONFIRM.

A precedent is SIMILAR but was NOT applied. A broker set 9405.11.60.10 on
SHP-2026-0822-003, reason: "Ceiling mounted, mains powered, not portable."
Similarity 0.75, under the 0.90 binding bar, so the engine kept its own pick
of 8513.10.20.00 and routed the line to a human. The two codes disagree:
engine 8513.10.20.00, precedent 9405.11.60.10.

NEXT ACTION: a broker decides which of the two codes applies.`;

/**
 * Script 1, the cold pass. Nothing in memory, the engine is unsure, a human is needed.
 * Timings are deliberately slower than the engine (which is instant) and faster than the
 * 70B memo (which is not), so the console's pacing gets rehearsed against something
 * demo-shaped rather than against either extreme.
 */
export const SCRIPT_1 = [
  [0.0, ev("shipment.new", "SHP-2026-0822-006", { filename: "shipment_006_precedent_test.json" })],
  [0.3, ev("log", "SHP-2026-0822-006", { level: "info", msg: "shipment_006_precedent_test.json landed in inbox/" })],
  [0.8, ev("log", "SHP-2026-0822-006", { level: "info", msg: "classifying 1 line against hts_subset.csv" })],
  [1.4, ev("rules.done", "SHP-2026-0822-006", FAKE_COLD)],
  [1.7, ev("log", "SHP-2026-0822-006", { level: "warn", msg: "L1 confidence 0.60 is below the 0.70 floor -> LOW_CONFIDENCE" })],
  [2.1, ev("log", "SHP-2026-0822-006", { level: "info", msg: "reading precedents.jsonl, 0 entries" })],
  [2.6, ev("memory.recalled", "SHP-2026-0822-006", { precedents: [], enabled: true })],
  [3.0, ev("log", "SHP-2026-0822-006", { level: "warn", msg: "no precedent matched. cold classification stands" })],
  [3.4, ev("log", "SHP-2026-0822-006", { level: "info", msg: "agent writing memo via inference.local" })],
  [5.2, ev("memo.ready", "SHP-2026-0822-006", { memo: MEMO_COLD })],
  [5.6, ev("review.awaiting", "SHP-2026-0822-006", { lines_needing_human: [1] })],
];

/**
 * Script 2, the warm pass, after a broker has recorded the precedent. Same input file,
 * nothing retrained. This is the beat the pitch rests on: memory.recalled arrives with a
 * binding precedent and the memory panel has to announce itself.
 */
export const SCRIPT_2 = [
  [0.0, ev("shipment.new", "SHP-2026-0822-006", { filename: "shipment_006_precedent_test.json" })],
  [0.3, ev("log", "SHP-2026-0822-006", { level: "info", msg: "same file re-swept. nothing was retrained" })],
  [1.0, ev("log", "SHP-2026-0822-006", { level: "info", msg: "reading precedents.jsonl, 1 entry" })],
  [1.6, ev("memory.recalled", "SHP-2026-0822-006", {
    precedents: [FAKE_WARM.lines[0].precedent],
    enabled: true,
  })],
  [2.0, ev("log", "SHP-2026-0822-006", { level: "good", msg: "precedent similarity 1.00 >= 0.90 -> BIND 9405.11.60.10" })],
  [2.4, ev("rules.done", "SHP-2026-0822-006", FAKE_WARM)],
  [2.8, ev("log", "SHP-2026-0822-006", { level: "good", msg: "duty $2,362.50 -> $2,053.80, swing $308.70" })],
  [3.2, ev("log", "SHP-2026-0822-006", { level: "info", msg: "agent writing memo via inference.local" })],
  [4.8, ev("memo.ready", "SHP-2026-0822-006", { memo: MEMO_WARM })],
  [5.2, ev("review.awaiting", "SHP-2026-0822-006", { lines_needing_human: [] })],
];

/** Script 3, the two-tier rule. Suggested, not applied. Rehearse this before a judge asks. */
export const SCRIPT_3 = [
  [0.0, ev("shipment.new", "SHP-2026-0822-099", { filename: "shipment_099_reading_lamp.json" })],
  [0.6, ev("log", "SHP-2026-0822-099", { level: "info", msg: "reading precedents.jsonl, 1 entry" })],
  [1.4, ev("memory.recalled", "SHP-2026-0822-099", {
    precedents: [FAKE_SUGGESTED.lines[0].precedent],
    enabled: true,
  })],
  [1.8, ev("log", "SHP-2026-0822-099", { level: "warn", msg: "similarity 0.75 is under the 0.90 bar -> SUGGEST only, human decides" })],
  [2.2, ev("rules.done", "SHP-2026-0822-099", FAKE_SUGGESTED)],
  [3.8, ev("memo.ready", "SHP-2026-0822-099", { memo: MEMO_SUGGESTED })],
  [4.2, ev("review.awaiting", "SHP-2026-0822-099", { lines_needing_human: [1] })],
];

export const SCRIPTS = { 1: SCRIPT_1, 2: SCRIPT_2, 3: SCRIPT_3 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Play a script, awaiting emit for each event. Timings in the script are absolute seconds
 * from the start, not deltas, so reordering a line does not silently rescale the rest.
 */
export async function play(script, emit) {
  let at = 0;
  for (const [when, event] of script) {
    if (when > at) await sleep((when - at) * 1000);
    at = when;
    await emit({ ...event, ts: new Date().toISOString() });
  }
}
