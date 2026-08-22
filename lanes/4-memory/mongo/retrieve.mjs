// Three retrieval strategies over the same precedent collection, so they can be compared
// on identical inputs. jaccard() is a faithful copy of engine/triage.mjs so the A/B is honest.
import { db, PRECEDENTS, EMBED_DIM, close } from "./db.mjs";
import { embed } from "./embed.mjs";

// ---- keep in sync with engine/triage.mjs signature()/jaccard() ----
const STOP = new Set(["the","a","an","of","for","and","or","with","in","to","by","on","at","from","other","nesoi","n.e.s.o.i","x","pcs","pc","each","set","sets"]);
const tokenize = (s) => (s || "").toLowerCase().replace(/[^a-z0-9%.\s-]/g, " ").split(/\s+/)
  .map((t) => t.replace(/^[-.]+|[-.]+$/g, "")).filter((t) => t && !STOP.has(t))
  .map((t) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t));
export const signature = (d) => [...new Set(tokenize(d))].sort().join(" ");
export function jaccardSim(a, b) {
  const A = new Set(a.split(" ").filter(Boolean)), B = new Set(b.split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let i = 0; for (const t of A) if (B.has(t)) i++;
  return i / (A.size + B.size - i);
}

export async function retrieveJaccard(description) {
  const d = await db();
  const sig = signature(description);
  let best = null, bestSim = 0;
  for await (const p of d.collection(PRECEDENTS).find({}, { projection: { embedding: 0 } })) {
    const sim = p.sig === sig ? 1 : jaccardSim(sig, p.sig);
    if (sim >= bestSim) { bestSim = sim; best = p; }   // >= so a later record supersedes on a tie
  }
  return best ? { ...best, similarity: round(bestSim), how: "jaccard" } : null;
}

export async function retrieveVector(description, queryVector) {
  const d = await db();
  const qv = queryVector || (await embed(description));
  const [hit] = await d.collection(PRECEDENTS).aggregate([
    { $vectorSearch: { index: "vector_idx", path: "embedding", queryVector: qv, numCandidates: 100, limit: 1 } },
    { $project: { embedding: 0, score: { $meta: "vectorSearchScore" } } },
  ]).toArray();
  if (!hit) return null;
  // cosine similarity index scores are normalised to (1 + cos) / 2; undo it so the number is
  // comparable to a Jaccard similarity and to the engine's two bars.
  return { ...hit, similarity: round(2 * hit.score - 1), raw_score: hit.score, how: "vector" };
}

export async function retrieveHybrid(description, queryVector) {
  const d = await db();
  const qv = queryVector || (await embed(description));
  const [hit] = await d.collection(PRECEDENTS).aggregate([
    { $rankFusion: {
        input: { pipelines: {
          lexical: [{ $search: { index: "text_idx", text: { query: description, path: "description" } } }, { $limit: 20 }],
          semantic: [{ $vectorSearch: { index: "vector_idx", path: "embedding", queryVector: qv, numCandidates: 100, limit: 20 } }],
        } },
        combination: { weights: { lexical: 1, semantic: 1 } },
        scoreDetails: true,
    } },
    { $limit: 1 },
    { $project: { embedding: 0, rrf: { $meta: "score" }, details: { $meta: "scoreDetails" } } },
  ]).toArray();
  if (!hit) return null;
  // $rankFusion ranks; it does not produce a similarity. Use it to pick WHICH precedent,
  // then score that choice with cosine so the bind/suggest bars stay meaningful.
  const [cos] = await d.collection(PRECEDENTS).aggregate([
    { $vectorSearch: { index: "vector_idx", path: "embedding", queryVector: qv, numCandidates: 100, limit: 5 } },
    { $match: { _id: hit._id } },
    { $project: { _id: 1, score: { $meta: "vectorSearchScore" } } },
  ]).toArray();
  return { ...hit, similarity: cos ? round(2 * cos.score - 1) : null, rrf: hit.rrf, how: "hybrid" };
}

const round = (n) => Math.round(n * 1000) / 1000;
export { close, EMBED_DIM };
