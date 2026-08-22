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
