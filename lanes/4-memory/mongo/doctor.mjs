#!/usr/bin/env node
// Bring-up check for the lane 4 memory layer. Run this FIRST on any new machine, and again
// after any engine merge. Exits non-zero on the first thing that is actually broken.
//
//   node mongo/doctor.mjs
//
// Every value it prints is read from the running system, never assumed.
import { MONGO_URI, DB_NAME, PRECEDENTS, HTS, EMBED_MODEL, EMBED_DIM, db, close } from "./db.mjs";

const OLLAMA = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
let failed = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const warn = (m) => console.log(`  warn  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); failed++; };

console.log(`\nmongo   ${MONGO_URI}`);
let d;
try {
  d = await db();
  const build = await d.admin().command({ buildInfo: 1 });
  const hello = await d.admin().command({ hello: 1 });
  ok(`server ${build.version}`);
  if (Number(build.version.split(".").slice(0, 2).join(".")) < 8.2) {
    bad(`need 8.2+ for self-managed $search / $vectorSearch (mongot)`);
  }
  if (hello.setName) ok(`replica set "${hello.setName}" (change streams + mongot need this)`);
  else bad(`standalone mongod: no replica set, so no change streams and no mongot sync`);
} catch (e) {
  bad(`cannot connect: ${e.message}`);
  console.log(`\n${failed} check(s) failed\n`); process.exit(1);
}

for (const coll of [PRECEDENTS, HTS]) {
  const idx = await d.collection(coll).listSearchIndexes().toArray().catch(() => null);
  if (idx === null) { bad(`${coll}: listSearchIndexes failed, mongot is probably not running`); continue; }
  const names = idx.map((i) => i.name);
  const queryable = idx.filter((i) => i.queryable).map((i) => i.name);
  for (const want of ["text_idx", "vector_idx"]) {
    if (!names.includes(want)) bad(`${coll}.${want} missing, run: node mongo/setup.mjs`);
    else if (!queryable.includes(want)) warn(`${coll}.${want} exists but is still building`);
    else ok(`${coll}.${want} queryable`);
  }
  const n = await d.collection(coll).countDocuments();
  (n ? ok : warn)(`${coll}: ${n} document(s)`);
}

console.log(`\nollama  ${OLLAMA}`);
try {
  const v = await (await fetch(`${OLLAMA}/api/version`)).json();
  ok(`version ${v.version}`);
  const tags = await (await fetch(`${OLLAMA}/api/tags`)).json();
  const has = (tags.models || []).some((m) => m.name.startsWith(EMBED_MODEL));
  if (!has) bad(`${EMBED_MODEL} not pulled, run: ollama pull ${EMBED_MODEL}`);
  else {
    const r = await fetch(`${OLLAMA}/api/embed`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: "calibration probe" }),
    });
    const dim = (await r.json()).embeddings?.[0]?.length;
    if (dim === EMBED_DIM) ok(`${EMBED_MODEL} returns ${dim} dimensions`);
    else bad(`${EMBED_MODEL} returned ${dim} dimensions, indexes are built for ${EMBED_DIM}`);
  }
} catch (e) {
  bad(`cannot reach ollama: ${e.message}`);
}

console.log(`\ndb "${DB_NAME}" ${failed ? `\n\n${failed} check(s) failed` : "\n\nall checks passed"}\n`);
await close();
process.exit(failed ? 1 : 0);
