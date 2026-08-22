#!/usr/bin/env bash
# smoke.sh, the pre-merge check. Runs the whole local loop and asserts the numbers.
#
#   bash scripts/smoke.sh
#
# Lane 5 owns the merge and runs this before every merge to main. It needs nothing but
# Node: no box, no sandbox, no model, no network. If this is red, do not merge.
#
# Everything is done with paths RELATIVE to the repo root, on purpose. Half the team is
# on Windows running Git Bash, where an absolute shell path looks like /d/Projects/... and
# node.exe cannot resolve it. Relative paths work identically on both sides. Do not
# "improve" this by reintroducing mktemp or $PWD.

set -uo pipefail
cd "$(dirname "$0")/.."

# Gitignored scratch workspace, one per run. $$ alone is NOT enough: PIDs get reused, and a
# leftover run dir already has its inbox drained into processed/, so the sweep finds nothing,
# produces zero results and every field assertion below fails for no real reason. Pick a name
# that does not exist yet. Nothing here is ever cleaned up automatically because this script
# must not delete anything; .smoke/ is safe to remove by hand at any time.
WS=".smoke/run-$$"
n=0
while [ -e "$WS" ]; do n=$((n+1)); WS=".smoke/run-$$-$n"; done
FAIL=0

pass() { printf '  ok    %s\n' "$1"; }
fail() { printf '  FAIL  %s\n' "$1"; FAIL=$((FAIL+1)); }

# expect <label> <actual> <expected>
expect() {
  if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 (got '$2', expected '$3')"; fi
}

# field <relative json path> <dotted key>, empty string if anything is missing
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

echo "SovereignDesk smoke test"
echo "workspace: $WS"
echo

# ---------------------------------------------------------------- 1. syntax
echo "[1] syntax"
for f in engine/*.mjs scripts/*.mjs lanes/*/*.mjs; do
  [ -e "$f" ] || continue
  if node --check "$f" 2>/dev/null; then pass "$f"; else fail "$f does not parse"; fi
done

echo
echo "[2] data tables parse"
for f in engine/data/*.json engine/samples/*.json; do
  [ -e "$f" ] || continue
  if node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1],"utf8"))' "$f" 2>/dev/null; then
    pass "$(basename "$f")"
  else
    fail "$(basename "$f") is not valid JSON"
  fi
done

# ---------------------------------------------------------------- 3. cold sweep
echo
echo "[3] cold sweep, no precedents"
mkdir -p "$WS/inbox"
cp engine/samples/*.json "$WS/inbox/"
if node engine/process_inbox.mjs --root "$WS" >/dev/null 2>&1; then
  pass "sweep ran"
else
  fail "process_inbox.mjs exited non-zero"
fi

n_results=$(find "$WS/results" -name '*.result.json' 2>/dev/null | wc -l | tr -d ' ')
expect "six shipments produced results" "$n_results" "6"

R6="$WS/results/SHP-2026-0822-006.result.json"
R4="$WS/results/SHP-2026-0822-004.result.json"

expect "006 cold hts"        "$(field "$R6" 'lines.0.hts')"             "8513.10.20.00"
expect "006 cold confidence" "$(field "$R6" 'lines.0.confidence')"      "0.6"
expect "006 cold status"     "$(field "$R6" 'shipment_summary.status')" "NEEDS_REVIEW"
expect "006 cold duty"       "$(field "$R6" 'lines.0.duty.duty_est')"   "2362.5"
expect "004 declared mismatch flagged" "$(field "$R4" 'shipment_summary.flags.0')" "DECLARED_DIFFERS"

# Sample 001 line 1 is "Cast iron pump casing ... without engine". A casing is a PART of a
# pump, not a pump. Both halves of the parts-vs-whole logic have to fire for this to land:
# triage.mjs:143 must test the heading path for a real "Parts:" segment (rowDesc.has("part")
# was true for the whole-machine row too, because the USITC heading says "part thereof"), and
# the halving at :145 must be 0.35. Either alone regresses this to NEEDS_REVIEW.
R1="$WS/results/SHP-2026-0822-001.result.json"
expect "001 classifies the casing as a pump PART" "$(field "$R1" 'lines.0.hts')" "8413.91.90.96"
expect "001 confidence clears the 0.70 floor"     "$(field "$R1" 'lines.0.confidence')" "0.77"
expect "001 reaches READY"                        "$(field "$R1" 'shipment_summary.status')" "READY"

# 005: the hex bolt correctly disclaims the AD/CVD scope check (no general steel-fasteners
# CN order exists; the 2009 petition failed at the ITC). FCC/DOE items are records on
# request, so nothing forces review. Verified against agency sources 2026-08-22.
R5="$WS/results/SHP-2026-0822-005.result.json"
expect "005 reaches READY, AD/CVD disclaimed on the hex bolt" "$(field "$R5" 'shipment_summary.status')" "READY"
expect "005 hex bolt AD/CVD status" "$(field "$R5" 'lines.1.pga.0.status')" "DISCLAIMABLE"

# ---------------------------------------------------------------- 4. duty stack
echo
echo "[4] duty stack is sourced, not invented"
SUR="engine/data/surcharges.json"
expect "section 122 disabled" "$(field "$SUR" 'section_122.enabled')" "false"

n301=$(node -e '
  const s = JSON.parse(require("node:fs").readFileSync("engine/data/surcharges.json","utf8"));
  process.stdout.write(String(Object.keys(s.section_301.rates_by_prefix||{}).length));
')
nauth=$(node -e '
  const s = JSON.parse(require("node:fs").readFileSync("engine/data/surcharges.json","utf8"));
  process.stdout.write(String(Object.keys(s.section_301.authority_by_prefix||{}).length));
')
if [ "${n301:-0}" -gt 1000 ]; then
  pass "section 301 covers $n301 prefixes"
else
  fail "section 301 only covers ${n301:-0} prefixes, did the table get reverted?"
fi
expect "every 301 prefix cites a chapter 99 heading" "$nauth" "$n301"

if grep -q "PLACEHOLDER-verify-USITC" engine/data/hts_subset.csv 2>/dev/null; then
  fail "hts_subset.csv still contains placeholder rates"
else
  pass "no placeholder rates left in hts_subset.csv"
fi

echo
echo "[4b] entry-level fees"
# MPF is clamped to a per-ENTRY minimum and maximum, which is exactly what a per-line
# ad-valorem rate cannot express. 006 has $6,300 entered, so raw MPF is $21.82 and the
# floor must lift it to the FY2026 minimum of $33.58 (CBP Dec. 25-10, verified 2026-08-22).
# If this ever equals 21.82, someone refactored the fee into the line rate and broke the clamp.
expect "006 MPF clamped to the FY2026 entry minimum" "$(field "$R6" 'shipment_summary.fees.0.amount')" "33.58"
expect "006 MPF named"                        "$(field "$R6" 'shipment_summary.fees.0.name')"   "MPF"
expect "006 HMF charged on an ocean shipment" "$(field "$R6" 'shipment_summary.fees.1.amount')" "7.88"
expect "006 total payable = duty + fees"      "$(field "$R6" 'shipment_summary.estimated_total_payable')" "2403.96"
# 004 is not a vessel shipment, so HMF must not appear at all.
expect "004 mode is not vessel"        "$(field "$R4" 'shipment_summary.fees.1.name')" ""
expect "004 fees are MPF only"         "$(field "$R4" 'shipment_summary.estimated_fees')" "33.58"
# duty must NOT absorb the fees: effective_rate stays duty-only
expect "006 effective_rate excludes fees" "$(field "$R6" 'shipment_summary.effective_rate')" "0.375"

# ---------------------------------------------------------------- 5. precedent
echo
echo "[5] precedent round trip"
if node engine/record_precedent.mjs \
     --shipment SHP-2026-0822-003 --line 2 --hts 9405.11.60.10 \
     --reason "smoke test: ceiling fixture, mains powered, not portable" \
     --root "$WS" >/dev/null 2>&1; then
  pass "precedent recorded"
else
  fail "record_precedent.mjs exited non-zero"
fi

if [ -f "$WS/precedents.jsonl" ]; then
  pass "precedents.jsonl written at the workspace root (host side)"
else
  fail "precedents.jsonl missing. the teardown demo depends on this path"
fi

cp engine/samples/shipment_006_precedent_test.json "$WS/inbox/"
node engine/process_inbox.mjs --root "$WS" >/dev/null 2>&1

expect "006 warm hts"        "$(field "$R6" 'lines.0.hts')"             "9405.11.60.10"
expect "006 warm confidence" "$(field "$R6" 'lines.0.confidence')"      "0.95"
expect "006 warm status"     "$(field "$R6" 'shipment_summary.status')" "READY"
expect "006 warm duty"       "$(field "$R6" 'lines.0.duty.duty_est')"   "2053.8"
expect "cold value preserved for the memo" "$(field "$R6" 'lines.0.precedent.cold_hts')" "8513.10.20.00"

# ---------------------------------------------------------------- 6. retrieval
echo
echo "[6] precedent retrieval generalises"
if node lanes/4-memory/eval_retrieval.mjs >/dev/null 2>&1; then
  pass "retrieval eval passes all asserted cases"
else
  fail "retrieval eval has failing cases. run: node lanes/4-memory/eval_retrieval.mjs"
fi

# ---------------------------------------------------------------- 7. hygiene
echo
echo "[7] repo hygiene"
if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  fail ".env is tracked by git. remove it from the index immediately"
else
  pass ".env is not tracked"
fi

# Match token SHAPES, not bare prefixes: lane 5's runbook documents a leak-detection
# regex, and a prefix-only scan flags the documentation instead of a secret.
leaked=$(git grep -lIE '(gh[pousr]_[A-Za-z0-9]{36}|xox[baprs]-[A-Za-z0-9]{10,}-[A-Za-z0-9]{10,}|syt_[A-Za-z0-9_=-]{20,}|bot[0-9]{8,}:AA[A-Za-z0-9_-]{30,})' -- . ':!scripts/smoke.sh' 2>/dev/null || true)
if [ -n "$leaked" ]; then
  fail "possible token committed in: $leaked"
else
  pass "no obvious tokens in tracked files"
fi

# U+2014 check. Done in node so this script does not have to contain the character.
emdash=$(node -e '
  const { execSync } = require("node:child_process");
  const files = execSync("git ls-files", { encoding: "utf8" }).split("\n").filter(Boolean);
  const fs = require("node:fs");
  const hits = files.filter((f) => {
    if (f.includes("engine/data/usitc/")) return false;
    try { return fs.readFileSync(f, "utf8").includes(String.fromCharCode(0x2014)); } catch { return false; }
  });
  process.stdout.write(hits.join(" "));
' 2>/dev/null)
if [ -n "$emdash" ]; then
  fail "em-dash present in tracked files: $emdash"
else
  pass "no em-dashes in tracked text"
fi

# ---------------------------------------------------------------- done
echo
if [ "$FAIL" -eq 0 ]; then
  echo "SMOKE PASSED. safe to merge."
  exit 0
else
  echo "SMOKE FAILED: $FAIL check(s). do not merge."
  exit 1
fi
