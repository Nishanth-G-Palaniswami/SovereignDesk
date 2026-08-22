#!/usr/bin/env node
/**
 * Seed precedents that are deliberately confusable with the existing lamp override, so
 * retrieval has something to DISCRIMINATE between.
 *
 *   node mongo/seed_confusable.mjs
 *
 * With one precedent in the store, $rankFusion has nothing to rank and hybrid retrieval
 * scores identically to pure vector: the comparison is meaningless. This adds three real
 * broker rulings through the normal engine path (process_inbox -> record_precedent), so the
 * signatures are exactly what the engine computes:
 *
 *   reading lamp  -> 8513.10.20.00   NOT the 9405 night-light ruling, on purpose. This is
 *                                    the 0.75 false positive from lane 4's corpus: a broker
 *                                    who rules on it separately is the realistic outcome.
 *   flashlight    -> 8513.10.20.00   near neighbour of both lamp rulings
 *   pump casing   -> 8413.91.90.96   unrelated, proves no cross-contamination
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..", "..", "..");
const WS = process.env.SEED_WS || "/tmp/lane4";
const fixture = path.join(here, "..", "fixtures", "shipment_900_confusable.json");

fs.mkdirSync(path.join(WS, "inbox"), { recursive: true });
fs.copyFileSync(fixture, path.join(WS, "inbox", path.basename(fixture)));
execFileSync(process.execPath, [path.join(repo, "engine", "process_inbox.mjs"), "--root", WS], { stdio: "ignore" });

const RULINGS = [
  { line: 1, hts: "8513.10.20.00", by: "R. Vance, LCB",
    reason: "A reading lamp is a self-contained portable lamp under 8513, not a luminaire under 9405" },
  { line: 2, hts: "8513.10.20.00", by: "R. Vance, LCB",
    reason: "Torches and flashlights are the archetypal 8513 portable electric lamp" },
  { line: 3, hts: "8413.91.90.96", by: "M. Okafor, LCB",
    reason: "A pump casing is a part of a pump under 8413.91, not an article of rubber" },
];

for (const r of RULINGS) {
  execFileSync(process.execPath, [
    path.join(repo, "engine", "record_precedent.mjs"),
    "--shipment", "SHP-2026-0822-900", "--line", String(r.line),
    "--hts", r.hts, "--reason", r.reason, "--by", r.by, "--root", WS,
  ], { stdio: "ignore" });
  console.log(`recorded L${r.line} -> ${r.hts} (${r.by})`);
}
console.log(`\nstore now: ${fs.readFileSync(path.join(WS, "precedents.jsonl"), "utf8").split("\n").filter(Boolean).length} precedents`);
console.log(`next: node mongo/migrate.mjs ${path.join(WS, "precedents.jsonl")}`);
