// Lane 4 memory: connection + shared config. Nothing here is imported by engine/.
import { MongoClient } from "mongodb";

export const MONGO_URI = process.env.MEMORY_MONGO_URI || "mongodb://127.0.0.1:27018/?directConnection=true";
export const DB_NAME = process.env.MEMORY_DB || "sovereigndesk";
export const PRECEDENTS = "precedents";
export const HTS = "hts_lines";

export const EMBED_MODEL = process.env.EMBED_MODEL || "nomic-embed-text";
export const EMBED_DIM = 768;

// Must match engine/triage.mjs. The two-tier rule shipped 2026-08-22.
export const PRECEDENT_FLOOR = 0.55;
export const PRECEDENT_BIND = 0.90;

let client;
export async function db() {
  if (!client) { client = new MongoClient(MONGO_URI); await client.connect(); }
  return client.db(DB_NAME);
}
export async function close() { if (client) { await client.close(); client = null; } }
