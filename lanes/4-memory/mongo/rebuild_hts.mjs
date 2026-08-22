#!/usr/bin/env node
/**
 * Rebuild hts_lines descriptions straight from the USITC export and re-embed.
 *
 *   node mongo/rebuild_hts.mjs [--batch N] [--limit N]
 *
 * Why: engine/data/hts_full.csv caps the joined description at 220 characters
 * (scripts/build_hts_from_usitc.mjs). The leaf text is joined LAST, so the cap deletes
 * exactly the words that distinguish one line from its neighbours. Measured on the loaded
 * collection: 8,757 of 19,856 lines (44%) hit that cap, and 1,237 groups of lines share a
 * byte-identical description.
 *
 * Two fields are written per line:
 *   description  full ancestor chain, uncapped, for display and for the audit trail
 *   search_text  what actually gets embedded and lexically indexed:
 *                  - most specific segment FIRST, so meaning leads
 *                  - bare "Other" segments dropped; they carry no signal and the USITC
 *                    schedule is full of them ("Parts:, Of pumps:, Other, Other")
 *                  - `superior` is NOT text: it is a boolean flag encoded as the string
 *                    "true" (5,912 rows, one distinct value), so it is ignored
 *                  - duplicate segments collapsed
 *
 * This does not touch engine/data/. Lane 3 owns those tables.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, HTS, EMBED_MODEL, close } from "./db.mjs";
import { embed } from "./embed.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, "..", "..", "..", "engine", "data", "usitc", "hts_2026_rev_7.json");
const opt = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const BATCH = opt("--batch", 256);
const LIMIT = opt("--limit", Infinity);

const rows = JSON.parse(fs.readFileSync(SRC, "utf8"));
const clean = (s) => String(s || "").trim().replace(/\s*:\s*$/, "").replace(/\s+/g, " ");
const isNoise = (s) => !s || /^other$/i.test(s) || /^n\.?e\.?s\.?o\.?i\.?$/i.test(s);

const stack = [];
const out = [];
for (const r of rows) {
  const indent = parseInt(r.indent ?? "0", 10) || 0;
  stack[indent] = r;
  stack.length = indent + 1;

  const hts = clean(r.htsno);
  if (!/^\d{4}\.\d{2}\.\d{2}\.\d{2}$/.test(hts)) continue;

  const segs = [];
  for (const anc of stack) {
    if (!anc) continue;
    const d = clean(anc.description);
    if (d && !segs.includes(d)) segs.push(d);
  }
  const description = segs.join(", ");
  // leaf-first, noise dropped. Fall back to the full chain if stripping leaves nothing.
  const meaningful = segs.filter((s) => !isNoise(s));
  const search_text = (meaningful.length ? [...meaningful].reverse() : [...segs].reverse()).join(", ");
  out.push({ hts, description, search_text });
}
console.log(`${out.length} ten-digit lines resolved from the USITC export`);

const d = await db();
const coll = d.collection(HTS);
const todo = out.slice(0, LIMIT);
const t0 = Date.now();
let done = 0, changed = 0;

for (let i = 0; i < todo.length; i += BATCH) {
  const slice = todo.slice(i, i + BATCH);
  const vecs = await embed(slice.map((r) => r.search_text));
  const ops = slice.map((r, k) => ({
    updateOne: {
      filter: { hts: r.hts },
      update: { $set: { description: r.description, search_text: r.search_text, embedding: vecs[k], embedding_model: EMBED_MODEL } },
    },
  }));
  const res = await coll.bulkWrite(ops, { ordered: false });
  changed += res.modifiedCount;
  done += slice.length;
  const rate = done / ((Date.now() - t0) / 1000);
  process.stdout.write(`\r  ${done}/${todo.length}  ${rate.toFixed(0)}/s  eta ${Math.round((todo.length - done) / rate)}s   `);
}
console.log(`\nrebuilt ${done}, modified ${changed} in ${Math.round((Date.now() - t0) / 1000)}s`);
const capped = await coll.countDocuments({ $expr: { $gte: [{ $strLenCP: "$description" }, 220] } });
const dup = await coll.aggregate([{ $group: { _id: "$search_text", n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $count: "groups" }]).toArray();
console.log(`descriptions at/over 220 chars: ${capped} (was capped there before)`);
console.log(`duplicate search_text groups: ${dup[0]?.groups ?? 0} (was 1237 on the capped text)`);
await close();
