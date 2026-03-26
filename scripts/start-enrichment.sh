#!/bin/bash
# One-shot launcher: unpauses enrichment and starts the watchdog.
# Intended to be called by `at` or manually.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "[$(date)] Unpausing enrichment..."
sed -i '' 's/^ENRICHMENT_PAUSED=true/ENRICHMENT_PAUSED=false/' .env.local

echo "[$(date)] Launching enrichment watchdog..."
nohup bash scripts/enrich-watchdog.sh > /dev/null 2>&1 &
echo "[$(date)] Watchdog launched (PID: $!)"
