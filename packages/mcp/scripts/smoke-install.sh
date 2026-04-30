#!/usr/bin/env bash
#
# smoke-install — local Docker matrix runner for @spine/mcp.
#
# Runs `node scripts/publish-smoke.mjs` inside containers for the matrix of
# (Node version × libc) combinations that real users hit. Catches native-
# module breakage (better-sqlite3) and missing build toolchains before the
# CI workflow does — useful when you've changed something that touches
# install behaviour and don't want to burn a 12-minute round-trip to
# GitHub Actions.
#
# Usage (from packages/mcp):
#   ./scripts/smoke-install.sh                # run the full matrix
#   ./scripts/smoke-install.sh node:20-alpine # run just one image
#
# Requires Docker. Mirrors .github/workflows/mcp-smoke.yml — keep them
# in sync if you add a node version.

set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "smoke-install: docker is not installed or not on PATH" >&2
  exit 1
fi

PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$PKG_DIR/../../../.." && pwd)"

DEFAULT_IMAGES=(
  "node:20-alpine"
  "node:22-alpine"
  "node:20-bookworm-slim"
  "node:22-bookworm-slim"
)

if [ "$#" -gt 0 ]; then
  IMAGES=("$@")
else
  IMAGES=("${DEFAULT_IMAGES[@]}")
fi

# What we run inside the container. The host's MCP package is mounted
# read-only at /src; we copy it into a writable scratch dir so npm install
# / npm pack can mutate freely without touching host node_modules.
INNER='set -e
if command -v apk >/dev/null 2>&1; then
  apk add --no-cache --quiet python3 make g++ git >/dev/null
elif command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq >/dev/null
  apt-get install -y -qq --no-install-recommends python3 make g++ git ca-certificates >/dev/null
fi
mkdir -p /work
cp -r /src/. /work/
cd /work
rm -rf node_modules dist
npm install --no-audit --no-fund --silent
node scripts/publish-smoke.mjs'

PASS=()
FAIL=()
for image in "${IMAGES[@]}"; do
  echo
  echo "=========================================================="
  echo "  smoke-install :: $image"
  echo "=========================================================="
  if docker run --rm \
      --volume "$PKG_DIR:/src:ro" \
      --tmpfs /work-tmp:rw,size=512m \
      --env "HOME=/work-tmp" \
      "$image" \
      sh -c "$INNER"
  then
    PASS+=("$image")
  else
    FAIL+=("$image")
  fi
done

echo
echo "----------------------------------------------------------"
echo "smoke-install summary"
echo "  pass: ${#PASS[@]}  ${PASS[*]:-}"
echo "  fail: ${#FAIL[@]}  ${FAIL[*]:-}"
echo "----------------------------------------------------------"

if [ "${#FAIL[@]}" -gt 0 ]; then
  exit 1
fi
