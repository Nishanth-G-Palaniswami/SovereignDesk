#!/usr/bin/env bash
# Bring the lane 4 memory layer up on this machine. Idempotent.
#
#   ./mongo/up.sh                 # local, container on 27018
#   MEMORY_MONGO_URI=mongodb://<box>:27017/?directConnection=true ./mongo/up.sh
#                                 # point at an existing MongoDB, skips the container
#
# Never put a password in this file or in a committed .env. Pass it in the URI at run time.
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE="mongodb/mongodb-atlas-local:8.2.0"
NAME="${MEMORY_CONTAINER:-sovereign-memory}"
PORT="${MEMORY_PORT:-27018}"
# Named docker volume, not a bind mount. mongod runs as its own uid inside the image and
# cannot write a host directory owned by the calling user; on Linux the bind mount makes the
# container exit unhealthy ("connection refused ... localhost:27017"). The volume still lives
# on the host, outside the container, and survives `docker rm` and a sandbox rebuild, which is
# what the teardown demo actually needs. `docker volume inspect` prints its host path.
VOLUME="${MEMORY_VOLUME:-sovereign-memory-data}"
# /data/configdb holds the replica-set keyfile the image generates on first run. Persist it
# too, or recreating the container leaves a volume whose replica set expects a keyfile that
# no longer exists and mongod dies with "Unable to acquire security key[s]".
CONFVOL="${MEMORY_CONFIG_VOLUME:-sovereign-memory-config}"

if [ -z "${MEMORY_MONGO_URI:-}" ]; then
  # 8.2.0, not :latest. latest tracks the 8.0 line and $rankFusion needs 8.1+.
  if ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
    echo "starting $NAME on $PORT"
    docker rm -f "$NAME" >/dev/null 2>&1 || true
    docker volume create "$VOLUME" >/dev/null; docker volume create "$CONFVOL" >/dev/null
    docker run -d --restart unless-stopped --name "$NAME" -p "$PORT:27017" -v "$VOLUME:/data/db" -v "$CONFVOL:/data/configdb" "$IMAGE" >/dev/null
    printf "waiting for health"
    for _ in $(seq 1 60); do
      [ "$(docker inspect -f '{{.State.Health.Status}}' "$NAME" 2>/dev/null || echo x)" = healthy ] && break
      printf "."; sleep 2
    done; echo
  else
    echo "$NAME already running"
  fi
fi

command -v ollama >/dev/null || { echo "ollama not installed"; exit 1; }
ollama list 2>/dev/null | grep -q "${EMBED_MODEL:-nomic-embed-text}" || ollama pull "${EMBED_MODEL:-nomic-embed-text}"

[ -d node_modules ] || npm install --silent
node mongo/setup.mjs
node mongo/doctor.mjs
