#!/usr/bin/env bash
# The A/B to run on stage: same shipment file, same precedent store, one env var.
#
#   ./mongo/demo_retrieval_ab.sh
#
# The line is a plural rewording of a description a broker already ruled on. Token overlap
# scores it 0.86, below the 0.90 bind bar, so it only SUGGESTS and the shipment goes to a
# human. Cosine over local embeddings scores it 0.93, binds, and the shipment clears.
# Same code, same duty, different behaviour: that is what the memory is for.
set -euo pipefail
cd "$(dirname "$0")/../../.."

: "${MONGO_URI:?set MONGO_URI}"
: "${STORE:=/tmp/lane4/precedents.jsonl}"
PROBE=${PROBE:-/tmp/reworded.json}

if [ ! -f "$PROBE" ]; then
  python3 - "$PROBE" <<'PY'
import json, sys
s = json.load(open("engine/samples/shipment_006_precedent_test.json"))
s["shipment_id"] = "SHP-2026-0822-006R"
s["lines"][0]["description"] = "LED night lights, USB rechargeable, portable"
json.dump(s, open(sys.argv[1], "w"), indent=1)
PY
fi

show() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{
    const r=JSON.parse(s.trim().split("\n").pop()), l=r.lines[0];
    console.log("  "+r.shipment_summary.status.padEnd(13)+" hts "+l.hts+"  conf "+l.confidence+
      "  duty "+r.shipment_summary.estimated_duty+"  precedent: "+
      (l.precedent?l.precedent.hts+" applied="+l.precedent.applied+" sim="+l.precedent.similarity:"none"));
  }catch(e){console.log("  ERR "+s.slice(0,160))}})'
}

echo "probe: $(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).lines[0].description)' "$PROBE")"
echo
echo "1. a file, token overlap          (MONGO_URI unset)"
MONGO_URI= node engine/triage.mjs "$PROBE" --precedents "$STORE" 2>&1 | show
echo
echo "2. MongoDB doing the same thing   (Jaccard in an aggregation)"
node engine/triage.mjs "$PROBE" --precedents "$STORE" 2>&1 | show
echo
echo "3. MongoDB doing what a file cannot (\$vectorSearch over local embeddings)"
MEMORY_RETRIEVAL=hybrid node engine/triage.mjs "$PROBE" --precedents "$STORE" 2>&1 | show
echo
echo "1 and 2 agree to the decimal: the index is a faithful copy of the file, which is"
echo "exactly why moving the same match into a database changes nothing. 3 is the reason"
echo "to use one."
