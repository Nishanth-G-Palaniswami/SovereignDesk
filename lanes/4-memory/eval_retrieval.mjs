#!/usr/bin/env node
/**
 * eval_retrieval.mjs, does the precedent memory actually generalise?
 *
 *   node lanes/4-memory/eval_retrieval.mjs
 *   node lanes/4-memory/eval_retrieval.mjs --verbose
 *
 * The claim the whole entry rests on is "the broker corrects it once and it never
 * forgets". That claim is only true if retrieval survives REWORDING. An exact string
 * match would be worthless: no two commercial invoices describe the same goods with the
 * same words. This harness measures how much rewording the matcher tolerates before it
 * stops firing, and how much unrelated text it tolerates before it fires when it should
 * not.
 *
 * Exits non-zero on any failed case, so lane 5 can wire it into the pre-merge check.
 *
 * Retrieval, as implemented in engine/triage.mjs:
 *   signature(d) = unique tokens, stopworded, crudely stemmed, sorted, space joined
 *   score        = Jaccard over those token sets, or exactly 1 when the sigs are equal
 *   fires when   score >= PRECEDENT_FLOOR (0.55)
 *   confidence   = min(0.99, 0.75 + score * 0.2)
 *
 * The tokenizer is duplicated here on purpose, matching what record_precedent.mjs already
 * does. If you change the tokenizer in engine/triage.mjs you must change it in all three
 * files in the same commit, and this harness is what will tell you that you forgot.
 */

const VERBOSE = process.argv.includes("--verbose");

// ---- keep in sync with engine/triage.mjs and engine/record_precedent.mjs ----
const STOP = new Set(["the","a","an","of","for","and","or","with","in","to","by","on","at","from","other","nesoi","n.e.s.o.i","x","pcs","pc","each","set","sets"]);
function tokenize(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9%.\s-]/g, " ").split(/\s+/)
    .map((t) => t.replace(/^[-.]+|[-.]+$/g, ""))
    .filter((t) => t && !STOP.has(t))
    .map((t) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t));
}
const signature = (d) => [...new Set(tokenize(d))].sort().join(" ");
function jaccard(a, b) {
  const A = new Set(a.split(" ").filter(Boolean)), B = new Set(b.split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
const PRECEDENT_FLOOR = 0.55;
const PRECEDENT_BIND = 0.90;   // engine/triage.mjs: below this a match SUGGESTS, only >= binds
const confidenceFor = (sim) => Math.round(Math.min(0.99, 0.75 + sim * 0.2) * 100) / 100;

// ---------------------------------------------------------------- test corpus

/**
 * The recorded precedent. This is the exact line description the broker reclassified in
 * sample 003, so the signature here is the one really sitting in precedents.jsonl.
 */
const RECORDED = "LED night light lamp, USB rechargeable, portable";

/**
 * expect: "fire"    a clerk would call this the same product, retrieval must fire
 *         "nofire"  a different product, retrieval must NOT fire
 *         "either"  genuinely borderline, recorded for information, never fails the run
 */
const CASES = [
  // identical and trivially reworded
  { text: "LED night light lamp, USB rechargeable, portable", expect: "fire", note: "identical" },
  { text: "portable USB rechargeable LED night light lamp", expect: "fire", note: "word order only" },
  { text: "LED night lights, USB rechargeable, portable", expect: "fire", note: "plural, tests the stemmer" },
  { text: "Portable LED Night-Light Lamp (USB Rechargeable)", expect: "fire", note: "punctuation and case" },

  // realistic invoice rewordings, the cases that actually matter
  { text: "USB rechargeable portable LED lamp for bedside use", expect: "fire", note: "adds a use phrase" },
  { text: "Rechargeable LED lamp, portable, USB powered", expect: "fire", note: "powered vs rechargeable" },
  { text: "LED lamp night light, rechargeable via USB, 3 pack", expect: "fire", note: "adds packaging" },

  // drift, where a human would start to hesitate
  { text: "LED ceiling light fitting, mains powered", expect: "either", note: "the code is right, the words are not" },
  { text: "portable lamp, rechargeable", expect: "either", note: "half the tokens gone" },
  { text: "LED lamp", expect: "either", note: "minimal description, the common invoice case" },

  // must not BIND (the two-tier rule exists because of this exact line)
  { text: "Portable USB rechargeable LED reading light lamp", expect: "suggest", note: "a reading lamp is not a ceiling fixture. 0.75: surfaced to a human, never auto-applied" },
  { text: "Cast iron pump casing for centrifugal liquid pump, without engine", expect: "nofire", note: "unrelated, sample 001" },
  { text: "Frozen peeled shrimp, 16/20 count, 2 kg bags", expect: "nofire", note: "unrelated, sample 002" },
  { text: "USB wall charger, 20W, power adapter", expect: "nofire", note: "shares USB, different heading" },
  { text: "Rechargeable lithium battery pack, portable", expect: "nofire", note: "shares rechargeable and portable" },
  { text: "Cotton knit sweater, women's, long sleeve", expect: "nofire", note: "unrelated, sample 005 adjacent" },
];

// ---------------------------------------------------------------- run

const recordedSig = signature(RECORDED);
console.log(`recorded precedent : "${RECORDED}"`);
console.log(`signature          : ${recordedSig}`);
console.log(`floor              : ${PRECEDENT_FLOOR}\n`);

const rows = CASES.map((c) => {
  const sig = signature(c.text);
  const sim = sig === recordedSig ? 1 : Math.round(jaccard(sig, recordedSig) * 1000) / 1000;
  const fires = sim >= PRECEDENT_FLOOR;
  const binds = sim >= PRECEDENT_BIND;
  let ok;
  if (c.expect === "either") ok = true;
  else if (c.expect === "suggest") ok = fires && !binds;   // must surface, must NOT auto-apply
  else if (c.expect === "fire") ok = fires;
  else ok = !fires;
  return { ...c, sig, sim, fires, binds, ok };
});

const w = Math.max(...rows.map((r) => r.text.length));
for (const r of rows) {
  const mark = r.expect === "either" ? "·" : r.ok ? "ok  " : "FAIL";
  const verdict = r.binds ? `BINDS  conf ${confidenceFor(r.sim)}` : r.fires ? "suggests       " : "no fire";
  console.log(`${mark} ${String(r.sim).padEnd(5)} ${verdict.padEnd(16)} ${r.text.padEnd(w)}  ${r.note}`);
  if (VERBOSE) console.log(`      sig: ${r.sig}`);
}

const failures = rows.filter((r) => !r.ok);
const borderline = rows.filter((r) => r.expect === "either");

console.log(`\n${rows.length - borderline.length} asserted cases, ${failures.length} failed, ${borderline.length} borderline (never fail the run)`);

// The number lane 4 has to be able to say out loud when a judge asks how it generalises.
const firing = rows.filter((r) => r.expect === "fire");
const margin = Math.min(...firing.map((r) => r.sim)) - PRECEDENT_FLOOR;
console.log(`tightest passing margin above the floor: ${Math.round(margin * 1000) / 1000}`);
if (margin < 0.05) {
  console.log("WARNING: a real invoice reworded slightly further than these cases stops matching.");
  console.log("         Do NOT fix this by lowering PRECEDENT_FLOOR. The floor is simultaneously");
  console.log("         too tight for paraphrase and too loose for neighbouring products: see the");
  console.log("         known false positive below, which already fires at 0.75.");
}

const nearMiss = rows.filter((r) => r.expect === "nofire").sort((a, b) => b.sim - a.sim)[0];
if (nearMiss) {
  console.log(`closest ASSERTED non-match: ${nearMiss.sim} on "${nearMiss.text}"`);
  console.log(`  Headroom against that one is ${Math.round((PRECEDENT_FLOOR - nearMiss.sim) * 1000) / 1000}, but do not read it as safety margin:`);
  console.log(`  it is the worst case in THIS corpus, not the worst case that exists.`);
}

// ---------------------------------------------------------------- the two-tier guarantee
//
// The reading-lamp case is why PRECEDENT_BIND exists: at 0.75 it used to be silently
// promoted to READY against the precedent's own reason. It must now surface as a
// suggestion and never bind. If any "suggest" or "nofire" case ever reaches BIND, a
// change loosened auto-apply and this run fails.
const wrongBinds = rows.filter((r) => (r.expect === "suggest" || r.expect === "nofire") && r.binds);
if (wrongBinds.length) {
  console.log(`
FAILED: ${wrongBinds.length} case(s) reached the ${PRECEDENT_BIND} bind bar that must not:`);
  for (const f of wrongBinds) console.log(`  ${f.sim} "${f.text}"`);
  process.exit(1);
}
console.log(`
two-tier rule holds: nothing below ${PRECEDENT_BIND} auto-applies; the 0.75 reading-lamp case suggests only.`);

if (failures.length) {
  console.log("\nfailed cases:");
  for (const f of failures) console.log(`  expected ${f.expect}, got ${f.fires ? "fire" : "no fire"} at ${f.sim}: "${f.text}"`);
  process.exit(1);
}
