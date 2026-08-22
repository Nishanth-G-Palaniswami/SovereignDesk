// Create the precedent collection with enforced schema, plus the search and vector indexes.
// Idempotent: safe to re-run.
import { db, PRECEDENTS, HTS, EMBED_DIM, close } from "./db.mjs";

const d = await db();
const existing = (await d.listCollections().toArray()).map((c) => c.name);

// $jsonSchema is the difference between "our code promises not to write junk" and "the
// database refuses it". A malformed precedent is rejected at write time instead of being
// silently skipped at read time, which is what engine/triage.mjs does with a bad JSONL line.
const validator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["sig", "description", "hts", "by", "at", "embedding"],
    properties: {
      sig: { bsonType: "string" },
      description: { bsonType: "string", minLength: 1 },
      hts: { bsonType: "string", pattern: "^[0-9]{4}\\.[0-9]{2}\\.[0-9]{2}\\.[0-9]{2}$" },
      reason: { bsonType: "string" },
      by: { bsonType: "string", minLength: 1 },
      shipment_id: { bsonType: "string" },
      line: { bsonType: "int" },
      at: { bsonType: "date" },
      supersedes: { bsonType: ["objectId", "null"] },
      embedding: { bsonType: "array", minItems: EMBED_DIM, maxItems: EMBED_DIM, items: { bsonType: "double" } },
      embedding_model: { bsonType: "string" },
    },
  },
};

if (!existing.includes(PRECEDENTS)) {
  await d.createCollection(PRECEDENTS, { validator, validationAction: "error", validationLevel: "strict" });
  console.log(`created ${PRECEDENTS} with strict schema validation`);
} else {
  await d.command({ collMod: PRECEDENTS, validator, validationAction: "error", validationLevel: "strict" });
  console.log(`updated validator on ${PRECEDENTS}`);
}
if (!existing.includes(HTS)) { await d.createCollection(HTS); console.log(`created ${HTS}`); }

await d.collection(PRECEDENTS).createIndex({ sig: 1 });
await d.collection(PRECEDENTS).createIndex({ at: -1 });
await d.collection(PRECEDENTS).createIndex({ supersedes: 1 });
await d.collection(HTS).createIndex({ hts: 1 }, { unique: true });

async function ensureSearchIndex(coll, spec) {
  const have = await d.collection(coll).listSearchIndexes().toArray().catch(() => []);
  if (have.some((i) => i.name === spec.name)) { console.log(`  ${coll}.${spec.name} exists`); return; }
  await d.collection(coll).createSearchIndex(spec);
  console.log(`  ${coll}.${spec.name} created`);
}

for (const coll of [PRECEDENTS, HTS]) {
  await ensureSearchIndex(coll, {
    name: "text_idx", type: "search",
    definition: { mappings: { dynamic: false, fields: { description: { type: "string" } } } },
  });
  await ensureSearchIndex(coll, {
    name: "vector_idx", type: "vectorSearch",
    definition: { fields: [{ type: "vector", path: "embedding", numDimensions: EMBED_DIM, similarity: "cosine" }] },
  });
}

console.log("setup complete");
await close();
