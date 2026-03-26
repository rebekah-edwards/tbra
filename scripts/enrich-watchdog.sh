#!/bin/bash
# Watchdog wrapper for overnight enrichment.
# Monitors the dev server, auto-restarts it if it dies, then resumes enrichment.
#
# Usage:
#   nohup bash scripts/enrich-watchdog.sh &
#
# What it does:
#   1. Checks if the dev server is alive before each enrichment batch
#   2. If dead: kills stale port 3000 processes, deletes .next/dev/lock, restarts server
#   3. Waits for server to be healthy, then resumes enrichment
#   4. Logs all watchdog events to a separate log file
#   5. Caps server restart attempts to avoid infinite loops

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

PORT=3000
BASE="http://localhost:$PORT/api/enrichment"
WATCHDOG_LOG="scripts/watchdog-$(date +%Y%m%d-%H%M%S).log"
ENRICHMENT_LOG="scripts/enrichment-log-$(date +%Y%m%d-%H%M%S).txt"
BATCH_SIZE=25
SLEEP_BETWEEN=30
MAX_SERVER_RESTARTS=10
MAX_CONSECUTIVE_FAILURES=5

# Load enrichment secret for API auth
ENRICHMENT_SECRET=$(grep ENRICHMENT_SECRET .env.local | cut -d= -f2)
AUTH_HEADER=(-H "x-enrichment-secret: $ENRICHMENT_SECRET")

TOTAL_SUCCESS=0
TOTAL_FAILED=0
BATCH_NUM=0
SERVER_RESTARTS=0
CONSECUTIVE_FAILURES=0

wlog() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [watchdog] $*" | tee -a "$WATCHDOG_LOG"
}

elog() {
  echo "[$(date '+%H:%M:%S')] $*" | tee -a "$ENRICHMENT_LOG"
}

# ── Server health check ──
# Two-tier: quick check if port responds at all, then verify API works.
# Next.js dev mode compiles routes on first request so the API check is slow on cold start.
port_is_listening() {
  # Fast check: is anything accepting connections on the port?
  (echo > /dev/tcp/localhost/$PORT) 2>/dev/null
}

server_is_alive() {
  # First: is anything on the port?
  if ! port_is_listening; then
    return 1
  fi
  # Second: does the API respond? Allow 120s for first-time route compilation.
  curl -s -o /dev/null -m 120 -w "%{http_code}" "http://localhost:$PORT/api/enrichment/status" 2>/dev/null | grep -q "200"
}

# ── Kill anything on port 3000 ──
kill_port() {
  local pids
  pids=$(lsof -ti:$PORT 2>/dev/null || true)
  if [ -n "$pids" ]; then
    wlog "Killing stale processes on port $PORT: $pids"
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 2
  fi
}

# ── Start the dev server ──
start_server() {
  wlog "Starting dev server..."

  # Clean up lock file
  rm -f .next/dev/lock

  # Only kill port if nothing is responding
  if ! port_is_listening; then
    kill_port
  fi

  # Check if server is already running (just needs warming up)
  if port_is_listening; then
    wlog "Port $PORT already in use — warming up existing server..."
  else
    # Start server in background
    nohup npm run dev > "scripts/devserver-$(date +%Y%m%d-%H%M%S).log" 2>&1 &
    local server_pid=$!
    wlog "Dev server launched (PID: $server_pid)"
  fi

  # Wait for server to be healthy (up to 180s)
  local waited=0
  while [ $waited -lt 180 ]; do
    if server_is_alive; then
      wlog "Dev server healthy after ${waited}s"
      return 0
    fi
    sleep 5
    waited=$((waited + 5))
  done

  wlog "ERROR: Dev server failed to respond after 180s"
  # Last resort: kill and start fresh
  kill_port
  rm -f .next/dev/lock
  nohup npm run dev > "scripts/devserver-$(date +%Y%m%d-%H%M%S).log" 2>&1 &
  wlog "Fresh server launched (PID: $!)"

  waited=0
  while [ $waited -lt 180 ]; do
    if server_is_alive; then
      wlog "Fresh server healthy after ${waited}s"
      return 0
    fi
    sleep 5
    waited=$((waited + 5))
  done

  wlog "FATAL: Cannot start dev server after two attempts"
  return 1
}

# ── Ensure server is running, restart if needed ──
ensure_server() {
  if server_is_alive; then
    return 0
  fi

  wlog "Server is DOWN — attempting restart ($((SERVER_RESTARTS + 1))/$MAX_SERVER_RESTARTS)"

  if [ "$SERVER_RESTARTS" -ge "$MAX_SERVER_RESTARTS" ]; then
    wlog "FATAL: Max server restarts ($MAX_SERVER_RESTARTS) reached. Giving up."
    return 1
  fi

  SERVER_RESTARTS=$((SERVER_RESTARTS + 1))
  start_server
}

# ── Run a single enrichment batch ──
run_batch() {
  local endpoint="$1"
  local label="$2"

  # Ensure server is alive
  if ! ensure_server; then
    return 1
  fi

  BATCH_NUM=$((BATCH_NUM + 1))
  local result
  result=$(curl -s -m 600 -X POST "${AUTH_HEADER[@]}" "$endpoint" 2>/dev/null)

  # Check if curl got a valid response
  if [ -z "$result" ] || ! echo "$result" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
    wlog "Invalid response from $label batch $BATCH_NUM — server may have crashed"
    CONSECUTIVE_FAILURES=$((CONSECUTIVE_FAILURES + 1))
    if [ "$CONSECUTIVE_FAILURES" -ge "$MAX_CONSECUTIVE_FAILURES" ]; then
      wlog "FATAL: $MAX_CONSECUTIVE_FAILURES consecutive failures. Stopping."
      return 1
    fi
    # Try to restart server and retry
    sleep 5
    return 2  # signal: retry
  fi

  CONSECUTIVE_FAILURES=0

  local success failed exhausted processed
  success=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',0))")
  failed=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('failed',0))")
  exhausted=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('apiExhausted',False))")
  processed=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('processed',0))")

  TOTAL_SUCCESS=$((TOTAL_SUCCESS + success))
  TOTAL_FAILED=$((TOTAL_FAILED + failed))

  elog "$label batch $BATCH_NUM: $success ok, $failed fail (total: $TOTAL_SUCCESS ok, $TOTAL_FAILED fail)"

  # Log errors
  local errors
  errors=$(echo "$result" | python3 -c "import sys,json; errs=json.load(sys.stdin).get('errors',[]); [print(f'  ERROR: {e[\"title\"]}: {e[\"error\"]}') for e in errs]" 2>/dev/null || true)
  [ -n "$errors" ] && echo "$errors" | tee -a "$ENRICHMENT_LOG"

  if [ "$exhausted" = "True" ]; then
    return 3  # signal: API exhausted
  fi

  if [ "$processed" -eq 0 ]; then
    return 4  # signal: phase complete
  fi

  return 0
}

# ═══════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════

wlog "=== Enrichment watchdog starting ==="
wlog "Batch size: $BATCH_SIZE | Sleep: ${SLEEP_BETWEEN}s | Max restarts: $MAX_SERVER_RESTARTS"

# Initial server check
if ! ensure_server; then
  wlog "FATAL: Cannot start dev server. Exiting."
  exit 1
fi

# Get initial status
STATUS=$(curl -s -m 120 "$BASE/status")
NEEDS=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin)['needsEnrichment'])")
wlog "Books needing enrichment: $NEEDS"
elog "Starting enrichment (watchdog). Books remaining: $NEEDS"
elog "Google Books: SKIPPED. Batch size: $BATCH_SIZE. Delay: ${SLEEP_BETWEEN}s"
elog "---"

# ── Helper: halt on API exhaustion ──
api_halt() {
  local phase="$1"
  elog ""
  elog "╔═══════════════════════════════════════════════╗"
  elog "║  ⚠️  API EXHAUSTED — ALL ENRICHMENT PAUSED   ║"
  elog "║  Phase: $phase"
  elog "║  Time:  $(date '+%Y-%m-%d %H:%M:%S')"
  elog "║  Total: $TOTAL_SUCCESS enriched, $TOTAL_FAILED failed"
  elog "║                                               ║"
  elog "║  Check Grok (xAI) and Brave Search credits.  ║"
  elog "╚═══════════════════════════════════════════════╝"
  wlog "API EXHAUSTED in $phase — halting all enrichment immediately."
  wlog "=== Watchdog HALTED. Restarts: $SERVER_RESTARTS, Enriched: $TOTAL_SUCCESS, Failed: $TOTAL_FAILED ==="
  exit 2
}

# ── Phase 1: Initial enrichment ──
elog "=== PHASE 1: Initial enrichment ==="
while true; do
  run_batch "$BASE/run?limit=$BATCH_SIZE&skipGoogleBooks=true" "Phase1"
  rc=$?

  case $rc in
    0) ;;                                        # success, continue
    1) wlog "Stopping: fatal error"; break ;;     # fatal
    2) continue ;;                                # retry after server restart
    3) api_halt "Phase 1 (Initial enrichment)" ;;
    4) elog "Phase 1 complete."; break ;;
  esac

  elog "Sleeping ${SLEEP_BETWEEN}s..."
  sleep "$SLEEP_BETWEEN"
done

# ── Phase 2: Heal pass ──
elog ""
elog "=== PHASE 2: Heal pass ==="
HEAL_BATCH=0
while [ "$HEAL_BATCH" -lt 20 ]; do
  HEAL_BATCH=$((HEAL_BATCH + 1))

  if ! ensure_server; then
    wlog "FATAL: Cannot reach server for Phase 2. Exiting."
    break
  fi

  RESULT=$(curl -s -m 300 -X POST "${AUTH_HEADER[@]}" "$BASE/heal?limit=100" 2>/dev/null)
  PROCESSED=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('processed',0))" 2>/dev/null || echo "0")
  FIXES=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('totalFixes',0))" 2>/dev/null || echo "0")

  elog "Heal batch $HEAL_BATCH: $PROCESSED books, $FIXES fixes"

  if [ "$PROCESSED" -eq 0 ]; then
    elog "Phase 2 complete."
    break
  fi

  sleep 5
done

# ── Phase 3: Re-enrich ──
elog ""
elog "=== PHASE 3: Re-enrich ==="
while true; do
  run_batch "$BASE/re-enrich?limit=$BATCH_SIZE&focus=all" "Phase3"
  rc=$?

  case $rc in
    0) ;;
    1) wlog "Stopping: fatal error"; break ;;
    2) continue ;;
    3) api_halt "Phase 3 (Re-enrich)" ;;
    4) elog "Phase 3 complete."; break ;;
  esac

  elog "Sleeping ${SLEEP_BETWEEN}s..."
  sleep "$SLEEP_BETWEEN"
done

# ── Phase 4: Google Books cover pass ──
# Runs cover-only enrichment WITH Google Books API enabled for books still
# missing covers after Phases 1-3. Google Books is Tier D in the cover cascade
# (after OL English edition, OL ISBN, and Brave Search), so it only fires
# when all other tiers failed. Capped at 800 books to stay within the
# 1,000 queries/day free tier (leaves headroom for organic page visits).
elog ""
elog "=== PHASE 4: Google Books cover pass ==="
GBOOKS_BATCH=0
GBOOKS_BATCH_SIZE=25
GBOOKS_MAX_BOOKS=800
GBOOKS_PROCESSED=0
while [ "$GBOOKS_PROCESSED" -lt "$GBOOKS_MAX_BOOKS" ]; do
  GBOOKS_BATCH=$((GBOOKS_BATCH + 1))

  if ! ensure_server; then
    wlog "FATAL: Cannot reach server for Phase 4. Exiting."
    break
  fi

  # Use the run endpoint with cover focus + Google Books enabled
  # This only processes books that still need cover resolution
  run_batch "$BASE/re-enrich?limit=$GBOOKS_BATCH_SIZE&focus=cover&useGoogleBooks=true" "Phase4-GBooks"
  rc=$?

  case $rc in
    0) ;;
    1) wlog "Stopping Phase 4: fatal error"; break ;;
    2) continue ;;
    3) api_halt "Phase 4 (Google Books cover pass)" ;;
    4) elog "Phase 4 complete — no more books need covers."; break ;;
  esac

  GBOOKS_PROCESSED=$((GBOOKS_PROCESSED + GBOOKS_BATCH_SIZE))
  elog "Google Books progress: ~$GBOOKS_PROCESSED/$GBOOKS_MAX_BOOKS processed"
  elog "Sleeping ${SLEEP_BETWEEN}s..."
  sleep "$SLEEP_BETWEEN"
done
elog "Phase 4 finished. Processed ~$GBOOKS_PROCESSED books with Google Books enabled."

# ── Final status ──
elog ""
elog "=== DONE ==="
if server_is_alive; then
  STATUS=$(curl -s -m 120 "$BASE/status")
  REMAINING=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin)['needsEnrichment'])")
  elog "Total: $TOTAL_SUCCESS enriched, $TOTAL_FAILED failed. Remaining: $REMAINING"
else
  elog "Total: $TOTAL_SUCCESS enriched, $TOTAL_FAILED failed. (Server down at finish — can't check remaining)"
fi

wlog "=== Watchdog complete. Restarts: $SERVER_RESTARTS, Enriched: $TOTAL_SUCCESS, Failed: $TOTAL_FAILED ==="
elog "Enrichment log: $ENRICHMENT_LOG"
elog "Watchdog log: $WATCHDOG_LOG"
