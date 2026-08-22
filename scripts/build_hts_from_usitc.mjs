#!/usr/bin/env node
/**
 * build_hts_from_usitc.mjs: replace the placeholder tariff tables with real
 * rates taken straight from a USITC Harmonized Tariff Schedule JSON export.
 *
 *   node scripts/build_hts_from_usitc.mjs --archive <hts_YYYY_rev_N.json>
 *
 * Why this exists: engine/data/hts_subset.csv shipped with every mfn_rate
 * marked PLACEHOLDER-verify-USITC, and surcharges.json invented the Section 301
 * rates. Both are in the USITC export already:
 *
 *   - The 10-digit line carries the MFN rate in `general` ("12.5%", "Free").
 *     Rates and footnotes live on the nearest ancestor with a value, so the
 *     hierarchy has to be walked by `indent`, a 10-digit row read on its own
 *     is usually blank. That is the one thing that eats an hour if you miss it.
 *   - Section 301 membership is a footnote on the line ("See 9903.88.03."),
 *     and the Chapter 99 heading it points at states its own surcharge
 *     ("The duty provided in the applicable subheading plus 25%"). So the
 *     surcharge is read, not assumed.
 *
 * Keywords are NOT regenerated, the curated ones classify better than anything
 * derived from a description. Only rates, descriptions, units and provenance
 * are replaced.
 *
 * Writes:
 *   engine/data/hts_subset.csv     curated lines, real rates      (backed up)
 *   engine/data/surcharges.json    real 301 map                   (backed up)
 *   engine/data/hts_full.csv       every 10-digit line, real rates
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "engine", "data");

const archiveArg = process.argv.indexOf("--archive");
if (archiveArg === -1 || !process.argv[archiveArg + 1]) {
  console.error("usage: node scripts/build_hts_from_usitc.mjs --archive <path to hts_*.json>");
  console.error("       get one from hts.usitc.gov -> Export -> JSON");
  process.exit(1);
}
const ARCHIVE = process.argv[archiveArg + 1];
if (!fs.existsSync(ARCHIVE)) {
  console.error(`archive not found: ${ARCHIVE}`);
  process.exit(1);
}

// ---------------------------------------------------------------- rate parsing

/**
 * "Free" -> 0. "12.5%" -> 0.125. "4.4% + 2.5 cents/kg" -> 0.044 plus a note,
 * because the engine's duty stack is ad-valorem only. A line whose duty is
 * purely specific returns adVal 0 and a note, so the memo can say so rather
 * than silently under-computing the duty.
 */
function parseRate(text) {
  const raw = (text || "").trim();
  if (!raw) return { adVal: null, note: "" };
  if (/^free$/i.test(raw)) return { adVal: 0, note: "" };

  const pct = raw.match(/(\d+(?:\.\d+)?)\s*%/);
  const adVal = pct ? Math.round((parseFloat(pct[1]) / 100) * 1e6) / 1e6 : 0;

  // anything cents/kg, cents/liter, $/unit: specific duty the engine can't stack
  const hasSpecific = /[¢$]|cents?\/|\bper\b/i.test(raw.replace(/%/g, ""));
  const note = hasSpecific ? `specific duty component not modelled: "${raw}"` : "";

  if (!pct && !hasSpecific) return { adVal: 0, note: `unparsed rate: "${raw}"` };
  return { adVal, note };
}

/** "The duty provided in the applicable subheading plus 25%" -> 0.25 */
function parseSurcharge(text) {
  const m = (text || "").match(/(?:plus|\+)\s*(\d+(?:\.\d+)?)\s*%/i);
  return m ? Math.round((parseFloat(m[1]) / 100) * 1e6) / 1e6 : null;
}

// back up once only, so re-running never clobbers the pristine placeholder copy
function backupOnce(file) {
  const bak = file + ".placeholder.bak";
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
}

function csvEscape(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------------------------------------------------------------- load archive

console.log(`reading ${ARCHIVE}`);
const rows = JSON.parse(fs.readFileSync(ARCHIVE, "utf8").replace(/^﻿/, ""));
if (!Array.isArray(rows)) throw new Error("expected a JSON array of HTS rows");
console.log(`  ${rows.length} rows`);

// Chapter 99 headings state their own surcharge, collect them first.
const ch99 = new Map();
for (const r of rows) {
  const h = (r.htsno || "").trim();
  if (!/^9903\.\d{2}\.\d{2}$/.test(h)) continue;
  const rate = parseSurcharge(r.general);
  if (rate !== null) ch99.set(h, { rate, description: (r.description || "").trim() });
}
console.log(`  ${ch99.size} chapter-99 headings with a stated surcharge`);

/**
 * Walk the indent hierarchy once, resolving each 10-digit line to the rate and
 * footnotes it actually inherits.
 */
const stack = [];
const lines = new Map(); // "8513.10.20.00" -> resolved line
for (const r of rows) {
  const indent = parseInt(r.indent ?? "0", 10) || 0;
  stack[indent] = r;
  stack.length = indent + 1;

  const hts = (r.htsno || "").trim();
  if (!/^\d{4}\.\d{2}\.\d{2}\.\d{2}$/.test(hts)) continue;

  let rateText = "";
  let unit = "";
  const descParts = [];
  const refs = new Set();

  for (const anc of stack) {
    if (!anc) continue;
    if (!rateText && (anc.general || "").trim()) rateText = anc.general.trim();
    if (!unit && Array.isArray(anc.units) && anc.units.length) unit = anc.units[0];
    const d = (anc.description || "").trim();
    if (d) descParts.push(d);
    for (const f of anc.footnotes || []) {
      for (const m of String(f.value || "").matchAll(/9903\.\d{2}\.\d{2}/g)) refs.add(m[0]);
    }
  }

  const { adVal, note } = parseRate(rateText);
  lines.set(hts, {
    hts,
    description: descParts.join(", ").replace(/\s+/g, " ").slice(0, 220),
    rateText,
    mfn_rate: adVal ?? 0,
    rate_note: note,
    unit: unit || "X",
    ch99: [...refs],
  });
}
console.log(`  ${lines.size} ten-digit lines resolved`);

// ------------------------------------------------- rewrite the curated subset

const subsetPath = path.join(DATA, "hts_subset.csv");
const existing = fs.readFileSync(subsetPath, "utf8").trim().split(/\r?\n/);
const header = existing[0].split(",");

// minimal CSV reader, the curated file quotes descriptions, nothing else
function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

const archiveName = path.basename(ARCHIVE);
const out = [header.join(",")];
const missing = [];
const changed = [];

for (const line of existing.slice(1)) {
  if (!line.trim()) continue;
  const cells = splitCsvLine(line);
  const rec = Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  const real = lines.get(rec.hts);

  if (!real) {
    missing.push(rec.hts);
    rec.source = `NOT-IN-${archiveName}-verify-manually`;
  } else {
    const before = parseFloat(rec.mfn_rate || "0");
    if (before !== real.mfn_rate) changed.push(`${rec.hts}  ${before} -> ${real.mfn_rate}`);
    rec.mfn_rate = String(real.mfn_rate);
    rec.description = real.description || rec.description;
    rec.unit = real.unit || rec.unit;
    rec.source = `USITC ${archiveName} general="${real.rateText}"` +
      (real.rate_note ? ` [${real.rate_note}]` : "");
  }
  out.push(header.map((h) => csvEscape(rec[h])).join(","));
}

backupOnce(subsetPath);
fs.writeFileSync(subsetPath, out.join("\n") + "\n", "utf8");

console.log(`\nhts_subset.csv: ${changed.length} rates corrected, ${missing.length} not found`);
for (const c of changed) console.log(`   ${c}`);
for (const m of missing) console.log(`   MISSING ${m} (no such line in this revision)`);

// ------------------------------------------------------- rewrite surcharges

const surPath = path.join(DATA, "surcharges.json");
const sur = JSON.parse(fs.readFileSync(surPath, "utf8"));

// Section 301 = the 9903.88.xx / 9903.91.xx subchapters, keyed by the HTS
// prefixes our curated lines actually use, so the engine's prefix match keeps
// working unchanged.
const byPrefix = {};
const authority = {};
for (const [hts, rec] of lines) {
  const prefix = hts.slice(0, 4);
  for (const code of rec.ch99) {
    if (!/^9903\.(88|91)\./.test(code)) continue;
    const meta = ch99.get(code);
    if (!meta) continue;
    // keep the highest surcharge seen for the prefix; note which heading set it
    if (byPrefix[prefix] === undefined || meta.rate > byPrefix[prefix]) {
      byPrefix[prefix] = meta.rate;
      authority[prefix] = code;
    }
  }
}

sur._comment =
  `Section 301 rates derived from ${archiveName}: each HTS line's Chapter 99 ` +
  `footnote resolved to the 9903.xx heading, whose own 'general' text states ` +
  `the surcharge. Not hand-entered. Section 122 remains a manual toggle, ` +
  `confirm it is in force before the demo or set enabled=false.`;
sur.section_301.rates_by_prefix = Object.fromEntries(
  Object.entries(byPrefix).sort(([a], [b]) => a.localeCompare(b))
);
sur.section_301.authority_by_prefix = Object.fromEntries(
  Object.entries(authority).sort(([a], [b]) => a.localeCompare(b))
);
sur.section_301.source = `USITC ${archiveName}`;

backupOnce(surPath);
fs.writeFileSync(surPath, JSON.stringify(sur, null, 2) + "\n", "utf8");
console.log(`\nsurcharges.json: ${Object.keys(byPrefix).length} prefixes carry a Section 301 surcharge`);

// ------------------------------------------------------------ full table

const fullPath = path.join(DATA, "hts_full.csv");
const full = ["hts,description,mfn_rate,unit,rate_text,ch99,rate_note"];
for (const rec of lines.values()) {
  full.push([
    rec.hts, rec.description, rec.mfn_rate, rec.unit,
    rec.rateText, rec.ch99.join("|"), rec.rate_note,
  ].map(csvEscape).join(","));
}
fs.writeFileSync(fullPath, full.join("\n") + "\n", "utf8");
console.log(`hts_full.csv: ${lines.size} lines written (the "swap in the full schedule" claim, already true)`);
