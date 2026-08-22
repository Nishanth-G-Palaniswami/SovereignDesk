#!/usr/bin/env node
/**
 * Rebuild the MongoDB precedent index FROM precedents.jsonl.
 *
 * The JSONL is the append-only source of truth; the index is derived and disposable.
 * This is the reconciliation path for every drift scenario: a failed dual-write, a box
 * move, a sandbox rebuild, or an index that points at another workspace (the engine's
 * count-parity guard names this script in its error message).
 *
 * Usage:
 *   MONGO_URI=... node scripts/mongo_sync.mjs [--precedents <file>]
 *
 * Drops the collection and reinserts every valid record (same sig/hts filter the engine
 * uses) with seq = its 1-based line number among non-empty lines, so index tie-breaks
 * mirror JSONL file order exactly.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mongoEnabled, dbName, runEval } from "../engine/mongo_precedents.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const store = opt("--precedents", path.join(here, "..", "workspace", "precedents.jsonl"));

if (!mongoEnabled()) {
  console.error("[mongo_sync] MONGO_URI is not set; there is nothing to sync to.");
  process.exit(2);
}

// A missing file is a legitimate empty store (fresh workspace): the index still drops.
const lines = fs.existsSync(store)
  ? fs.readFileSync(store, "utf8").split("\n").map((l) => l.trim()).filter(Boolean)
  : [];
const docs = [];
let skipped = 0;
lines.forEach((l, i) => {
  let r = null;
  try { r = JSON.parse(l); } catch { r = null; }
  if (r && r.sig && r.hts) docs.push({ ...r, tokens: r.sig.split(" ").filter(Boolean), seq: i + 1 });
  else skipped++;
});

// Payload goes through a temp script file, never --eval: a long JSONL would not fit argv.
const script = [
  `const col = db.getSiblingDB(${JSON.stringify(dbName())}).precedents;`,
  `col.drop();`,
  `const docs = ${JSON.stringify(docs)};`,
  `if (docs.length) col.insertMany(docs);`,
  `print(JSON.stringify({ entries: col.countDocuments() }));`,
].join("\n");
const tmp = path.join(os.tmpdir(), `sd-mongo-sync-${process.pid}.js`);
fs.writeFileSync(tmp, script);
try {
  const { entries } = runEval(tmp, { file: true, timeoutMs: 60000 });
  console.log(JSON.stringify({ synced: entries, skipped, db: dbName(), collection: "precedents", store }, null, 2));
} finally {
  fs.unlinkSync(tmp);
}
