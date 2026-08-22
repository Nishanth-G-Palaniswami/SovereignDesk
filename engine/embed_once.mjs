#!/usr/bin/env node
/**
 * Print one embedding as a JSON array. Exists so synchronous callers can get a vector:
 * engine/triage.mjs is sync top to bottom and fetch() is not, so mongo_precedents.mjs
 * spawns this with execFileSync, exactly as it already does for mongosh.
 *
 *   node engine/embed_once.mjs "<text>"
 *
 * Local Ollama only. Never a hosted embedding service.
 */
const text = process.argv[2];
if (typeof text !== "string") { console.error("usage: node embed_once.mjs <text>"); process.exit(2); }
const HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const MODEL = process.env.EMBED_MODEL || "nomic-embed-text";
const res = await fetch(`${HOST}/api/embed`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: MODEL, input: [text] }),
});
if (!res.ok) { console.error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`); process.exit(3); }
const j = await res.json();
if (!Array.isArray(j.embeddings?.[0])) { console.error("no embedding in response"); process.exit(3); }
process.stdout.write(JSON.stringify(j.embeddings[0]));
