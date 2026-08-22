#!/usr/bin/env node
/**
 * Classify a line description against the FULL USITC schedule in MongoDB.
 *
 *   node mongo/classify.mjs "cast iron pump casing for centrifugal liquid pump"
 *   node mongo/classify.mjs --samples          # every line in engine/samples/
 *
 * engine/triage.mjs scores keywords against the 16 curated rows of hts_subset.csv.
 * This searches all 19,856 ten-digit lines with $rankFusion: a lexical $search pipeline
 * and a semantic $vectorSearch pipeline, fused by reciprocal rank.
 *
 * This PROPOSES candidates. It does not decide. The engine still decides and a licensed
 * broker still rules: nothing here writes an hts field.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, HTS, close } from "./db.mjs";
import { embed } from "./embed.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

export async function classify(description, limit = 3) {
  const d = await db();
  const qv = await embed(description);
  return d.collection(HTS).aggregate([
    { $rankFusion: {
        input: { pipelines: {
          lexical: [{ $search: { index: "text_idx", text: { query: description, path: "description" } } }, { $limit: 50 }],
          semantic: [{ $vectorSearch: { index: "vector_idx", path: "embedding", queryVector: qv, numCandidates: 400, limit: 50 } }],
        } },
        combination: { weights: { lexical: 1, semantic: 1 } },
    } },
    { $limit: limit },
    { $project: { _id: 0, hts: 1, description: 1, mfn_rate: 1, rrf: { $meta: "score" } } },
  ]).toArray();
}

const args = process.argv.slice(2);
let queries = [];
if (args.includes("--samples")) {
  const dir = path.join(here, "..", "..", "..", "engine", "samples");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const s = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    for (const l of s.lines || []) queries.push({ src: `${s.shipment_id} L${l.line}`, text: l.description, declared: l.hts_declared || "" });
  }
} else if (args.length) {
  queries = [{ src: "query", text: args.join(" "), declared: "" }];
} else {
  console.error('usage: node mongo/classify.mjs "<description>" | --samples');
  process.exit(2);
}

for (const q of queries) {
  const hits = await classify(q.text);
  console.log(`\n${q.src}: "${q.text}"${q.declared ? `   [declared ${q.declared}]` : ""}`);
  for (const h of hits) {
    console.log(`   ${h.hts}  mfn ${(h.mfn_rate * 100).toFixed(1).padStart(5)}%  ${h.description.slice(0, 96)}`);
  }
}
await close();
