#!/usr/bin/env node
/**
 * Customs Desk, record a human override as a durable precedent.
 *
 * The agent runs this when a broker replies `reclassify <shipment_id> line <n> to <hts>`.
 * Appends ONE line to precedents.jsonl, which lives on the HOST mount so it survives
 * sandbox teardown / `nemoclaw rebuild`. That survival is the whole point.
 *
 * Usage:
 *   node record_precedent.mjs --shipment <id> --line <n> --hts <code> [--reason "..."]
 *                             [--by broker] [--root <workspace>] [--results <dir>]
 *
 * The line description is read from results/<shipment_id>.result.json, so the caller
 * never has to retype it and the signature always matches what the engine computes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

const shipmentId = opt("--shipment");
const lineNo = parseInt(opt("--line", ""), 10);
const hts = opt("--hts");
const reason = opt("--reason", "");
const by = opt("--by", "broker");
const root = opt("--root", path.join(here, "..", "workspace"));
const resultsDir = opt("--results", path.join(root, "results"));
const store = opt("--precedents", path.join(root, "precedents.jsonl"));

if (!shipmentId || !Number.isFinite(lineNo) || !hts) {
  console.error('usage: node record_precedent.mjs --shipment <id> --line <n> --hts <code> [--reason "..."]');
  process.exit(2);
}

// Same tokenizer/signature as triage.mjs, keep these two in sync if you edit either.
const STOP = new Set(["the","a","an","of","for","and","or","with","in","to","by","on","at","from","other","nesoi","n.e.s.o.i","x","pcs","pc","each","set","sets"]);
function tokenize(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9%.\s-]/g, " ").split(/\s+/)
    .map((t) => t.replace(/^[-.]+|[-.]+$/g, ""))
    .filter((t) => t && !STOP.has(t))
    .map((t) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t));
}
const signature = (d) => [...new Set(tokenize(d))].sort().join(" ");

const resultPath = path.join(resultsDir, `${shipmentId}.result.json`);
let description = opt("--description", "");
if (!description) {
  if (!fs.existsSync(resultPath)) {
    console.error(`[precedent] no result file at ${resultPath}; pass --description "<line text>" instead`);
    process.exit(3);
  }
  const r = JSON.parse(fs.readFileSync(resultPath, "utf8"));
  const line = r.lines.find((l) => l.line === lineNo);
  if (!line) { console.error(`[precedent] line ${lineNo} not found in ${shipmentId}`); process.exit(3); }
  description = line.description;
}

const record = {
  sig: signature(description),
  description,
  hts,
  reason,
  by,
  shipment_id: shipmentId,
  line: lineNo,
  at: new Date().toISOString(),
};

fs.mkdirSync(path.dirname(store), { recursive: true });
fs.appendFileSync(store, JSON.stringify(record) + "\n");
const total = fs.readFileSync(store, "utf8").split("\n").filter((l) => l.trim()).length;
console.log(JSON.stringify({ recorded: true, hts, description, store, total_precedents: total }, null, 2));
