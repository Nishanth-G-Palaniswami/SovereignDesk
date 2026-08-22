#!/usr/bin/env node
/**
 * write_memos.mjs, the local memo writer.
 *
 *   node lanes/1-inference/write_memos.mjs --root <ws> [--model qwen2.5:3b]
 *        [--host http://127.0.0.1:11434] [--shipment <id>] [--force]
 *
 * On the box, OpenClaw writes memos/<id>.memo.md per cron tick (agent/AGENTS.md). This
 * script is the same step for a dev machine with local Ollama: read results/<id>.result.json,
 * have the model turn it into the AGENTS.md memo, write it next door. The console watches
 * memos/ and repaints on its own.
 *
 * The engine decides, the model only explains. This script writes ONLY into memos/. It never
 * touches results/, precedents.jsonl, or any engine field. Every draft passes a tripwire:
 * an HTS code absent from the result JSON, a precedent or declared-check sentence when those
 * fields are null, or a mangled shipment_id gets the draft rejected and retried with feedback,
 * and after three strikes the run fails loudly rather than write a memo that invents facts.
 * Small local models fill in the template's conditional branches unprompted; the box's 70B
 * mostly does not, but the tripwire does not care which model is on the other end.
 *
 * Zero dependencies, node builtins plus global fetch. No fallback template: if Ollama is
 * down or the model is missing, this fails loudly and tells you what to run.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const has = (n) => argv.includes(n);

const ROOT = path.resolve(opt("--root", path.join(REPO, "workspace")));
const MODEL = opt("--model", "qwen2.5:3b");
const HOST = (opt("--host", process.env.OLLAMA_HOST || "http://127.0.0.1:11434")).replace(/\/+$/, "");
const ONLY = opt("--shipment");
const FORCE = has("--force");

const resultsDir = path.join(ROOT, "results");
const memosDir = path.join(ROOT, "memos");

// The memo format is the one in agent/AGENTS.md, but the [if ...] conditionals are resolved
// HERE, deterministically, per shipment. A small model shown a conditional template copies
// the brackets, fills branches whose JSON field is null, or drops branches that apply. So
// the engine side of this script decides which sections exist and the model only fills in
// values; the same division of labor the whole repo is built on.
function formatBlock(result) {
  const p = [];
  p.push("📦 <shipment_id> · <importer> · origin <origin_country>");
  p.push(result.status === "READY" ? "Status: READY ✅" : "Status: NEEDS_REVIEW ⚠️");
  p.push("Entered value $<entered_value> · Est. duty $<estimated_duty> (<effective_rate as %>) · Fees $<estimated_fees> · Total payable $<estimated_total_payable>");
  for (const l of result.lines) {
    p.push("");
    p.push(`Line ${l.line}: <short description>`);
    p.push("  HTS <hts> (conf <confidence>) · MFN + <surcharges> = <total_rate as %>");
    p.push(l.pga.length ? "  PGA: <agency requirement -> status>" : "  PGA: none");
    p.push(l.flags.length ? "  Flags: <flags>" : "  Flags: none");
    // The precedent and declared sentences are inlined with their real values here, by
    // code, not left as placeholders: a deterministic copy of an engine field cannot be
    // hallucinated, and these are the sentences the demo stands on. The model reproduces
    // them verbatim; validate() rejects the memo if it mutates them.
    const pr = l.precedent;
    if (pr && pr.applied && pr.changed_outcome) {
      p.push(`  🧠 Precedent: ${pr.by} set this to ${pr.hts} on ${pr.source_shipment}, "${pr.reason}".`);
      p.push(`      Cold engine would have said ${pr.cold_hts}. Applied automatically (similarity ${pr.similarity}).`);
    } else if (pr && !pr.applied) {
      p.push(`  🤔 Similar case on file, NOT applied (similarity ${pr.similarity}):`);
      p.push(`      ${pr.by} chose ${pr.hts} on ${pr.source_shipment}, "${pr.reason}". Engine kept ${l.hts}. Confirm or reclassify.`);
    }
    const dc = l.declared_check;
    if (dc) {
      p.push(`  Declared ${dc.declared} vs engine ${dc.engine} → duty delta $${dc.duty_delta}. Audit-risk: confirm basis.`);
    }
  }
  p.push("");
  p.push(result.missing_documents.length ? "Missing documents: <list>" : "Missing documents: none");
  p.push("Next action: <one sentence>, reply \`approve <id>\` or \`reclassify <id> line <n> to <hts>\`");
  return p.join("\n");
}

// The instruction paragraph is near verbatim from PLAN.md Phase 4 step 2.
function buildSystem(result) {
  return `You are Customs Desk, an import-compliance triage agent for a U.S. customs brokerage.
The user gives you one shipment result JSON produced by a deterministic engine. Write the memo.
Memo under 1,200 characters. You may not change an HTS code, a rate, a flag or any figure:
every number is copied from the JSON. Invent nothing. No preamble.

This format was generated for exactly this shipment. Produce exactly these lines, replacing
each <placeholder> with the value from the JSON, and add nothing else:

${formatBlock(result)}

Copy shipment_id, every HTS code, and every PGA status word (REQUIRED, CONFIRM, DISCLAIMABLE)
character for character from the JSON. Output only the memo text. No code fences, no commentary.`;
}

const HTS_RE = /\b\d{4}\.\d{2}\.\d{2}(?:\.\d{2})?\b/g;

// The tripwire. A memo is prose, but prose that invents a precedent, a declared-code
// mismatch, or an HTS code is exactly what the architecture promises cannot happen.
// Violations are retried with feedback, then fatal. Never written.
function validate(memo, result, resultText) {
  const bad = [];
  if (!memo.includes(result.shipment_id)) {
    bad.push(`the memo does not contain the shipment_id "${result.shipment_id}" copied exactly`);
  }
  const known = new Set(resultText.match(HTS_RE) || []);
  for (const code of new Set(memo.match(HTS_RE) || [])) {
    if (!known.has(code)) bad.push(`HTS ${code} does not appear anywhere in the result JSON`);
  }
  const lines = result.lines || [];
  if (!lines.some((l) => l.precedent) && /precedent|similar case/i.test(memo)) {
    bad.push(`every line's "precedent" is null, but the memo mentions a precedent or similar case`);
  }
  if (!lines.some((l) => l.declared_check) && /\bdeclared\b.*\bvs\b/i.test(memo)) {
    bad.push(`every line's "declared_check" is null, but the memo claims a declared code was checked`);
  }
  // Completeness cuts both ways: an emitted precedent MUST be told, with the cold code and
  // the source shipment. This is the beat the whole memory layer exists for. The conditions
  // mirror formatBlock(): applied-and-changed gets the 🧠 story, not-applied gets the 🤔 one.
  for (const l of lines) {
    const p = l.precedent;
    if (!p || (p.applied && !p.changed_outcome)) continue;
    if (!/precedent|similar case/i.test(memo)) bad.push(`line ${l.line} has a precedent but the memo never mentions it`);
    if (p.source_shipment && !memo.includes(p.source_shipment)) bad.push(`the memo must name the precedent's source shipment ${p.source_shipment}`);
    if (p.applied && p.changed_outcome && p.cold_hts && !memo.includes(p.cold_hts)) {
      bad.push(`the memo must state the cold engine code ${p.cold_hts} for line ${l.line}`);
    }
  }
  for (const l of lines) {
    const d = l.declared_check;
    if (!d) continue;
    if (!memo.includes(d.declared) || !memo.includes(d.engine)) {
      bad.push(`line ${l.line} has a declared_check: the memo must keep the format's "Declared ${d.declared} vs engine ${d.engine}" line`);
    }
  }
  const statuses = new Set(lines.flatMap((l) => (l.pga || []).map((p) => p.status)));
  for (const m of memo.matchAll(/->\s*([A-Z][A-Z_]{2,})/g)) {
    if (!statuses.has(m[1])) bad.push(`PGA status "${m[1]}" is not a status the engine emitted (${[...statuses].join(", ") || "none"})`);
  }
  return bad;
}

async function chat(messages) {
  let res;
  try {
    res = await fetch(`${HOST}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(300_000),
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        options: { temperature: 0, num_ctx: 8192 },
        messages,
      }),
    });
  } catch (e) {
    if (e.name === "TimeoutError") {
      throw new Error(`Ollama at ${HOST} took over 300s for one memo. Model too slow for this box, or mid-load; retry, or pick a smaller --model.`);
    }
    throw new Error(
      `Ollama not reachable at ${HOST} (${e.cause?.code || e.name}). ` +
      `Start it, then check: curl ${HOST}/api/tags`
    );
  }
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 404 || /not found/i.test(body)) {
      throw new Error(`model "${MODEL}" not available (${body.trim()}). Run: ollama pull ${MODEL}`);
    }
    throw new Error(`Ollama ${res.status} from ${HOST}/api/chat: ${body.trim()}`);
  }
  const data = await res.json();
  let memo = (data.message?.content || "").trim();
  // Some models wrap output in a fence despite instructions. Cosmetic strip only.
  memo = memo.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/, "").trim();
  if (!memo) throw new Error(`empty reply from ${MODEL}`);
  return memo;
}

const ATTEMPTS = 3;

// Deterministic projection of the result file: exactly the fields the memo format needs,
// nothing else. The full file carries hts_candidates scores and the ON_FILE lpco list, and
// a small model will happily read a candidate score as a confidence or an on-file document
// as a missing one. Trimming the input is engine code deciding what the model sees; every
// value still comes verbatim from the result file.
function projection(result) {
  const s = result.shipment_summary;
  return {
    shipment_id: result.shipment_id,
    importer: result.importer,
    origin_country: result.origin_country,
    status: s.status,
    entered_value: s.entered_value,
    estimated_duty: s.estimated_duty,
    effective_rate: s.effective_rate,
    estimated_fees: s.estimated_fees,
    estimated_total_payable: s.estimated_total_payable,
    shipment_flags: s.flags,
    missing_documents: s.missing_documents,
    lines: (result.lines || []).map((l) => ({
      line: l.line,
      description: l.description,
      hts: l.hts,
      confidence: l.confidence,
      mfn_rate: l.duty?.mfn_rate,
      surcharges: (l.duty?.surcharges || []).map((x) => `${x.name} ${x.rate}`),
      total_rate: l.duty?.total_rate,
      duty_est: l.duty?.duty_est,
      pga: (l.pga || []).map((p) => `${p.agency} ${p.requirement} -> ${p.status}`),
      flags: l.flags,
      precedent: l.precedent,
      declared_check: l.declared_check,
    })),
  };
}

async function generate(result, resultText, id) {
  const proj = projection(result);
  const messages = [
    { role: "system", content: buildSystem(proj) },
    {
      role: "user",
      content:
        `Write the memo for shipment_id "${result.shipment_id}". Copy that id exactly, character for character, everywhere it appears.\n\n` +
        JSON.stringify(proj, null, 1),
    },
  ];
  for (let attempt = 1; ; attempt++) {
    const memo = await chat(messages);
    const bad = validate(memo, result, resultText);
    if (!bad.length) return memo;
    if (attempt >= ATTEMPTS) {
      throw new Error(
        `memo still breaks the rules after ${ATTEMPTS} attempts, refusing to write it:\n  - ${bad.join("\n  - ")}\n` +
        `last rejected draft:\n${memo.replace(/^/gm, "  | ")}`
      );
    }
    console.error(
      `[memos] ${id} attempt ${attempt} rejected, retrying with feedback:\n  - ${bad.join("\n  - ")}\n` +
      `rejected draft:\n${memo.replace(/^/gm, "  | ")}`
    );
    // Keep only the latest draft in the chain; stacking every attempt slows local
    // inference until the per-memo timeout starts eating the later retries.
    messages.length = 2;
    messages.push({ role: "assistant", content: memo });
    messages.push({
      role: "user",
      content: `Your memo broke these rules:\n- ${bad.join("\n- ")}\nRewrite the whole memo. Reproduce every line of the format, with the values from the JSON. Add nothing else.`,
    });
  }
}

let files;
try {
  files = fs.readdirSync(resultsDir).filter((f) => f.endsWith(".result.json")).sort();
} catch {
  console.error(`no results directory at ${resultsDir}. Run the sweep first: node engine/process_inbox.mjs --root ${ROOT}`);
  process.exit(1);
}
if (ONLY) files = files.filter((f) => f === `${ONLY}.result.json`);
if (!files.length) {
  console.error(ONLY ? `no result file for ${ONLY} in ${resultsDir}` : `no result files in ${resultsDir}`);
  process.exit(1);
}
fs.mkdirSync(memosDir, { recursive: true });

console.log(`[memos] root ${ROOT} · model ${MODEL} · host ${HOST}`);
let wrote = 0, skipped = 0, warned = 0;
for (const f of files) {
  const id = f.replace(/\.result\.json$/, "");
  const memoPath = path.join(memosDir, `${id}.memo.md`);
  if (!FORCE && fs.existsSync(memoPath)) { skipped++; console.log(`[memos] ${id} exists, skipped (--force to rewrite)`); continue; }

  const resultText = fs.readFileSync(path.join(resultsDir, f), "utf8");
  const result = JSON.parse(resultText);
  const t0 = Date.now();
  let memo;
  try {
    memo = await generate(result, resultText, id);
  } catch (e) {
    console.error(`[memos] ${id} FAILED: ${e.message}`);
    process.exit(1);
  }

  if (memo.length > 1200) {
    warned++;
    console.error(`[memos] WARNING ${id}: memo is ${memo.length} chars, over the 1,200 console-card budget.`);
  }

  fs.writeFileSync(memoPath, memo + "\n");
  wrote++;
  console.log(`[memos] ${id} -> ${path.relative(process.cwd(), memoPath)} (${memo.length} chars, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
console.log(`[memos] done: ${wrote} written, ${skipped} skipped, ${warned} length warning(s)`);
