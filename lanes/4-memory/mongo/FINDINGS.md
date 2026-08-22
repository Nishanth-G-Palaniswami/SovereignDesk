# Lane 4 findings: MongoDB retrieval, measured

All numbers below were produced on the GB10 (`nvidia-smi`, aarch64, Ubuntu 24.04.4) against
MongoDB 8.2.0 (atlas-local, `mongot` live) with `nomic-embed-text` on Ollama 0.32.15.
Reproduce with `node mongo/doctor.mjs`, then `node mongo/ab.mjs` and `node mongo/classify.mjs --samples`.

---

## 1. Precedent retrieval: cosine triples the binding recall

Lane 4's own 16-case corpus, one precedent in the store. Identical to three decimals on the
laptop and on the box.

| | jaccard 0.55 / 0.90 | cosine 0.75 / 0.90 |
|---|---|---|
| true paraphrases that fire | 7/7 | 7/7 |
| true paraphrases that **bind** | **2/7** | **6/7** |
| unrelated lines that fire | 0 | 0 |
| known false positive binds | no | no |

The two-tier rule made binding safe by making it rare. Under Jaccard only the identical string
and a pure word reorder bind; a plural, a hyphen, or "USB powered" instead of "USB rechargeable"
all drop out. `"LED lamp"`, the terse description PLAN.md calls the common invoice case, scores
0.286 and never fires. Under cosine it scores 0.767 and surfaces as a suggestion.

**Watch this number:** the bind margin over the known reading-lamp false positive is **0.012**
(0.894 vs the lowest true bind at 0.906). It holds on this corpus. It is not a safety margin,
and it is the honest answer if a judge asks what breaks.

Cosine bars are calibrated, not inherited. Cosine sits in a higher, narrower band than Jaccard:
the engine's 0.55 floor applied to cosine fires on a USB wall charger (0.550).

---

## 2. Classification over the real schedule: useful, not autonomous

All 19,856 ten-digit lines of USITC 2026 rev 7, embedded and indexed, loaded in 130 seconds.
`engine/triage.mjs` scores keywords against the 16 curated rows of `hts_subset.csv`; this is
the whole schedule, retrievable with `$rankFusion` over a lexical and a vector pipeline.

**Where it works.** Sample 004, the audit-risk case, is the result worth showing:

```
"Pump seal kit including impeller and housing parts for liquid pump"   [declared 4016.93.50.50]
   8413.92.00.00   Of liquid elevators, Parts, Pumps for liquids...
   8413.91.90.96   Of pumps, Parts, Pumps for liquids...
```

It found the 8413 parts headings out of 19,856 lines unassisted. That is the declared-vs-engine
mismatch the demo is built on, previously reachable only because someone hand-curated the subset.
Also correct: rubber gasket to `4016.93.50.50` at rank 1; the 65W adapter to `8504.40.70.07`
("exceeding 50 W but not exceeding 150 W") at rank 2; shrimp into `0306.17` and the plush toy
into `9503.00.00`, both right heading, different statistical suffix.

**Where it fails, and why.**

```
"Hex head steel bolt M10x40 zinc plated"  -> 7217.20.75.00  (steel WIRE)
                                             correct answer 7318.15 is not in the top 3
"Plastic housing bracket for adapter"     -> 9607.19.00.40  (slide fasteners)
                                             plausible answer 3926.90.85.00 is rank 3
```

Both failures share one cause: **retrieval locked onto material and finish adjectives**
("steel", "zinc plated", "plastic", "fasteners") **and ignored the article noun** ("bolt",
"bracket"). Embedding a whole description averages it, and in a tariff schedule the noun is
the part that decides the chapter.

Across the 9 sample lines: 5 solid, 2 right-heading-wrong-suffix, 2 wrong.

**Recommendation.** Present this as candidate generation over the real schedule, not as
classification. Keep `hts_subset.csv` as the scoring path the engine uses. Lead with the 8413
pump case. Do not claim it classifies 19,856 lines correctly: the bolt case is exactly what a
judge with a customs background will probe.

---

## 3. Three data defects found by reading the data back

Each of these was invisible until the documents were queried, not assumed.

1. **The 220-character cap destroys the distinguishing words.**
   `scripts/build_hts_from_usitc.mjs` caps the joined description and joins the leaf **last**,
   so the cap removes the most specific text. **8,757 of 19,856 lines (44%)** hit the cap and
   **1,237 groups covering 8,456 lines** share a byte-identical description. Those lines were
   literally unretrievable from one another.

2. **`superior` is not text.** It is a boolean flag encoded as the string `"true"` (5,912 rows,
   one distinct value). Folding it into the ancestor chain injected the word "true" into those
   lines' embeddings: *"Live horses, asses, mules and hinnies, true, Horses, ... Males"*.

3. **`Other` segments carry no signal** and the schedule is full of them
   (*"Parts:, Of pumps:, Other, Other"*).

Fixed by building `search_text` from the USITC export directly: leaf-first, uncapped, `Other`
and `nesoi` stripped, duplicates collapsed. After: **0 duplicate groups, 0 bogus tokens.**
`engine/data/` is untouched; lane 3 owns those tables.

---

## 4. Operational notes for the box

- **Bind mounts do not work** for the container's data directory on Linux. `mongod` runs as its
  own uid inside the atlas-local image and cannot write a host directory owned by the caller;
  `--user` does not fix it. It only worked on macOS because Docker Desktop maps uids. Named
  volumes, and persist **both** `/data/db` and `/data/configdb`: the image generates its
  replica-set keyfile in configdb, and losing it kills mongod with
  `Unable to acquire security key[s]`.
- **The container needs `--restart unless-stopped`.** The box rebooted mid-load and took both
  it and a teammate's vLLM container with it. The named volume meant no data loss, but the
  store was simply gone until someone looked.
- **A replica set is required**, for `mongot` and for change streams. The atlas-local image
  initiates one itself.
- **Never Voyage AI.** MongoDB's managed embeddings are MongoDB-hosted, which breaks the
  zero-egress guarantee. Embeddings are generated locally by Ollama.

---

## 5. Still open

- `$rankFusion` cannot show its value on the precedent store with **one** precedent in it:
  fusion ranks, and with N=1 there is nothing to rank. Needs a corpus with confusable
  precedents, two lamp rulings with different codes.
- Insert-only RBAC, the "`deleteOne` fails live" immutability demo, needs the container
  restarted with `--auth`.
- Change streams replacing the cron poll: the replica set is there, the code is not.
