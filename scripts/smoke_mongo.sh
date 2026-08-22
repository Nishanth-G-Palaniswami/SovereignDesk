#!/usr/bin/env bash
# smoke_mongo.sh, the MongoDB gate. Asserts that retrieval through the Mongo index is
# byte-identical to the JSONL scan, that the frozen demo numbers hold in Mongo mode, and
# that the failure paths are loud. Run it IN ADDITION to smoke.sh, never instead:
#
#   bash scripts/smoke.sh          # MONGO_URI must be unset for this one
#   bash scripts/smoke_mongo.sh
#
# Needs a reachable mongod and mongosh. If either is absent this script prints SKIPPED
# and exits 0 so laptop chains survive; the VENUE BOX MUST NEVER SEE "SKIPPED". On
# Windows point MONGOSH_BIN at the real exe with a C:/-style path (never /c/...):
#   export MONGOSH_BIN="C:/Users/<you>/AppData/Local/Programs/mongosh/mongosh.exe"
#
# Same conventions as smoke.sh: paths relative to the repo root, no mktemp, no cleanup.
# All writes go to the sovereigndesk_smoke database, never the demo index.

set -uo pipefail
cd "$(dirname "$0")/.."

MONGOSH="${MONGOSH_BIN:-mongosh}"
URI="${MONGO_URI:-mongodb://127.0.0.1:27017/?serverSelectionTimeoutMS=2000}"

if ! "$MONGOSH" --version >/dev/null 2>&1; then
  echo "SKIPPED: mongosh not found (set MONGOSH_BIN to the real mongosh executable)"
  exit 0
fi
if [ "$("$MONGOSH" "$URI" --quiet --norc --eval 'print(db.runCommand({ping:1}).ok)' 2>/dev/null)" != "1" ]; then
  echo "SKIPPED: no mongod answering at $URI"
  exit 0
fi

export MONGO_URI="$URI"
export MONGO_DB="sovereigndesk_smoke"

WS=".smoke/mongo-$$"
n=0
while [ -e "$WS" ]; do n=$((n+1)); WS=".smoke/mongo-$$-$n"; done
mkdir -p "$WS/inbox"
FAIL=0

pass() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAIL=$((FAIL+1)); }
expect() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (got '$2', expected '$3')"; fi; }
field() {
  node -e '
    const fs = require("node:fs");
    try {
      const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      let v = d;
      for (const k of process.argv[2].split(".")) v = v?.[k];
      process.stdout.write(v === undefined || v === null ? "" : String(v));
    } catch { process.stdout.write(""); }
  ' "$1" "$2" 2>/dev/null
}
mongo_count() { "$MONGOSH" "$URI" --quiet --norc --eval "print(db.getSiblingDB('$MONGO_DB').$1.countDocuments())" 2>/dev/null; }

echo "SovereignDesk mongo smoke test"
echo "workspace: $WS   db: $MONGO_DB"
echo

# ------------------------------------------------ 1. cold sweep against an empty index
echo "[1] mongo mode, cold sweep, empty index"
node scripts/mongo_sync.mjs --precedents "$WS/precedents.jsonl" >/dev/null 2>&1 \
  && pass "mongo_sync on an empty store" || fail "mongo_sync on an empty store"
cp engine/samples/shipment_006_precedent_test.json "$WS/inbox/"
node engine/process_inbox.mjs --root "$WS" >/dev/null 2>&1 || fail "mongo-mode sweep exited non-zero"
R6="$WS/results/SHP-2026-0822-006.result.json"
expect "006 cold hts"        "$(field "$R6" lines.0.hts)"                    "8513.10.20.00"
expect "006 cold confidence" "$(field "$R6" lines.0.confidence)"            "0.6"
expect "006 cold status"     "$(field "$R6" shipment_summary.status)"       "NEEDS_REVIEW"
expect "006 cold duty"       "$(field "$R6" lines.0.duty.duty_est)"         "2362.5"
expect "index evidence present" "$(field "$R6" precedent_store.index.type)" "mongodb"

echo
# ------------------------------------------------ 2. reclassify dual-writes both stores
echo "[2] reclassify dual-writes JSONL and index"
node engine/record_precedent.mjs --shipment SHP-2026-0822-006 --line 1 \
  --hts 9405.11.60.10 --reason "mongo smoke: portable LED lamp, not a torch" \
  --root "$WS" >/dev/null 2>&1 && pass "record_precedent exit 0" || fail "record_precedent failed"
JL=$(grep -c . "$WS/precedents.jsonl" 2>/dev/null || echo 0)
expect "index count == JSONL line count" "$(mongo_count precedents)" "$JL"

echo
# ------------------------------------------------ 3. warm numbers + full result parity
echo "[3] warm frozen numbers, mongo vs jsonl parity"
node engine/triage.mjs engine/samples/shipment_006_precedent_test.json \
  --precedents "$WS/precedents.jsonl" --out "$WS/warm_mongo.json" >/dev/null 2>&1
env -u MONGO_URI node engine/triage.mjs engine/samples/shipment_006_precedent_test.json \
  --precedents "$WS/precedents.jsonl" --out "$WS/warm_jsonl.json" >/dev/null 2>&1
expect "006 warm hts (mongo)"    "$(field "$WS/warm_mongo.json" lines.0.hts)"                    "9405.11.60.10"
expect "006 warm conf (mongo)"   "$(field "$WS/warm_mongo.json" lines.0.confidence)"             "0.95"
expect "006 warm status (mongo)" "$(field "$WS/warm_mongo.json" shipment_summary.status)"        "READY"
expect "006 warm duty (mongo)"   "$(field "$WS/warm_mongo.json" lines.0.duty.duty_est)"          "2053.8"
expect "summary carries applied" "$(field "$WS/warm_mongo.json" shipment_summary.precedents_applied.0.applied)" "true"
PARITY=$(node -e '
  const fs = require("node:fs");
  const a = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const b = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  delete a.generated_at; delete b.generated_at; delete a.precedent_store.index;
  process.stdout.write(JSON.stringify(a) === JSON.stringify(b) ? "IDENTICAL" : "DIFFER");
' "$WS/warm_mongo.json" "$WS/warm_jsonl.json" 2>/dev/null)
expect "full result parity (minus generated_at + index)" "$PARITY" "IDENTICAL"

echo
# ------------------------------------------------ 4. newest precedent wins a tie, both modes
echo "[4] tie-break: newest wins in both modes"
node engine/record_precedent.mjs --shipment SHP-2026-0822-006 --line 1 \
  --hts 8513.10.20.00 --reason "mongo smoke: second broker corrects the correction" \
  --root "$WS" >/dev/null 2>&1
node engine/triage.mjs engine/samples/shipment_006_precedent_test.json \
  --precedents "$WS/precedents.jsonl" --out "$WS/tie_mongo.json" >/dev/null 2>&1
env -u MONGO_URI node engine/triage.mjs engine/samples/shipment_006_precedent_test.json \
  --precedents "$WS/precedents.jsonl" --out "$WS/tie_jsonl.json" >/dev/null 2>&1
expect "tie winner (mongo)" "$(field "$WS/tie_mongo.json" lines.0.precedent.hts)" "8513.10.20.00"
expect "tie winner (jsonl)" "$(field "$WS/tie_jsonl.json" lines.0.precedent.hts)" "8513.10.20.00"

echo
# ------------------------------------------------ 5. full-schedule tariff index
echo "[5] tariff index: precedent binds outside the curated subset"
LOADED=$(node scripts/mongo_load_tariff.mjs 2>/dev/null | node -e 'try{process.stdout.write(String(JSON.parse(require("fs").readFileSync(0,"utf8")).loaded))}catch{process.stdout.write("")}')
expect "tariff rows loaded" "$LOADED" "19856"
# 8513.10.40.00 is real (Lamps: Other, MFN 3.5%) and NOT in hts_subset.csv.
node engine/record_precedent.mjs --shipment SHP-2026-0822-006 --line 1 \
  --hts 8513.10.40.00 --reason "mongo smoke: own-source lamp, not a flashlight" \
  --root "$WS" >/dev/null 2>&1
node engine/triage.mjs engine/samples/shipment_006_precedent_test.json \
  --precedents "$WS/precedents.jsonl" --out "$WS/full_mongo.json" >/dev/null 2>&1
env -u MONGO_URI node engine/triage.mjs engine/samples/shipment_006_precedent_test.json \
  --precedents "$WS/precedents.jsonl" --out "$WS/full_jsonl.json" >/dev/null 2>&1
expect "out-of-subset code binds (mongo)"  "$(field "$WS/full_mongo.json" lines.0.hts)"             "8513.10.40.00"
expect "full-schedule rate applied"        "$(field "$WS/full_mongo.json" lines.0.duty.total_rate)" "0.285"
expect "duty from full-schedule MFN"       "$(field "$WS/full_mongo.json" lines.0.duty.duty_est)"   "1795.5"
JF=$(field "$WS/full_jsonl.json" lines.0.flags)
case "$JF" in *PRECEDENT_UNKNOWN_CODE*) pass "jsonl mode still escalates the unknown code";;
  *) fail "jsonl mode should flag PRECEDENT_UNKNOWN_CODE (got '$JF')";; esac

echo
# ------------------------------------------------ 6. failures are loud, never silent
echo "[6] failures are loud"
if MONGO_URI="mongodb://127.0.0.1:27016/?serverSelectionTimeoutMS=1500" \
   node engine/triage.mjs engine/samples/shipment_006_precedent_test.json \
   --precedents "$WS/precedents.jsonl" >/dev/null 2>&1; then
  fail "dead mongod should be a non-zero exit, not a silent fallback"
else
  pass "dead mongod exits non-zero"
fi
if MONGO_DB="sovereigndesk_smoke_stale" \
   node engine/triage.mjs engine/samples/shipment_006_precedent_test.json \
   --precedents "$WS/precedents.jsonl" >/dev/null 2>&1; then
  fail "stale/mismatched index should be a non-zero exit"
else
  pass "count-parity guard trips on a mismatched index"
fi

echo
if [ "$FAIL" -eq 0 ]; then
  echo "MONGO SMOKE PASSED."
  exit 0
else
  echo "MONGO SMOKE FAILED: $FAIL assertion(s)."
  exit 1
fi
