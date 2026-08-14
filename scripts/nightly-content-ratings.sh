#!/bin/bash
# nightly-content-ratings.sh — self-contained wrapper for the content-ratings backfill.
#
# WHY: enrich-content-700.ts calls the local Next.js API at http://localhost:3000/api/enrichment/trigger.
# If no dev server is up, EVERY book fails "fetch failed" and the whole night silently no-ops
# (observed 2026-07-06). This wrapper guarantees a server is running before enriching and tears
# down ONLY a server it started itself (leaves a pre-existing dev server alone).
#
# Steps: pull from Turso -> ensure server -> enrich -> wait for PT push window -> push delta -> teardown.
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

# 4. Wait for the push window if enrichment finished early.
#
# WHY: push-content-ratings-to-turso.ts gates on 3:00-6:00 AM *Pacific*, but this Mac
# runs on Eastern and the cron slot is ET, so a fast night can finish before the window
# opens — the push exits 3 and the night's ratings sit stranded locally until the next
# run (observed 2026-08-14, when a 56-min enrichment off the old 4:53 AM ET slot landed
# at 2:50 AM PT, 10 minutes short). The slot was moved to 5:30 AM ET so a typical ~1h
# night needs no wait at all; this loop only covers the short-night case.
#
# Deliberately does NOT set TBRA_FORCE — waiting for the real window preserves the gate's
# purpose (keep Turso load off the live site) instead of bypassing it.
pt_hour() { echo $((10#$(TZ=America/Los_Angeles date +%H))); }

WAITED=0
while [ "$(pt_hour)" -lt 3 ]; do
  if [ "$WAITED" -eq 0 ]; then
    log "Finished at $(pt_hour):xx PT, before the 3:00 AM PT push window — waiting for it to open..."
  fi
  if [ "$WAITED" -ge 180 ]; then
    log "WARNING: waited ${WAITED}min and the window never opened — running the push anyway so its gate reports the real reason."
    break
  fi
  sleep 60
  WAITED=$((WAITED + 1))
done
if [ "$WAITED" -gt 0 ]; then
  log "Waited ${WAITED}min; PT hour is now $(pt_hour)."
fi

# 5. Push delta to Turso (schedule-gated; its exit code is our exit code).
log "=== PUSH ==="
npx tsx scripts/push-content-ratings-to-turso.ts
PUSH_EXIT=$?
log "Push exited ${PUSH_EXIT}."
exit $PUSH_EXIT
