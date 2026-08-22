#!/usr/bin/env bash
# doctor.sh, one screen that tells you what state the GB10 box is actually in.
#
#   bash lanes/1-inference/doctor.sh
#
# Run this the moment you sit down, before touching anything. Most of the first hour of a
# hackathon is lost to assuming something is installed when it is not, or reinstalling
# something that already works. This answers both questions in about ten seconds.
#
# Never exits non-zero on a missing component. A missing component is information, not an
# error: this script reports, it does not judge.

set -u

hr() { printf '%s\n' "----------------------------------------------------------------"; }
have() { command -v "$1" >/dev/null 2>&1; }
say() { printf '%-26s %s\n' "$1" "$2"; }

# ok / absent, rather than a bare exit code, because "absent" is a normal answer here
probe() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then say "$label" "ok"; else say "$label" "ABSENT or failing"; fi
}

hr
echo "SovereignDesk box doctor"
date -Is 2>/dev/null || date
hr

echo "[ hardware and os ]"
say "arch" "$(uname -m)   (must be aarch64. x86 container images will not run)"
say "kernel" "$(uname -r)"
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  say "os" "$(. /etc/os-release && echo "$PRETTY_NAME")"
fi
say "cpus" "$(nproc 2>/dev/null || echo '?')"
say "memory" "$(free -g 2>/dev/null | awk '/^Mem:/{print $2" GB total, "$7" GB available"}' || echo '?')"
say "disk /" "$(df -h / 2>/dev/null | awk 'NR==2{print $4" free of "$2}')"
say "disk ~" "$(df -h "$HOME" 2>/dev/null | awk 'NR==2{print $4" free of "$2}')"

hr
echo "[ gpu ]"
if have nvidia-smi; then
  nvidia-smi --query-gpu=name,memory.total,memory.used,driver_version \
             --format=csv,noheader 2>/dev/null || nvidia-smi 2>&1 | head -5
else
  say "nvidia-smi" "ABSENT"
fi

hr
echo "[ required stack ]"
for tool in nemoclaw openclaw openshell node npm docker git curl; do
  if have "$tool"; then
    v="$("$tool" --version 2>&1 | head -1)"
    say "$tool" "${v:-present}"
  else
    say "$tool" "ABSENT"
  fi
done

hr
echo "[ inference ]"
if have ollama; then
  say "ollama models" "$(ollama list 2>/dev/null | tail -n +2 | awk '{print $1}' | paste -sd' ' - || echo 'none')"
  if curl -fsS -m 2 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
    say "ollama serving" "yes on 11434"
  else
    say "ollama serving" "NO. start it: nohup ollama serve > ~/ollama.log 2>&1 &"
  fi
else
  say "ollama" "ABSENT"
fi

if [ -d "$HOME/.cache/huggingface/hub" ]; then
  say "hf cache" "$(du -sh "$HOME/.cache/huggingface/hub" 2>/dev/null | cut -f1) at ~/.cache/huggingface/hub"
  ls "$HOME/.cache/huggingface/hub" 2>/dev/null | sed 's/^/                           /'
else
  say "hf cache" "empty. Plan B needs weights staged here before nemoclaw onboard"
fi

if curl -fsS -m 2 http://127.0.0.1:8000/v1/models >/dev/null 2>&1; then
  say "vllm on 8000" "serving"
else
  say "vllm on 8000" "not serving"
fi

hr
echo "[ mongodb, the precedent retrieval index ]"
if have mongod; then say "mongod" "$(mongod --version 2>/dev/null | head -1)"; else say "mongod" "ABSENT. install the staged arm64 deb, see lanes/1-inference/BOX_SETUP.md"; fi
MSH="${MONGOSH_BIN:-mongosh}"
if "$MSH" --version >/dev/null 2>&1; then say "mongosh" "$("$MSH" --version 2>/dev/null | head -1)"; else say "mongosh" "ABSENT (or set MONGOSH_BIN)"; fi
if (exec 3<>/dev/tcp/127.0.0.1/27017) 2>/dev/null; then exec 3>&- 2>/dev/null; say "port 27017" "open"; else say "port 27017" "closed. mongod is not listening"; fi
say "MONGO_URI" "${MONGO_URI:-unset (engine runs JSONL-only)}"

hr
echo "[ nemoclaw sandboxes ]"
if have nemoclaw; then
  nemoclaw list 2>&1 | head -20 || say "nemoclaw list" "failed"
else
  say "nemoclaw" "ABSENT. installer: curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash"
fi

hr
echo "[ usb / external media ]"
lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINT 2>/dev/null | grep -v loop | head -20 || say "lsblk" "unavailable"

hr
echo "[ project ]"
say "repo" "$(cd "$(dirname "$0")/../.." && pwd)"
if have node; then
  ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
  TMP="$(mktemp -d)"
  mkdir -p "$TMP/inbox"
  cp "$ROOT"/engine/samples/shipment_001_clean.json "$TMP/inbox/" 2>/dev/null
  # env -u MONGO_URI: this probe uses a throwaway mktemp workspace, and the engine's
  # count-parity guard would (correctly) refuse a Mongo index that belongs to the real
  # workspace. The probe answers "does the engine run", not "is the index synced".
  if (cd "$ROOT" && env -u MONGO_URI node engine/process_inbox.mjs --root "$TMP" >/dev/null 2>&1); then
    say "engine smoke test" "ok, engine runs here"
  else
    say "engine smoke test" "FAILED. run it by hand to see why:"
    echo "                           cd $ROOT && node engine/process_inbox.mjs --root <workspace>"
  fi
else
  say "engine smoke test" "skipped, no node"
fi

hr
echo "[ egress, expected to FAIL from inside the sandbox ]"
# From the host this normally succeeds. From inside the OpenShell sandbox it must not.
# That difference is lane 2's on-camera moment, so knowing which side you are on matters.
if curl -fsS -m 4 -o /dev/null https://hts.usitc.gov 2>/dev/null; then
  say "https://hts.usitc.gov" "REACHABLE. you are on the host, or the policy is not applied"
else
  say "https://hts.usitc.gov" "blocked or unreachable"
fi

hr
echo "next: if nemoclaw is absent, start the installer NOW, it is the long pole."
echo "      hard stop at T+1. if managed vLLM has not pulled by then, switch to Ollama."
hr
