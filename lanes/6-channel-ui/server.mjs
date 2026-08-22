#!/usr/bin/env node
/**
 * server.mjs, the local review console for SovereignDesk.
 *
 *   node lanes/6-channel-ui/server.mjs --root workspace [--port 7777]
 *
 * Binds to 127.0.0.1 ONLY. This is the entire human-in-the-loop surface: there is no chat
 * channel, no relay, no allowlist. The network policy on the box is drop, and this page is
 * reachable over loopback because loopback is the one thing that is not dropped.
 *
 * Zero dependencies, matching engine/. No Python, no pip, no wheels: the box is aarch64 and
 * unavailable ARM wheels kill more hackathon teams than bad ideas do.
 *
 * WHO WRITES WHAT. The agent (OpenClaw) writes memos. This console handles human actions.
 * They do not overlap, so there is only ever one writer for a given artefact. For a
 * reclassify the console shells out to engine/record_precedent.mjs, which stays the single
 * sanctioned way a precedent is ever appended.
 *
 * Endpoints:
 *   GET  /                      the console
 *   GET  /api/health
 *   GET  /api/shipments         every result, newest first
 *   GET  /api/shipment/:id
 *   GET  /api/stream            SSE. pushes on any change under results/
 *   POST /api/review            {shipment_id, action: APPROVE|RECLASSIFY, line?, hts?, reason?}
 *   POST /api/replay            {shipment_id, memory: bool} -> re-runs one shipment with or
 *                               without the precedent store. This is the A/B moment: same
 *                               file, memory off gets it wrong, memory on gets it right.
 *                               Non-destructive, it never touches results/.
 */

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const argv = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const ROOT = path.resolve(opt("--root", path.join(REPO, "workspace")));
const PORT = Number(opt("--port", process.env.CONSOLE_PORT || 7777));
const HOST = "127.0.0.1";

const dirs = {
  results: path.join(ROOT, "results"),
  memos: path.join(ROOT, "memos"),
  decisions: path.join(ROOT, "decisions"),
  inbox: path.join(ROOT, "inbox"),
};
for (const d of Object.values(dirs)) fs.mkdirSync(d, { recursive: true });

// ---------------------------------------------------------------- data

function readResults() {
  let files = [];
  try {
    files = fs.readdirSync(dirs.results).filter((f) => f.endsWith(".result.json"));
  } catch { return []; }
  const out = [];
  for (const f of files) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dirs.results, f), "utf8"));
      const id = d.shipment_id;
      let memo = null;
      const memoPath = path.join(dirs.memos, `${id}.memo.md`);
      if (fs.existsSync(memoPath)) memo = fs.readFileSync(memoPath, "utf8");
      let decision = null;
      const decPath = path.join(dirs.decisions, `${id}.decision.json`);
      if (fs.existsSync(decPath)) {
        try { decision = JSON.parse(fs.readFileSync(decPath, "utf8")); } catch { /* partial write */ }
      }
      out.push({ ...d, memo, decision, _mtime: fs.statSync(path.join(dirs.results, f)).mtimeMs });
    } catch { /* a half-written file on the next tick is normal, skip it */ }
  }
  return out.sort((a, b) => b._mtime - a._mtime);
}

function precedentCount() {
  try {
    return fs.readFileSync(path.join(ROOT, "precedents.jsonl"), "utf8")
      .split("\n").filter((l) => l.trim()).length;
  } catch { return 0; }
}

// ---------------------------------------------------------------- SSE

const clients = new Set();
function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(payload); } catch { clients.delete(res); } }
}

let debounce = null;
function onChange(reason) {
  clearTimeout(debounce);
  // The engine writes several files per sweep. Coalesce so the page repaints once.
  debounce = setTimeout(() => {
    broadcast("refresh", { reason, at: new Date().toISOString(), precedents: precedentCount() });
  }, 150);
}
for (const [name, dir] of Object.entries(dirs)) {
  try { fs.watch(dir, { persistent: true }, () => onChange(name)); }
  catch (e) { console.error(`[console] cannot watch ${dir}: ${e.message}`); }
}
try { fs.watch(ROOT, { persistent: true }, (_, f) => { if (f === "precedents.jsonl") onChange("precedents"); }); } catch { /* fine */ }

// ---------------------------------------------------------------- helpers

const send = (res, code, body, type = "application/json") => {
  const payload = type === "application/json" ? JSON.stringify(body) : body;
  res.writeHead(code, {
    "Content-Type": type + (type.startsWith("text/") ? "; charset=utf-8" : ""),
    "Cache-Control": "no-store",
  });
  res.end(payload);
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = "";
    req.on("data", (c) => {
      b += c;
      if (b.length > 1e6) { reject(new Error("body too large")); req.destroy(); }
    });
    req.on("end", () => {
      try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(new Error("body is not JSON")); }
    });
    req.on("error", reject);
  });
}

const runNode = (args, cwd = REPO) =>
  new Promise((resolve, reject) => {
    execFile(process.execPath, args, { cwd, timeout: 120000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve({ stdout, stderr });
    });
  });

// ---------------------------------------------------------------- routes

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const p = url.pathname;

  try {
    if (p === "/" || p === "/index.html") {
      const f = path.join(path.dirname(fileURLToPath(import.meta.url)), "index.html");
      if (!fs.existsSync(f)) return send(res, 500, "index.html is missing next to server.mjs", "text/plain");
      return send(res, 200, fs.readFileSync(f, "utf8"), "text/html");
    }

    if (p === "/api/health") {
      return send(res, 200, {
        ok: true, root: ROOT, port: PORT, host: HOST,
        shipments: readResults().length, precedents: precedentCount(),
        node: process.version, hostname: os.hostname(),
      });
    }

    if (p === "/api/shipments") return send(res, 200, readResults());

    if (p.startsWith("/api/shipment/")) {
      const id = decodeURIComponent(p.slice("/api/shipment/".length));
      const hit = readResults().find((s) => s.shipment_id === id);
      return hit ? send(res, 200, hit) : send(res, 404, { error: `no shipment ${id}` });
    }

    if (p === "/api/stream") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(`event: hello\ndata: ${JSON.stringify({ at: new Date().toISOString(), precedents: precedentCount() })}\n\n`);
      clients.add(res);
      const ka = setInterval(() => { try { res.write(": keepalive\n\n"); } catch { /* closing */ } }, 20000);
      req.on("close", () => { clearInterval(ka); clients.delete(res); });
      return;
    }

    if (p === "/api/review" && req.method === "POST") {
      const body = await readBody(req);
      const id = String(body.shipment_id || "").trim();
      const action = String(body.action || "").toUpperCase();
      if (!id) return send(res, 400, { error: "shipment_id is required" });

      if (action === "APPROVE") {
        const decision = {
          shipment_id: id, decision: "APPROVED", by: "human (console)",
          at: new Date().toISOString(),
        };
        fs.writeFileSync(path.join(dirs.decisions, `${id}.decision.json`), JSON.stringify(decision, null, 2));
        onChange("decision");
        return send(res, 200, { ok: true, decision });
      }

      if (action === "RECLASSIFY") {
        const line = Number(body.line);
        const hts = String(body.hts || "").trim();
        const reason = String(body.reason || "").trim();
        if (!Number.isInteger(line) || line < 1) return send(res, 400, { error: "line must be a positive integer" });
        if (!hts) return send(res, 400, { error: "hts is required" });
        if (!reason) return send(res, 400, { error: "a reason is required. the reason IS the institutional memory" });

        // The single sanctioned write path for a precedent. Never append here directly.
        const { stdout } = await runNode([
          path.join("engine", "record_precedent.mjs"),
          "--shipment", id, "--line", String(line), "--hts", hts,
          "--reason", reason, "--root", ROOT,
        ]);
        onChange("precedent");
        let recorded = null;
        try { recorded = JSON.parse(stdout); } catch { /* tool prints json, but do not die on it */ }
        return send(res, 200, { ok: true, recorded, stdout: recorded ? undefined : stdout });
      }

      return send(res, 400, { error: `unknown action ${action}` });
    }

    /**
     * The A/B moment. Re-runs ONE shipment twice against the same input file: once with the
     * precedent store, once with an empty one. Writes nothing into results/, so the live
     * demo state is untouched and this is safe to hit on stage.
     */
    if (p === "/api/replay" && req.method === "POST") {
      const body = await readBody(req);
      const id = String(body.shipment_id || "").trim();
      const withMemory = body.memory !== false;
      if (!id) return send(res, 400, { error: "shipment_id is required" });

      const candidates = [
        path.join(ROOT, "processed", `${id}.json`),
        path.join(dirs.inbox, `${id}.json`),
      ];
      let src = candidates.find((f) => fs.existsSync(f));
      if (!src) {
        // process_inbox keeps the original filename, which is not always the shipment id
        for (const dir of [path.join(ROOT, "processed"), dirs.inbox]) {
          if (!fs.existsSync(dir)) continue;
          for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
            try {
              if (JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).shipment_id === id) {
                src = path.join(dir, f); break;
              }
            } catch { /* skip */ }
          }
          if (src) break;
        }
      }
      if (!src) return send(res, 404, { error: `cannot find the source file for ${id}` });

      const args = [path.join("engine", "triage.mjs"), src];
      if (!withMemory) {
        const empty = path.join(os.tmpdir(), `sd-empty-${process.pid}.jsonl`);
        fs.writeFileSync(empty, "");
        args.push("--precedents", empty);
      } else {
        args.push("--precedents", path.join(ROOT, "precedents.jsonl"));
      }
      const { stdout } = await runNode(args);
      return send(res, 200, { memory: withMemory, result: JSON.parse(stdout) });
    }

    return send(res, 404, { error: `no route ${p}` });
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, HOST, () => {
  console.error(`[console] http://${HOST}:${PORT}`);
  console.error(`[console] workspace ${ROOT}`);
  console.error(`[console] ${readResults().length} shipments, ${precedentCount()} precedents`);
  console.error(`[console] bound to loopback only. nothing here is reachable off the box.`);
});
