// Import an existing precedents.jsonl into MongoDB, embedding each description.
// usage: node mongo/migrate.mjs <precedents.jsonl>
import fs from "node:fs";
import { db, PRECEDENTS, EMBED_MODEL, close } from "./db.mjs";
import { embed } from "./embed.mjs";

const src = process.argv[2];
if (!src) { console.error("usage: node mongo/migrate.mjs <precedents.jsonl>"); process.exit(2); }

const rows = fs.readFileSync(src, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
if (!rows.length) { console.error("empty store"); process.exit(2); }

const vecs = await embed(rows.map((r) => r.description));
const d = await db();
const coll = d.collection(PRECEDENTS);

let inserted = 0;
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  if (await coll.findOne({ sig: r.sig, hts: r.hts, at: new Date(r.at) })) continue;
  await coll.insertOne({
    sig: r.sig, description: r.description, hts: r.hts,
    reason: r.reason || "", by: r.by || "broker",
    shipment_id: r.shipment_id || "", line: Number.isInteger(r.line) ? r.line : parseInt(r.line, 10) || 1,
    at: new Date(r.at), supersedes: null,
    embedding: vecs[i], embedding_model: EMBED_MODEL,
  });
  inserted++;
}
console.log(`migrated ${inserted} precedent(s); collection now holds ${await coll.countDocuments()}`);
await close();
