#!/usr/bin/env node
/**
 * Load the FULL tariff schedule into the MongoDB tariff collection.
 *
 * Source: engine/data/hts_full.csv (19,856 ten-digit lines built from the committed USITC
 * 2026 rev 7 export by scripts/build_hts_from_usitc.mjs, indent-inheritance already
 * walked, rates real). The engine consults this collection in exactly one place: when a
 * broker precedent names a code outside the 16-row curated subset, so the memory is no
 * longer limited to the curated codes. Rebuild any time; like the precedent index, this
 * collection is derived and disposable. Never hand-edit a rate here; fix the CSV build.
 *
 * Usage:
 *   MONGO_URI=... node scripts/mongo_load_tariff.mjs [--csv <file>]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mongoEnabled, dbName, runEval } from "../engine/mongo_precedents.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const csvPath = opt("--csv", path.join(here, "..", "engine", "data", "hts_full.csv"));

if (!mongoEnabled()) {
  console.error("[mongo_load_tariff] MONGO_URI is not set; there is nothing to load into.");
  process.exit(2);
}

// Same minimal RFC-4180-ish parser as engine/triage.mjs (deliberately duplicated there
// and in the engine; triage.mjs is a script whose import would run its CLI).
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQ = false;
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift().map((h) => h.trim());
  return rows.filter((r) => r.length > 1 && r.some((x) => x.trim() !== ""))
             .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}

const docs = parseCSV(fs.readFileSync(csvPath, "utf8")).map((r) => ({
  hts: r.hts,
  hts_digits: r.hts.replace(/\D/g, ""),
  description: r.description,
  mfn_rate: Number(r.mfn_rate) || 0,
  unit: r.unit || "",
  rate_text: r.rate_text || "",
  ch99: r.ch99 || "",
  rate_note: r.rate_note || "",
}));

const script = [
  `const col = db.getSiblingDB(${JSON.stringify(dbName())}).tariff;`,
  `col.drop();`,
  `const docs = ${JSON.stringify(docs)};`,
  `if (docs.length) col.insertMany(docs, { ordered: false });`,
  `col.createIndex({ hts_digits: 1 }, { unique: true });`,
  `print(JSON.stringify({ loaded: col.countDocuments() }));`,
].join("\n");
const tmp = path.join(os.tmpdir(), `sd-mongo-tariff-${process.pid}.js`);
fs.writeFileSync(tmp, script);
try {
  const { loaded } = runEval(tmp, { file: true, timeoutMs: 180000 });
  if (loaded !== docs.length) {
    console.error(`[mongo_load_tariff] loaded ${loaded} docs but the CSV has ${docs.length} rows; the load is incomplete.`);
    process.exit(1);
  }
  console.log(JSON.stringify({ loaded, db: dbName(), collection: "tariff", csv: csvPath }, null, 2));
} finally {
  fs.unlinkSync(tmp);
}
