// A/B the retrieval strategies on lane 4's own corpus.
// CASES mirrors lanes/4-memory/eval_retrieval.mjs (keep in sync).
import { retrieveJaccard, retrieveVector, retrieveHybrid, close } from "./retrieve.mjs";
import { embed } from "./embed.mjs";
import { PRECEDENT_FLOOR, PRECEDENT_BIND } from "./db.mjs";

const CASES = [
  { text: "LED night light lamp, USB rechargeable, portable", expect: "fire", note: "identical" },
  { text: "portable USB rechargeable LED night light lamp", expect: "fire", note: "word order only" },
  { text: "LED night lights, USB rechargeable, portable", expect: "fire", note: "plural" },
  { text: "Portable LED Night-Light Lamp (USB Rechargeable)", expect: "fire", note: "punctuation and case" },
  { text: "USB rechargeable portable LED lamp for bedside use", expect: "fire", note: "adds a use phrase" },
  { text: "Rechargeable LED lamp, portable, USB powered", expect: "fire", note: "powered vs rechargeable" },
  { text: "LED lamp night light, rechargeable via USB, 3 pack", expect: "fire", note: "adds packaging" },
  { text: "LED ceiling light fitting, mains powered", expect: "either", note: "code right, words wrong" },
  { text: "portable lamp, rechargeable", expect: "either", note: "half the tokens gone" },
  { text: "LED lamp", expect: "either", note: "minimal description, the common invoice case" },
  { text: "Portable USB rechargeable LED reading light lamp", expect: "suggest", note: "KNOWN FALSE POSITIVE" },
  { text: "Cast iron pump casing for centrifugal liquid pump, without engine", expect: "nofire", note: "unrelated" },
  { text: "Frozen peeled shrimp, 16/20 count, 2 kg bags", expect: "nofire", note: "unrelated" },
  { text: "USB wall charger, 20W, power adapter", expect: "nofire", note: "shares USB" },
  { text: "Rechargeable lithium battery pack, portable", expect: "nofire", note: "shares 2 tokens" },
  { text: "Cotton knit sweater, women's, long sleeve", expect: "nofire", note: "unrelated" },
];

const vecs = await embed(CASES.map((c) => c.text));
const rows = [];
for (let i = 0; i < CASES.length; i++) {
  const c = CASES[i];
  rows.push({
    ...c,
    j: (await retrieveJaccard(c.text))?.similarity ?? 0,
    v: (await retrieveVector(c.text, vecs[i]))?.similarity ?? 0,
    h: (await retrieveHybrid(c.text, vecs[i]))?.similarity ?? 0,
  });
}

// Calibrated on this corpus. Cosine similarities sit in a much higher, narrower band than
// Jaccard, so the engine's 0.55 floor is far too loose for them: it would fire on a USB wall
// charger. These bars are the measured separation, not a guess.
const COS_FLOOR = 0.75, COS_BIND = 0.90;
const band = (s, floor, bind) => (s >= bind ? "BIND" : s >= floor ? "sugg" : "  - ");
console.log(`\njaccard bars: floor ${PRECEDENT_FLOOR} bind ${PRECEDENT_BIND}    cosine bars: floor ${COS_FLOOR} bind ${COS_BIND}\n`);
console.log("  jac   band   cos    band   expect    description");
for (const r of rows) {
  console.log(
    `  ${r.j.toFixed(3)} ${band(r.j, PRECEDENT_FLOOR, PRECEDENT_BIND)}   ${r.v.toFixed(3)} ${band(r.v, COS_FLOOR, COS_BIND)}   ${r.expect.padEnd(8)}  ${r.text.slice(0, 52)}`
  );
}

// Where would the cosine bars have to sit to keep the corpus honest?
const fires = rows.filter((r) => r.expect === "fire");
const nofire = rows.filter((r) => r.expect === "nofire");
const fp = rows.find((r) => r.expect === "suggest");
console.log(`\ncosine separation:`);
console.log(`  lowest  true paraphrase (must fire)   ${Math.min(...fires.map((r) => r.v)).toFixed(3)}`);
console.log(`  highest unrelated      (must not)     ${Math.max(...nofire.map((r) => r.v)).toFixed(3)}`);
console.log(`  known false positive   (must not bind) ${fp.v.toFixed(3)}`);
console.log(`  => a cosine FLOOR anywhere in (${Math.max(...nofire.map((r) => r.v)).toFixed(3)}, ${Math.min(...fires.map((r) => r.v)).toFixed(3)}) separates signal from noise`);
console.log(`  => a cosine BIND bar must sit above ${fp.v.toFixed(3)} to keep the false positive out`);

const jb = rows.filter(r=>r.expect==="fire" && r.j>=PRECEDENT_BIND).length;
const cb = rows.filter(r=>r.expect==="fire" && r.v>=COS_BIND).length;
const jf = rows.filter(r=>r.expect==="fire" && r.j>=PRECEDENT_FLOOR).length;
const cf = rows.filter(r=>r.expect==="fire" && r.v>=COS_FLOOR).length;
const jbad = rows.filter(r=>r.expect==="nofire" && r.j>=PRECEDENT_FLOOR).length;
const cbad = rows.filter(r=>r.expect==="nofire" && r.v>=COS_FLOOR).length;
const n = rows.filter(r=>r.expect==="fire").length;
console.log(`\nverdict`);
console.log(`  true paraphrases that FIRE   jaccard ${jf}/${n}   cosine ${cf}/${n}`);
console.log(`  true paraphrases that BIND   jaccard ${jb}/${n}   cosine ${cb}/${n}`);
console.log(`  unrelated lines that fire    jaccard ${jbad}      cosine ${cbad}   (must be 0)`);
console.log(`  false positive binds?        jaccard ${fp.j>=PRECEDENT_BIND?"YES":"no"}      cosine ${fp.v>=COS_BIND?"YES":"no"}`);
console.log(`  bind margin over the FP      cosine ${(rows.filter(r=>r.expect==="fire"&&r.v>=COS_BIND).reduce((m,r)=>Math.min(m,r.v),1) - fp.v).toFixed(3)}  (thin: watch this)`);
await close();
