#!/usr/bin/env node
/**
 * matrix_bridge.mjs, the human-in-the-loop channel for SovereignDesk.
 *
 * Talks to a Matrix homeserver running ON the box over the Client-Server API.
 * Zero dependencies: Node 24 has global fetch. Same house style as engine/.
 *
 * Why Matrix and not Telegram: the homeserver is local, so the OpenShell outbound
 * allowlist stays EMPTY. The claim moves from "only a short text memo leaves the box"
 * to "nothing leaves the box". That is the whole sovereignty argument, so this file is
 * load bearing for the pitch, not just for the demo.
 *
 *   node lanes/6-channel-ui/matrix_bridge.mjs --post "hello from the desk"
 *   node lanes/6-channel-ui/matrix_bridge.mjs --post-file ws/memos/SHP-2026-0822-006.memo.md
 *   node lanes/6-channel-ui/matrix_bridge.mjs --listen
 *   node lanes/6-channel-ui/matrix_bridge.mjs --whoami
 *
 * STATUS: written against the Matrix Client-Server API v3. NOT yet run against a live
 * homeserver, because there was no homeserver to run it against when it was written.
 * Lane 6 owner: stand up Conduit, then run --whoami first. That single call proves the
 * homeserver address, the access token and network reachability from wherever you are
 * running it, before anything else can confuse you.
 *
 * Endpoints used, all v3:
 *   GET  /_matrix/client/v3/account/whoami
 *   PUT  /_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}
 *   GET  /_matrix/client/v3/sync?since={batch}&timeout={ms}
 *   POST /_matrix/client/v3/login                      (only for --login)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// ---------------------------------------------------------------- env

/**
 * Minimal .env reader. PowerShell writes BOM/UTF-16 by default, so strip a BOM rather
 * than letting the first key silently become "﻿MATRIX_HOMESERVER".
 */
function loadEnv() {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv();

const HOMESERVER = (process.env.MATRIX_HOMESERVER || "").replace(/\/+$/, "");
const TOKEN = process.env.MATRIX_ACCESS_TOKEN || "";
const ROOM = process.env.MATRIX_ROOM_ID || "";

function requireEnv(...keys) {
  const missing = keys.filter((k) => !process.env[k] || process.env[k] === "replace_me");
  if (missing.length) {
    console.error(`missing in .env: ${missing.join(", ")}`);
    console.error(`copy .env.example to .env and fill it in. never commit .env.`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------- transport

async function mx(method, endpoint, { body, auth = true, query } = {}) {
  const url = new URL(HOMESERVER + endpoint);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  }
  const headers = { "Content-Type": "application/json" };
  if (auth) headers.Authorization = `Bearer ${TOKEN}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let parsed;
  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }

  if (!res.ok) {
    // Matrix returns {errcode, error}. Surface both: errcode is what you grep for.
    const code = parsed.errcode || res.status;
    const msg = parsed.error || text.slice(0, 200);
    throw new Error(`matrix ${method} ${endpoint} failed: ${code} ${msg}`);
  }
  return parsed;
}

// ---------------------------------------------------------------- commands

async function whoami() {
  requireEnv("MATRIX_HOMESERVER", "MATRIX_ACCESS_TOKEN");
  const me = await mx("GET", "/_matrix/client/v3/account/whoami");
  console.log(JSON.stringify({ homeserver: HOMESERVER, ...me }, null, 2));
}

/**
 * Post a message. Matrix requires a unique transaction id per send so a retried request
 * is not delivered twice. Do NOT use Math.random here: a counter plus the clock is enough
 * and it stays readable in the homeserver logs while you are debugging on stage.
 */
let txnCounter = 0;
async function post(text) {
  requireEnv("MATRIX_HOMESERVER", "MATRIX_ACCESS_TOKEN", "MATRIX_ROOM_ID");
  if (!text || !text.trim()) throw new Error("refusing to post an empty message");
  const txnId = `sd-${Date.now()}-${txnCounter++}`;
  const endpoint =
    `/_matrix/client/v3/rooms/${encodeURIComponent(ROOM)}` +
    `/send/m.room.message/${encodeURIComponent(txnId)}`;
  const out = await mx("PUT", endpoint, { body: { msgtype: "m.text", body: text } });
  console.log(JSON.stringify({ posted: true, event_id: out.event_id, chars: text.length }));
  return out;
}

/**
 * The reply grammar. This MUST stay identical to agent/AGENTS.md, because the agent and
 * this bridge are two independent readers of the same human input. If you change one,
 * change the other in the same commit.
 *
 *   approve <id>
 *   reclassify <id> line <n> to <hts> [because <reason>]
 *   status
 *   why <id>
 *   precedents
 */
export function parseCommand(raw) {
  const text = (raw || "").trim();
  if (!text) return null;

  let m = text.match(/^approve\s+(\S+)\s*$/i);
  if (m) return { cmd: "approve", shipment_id: m[1] };

  m = text.match(/^reclassify\s+(\S+)\s+line\s+(\d+)\s+to\s+(\S+?)(?:\s+because\s+(.+))?\s*$/i);
  if (m) {
    return {
      cmd: "reclassify",
      shipment_id: m[1],
      line: Number(m[2]),
      hts: m[3],
      reason: (m[4] || "").trim() || "no reason given",
    };
  }

  if (/^status\s*$/i.test(text)) return { cmd: "status" };

  m = text.match(/^why\s+(\S+)\s*$/i);
  if (m) return { cmd: "why", shipment_id: m[1] };

  if (/^precedents\s*$/i.test(text)) return { cmd: "precedents" };

  return { cmd: "unknown", text };
}

/**
 * Long-poll /sync and print any recognised command as one JSON line on stdout.
 *
 * Deliberately does NOT execute anything. Lane 5 owns the agent, and the agent is the
 * only thing allowed to write decisions or record precedents. Two independent writers
 * into decisions/ is exactly how a live demo breaks. Pipe this into whatever the agent
 * consumes, or read it as a debugging window on what the room is actually sending.
 */
async function listen() {
  requireEnv("MATRIX_HOMESERVER", "MATRIX_ACCESS_TOKEN", "MATRIX_ROOM_ID");
  const me = await mx("GET", "/_matrix/client/v3/account/whoami");
  const selfId = me.user_id;
  console.error(`listening as ${selfId} on ${ROOM} via ${HOMESERVER}`);

  // First sync with no `since` returns a baseline. Take the token and ignore the backlog,
  // otherwise every old message replays as a fresh command the moment you start up.
  let since = (await mx("GET", "/_matrix/client/v3/sync", { query: { timeout: 0 } })).next_batch;
  console.error("baseline taken, waiting for new messages");

  for (;;) {
    let res;
    try {
      res = await mx("GET", "/_matrix/client/v3/sync", { query: { since, timeout: 30000 } });
    } catch (err) {
      // A homeserver restart or a dropped tunnel should not kill the bridge mid-demo.
      console.error(`sync error, retrying in 3s: ${err.message}`);
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    since = res.next_batch;

    const room = res.rooms?.join?.[ROOM];
    for (const ev of room?.timeline?.events || []) {
      if (ev.type !== "m.room.message") continue;
      if (ev.sender === selfId) continue;              // never react to our own memos
      if (ev.content?.msgtype !== "m.text") continue;
      const parsed = parseCommand(ev.content.body);
      if (!parsed) continue;
      console.log(JSON.stringify({
        from: ev.sender,
        at: new Date(ev.origin_server_ts).toISOString(),
        event_id: ev.event_id,
        ...parsed,
      }));
    }
  }
}

/**
 * Password login, only to mint an access token the first time. Run it once by hand, put
 * the token in .env, and never put the password anywhere. Reads the password from stdin
 * so it does not land in your shell history or in a transcript.
 */
async function login() {
  requireEnv("MATRIX_HOMESERVER", "MATRIX_USER");
  const user = process.env.MATRIX_USER;
  const localpart = user.startsWith("@") ? user.slice(1).split(":")[0] : user;

  process.stderr.write(`password for ${user} (input is read from stdin, not echoed by your shell): `);
  const password = await new Promise((resolve) => {
    let buf = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => { buf += d; });
    process.stdin.on("end", () => resolve(buf.trim()));
  });
  if (!password) throw new Error("no password on stdin");

  const out = await mx("POST", "/_matrix/client/v3/login", {
    auth: false,
    body: {
      type: "m.login.password",
      identifier: { type: "m.id.user", user: localpart },
      password,
    },
  });
  console.error("\npaste this into .env as MATRIX_ACCESS_TOKEN, then delete it from your scrollback:");
  console.log(out.access_token);
}

// ---------------------------------------------------------------- cli

const argv = process.argv.slice(2);
function flag(name) {
  const i = argv.indexOf(name);
  return i === -1 ? null : (argv[i + 1] ?? "");
}

// Only run the CLI when executed directly, so `import { parseCommand }` stays testable.
const runDirectly =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (runDirectly) try {
  if (argv.includes("--whoami")) {
    await whoami();
  } else if (argv.includes("--login")) {
    await login();
  } else if (argv.includes("--listen")) {
    await listen();
  } else if (flag("--post") !== null) {
    await post(flag("--post"));
  } else if (flag("--post-file") !== null) {
    const f = flag("--post-file");
    if (!fs.existsSync(f)) throw new Error(`no such file: ${f}`);
    await post(fs.readFileSync(f, "utf8").replace(/^﻿/, ""));
  } else {
    console.error(`usage:
  --whoami                 prove homeserver + token work. run this first.
  --login                  mint an access token from a password on stdin. run once.
  --post "<text>"          post a message to MATRIX_ROOM_ID
  --post-file <path>       post a file's contents (use this for memos)
  --listen                 long-poll and print recognised commands as JSON lines`);
    process.exit(1);
  }
} catch (err) {
  console.error(String(err.message || err));
  process.exit(1);
}
