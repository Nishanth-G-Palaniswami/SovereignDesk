#!/usr/bin/env node
/**
 * Load the real USITC tariff schedule into MongoDB, embedded and indexed.
 *
 *   node mongo/load_hts.mjs [--limit N] [--batch N]
 *
 * Reads engine/data/hts_full.csv, which scripts/build_hts_from_usitc.mjs already resolved
 * from the USITC 2026 rev 7 export: each 10-digit line carries the joined ancestor heading
 * text, the inherited MFN rate and its Chapter 99 references. A 10-digit row read on its own
 * is usually a fragment ("Males"), which is why the joined description is the thing to embed.
 *
 * Why this matters: engine/triage.mjs scores keywords against the 16 curated rows of
 * hts_subset.csv. This is the whole schedule, 19,857 lines, retrievable.
 *
 * Resumable: re-running skips lines already present.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { db, HTS, EMBED_MODEL, close } from "./db.mjs";
import { embed } from "./embed.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const CSV = path.join(here, "..", "..", "..", "engine", "data", "hts_full.csv");
const opt = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 ? Number(process.argv[i + 1]) : d; };
const LIMIT = opt("--limit", Infinity);
const BATCH = opt("--batch", 256);

function parseCSV(text) {
  const rows = []; let row = [], field = "", inQ = false;
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
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Text comes from the USITC export, not from the CSV: hts_full.csv caps the joined
// description at 220 chars and puts the leaf LAST, so the cap eats the distinguishing
// words. Rates/units still come from the CSV, which resolved them by walking the hierarchy.
const USITC = path.join(here, "..", "..", "..", "engine", "data", "usitc", "hts_2026_rev_7.json");
const clean = (s) => String(s || "").trim().replace(/\s*:\s*$/, "").replace(/\s+/g, " ");
const isNoise = (s) => !s || /^other$/i.test(s) || /^n\.?e\.?s\.?o\.?i\.?$/i.test(s);
const TEXT = new Map();
{
  // NB: `superior` is a boolean flag encoded as the string "true", not descriptive text.
  const stack = [];
  for (const r of JSON.parse(fs.readFileSync(USITC, "utf8"))) {
    const indent = parseInt(r.indent ?? "0", 10) || 0;
    stack[indent] = r; stack.length = indent + 1;
    const h = clean(r.htsno);
    if (!/^\d{4}\.\d{2}\.\d{2}\.\d{2}$/.test(h)) continue;
    const segs = [];
    for (const anc of stack) {
      const d = anc && clean(anc.description);
      if (d && !segs.includes(d)) segs.push(d);
    }
    const meaningful = segs.filter((x) => !isNoise(x));
    TEXT.set(h, {
      description: segs.join(", "),
      search_text: (meaningful.length ? [...meaningful].reverse() : [...segs].reverse()).join(", "),
    });
  }
}
console.log(`resolved text for ${TEXT.size} lines from the USITC export`);

const raw = parseCSV(fs.readFileSync(CSV, "utf8"));
const header = raw.shift();
const col = Object.fromEntries(header.map((h, i) => [h.trim(), i]));
const all = raw
  .filter((r) => r[col.hts] && /^\d{4}\.\d{2}\.\d{2}\.\d{2}$/.test(r[col.hts].trim()))
  .map((r) => ({
    hts: r[col.hts].trim(),
    description: TEXT.get(r[col.hts].trim())?.description || (r[col.description] || "").trim(),
    search_text: TEXT.get(r[col.hts].trim())?.search_text || (r[col.description] || "").trim(),
    mfn_rate: Number(r[col.mfn_rate]) || 0,
    unit: (r[col.unit] || "X").trim(),
    rate_text: (r[col.rate_text] || "").trim(),
    ch99: (r[col.ch99] || "").split(/[;\s]+/).filter(Boolean),
  }));

const d = await db();
const coll = d.collection(HTS);
const have = new Set((await coll.distinct("hts")).map(String));
const todo = all.filter((r) => !have.has(r.hts)).slice(0, LIMIT);

console.log(`${all.length} lines in ${path.basename(CSV)}; ${have.size} already loaded; ${todo.length} to do`);
if (!todo.length) { console.log("nothing to do"); await close(); process.exit(0); }

const t0 = Date.now();
let done = 0;
for (let i = 0; i < todo.length; i += BATCH) {
  const slice = todo.slice(i, i + BATCH);
  const vecs = await embed(slice.map((r) => r.search_text));
  await coll.insertMany(
    slice.map((r, k) => ({ ...r, embedding: vecs[k], embedding_model: EMBED_MODEL })),
    { ordered: false }
  );
  done += slice.length;
  const rate = done / ((Date.now() - t0) / 1000);
  const eta = Math.round((todo.length - done) / rate);
  process.stdout.write(`\r  ${done}/${todo.length}  ${rate.toFixed(0)}/s  eta ${eta}s   `);
}
console.log(`\nloaded ${done} in ${Math.round((Date.now() - t0) / 1000)}s; collection holds ${await coll.countDocuments()}`);
await close();
