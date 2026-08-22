# Lane 4 memory: MongoDB retrieval

Measured alternative to the Jaccard precedent matcher in `engine/triage.mjs`. Nothing here is
imported by `engine/`, which stays zero-dependency. The driver is scoped to this folder's own
`package.json`.

## Why

The two-tier rule shipped 2026-08-22 (`PRECEDENT_BIND = 0.90`) made binding safe by making it
rare: on lane 4's own corpus only 2 of 7 true paraphrases bind. A plural or a hyphen drops a
line out of binding, and `"LED lamp"` (0.286) never fires at all. Sorted-token signature plus an
equality test is, functionally, a normalised exact-match lookup.

## Run it

```bash
docker run -d --name sovereign-memory -p 27018:27017 \
  -v "$PWD/../../workspace/mongo:/data/db" mongodb/mongodb-atlas-local:8.2.0
ollama pull nomic-embed-text
npm install
node mongo/setup.mjs                              # collections, $jsonSchema, search + vector indexes
node mongo/migrate.mjs <workspace>/precedents.jsonl
node mongo/ab.mjs                                 # the comparison table
```

## Measured, 16 cases, one precedent in the store

|  | jaccard 0.55 / 0.90 | cosine 0.75 / 0.90 |
|---|---|---|
| true paraphrases that fire | 7/7 | 7/7 |
| true paraphrases that **bind** | **2/7** | **6/7** |
| unrelated lines that fire | 0 | 0 |
| known false positive binds | no | no |

Cosine bars are calibrated, not inherited: cosine sits in a higher, narrower band than Jaccard,
and the engine's 0.55 floor applied to cosine would fire on a USB wall charger (0.550).

**Watch this number:** the bind margin over the known false positive is **0.012**
(reading lamp 0.894, lowest true bind 0.906). It holds on this corpus and is not a safety margin.

## Files

- `db.mjs` connection, collection names, thresholds
- `embed.mjs` local embeddings via Ollama (`nomic-embed-text`, 768d). Never Voyage AI: that is
  MongoDB-hosted and would break the zero-egress guarantee
- `setup.mjs` schema validation + `text_idx` (`$search`) and `vector_idx` (`$vectorSearch`)
- `migrate.mjs` import an existing `precedents.jsonl`, embedding each description
- `retrieve.mjs` `retrieveJaccard` / `retrieveVector` / `retrieveHybrid` (`$rankFusion`)
- `ab.mjs` the comparison table above

## Open

- `retrieveHybrid` cannot show its value with one precedent in the store: `$rankFusion` ranks,
  and with N=1 there is nothing to rank. Needs a corpus with confusable precedents.
- `retrieveJaccard` uses `>=` where `triage.mjs:192` uses `>`, so a later precedent supersedes
  on a similarity tie. That bug is still open in the engine.
- Insert-only RBAC (the "deleteOne fails live" demo) needs the container restarted with `--auth`.
