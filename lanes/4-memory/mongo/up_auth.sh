#!/usr/bin/env bash
# Bring up a SECOND, authenticated MongoDB for the immutability demo, on 27019.
# Separate from the main instance on 27018 on purpose: enabling auth needs a fresh volume
# (the image only provisions the root user on first init), and the 19,856-line collection
# on 27018 should not be rebuilt just to demo a permission check.
#
#   MONGO_ROOT_PASS=... DESK_PASS=... ./mongo/up_auth.sh
#
# Passwords come from the environment. Nothing here is committed.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${MONGO_ROOT_PASS:?set MONGO_ROOT_PASS}"
: "${DESK_PASS:?set DESK_PASS}"

NAME="${AUTH_CONTAINER:-sovereign-memory-auth}"
PORT="${AUTH_PORT:-27019}"
IMAGE="mongodb/mongodb-atlas-local:8.2.0"

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker volume rm "${NAME}-data" "${NAME}-config" >/dev/null 2>&1 || true
docker volume create "${NAME}-data" >/dev/null
docker volume create "${NAME}-config" >/dev/null

docker run -d --restart unless-stopped --name "$NAME" -p "$PORT:27017" \
  -e MONGODB_INITDB_ROOT_USERNAME=admin \
  -e MONGODB_INITDB_ROOT_PASSWORD="$MONGO_ROOT_PASS" \
  -v "${NAME}-data:/data/db" -v "${NAME}-config:/data/configdb" "$IMAGE" >/dev/null

printf "waiting for health"
for _ in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$NAME" 2>/dev/null || echo x)" = healthy ] && break
  printf "."; sleep 2
done; echo

node mongo/immutability.mjs \
  --uri "mongodb://127.0.0.1:${PORT}/?directConnection=true" \
  --root-user admin --root-pass "$MONGO_ROOT_PASS" --desk-pass "$DESK_PASS"
