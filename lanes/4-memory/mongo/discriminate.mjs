#!/usr/bin/env node
/**
 * Does retrieval pick the RIGHT precedent when several are confusable?
 *
 *   node mongo/discriminate.mjs
 *
 * The A/B in ab.mjs answers "does it fire". This answers "does it fire on the correct one",
 * which is the question that matters once a store holds more than one ruling. Each probe
 * names the precedent a broker would expect; every strategy is scored on whether it returns
 * that one. This is where $rankFusion can beat pure vector, and where it can lose.
 */
import { retrieveJaccard, retrieveVector, retrieveHybrid, close } from "./retrieve.mjs";
import { embed } from "./embed.mjs";

const PROBES = [
  { text: "USB rechargeable LED night light lamp, portable", want: "9405.11.60.10", note: "the original ruling, verbatim" },
  { text: "LED night lights, USB rechargeable, portable", want: "9405.11.60.10", note: "night light, plural" },
  { text: "Portable LED night lamp with USB charging", want: "9405.11.60.10", note: "night light, reworded" },
  { text: "Portable USB rechargeable LED reading light lamp", want: "8513.10.20.00", note: "READING lamp, the 0.75 confusion" },
  { text: "USB rechargeable LED reading lamp, portable", want: "8513.10.20.00", note: "reading lamp, reworded" },
  { text: "Aluminium LED flashlight, battery operated", want: "8513.10.20.00", note: "flashlight" },
  { text: "Cast iron casing for centrifugal pump", want: "8413.91.90.96", note: "pump part" },
  { text: "Pump housing, cast iron, for liquid pump", want: "8413.91.90.96", note: "pump part, reworded" },
];

const vecs = await embed(PROBES.map((p) => p.text));
const rows = [];
for (let i = 0; i < PROBES.length; i++) {
  const p = PROBES[i];
  const j = await retrieveJaccard(p.text);
  const v = await retrieveVector(p.text, vecs[i]);
  const h = await retrieveHybrid(p.text, vecs[i]);
  rows.push({ ...p, j, v, h });
}

const mark = (r, want) => (r && r.hts === want ? "hit " : r ? "MISS" : "none");
console.log("\n  jaccard      vector       hybrid       probe");
for (const r of rows) {
  console.log(`  ${mark(r.j, r.want)} ${String(r.j?.hts ?? "-").slice(0, 4)}   ${mark(r.v, r.want)} ${String(r.v?.hts ?? "-").slice(0, 4)}   ${mark(r.h, r.want)} ${String(r.h?.hts ?? "-").slice(0, 4)}   ${r.text.slice(0, 46)}`);
}
const score = (k) => rows.filter((r) => r[k] && r[k].hts === r.want).length;
console.log(`\n  correct precedent chosen, out of ${rows.length}`);
console.log(`    jaccard ${score("j")}   vector ${score("v")}   hybrid ${score("h")}`);
const wrongBind = rows.filter((r) => r.v && r.v.hts !== r.want && r.v.similarity >= 0.90);
if (wrongBind.length) {
  console.log(`\n  WRONG precedent above the 0.90 bind bar (would auto-apply):`);
  for (const r of wrongBind) console.log(`    ${r.v.similarity} -> ${r.v.hts} (wanted ${r.want})  "${r.text}"`);
}
await close();
