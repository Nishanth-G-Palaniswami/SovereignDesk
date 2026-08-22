#!/usr/bin/env node
/**
 * Customs Desk, deterministic triage engine.
 *
 * Node 18+, ZERO dependencies. Node is guaranteed inside the NemoClaw/OpenShell
 * sandbox because OpenClaw itself runs on it, python3 is NOT guaranteed.
 *
 * Usage:
 *   node triage.mjs <shipment.json> [--data <dir>] [--out <result.json>] [--pretty]
 *
 * Exit codes: 0 ok, 2 bad input, 3 data load failure.
 *
 * CONTRACT (frozen for the hackathon, do not change field names mid-day):
 *   input  = shipment.json   (see samples/)
 *   output = result.json     (see README "Engine contract")
 *
 * The LLM never decides an HTS code. This engine proposes candidates with
 * scores and a confidence; anything below CONFIDENCE_FLOOR is routed to a
 * human. Every decision appends a line to `trace` so the memo can cite it.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ENGINE_VERSION = "0.1.0";
const CONFIDENCE_FLOOR = 0.70;     // below this -> needs_human
const DECLARED_DELTA_FLAG = 0.0;   // any rate delta vs declared code gets flagged

// ---------- CLI ----------
const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
  console.error("usage: node triage.mjs <shipment.json> [--data <dir>] [--precedents <file>] [--out <file>] [--pretty]");
  process.exit(2);
}
const getOpt = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
};
const here = path.dirname(fileURLToPath(import.meta.url));
const optValues = new Set([getOpt("--data"), getOpt("--out"), getOpt("--precedents")].filter(Boolean));
const shipmentPath = argv.find((a) => !a.startsWith("--") && !optValues.has(a));
const dataDir = getOpt("--data") || path.join(here, "data");
const outPath = getOpt("--out");
// Precedent store lives on the HOST mount by default, NOT inside the sandbox, it must
// survive `nemoclaw rebuild` / sandbox teardown. Default: <workspace>/precedents.jsonl
const precedentsPath = getOpt("--precedents") || path.join(here, "..", "workspace", "precedents.jsonl");
const pretty = argv.includes("--pretty");

// ---------- Data loading ----------
function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}
function parseCSV(text) {
  // Minimal RFC-4180-ish parser (handles quoted fields with commas).
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

let HTS, PGA, LPCO, SUR;
try {
  HTS = parseCSV(fs.readFileSync(path.join(dataDir, "hts_subset.csv"), "utf8")).map((r) => ({
    hts: r.hts,
    description: r.description,
    mfn_rate: parseFloat(r.mfn_rate || "0"),
    unit: r.unit,
    keywords: (r.keywords || "").split("|").map((k) => k.trim().toLowerCase()).filter(Boolean),
    source: r.source || "",
  }));
  PGA = loadJSON(path.join(dataDir, "pga_flags.json"));
  LPCO = loadJSON(path.join(dataDir, "lpco_rules.json"));
  SUR = loadJSON(path.join(dataDir, "surcharges.json"));
} catch (e) {
  console.error(`[engine] failed to load data from ${dataDir}: ${e.message}`);
  process.exit(3);
}

// ---------- Precedent store (append-only JSONL, host-side, survives sandbox teardown) ----------
let PRECEDENTS = [];
try {
  if (fs.existsSync(precedentsPath)) {
    PRECEDENTS = fs.readFileSync(precedentsPath, "utf8")
      .split("\n").map((l) => l.trim()).filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((r) => r && r.sig && r.hts);
  }
} catch { PRECEDENTS = []; }

// ---------- Input ----------
let shipment;
try {
  shipment = loadJSON(shipmentPath);
  if (!shipment.shipment_id || !Array.isArray(shipment.lines)) throw new Error("missing shipment_id or lines[]");
} catch (e) {
  console.error(`[engine] bad shipment file ${shipmentPath}: ${e.message}`);
  process.exit(2);
}

// ---------- Text utils ----------
const STOP = new Set(["the","a","an","of","for","and","or","with","in","to","by","on","at","from","other","nesoi","n.e.s.o.i","x","pcs","pc","each","set","sets"]);
function tokenize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9%.\s-]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[-.]+|[-.]+$/g, ""))
    .filter((t) => t && !STOP.has(t))
    .map((t) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t)); // crude stem
}
function tokenSet(s) { return new Set(tokenize(s)); }

// ---------- Classification ----------
const PART_TOKENS = new Set(["casing", "housing", "impeller", "part", "kit", "component", "spare", "bracket"]); // gaskets/seals have their own headings (Sec. XVI note 1(a))
function scoreRow(row, descTokens) {
  let score = 0; const hits = [];
  for (const kw of row.keywords) {
    const kwTokens = tokenize(kw);
    if (kwTokens.length === 0) continue;
    const all = kwTokens.every((t) => descTokens.has(t));
    if (all) { score += kwTokens.length > 1 ? 4 : 3; hits.push(kw); }
  }
  const rowDesc = tokenSet(row.description);
  for (const t of descTokens) if (rowDesc.has(t)) score += 1;
  // "Parts of X" vs "X": if the line reads like a part, prefer parts headings and halve whole-machine headings
  const looksLikePart = [...descTokens].some((t) => PART_TOKENS.has(t));
  const rowIsParts = rowDesc.has("part");
  if (looksLikePart && rowIsParts && score > 0) { score += 4; hits.push("[parts-heading boost]"); }
  if (looksLikePart && !rowIsParts && row.description.toLowerCase().includes("pump")) score = Math.round(score * 0.5 * 100) / 100;
  return { score, hits };
}
function classify(description) {
  const descTokens = tokenSet(description);
  const scored = HTS.map((row) => ({ row, ...scoreRow(row, descTokens) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const top = scored[0], second = scored[1];
  let confidence = 0;
  if (top) confidence = second ? top.score / (top.score + second.score) : Math.min(1, 0.6 + top.score * 0.05);
  confidence = Math.round(confidence * 100) / 100;
  return {
    candidates: scored.slice(0, 3).map((x) => ({
      hts: x.row.hts, score: x.score, matched: x.hits, description: x.row.description,
    })),
    confidence,
  };
}
function findRow(hts) { return HTS.find((r) => r.hts === hts) || null; }

// ---------- Precedent matching ----------
// Signature = sorted unique content tokens of the line description. Order-independent, so
// "pump seal kit with impeller" and "impeller and seal kit for pump" produce the same sig.
function signature(description) { return [...new Set(tokenize(description))].sort().join(" "); }
function jaccard(a, b) {
  const A = new Set(a.split(" ").filter(Boolean)), B = new Set(b.split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
const PRECEDENT_FLOOR = 0.55;   // similarity needed to treat a past override as binding here
function precedentFor(description) {
  const sig = signature(description);
  let best = null, bestSim = 0;
  for (const p of PRECEDENTS) {
    const sim = p.sig === sig ? 1 : jaccard(sig, p.sig);
    if (sim > bestSim) { bestSim = sim; best = p; }
  }
  if (!best || bestSim < PRECEDENT_FLOOR) return null;
  return { ...best, similarity: Math.round(bestSim * 100) / 100, exact: bestSim === 1 };
}
function prefixMatches(hts, table) {
  // longest-prefix match on digits only (8413.91.90.96 -> "8413919096"); ignores "_comment"-style keys
  const digits = hts.replace(/\D/g, "");
  return Object.keys(table || {})
    .filter((p) => !p.startsWith("_"))
    .map((p) => [p, p.replace(/\D/g, "")])
    .filter(([, d]) => d.length > 0 && digits.startsWith(d))
    .sort((a, b) => b[1].length - a[1].length)
    .map(([p]) => p);
}

// ---------- PGA ----------
function pgaFor(hts, description) {
  const descTokens = tokenSet(description);
  const out = [];
  for (const p of prefixMatches(hts, PGA)) {
    if (!Array.isArray(PGA[p])) continue;
    for (const f of PGA[p]) {
      const entry = { agency: f.agency, requirement_id: f.requirement_id, requirement: f.requirement, semantic: f.semantic, status: "", reason: "" };
      if (f.semantic === "must") {
        entry.status = "REQUIRED";
        entry.reason = `HTS prefix ${p} is a ${f.agency} ${f.requirement} must-flag`;
      } else {
        const disclaimHit = (f.disclaim_if_any || []).filter((k) => tokenize(k).every((t) => descTokens.has(t)));
        if (disclaimHit.length) {
          entry.status = "DISCLAIMABLE";
          entry.reason = `May-flag; description matches disclaim terms [${disclaimHit.join(", ")}], file disclaim code`;
        } else {
          entry.status = "CONFIRM";
          entry.reason = `May-flag; no disclaim evidence in description, confirm with importer`;
        }
      }
      out.push(entry);
    }
  }
  return out;
}

// ---------- Duty ----------
function dutyFor(hts, origin, enteredValue, trace, lineNo) {
  const row = findRow(hts);
  const mfn = row ? row.mfn_rate : 0;
  const surcharges = [];
  const s301 = SUR.section_301;
  if (s301 && (s301.origin || []).includes(origin)) {
    const hit = prefixMatches(hts, s301.rates_by_prefix)[0];
    if (hit !== undefined) {
      const rate = s301.rates_by_prefix[hit];
      if (rate > 0) surcharges.push({ name: "Section 301", rate, basis: `prefix ${hit}, origin ${origin}` });
      trace.push(`L${lineNo}: Section 301 lookup prefix=${hit} origin=${origin} rate=${rate}`);
    }
  }
  const s122 = SUR.section_122;
  if (s122 && s122.enabled && !(s122.exempt_origins || []).includes(origin)) {
    surcharges.push({ name: "Section 122", rate: s122.rate, basis: s122.note || "global surcharge" });
    trace.push(`L${lineNo}: Section 122 applied rate=${s122.rate} (verify in force on demo day)`);
  }
  const adcvd = SUR.ad_cvd?.watch_prefixes || {};
  const adHit = prefixMatches(hts, adcvd)[0];
  const notes = [];
  if (adHit !== undefined) notes.push(`AD/CVD watch: ${adcvd[adHit]}`);
  const total = Math.round((mfn + surcharges.reduce((a, s) => a + s.rate, 0)) * 10000) / 10000;
  return { mfn_rate: mfn, surcharges, total_rate: total, duty_est: Math.round(enteredValue * total * 100) / 100, notes };
}

// ---------- Entry-level fees ----------
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * MPF and HMF are charged on the ENTRY, not on the line, so they are computed once from
 * the shipment's total entered value. This matters: MPF is clamped to an annual minimum
 * and maximum, and a per-line ad-valorem rate cannot express that clamp. On a five line
 * entry, folding MPF into each line's rate over-collects against the cap and silently
 * produces a number a broker would immediately know is wrong.
 *
 * Neither fee is part of the duty rate, so effective_rate stays duty-only and these are
 * reported separately.
 */
function feesFor(shipment, enteredTotal, trace) {
  const cfg = SUR.fees || {};
  const origin = (shipment.origin_country || "").toUpperCase();
  const mode = (shipment.mode || "").toLowerCase();
  const fees = [];

  const mpf = cfg.mpf;
  if (mpf && mpf.enabled) {
    if ((mpf.exempt_origins || []).includes(origin)) {
      trace.push(`fees: MPF treated as exempt for origin ${origin} per config`);
    } else {
      const raw = enteredTotal * mpf.rate;
      const floor = mpf.min_usd ?? 0;
      const cap = mpf.max_usd ?? Infinity;
      const amount = Math.min(Math.max(raw, floor), cap);
      let basis = `${(mpf.rate * 100).toFixed(4)}% of $${round2(enteredTotal)}`;
      if (amount > raw) basis += `, raised to the $${floor} entry minimum`;
      else if (amount < raw) basis += `, capped at the $${cap} entry maximum`;
      fees.push({ name: "MPF", amount: round2(amount), basis, source: mpf.source || "" });
      trace.push(`fees: MPF computed ${round2(raw)} applied ${round2(amount)} (${basis})`);
    }
  }

  const hmf = cfg.hmf;
  if (hmf && hmf.enabled) {
    const modes = (hmf.modes || ["ocean"]).map((m) => String(m).toLowerCase());
    if (modes.includes(mode)) {
      const amount = round2(enteredTotal * hmf.rate);
      fees.push({
        name: "HMF",
        amount,
        basis: `${(hmf.rate * 100).toFixed(3)}% of $${round2(enteredTotal)}, mode ${mode}`,
        source: hmf.source || "",
      });
      trace.push(`fees: HMF ${amount} on ${mode} shipment`);
    } else {
      trace.push(`fees: HMF not applicable, mode "${mode || "unspecified"}" is not a vessel mode`);
    }
  }
  return fees;
}

// ---------- LPCO ----------
function lpcoFor(pga, mode) {
  const docs = new Map();
  for (const d of LPCO.BASE || []) {
    if (/ocean shipments only/i.test(d) && mode && mode.toLowerCase() !== "ocean") continue;
    docs.set(d, { doc: d, required_by: "CBP entry", status: "" });
  }
  for (const f of pga) {
    if (f.status === "DISCLAIMABLE") continue;
    for (const d of LPCO[f.requirement_id] || []) {
      if (!docs.has(d)) docs.set(d, { doc: d, required_by: `${f.agency} ${f.requirement}`, status: "" });
    }
  }
  return [...docs.values()];
}
function markDocs(docs, onFile) {
  const have = [...new Set((onFile || []).map((x) => x.toLowerCase().trim()))];
  for (const d of docs) {
    const key = (d.doc.split(", ")[0] || d.doc).toLowerCase();
    const aliases = key.split(/\s+or\s+/).map((a) => a.split(" (")[0].trim()).filter(Boolean);
    d.status = have.some((h) => aliases.some((a) => a.includes(h) || h.includes(a))) ? "ON_FILE" : "MISSING";
  }
  return docs;
}

// ---------- Main ----------
const trace = [];
const origin = (shipment.origin_country || "").toUpperCase();
const results = [];
let enteredTotal = 0, dutyTotal = 0;
const shipmentFlags = [];

for (const line of shipment.lines) {
  const n = line.line;
  const desc = line.description || "";
  const entered = Math.round((line.qty || 0) * (line.unit_value || 0) * 100) / 100;
  enteredTotal += entered;

  const cls = classify(desc);
  trace.push(`L${n}: classify "${desc}" -> ${cls.candidates.map((c) => `${c.hts}(${c.score})`).join(", ") || "no candidates"} conf=${cls.confidence}`);

  let chosen = cls.candidates[0]?.hts || null;
  const flags = [];
  let needsHuman = false;

  // ---- Precedent: a past human override on a similar line changes the outcome here ----
  const precedent = precedentFor(desc);
  let precedentApplied = null;
  if (precedent) {
    const coldHts = chosen, coldConf = cls.confidence;
    if (findRow(precedent.hts)) {
      chosen = precedent.hts;
      cls.confidence = Math.max(cls.confidence, Math.round(Math.min(0.99, 0.75 + precedent.similarity * 0.2) * 100) / 100);
      cls.candidates = [
        { hts: precedent.hts, score: null, matched: ["[precedent]"], description: findRow(precedent.hts).description },
        ...cls.candidates.filter((c) => c.hts !== precedent.hts),
      ];
      precedentApplied = {
        hts: precedent.hts, reason: precedent.reason || "", by: precedent.by || "broker", at: precedent.at || "",
        source_shipment: precedent.shipment_id || "", similarity: precedent.similarity,
        cold_hts: coldHts, cold_confidence: coldConf,
        changed_outcome: coldHts !== precedent.hts,
      };
      flags.push("PRECEDENT_APPLIED");
      trace.push(`L${n}: PRECEDENT sim=${precedent.similarity} -> ${precedent.hts} (${precedent.by || "broker"}${precedent.shipment_id ? " on " + precedent.shipment_id : ""}${precedent.reason ? ": " + precedent.reason : ""}); cold engine said ${coldHts || "none"} conf=${coldConf}`);
    } else {
      flags.push("PRECEDENT_UNKNOWN_CODE"); needsHuman = true;
      trace.push(`L${n}: precedent ${precedent.hts} not in local HTS subset, escalating`);
    }
  }

  if (!chosen) { flags.push("NO_CANDIDATE"); needsHuman = true; }
  if (cls.confidence < CONFIDENCE_FLOOR) { flags.push("LOW_CONFIDENCE"); needsHuman = true; }

  let declaredCheck = null;
  if (line.hts_declared) {
    const declRow = findRow(line.hts_declared);
    if (!declRow) {
      flags.push("DECLARED_NOT_IN_TABLE"); needsHuman = true;
      trace.push(`L${n}: declared ${line.hts_declared} not in local HTS subset`);
    } else if (chosen && declRow.hts !== chosen) {
      const dDecl = dutyFor(declRow.hts, origin, entered, [], n);
      const dEng = dutyFor(chosen, origin, entered, [], n);
      declaredCheck = {
        declared: declRow.hts, engine: chosen,
        declared_total_rate: dDecl.total_rate, engine_total_rate: dEng.total_rate,
        duty_delta: Math.round((dDecl.duty_est - dEng.duty_est) * 100) / 100,
      };
      flags.push("DECLARED_DIFFERS"); needsHuman = true;
      trace.push(`L${n}: declared ${declRow.hts} (${dDecl.total_rate}) != engine ${chosen} (${dEng.total_rate}); delta=${declaredCheck.duty_delta}`);
      chosen = declRow.hts; // never silently override the filer; keep declared, flag it
    } else if (declRow) {
      chosen = declRow.hts;
      trace.push(`L${n}: declared ${declRow.hts} agrees with engine`);
    }
  }

  const pga = chosen ? pgaFor(chosen, desc) : [];
  for (const f of pga) trace.push(`L${n}: PGA ${f.agency} ${f.requirement} -> ${f.status} (${f.reason})`);
  const duty = chosen ? dutyFor(chosen, origin, entered, trace, n) : { mfn_rate: 0, surcharges: [], total_rate: 0, duty_est: 0, notes: [] };
  dutyTotal += duty.duty_est;
  const lpco = markDocs(lpcoFor(pga, shipment.mode), shipment.documents_on_file);
  const missing = lpco.filter((d) => d.status === "MISSING");
  if (missing.length) { flags.push("LPCO_MISSING"); needsHuman = needsHuman || pga.some((f) => f.status === "REQUIRED"); }
  if (pga.some((f) => f.status === "CONFIRM")) flags.push("PGA_CONFIRM");

  results.push({
    line: n, description: desc, qty: line.qty, unit_value: line.unit_value, entered_value: entered,
    hts: chosen, hts_candidates: cls.candidates, confidence: cls.confidence,
    precedent: precedentApplied,
    declared_check: declaredCheck, pga, duty, lpco, flags, needs_human: needsHuman,
  });
  for (const f of flags) if (!shipmentFlags.includes(f)) shipmentFlags.push(f);
}

const entryFees = feesFor(shipment, enteredTotal, trace);
const feeTotal = entryFees.reduce((a, f) => a + f.amount, 0);

const status = results.some((r) => r.needs_human) ? "NEEDS_REVIEW" : "READY";
const result = {
  engine_version: ENGINE_VERSION,
  generated_at: new Date().toISOString(),
  precedent_store: { path: precedentsPath, entries: PRECEDENTS.length },
  shipment_id: shipment.shipment_id,
  importer: shipment.importer, supplier: shipment.supplier, origin_country: origin,
  incoterm: shipment.incoterm, mode: shipment.mode || null, currency: shipment.currency || "USD",
  lines: results,
  shipment_summary: {
    status,
    entered_value: Math.round(enteredTotal * 100) / 100,
    estimated_duty: Math.round(dutyTotal * 100) / 100,
    effective_rate: enteredTotal ? Math.round((dutyTotal / enteredTotal) * 10000) / 10000 : 0,
    fees: entryFees,
    estimated_fees: round2(feeTotal),
    estimated_total_payable: round2(dutyTotal + feeTotal),
    flags: shipmentFlags,
    lines_needing_human: results.filter((r) => r.needs_human).map((r) => r.line),
    precedents_applied: results.filter((r) => r.precedent).map((r) => ({ line: r.line, hts: r.precedent.hts, changed_outcome: r.precedent.changed_outcome, similarity: r.precedent.similarity })),
    missing_documents: [...new Set(results.flatMap((r) => r.lpco.filter((d) => d.status === "MISSING").map((d) => d.doc)))],
  },
  trace,
  disclaimer: "MFN rates and Section 301 surcharges are read from the USITC Harmonized Tariff Schedule export (2026 rev 7); each surcharge cites the Chapter 99 heading that sets it. MPF and HMF are computed on the entry, not per line, but their figures are unverified: the MPF minimum and maximum are reset every fiscal year and must be confirmed on CBP. PGA flags and LPCO rules are still demo tables. The engine proposes; a licensed broker decides. Not legal or customs advice.",
};

const json = JSON.stringify(result, null, pretty || outPath ? 2 : 0);
if (outPath) { fs.writeFileSync(outPath, json); console.error(`[engine] wrote ${outPath} status=${status}`); }
else process.stdout.write(json + "\n");
