#!/usr/bin/env node
/**
 * Prove the append-only claim is ENFORCED, not promised.
 *
 *   node mongo/immutability.mjs --uri mongodb://127.0.0.1:27019/?directConnection=true \
 *       --root-user admin --root-pass "<pw>"
 *
 * PLAN.md calls the precedent store "append only" and lane 4's brief says a precedent is
 * "superseded by a new reclassify, never erased ... the file is the audit trail". With a
 * JSONL file that is a convention: nothing stops `vim` or a stray fs.writeFileSync. A broker
 * defending a CBP audit is relying on a promise about our code.
 *
 * This creates a role that can insert and read and NOTHING else, then tries to rewrite
 * history as that user. The deletes and updates fail at the database, with an authorization
 * error, regardless of what the application code does.
 *
 * Credentials are passed in at run time and never written to the repo.
 */
import { MongoClient } from "mongodb";

const opt = (n, d = null) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const URI = opt("--uri");
const RU = opt("--root-user", "admin");
const RP = opt("--root-pass");
const DB = opt("--db", "sovereigndesk");
const DESK_USER = "customsdesk";
const DESK_PASS = opt("--desk-pass") || process.env.DESK_PASS;
if (!URI || !RP || !DESK_PASS) {
  console.error("usage: node mongo/immutability.mjs --uri <uri> --root-pass <pw> --desk-pass <pw>");
  process.exit(2);
}
// authSource=admin is required: both users live in admin, and without it the driver
// authenticates against the default db and fails with AuthenticationFailed.
const withCreds = (uri, u, p) =>
  uri.replace("mongodb://", `mongodb://${encodeURIComponent(u)}:${encodeURIComponent(p)}@`) +
  (uri.includes("authSource=") ? "" : (uri.includes("?") ? "&" : "?") + "authSource=admin");

// ---- 1. as root: define a role that can only append ----
{
  const c = new MongoClient(withCreds(URI, RU, RP));
  await c.connect();
  const admin = c.db(DB);
  await admin.command({ dropRole: "precedentAppender" }).catch(() => {});
  await admin.command({ dropUser: DESK_USER }).catch(() => {});
  await admin.command({
    createRole: "precedentAppender",
    privileges: [{
      resource: { db: DB, collection: "precedents" },
      // insert and read. No update. No remove. No collMod, no dropCollection.
      actions: ["insert", "find"],
    }],
    roles: [{ role: "read", db: DB }],
  });
  // create the desk user in admin so one authSource covers both
  await c.db("admin").command({ dropUser: DESK_USER }).catch(() => {});
  await c.db("admin").command({ createUser: DESK_USER, pwd: DESK_PASS, roles: [{ role: "precedentAppender", db: DB }] });
  console.log(`role precedentAppender created: actions = ["insert","find"]`);
  await c.close();
}

// ---- 2. as the desk user: try to rewrite history ----
const c = new MongoClient(withCreds(URI, DESK_USER, DESK_PASS));
await c.connect();
const coll = c.db(DB).collection("precedents");

const attempt = async (label, fn) => {
  try { const r = await fn(); console.log(`  ALLOWED  ${label}  ${JSON.stringify(r).slice(0, 60)}`); return true; }
  catch (e) { console.log(`  REFUSED  ${label}  ${e.codeName || e.code}: ${String(e.message).slice(0, 72)}`); return false; }
};

console.log(`\nas ${DESK_USER}:`);
const before = await coll.countDocuments();
console.log(`  ${before} precedent(s) in the store`);
const ok = [];
ok.push(["read", await attempt("find one precedent", () => coll.findOne({}, { projection: { hts: 1, _id: 0 } }))]);
ok.push(["append", await attempt("insert a new precedent", async () => {
  const doc = { sig: "immutability probe", description: "immutability probe", hts: "9999.99.99.99",
    reason: "written by mongo/immutability.mjs", by: "probe", shipment_id: "PROBE", line: 1,
    at: new Date(), supersedes: null, embedding: Array(768).fill(0.0), embedding_model: "probe" };
  const r = await coll.insertOne(doc); return { insertedId: String(r.insertedId) };
})]);
ok.push(["delete", await attempt("deleteOne  (must fail)", () => coll.deleteOne({ shipment_id: "PROBE" }))]);
ok.push(["update", await attempt("updateOne  (must fail)", () => coll.updateOne({}, { $set: { hts: "0000.00.00.00" } }))]);
ok.push(["drop", await attempt("drop the collection (must fail)", () => coll.drop())]);

const after = await coll.countDocuments();
console.log(`  ${after} precedent(s) after the attempts`);
await c.close();

const [, canRead] = ok[0], [, canAppend] = ok[1], [, canDelete] = ok[2], [, canUpdate] = ok[3], [, canDrop] = ok[4];
const pass = canRead && canAppend && !canDelete && !canUpdate && !canDrop && after >= before;
console.log(`\n${pass ? "PASS" : "FAIL"}: append-only is ${pass ? "enforced by the database" : "NOT enforced"}`);
process.exit(pass ? 0 : 1);
