#!/bin/bash
# nightly-content-ratings.sh — self-contained wrapper for the content-ratings backfill.
#
# WHY: enrich-content-700.ts calls the local Next.js API at http://localhost:3000/api/enrichment/trigger.
# If no dev server is up, EVERY book fails "fetch failed" and the whole night silently no-ops
# (observed 2026-07-06). This wrapper guarantees a server is running before enriching and tears
# down ONLY a server it started itself (leaves a pre-existing dev server alone).
#
# Steps: pull from Turso -> ensure server -> enrich -> push delta -> teardown.
# Exit code is the PUSH step's exit code so the schedule gate (exit 3) still surfaces to the caller.
#
# Usage: ./scripts/nightly-content-ratings.sh

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

PORT=3000
BASE="http://localhost:${PORT}"
STARTED_SERVER=0
NPM_PID=""

log() { echo "[$(date '+%H:%M:%S')] $*"; }

server_up() { curl -s -o /dev/null -w '' "${BASE}/" 2>/dev/null; }

teardown() {
  if [ "$STARTED_SERVER" = "1" ]; then
    log "Tearing down dev server we started (npm pid=${NPM_PID})..."
    # Kill the port listener (next-server child) and the npm parent.
    lsof -ti tcp:${PORT} 2>/dev/null | xargs kill 2>/dev/null || true
    [ -n "$NPM_PID" ] && pkill -P "$NPM_PID" 2>/dev/null || true
    [ -n "$NPM_PID" ] && kill "$NPM_PID" 2>/dev/null || true
    log "Teardown complete."
  else
    log "Left pre-existing dev server running (we did not start it)."
  fi
}
trap teardown EXIT

# 1. Pull latest from Turso.
log "=== PULL ==="
./scripts/sync-incremental.sh pull

# 2. Ensure a dev server on :3000.
if server_up; then
  log "Dev server already up on :${PORT} — reusing it."
else
  log "No dev server on :${PORT} — starting 'npm run dev'..."
  PORT=${PORT} nohup npm run dev > "${PROJECT_DIR}/scripts/nightly-content-ratings-devserver.log" 2>&1 &
  NPM_PID=$!
  STARTED_SERVER=1
  log "Dev server launching (npm pid=${NPM_PID}); waiting for it to answer..."
  READY=0
  for i in $(seq 1 60); do   # up to ~180s for a cold Next.js compile
    if server_up; then READY=1; log "Dev server ready after ~$((i*3))s."; break; fi
    sleep 3
  done
  if [ "$READY" != "1" ]; then
    log "ERROR: dev server never became ready — aborting before enrich to avoid a silent all-fail run."
    exit 1
  fi
fi

# 3. Enrich.
log "=== ENRICH ==="
npx tsx scripts/enrich-content-700.ts

# 4. Push delta to Turso (schedule-gated; its exit code is our exit code).
log "=== PUSH ==="
npx tsx scripts/push-content-ratings-to-turso.ts
PUSH_EXIT=$?
log "Push exited ${PUSH_EXIT}."
exit $PUSH_EXIT
