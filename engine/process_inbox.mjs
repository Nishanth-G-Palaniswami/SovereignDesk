#!/usr/bin/env node
/**
 * Customs Desk, inbox sweeper. The ONE command the agent runs each cron tick.
 *
 *   node process_inbox.mjs --root <workspace>   (default: ../workspace relative to this file)
 *
 * Layout under <root>:
 *   inbox/      new shipment JSON files dropped by the business (watched)
 *   processed/  shipment JSON moved here after triage
 *   results/    <shipment_id>.result.json  (full engine output)
 *   memos/      <shipment_id>.memo.md      (written by the AGENT, not by this script)
 *   decisions/  <shipment_id>.decision.json (written by the AGENT after a human reply)
 *
 * Prints a JSON array of compact summaries for every NEW shipment processed this tick.
 * Prints [] when there is nothing new. Never throws on a single bad file, it is quarantined to inbox/_failed/.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const rootIdx = argv.indexOf("--root");
const root = rootIdx >= 0 ? argv[rootIdx + 1] : path.resolve(here, "..", "workspace");
const dirs = Object.fromEntries(["inbox", "processed", "results", "memos", "decisions"].map((d) => [d, path.join(root, d)]));
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });
fs.mkdirSync(path.join(dirs.inbox, "_failed"), { recursive: true });

const engine = path.join(here, "triage.mjs");
const dataDir = path.join(here, "data");
// Precedent store sits at the workspace ROOT (host mount) so it outlives any sandbox rebuild.
const precedentsPath = path.join(root, "precedents.jsonl");
const files = fs.readdirSync(dirs.inbox).filter((f) => f.endsWith(".json")).sort();
const summaries = [];

for (const f of files) {
  const src = path.join(dirs.inbox, f);
  try {
    const out = execFileSync(process.execPath, [engine, src, "--data", dataDir, "--precedents", precedentsPath], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const r = JSON.parse(out);
    const resultPath = path.join(dirs.results, `${r.shipment_id}.result.json`);
    fs.writeFileSync(resultPath, JSON.stringify(r, null, 2));
    fs.renameSync(src, path.join(dirs.processed, f));
    summaries.push({
      shipment_id: r.shipment_id,
      importer: r.importer,
      origin_country: r.origin_country,
      status: r.shipment_summary.status,
      entered_value: r.shipment_summary.entered_value,
      estimated_duty: r.shipment_summary.estimated_duty,
      effective_rate: r.shipment_summary.effective_rate,
      flags: r.shipment_summary.flags,
      precedents_applied: r.shipment_summary.precedents_applied,
      lines: r.lines.map((l) => ({
        line: l.line,
        description: l.description,
        hts: l.hts,
        confidence: l.confidence,
        total_rate: l.duty.total_rate,
        surcharges: l.duty.surcharges.map((s) => `${s.name} ${Math.round(s.rate * 1000) / 10}%`),
        pga: l.pga.map((p) => `${p.agency} ${p.requirement} -> ${p.status}`),
        flags: l.flags,
        precedent: l.precedent,
        declared_check: l.declared_check,
        alt_candidates: l.hts_candidates.slice(1).map((c) => `${c.hts} (score ${c.score})`),
      })),
      missing_documents: r.shipment_summary.missing_documents,
      result_file: resultPath,
      memo_file: path.join(dirs.memos, `${r.shipment_id}.memo.md`),
    });
  } catch (e) {
    const msg = (e.stderr || e.message || "").toString().trim();
    fs.renameSync(src, path.join(dirs.inbox, "_failed", f));
    summaries.push({ shipment_id: f, status: "ENGINE_ERROR", error: msg.slice(0, 400) });
  }
}
const precedentCount = fs.existsSync(precedentsPath)
  ? fs.readFileSync(precedentsPath, "utf8").split("\n").filter((l) => l.trim()).length : 0;
process.stdout.write(JSON.stringify({ precedent_store: { path: precedentsPath, entries: precedentCount }, shipments: summaries }, null, 2) + "\n");
