/**
 * MongoDB retrieval index for the precedent memory. ZERO npm dependencies: every call
 * shells out to mongosh (a system binary, like node) via execFileSync with an args array,
 * so nothing here adds a package.json and no shell ever parses the eval script.
 *
 * Contract, do not weaken it:
 * - precedents.jsonl stays the append-only source of truth and audit trail. This module
 *   talks to a DERIVED index, rebuildable any time with scripts/mongo_sync.mjs.
 * - MONGO_URI unset: every entry point below is inert and this import has no side effects,
 *   so engine behavior is byte-identical to the JSONL-only path.
 * - MONGO_URI set: any failure is a loud thrown error. There is no fallback on purpose;
 *   a silently ignored dead index is how a demo lies to a broker.
 *
 * Env (the only env vars the engine reads):
 *   MONGO_URI    e.g. mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=2000
 *   MONGO_DB     database name, default "sovereigndesk" (tests use a separate one)
 *   MONGOSH_BIN  path to the real mongosh executable when not on PATH. On Windows use
 *                C:/-style paths (never /c/...) and the .exe, not a .cmd shim.
 */
import { execFileSync } from "node:child_process";

const PRECEDENTS_COLL = "precedents";
const TARIFF_COLL = "tariff";
const EVAL_TIMEOUT_MS = 20000;

export function mongoEnabled() { return !!process.env.MONGO_URI; }
export function dbName() { return process.env.MONGO_DB || "sovereigndesk"; }
function mongoshBin() { return process.env.MONGOSH_BIN || "mongosh"; }

// One mongosh spawn. `script` must end by print()-ing exactly one JSON line.
// Exported only for scripts/mongo_sync.mjs and scripts/mongo_load_tariff.mjs, the two
// other sanctioned writers; the engine itself goes through the typed helpers below.
export function runEval(script, { file = false, timeoutMs = EVAL_TIMEOUT_MS } = {}) {
  const bin = mongoshBin();
  const uri = process.env.MONGO_URI;
  // file mode hands mongosh a .js path instead of --eval: bulk payloads (the 19,856-row
  // tariff load) cannot ride an argv string through the 32,767-char CreateProcess limit.
  const args = file ? [uri, "--quiet", "--norc", script] : [uri, "--quiet", "--norc", "--eval", script];
  let stdout;
  try {
    stdout = execFileSync(bin, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (e) {
    const detail = e.killed ? `mongosh timed out after ${timeoutMs}ms`
      : (e.stderr ? String(e.stderr).trim().slice(0, 400) : e.message);
    throw new Error(`[mongo] mongosh call failed (bin=${bin}): ${detail}. MONGO_URI is set, there is no fallback; fix the index or unset MONGO_URI.`);
  }
  const line = stdout.trim();
  try {
    return JSON.parse(line);
  } catch {
    throw new Error(`[mongo] unparseable mongosh output (first 200 chars): ${line.slice(0, 200)}`);
  }
}

// ---------- precedent retrieval ----------
// Jaccard is computed server-side ($setIntersection / $setUnion over the stored token
// array) on the same integer inputs the JSONL scan uses, so the double division is
// bit-identical to JS. Sort {sim desc, seq desc} mirrors the >= JSONL scan exactly:
// seq is the 1-based JSONL line number, so the newest record wins a similarity tie.
const matchCache = new Map();
let cachedCount = null;

export function topMatch(tokens, floor, expectedCount) {
  const key = tokens.join(" ");
  if (matchCache.has(key)) return matchCache.get(key);
  const script = [
    `const q = ${JSON.stringify(tokens)};`,
    `const col = db.getSiblingDB(${JSON.stringify(dbName())}).${PRECEDENTS_COLL};`,
    `const count = col.countDocuments();`,
    `const top = col.aggregate([`,
    `  { $addFields: { __inter: { $size: { $setIntersection: ["$tokens", q] } }, __uni: { $size: { $setUnion: ["$tokens", q] } } } },`,
    `  { $addFields: { __sim: { $cond: [{ $eq: ["$__uni", 0] }, 0, { $divide: ["$__inter", "$__uni"] }] } } },`,
    `  { $match: { __sim: { $gte: ${JSON.stringify(floor)} } } },`,
    `  { $sort: { __sim: -1, seq: -1 } },`,
    `  { $limit: 1 },`,
    `  { $project: { _id: 0 } },`,
    `]).toArray();`,
    `print(JSON.stringify({ count, top }));`,
  ].join("\n");
  const { count, top } = runEval(script);
  cachedCount = count;
  if (count !== expectedCount) {
    throw new Error(`[mongo] index db=${dbName()} has ${count} precedent docs but the JSONL store has ${expectedCount} valid records; the index is stale or points at another workspace. Rebuild it: node scripts/mongo_sync.mjs --precedents <path>`);
  }
  let out = null;
  if (top.length) {
    const doc = { ...top[0] };
    const sim = doc.__sim;
    delete doc.__sim; delete doc.__inter; delete doc.__uni; delete doc.tokens; delete doc.seq;
    out = { doc, sim };
  }
  matchCache.set(key, out);
  return out;
}

// Result-JSON evidence that retrieval ran through the index; null until a topMatch ran.
export function indexInfo() {
  return cachedCount === null ? null : { type: "mongodb", entries: cachedCount };
}

// ---------- precedent insert (called by record_precedent.mjs AFTER the JSONL append) ----------
export function insertPrecedent(record, seq) {
  const doc = { ...record, tokens: record.sig.split(" ").filter(Boolean), seq };
  const script = [
    `const col = db.getSiblingDB(${JSON.stringify(dbName())}).${PRECEDENTS_COLL};`,
    `col.insertOne(${JSON.stringify(doc)});`,
    `print(JSON.stringify({ inserted: true, entries: col.countDocuments() }));`,
  ].join("\n");
  return runEval(script);
}

// ---------- full-schedule tariff lookup ----------
// Exact-code lookup over the 19,856-line USITC export loaded by scripts/mongo_load_tariff.mjs.
// Lets a precedent bind to a code outside the curated subset. Returns the doc or null.
const tariffCache = new Map();

export function tariffLookup(hts) {
  const digits = String(hts).replace(/\D/g, "");
  if (tariffCache.has(digits)) return tariffCache.get(digits);
  const script = [
    `const col = db.getSiblingDB(${JSON.stringify(dbName())}).${TARIFF_COLL};`,
    `print(JSON.stringify(col.findOne({ hts_digits: ${JSON.stringify(digits)} }, { _id: 0 })));`,
  ].join("\n");
  const doc = runEval(script);
  tariffCache.set(digits, doc);
  return doc;
}

// ---------- hybrid retrieval (opt-in: MEMORY_RETRIEVAL=hybrid) ----------
// Jaccard-in-an-aggregation is the same match a JSONL scan makes, just executed in the
// database. Measured on lane 4's corpus it binds 2 of 7 true paraphrases; cosine over local
// embeddings binds 6 of 7 with no loss of precision, and "LED lamp" goes from 0.286 (never
// fires) to 0.767 (surfaced). See lanes/4-memory/mongo/FINDINGS.md.
//
// Still zero npm dependencies: the embedding is one fetch() to a LOCAL Ollama (never Voyage
// AI, which is MongoDB-hosted and would break the zero-egress guarantee), and the 768-float
// query vector rides into mongosh through file mode, not argv.
//
// Off by default. MEMORY_RETRIEVAL unset => byte-identical to the Jaccard path above.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const EMBED_MODEL = process.env.EMBED_MODEL || "nomic-embed-text";
const OLLAMA = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";

export function hybridEnabled() { return (process.env.MEMORY_RETRIEVAL || "").toLowerCase() === "hybrid"; }

// Synchronous on purpose: triage.mjs is sync top to bottom, so the vector is fetched by
// spawning engine/embed_once.mjs with execFileSync, the same shape as the mongosh calls.
function embedText(text) {
  const helper = path.join(path.dirname(fileURLToPath(import.meta.url)), "embed_once.mjs");
  let out;
  try {
    out = execFileSync(process.execPath, [helper, text], {
      encoding: "utf8", timeout: EVAL_TIMEOUT_MS, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 4 * 1024 * 1024,
    });
  } catch (e) {
    const detail = e.killed ? `embedding timed out after ${EVAL_TIMEOUT_MS}ms`
      : (e.stderr ? String(e.stderr).trim().slice(0, 300) : e.message);
    throw new Error(`[mongo] embedding failed via ${OLLAMA} (model ${EMBED_MODEL}): ${detail}. MEMORY_RETRIEVAL=hybrid is set, there is no fallback; fix Ollama or unset it.`);
  }
  const v = JSON.parse(out);
  if (!Array.isArray(v)) throw new Error(`[mongo] ollama returned no embedding for "${text.slice(0, 40)}"`);
  return v;
}

// Cosine sits in a higher, narrower band than Jaccard: the calibrated bars are floor 0.75 and
// bind 0.90, against the engine's 0.55 and 0.90. Rather than change the engine's constants
// (lane 3 owns them) map cosine onto the engine's scale, knot for knot, so PRECEDENT_FLOOR and
// PRECEDENT_BIND keep their exact meaning and the two-tier rule is untouched.
//   cosine 0.75 -> 0.55 (floor)      cosine 0.90 -> 0.90 (bind)
export function cosineToEngineScale(c) {
  const knots = [[0, 0], [0.75, 0.55], [0.90, 0.90], [1, 1]];
  for (let i = 1; i < knots.length; i++) {
    const [x0, y0] = knots[i - 1], [x1, y1] = knots[i];
    if (c <= x1) return y0 + ((c - x0) / (x1 - x0)) * (y1 - y0);
  }
  return 1;
}

export function hybridMatch(description, floor, expectedCount) {
  const qv = embedText(description);
  const tmp = path.join(os.tmpdir(), `sd-hybrid-${process.pid}-${Math.random().toString(36).slice(2)}.js`);
  const script = [
    `const qv = ${JSON.stringify(qv)};`,
    `const col = db.getSiblingDB(${JSON.stringify(dbName())}).${PRECEDENTS_COLL};`,
    `const count = col.countDocuments();`,
    `const top = col.aggregate([`,
    `  { $vectorSearch: { index: "vector_idx", path: "embedding", queryVector: qv, numCandidates: 200, limit: 1 } },`,
    `  { $addFields: { __cos: { $subtract: [{ $multiply: [{ $meta: "vectorSearchScore" }, 2] }, 1] } } },`,
    `  { $project: { _id: 0, embedding: 0, tokens: 0 } },`,
    `]).toArray();`,
    `print(JSON.stringify({ count, top }));`,
  ].join("\n");
  fs.writeFileSync(tmp, script);
  try {
    const { count, top } = runEval(tmp, { file: true });
    cachedCount = count;
    if (count !== expectedCount) {
      throw new Error(`[mongo] index db=${dbName()} has ${count} precedent docs but the JSONL store has ${expectedCount} valid records; rebuild: node scripts/mongo_sync.mjs --precedents <path>`);
    }
    if (!top.length) return null;
    const doc = { ...top[0] };
    const cos = doc.__cos;
    delete doc.__cos; delete doc.seq;
    const sim = cosineToEngineScale(cos);
    if (sim < floor) return null;
    return { doc, sim, cosine: Math.round(cos * 1000) / 1000 };
  } finally { fs.rmSync(tmp, { force: true }); }
}
