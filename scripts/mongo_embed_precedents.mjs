#!/usr/bin/env node
/**
 * Add embeddings and a vector index to the precedent index, so MEMORY_RETRIEVAL=hybrid works.
 *
 *   MONGO_URI=... node scripts/mongo_embed_precedents.mjs
 *
 * Idempotent: documents that already carry an embedding are skipped. Zero npm dependencies,
 * same as the rest of the engine: mongosh for the database, engine/embed_once.mjs for the
 * vectors, both via execFileSync.
 *
 * precedents.jsonl remains the source of truth. This only enriches the derived index.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mongoEnabled, dbName, runEval } from "../engine/mongo_precedents.mjs";

if (!mongoEnabled()) { console.error("MONGO_URI is not set"); process.exit(2); }
const here = path.dirname(fileURLToPath(import.meta.url));
const helper = path.join(here, "..", "engine", "embed_once.mjs");
const DIM = 768;

const embed = (t) => JSON.parse(execFileSync(process.execPath, [helper, t], { encoding: "utf8", timeout: 20000 }));

const { docs } = runEval(
  `const c = db.getSiblingDB(${JSON.stringify(dbName())}).precedents;` +
  `print(JSON.stringify({ docs: c.find({ embedding: { $exists: false } }, { description: 1 }).toArray() }));`
);
console.log(`${docs.length} precedent(s) need an embedding`);

for (const d of docs) {
  const v = embed(d.description);
  if (v.length !== DIM) { console.error(`embedding is ${v.length}d, the index expects ${DIM}d`); process.exit(3); }
  const tmp = path.join(os.tmpdir(), `sd-emb-${process.pid}-${Math.random().toString(36).slice(2)}.js`);
  fs.writeFileSync(tmp,
    `const c = db.getSiblingDB(${JSON.stringify(dbName())}).precedents;` +
    `const r = c.updateOne({ _id: ObjectId(${JSON.stringify(String(d._id.$oid || d._id))}) }, { $set: { embedding: ${JSON.stringify(v)}, embedding_model: ${JSON.stringify(process.env.EMBED_MODEL || "nomic-embed-text")} } });` +
    `print(JSON.stringify({ n: r.modifiedCount }));`);
  try { runEval(tmp, { file: true }); console.log(`  embedded: ${String(d.description).slice(0, 60)}`); }
  finally { fs.rmSync(tmp, { force: true }); }
}

// The vector index is what $vectorSearch reads. Creating it twice is harmless.
const idx = runEval(
  `const c = db.getSiblingDB(${JSON.stringify(dbName())}).precedents;` +
  `const have = c.getSearchIndexes().map(i => i.name);` +
  `let made = false;` +
  `if (!have.includes("vector_idx")) { c.createSearchIndex({ name: "vector_idx", type: "vectorSearch", definition: { fields: [{ type: "vector", path: "embedding", numDimensions: ${DIM}, similarity: "cosine" }] } }); made = true; }` +
  `print(JSON.stringify({ made, have }));`
);
console.log(idx.made ? "vector_idx created" : `vector_idx already present (${idx.have.join(", ")})`);
console.log("\nmongot indexes lag writes. Confirm retrieval returns the new precedent BEFORE demoing.");
