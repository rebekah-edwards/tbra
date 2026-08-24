#!/bin/bash
# housekeeping.sh — hourly Mac-health chores for tbra. No model, no judgment.
#
# Added 2026-08-24 after Rebekah's Tailscale-only tester app stopped loading:
# a headless iOS simulator left Booted from an earlier build session (165 procs,
# 5.6GB) drove swap to 14.2/15.4GB and wedged the dev server mid-compile. launchd
# still reported the service "running".  (memory: project_devserver_wedged_by_idle_simulator)
#
# Two chores:
#   1. Reap leftover booted simulators (guarded — see below).
#   2. Rotate data/devserver.log, which launchd appends to forever (was 37MB).
#
# Run via cron-run.sh, which supplies the lockfile + its own logging.

set -u

REPO="/Users/clankeredwards/claude/tbra"
DEVLOG="$REPO/data/devserver.log"

# Rotate when the dev log exceeds this; keep this much of the tail.
LOG_MAX_BYTES=${LOG_MAX_BYTES:-20971520}   # 20MB
LOG_KEEP_BYTES=${LOG_KEEP_BYTES:-2097152}  #  2MB

# Only reap a simulator idle at least this long. A build boots a sim and uses it
# within seconds, so an hour-old headless sim is leftover, never in-flight work.
SIM_IDLE_MIN=${SIM_IDLE_MIN:-60}

stamp() { date '+%Y-%m-%dT%H:%M:%S%z'; }

# ---------------------------------------------------------------- 1. simulators

# "[[DD-]HH:]MM:SS" -> minutes. macOS ps has no etimes.
etime_to_min() {
  local t="$1" d=0 h=0 m=0
  case "$t" in
    *-*) d="${t%%-*}"; t="${t#*-}" ;;
  esac
  local parts; IFS=':' read -ra parts <<< "$t"
  case "${#parts[@]}" in
    3) h="${parts[0]}"; m="${parts[1]}" ;;
    2) m="${parts[0]}" ;;
    *) echo 0; return ;;
  esac
  echo $(( 10#$d * 1440 + 10#$h * 60 + 10#$m ))
}

reap_simulators() {
  local booted
  booted=$(xcrun simctl list devices booted 2>/dev/null \
           | grep -oE '\([0-9A-F]{8}-[0-9A-F-]{27}\) \(Booted\)' \
           | grep -oE '[0-9A-F]{8}-[0-9A-F-]{27}')

  [ -z "$booted" ] && { echo "$(stamp) [sim] none booted"; return; }

  # GUARD: if the Simulator window is open, someone is watching it. Hands off.
  if pgrep -f "Simulator.app/Contents/MacOS/Simulator" >/dev/null 2>&1; then
    echo "$(stamp) [sim] Simulator GUI is open — skipping all reaps"
    return
  fi

  # GUARD: a build/install/launch in flight owns whatever is booted.
  if pgrep -f "xcodebuild" >/dev/null 2>&1; then
    echo "$(stamp) [sim] xcodebuild running — skipping all reaps"
    return
  fi
  if pgrep -f "simctl (install|launch)" >/dev/null 2>&1; then
    echo "$(stamp) [sim] simctl install/launch running — skipping all reaps"
    return
  fi

  local udid age_raw age_min rss
  while read -r udid; do
    [ -z "$udid" ] && continue

    # Age + footprint from the device's own process tree.
    age_raw=$(ps -Ao etime,command | grep -F "$udid" | grep -v grep | head -1 | awk '{print $1}')
    if [ -z "$age_raw" ]; then
      echo "$(stamp) [sim] $udid booted but has no processes — skipping"
      continue
    fi
    age_min=$(etime_to_min "$age_raw")
    rss=$(ps -Ao rss,command | grep -F "$udid" | grep -v grep | awk '{s+=$1} END {printf "%.0f", s/1024}')

    # GUARD: too young to be leftover.
    if [ "$age_min" -lt "$SIM_IDLE_MIN" ]; then
      echo "$(stamp) [sim] $udid idle ${age_min}m (<${SIM_IDLE_MIN}m) — leaving alone"
      continue
    fi

    echo "$(stamp) [sim] shutting down $udid (idle ${age_min}m, ~${rss}MB)"
    if xcrun simctl shutdown "$udid" 2>&1; then
      echo "$(stamp) [sim] $udid shut down, reclaimed ~${rss}MB"
    else
      echo "$(stamp) [sim] $udid shutdown FAILED"
    fi
  done <<< "$booted"
}

# ------------------------------------------------------------------- 2. dev log

# launchd holds persistent O_APPEND fds on this file (verified 2026-08-24), so it
# must be truncated IN PLACE. Renaming it — the way cron-run.sh rotates its own
# logs — would leave the server writing to the orphaned inode and devserver.log
# would never reappear until the service restarted.
rotate_devserver_log() {
  [ -f "$DEVLOG" ] || { echo "$(stamp) [log] no devserver.log"; return; }
  local size
  size=$(stat -f%z "$DEVLOG" 2>/dev/null || echo 0)
  if [ "$size" -le "$LOG_MAX_BYTES" ]; then
    echo "$(stamp) [log] devserver.log $((size/1024))KB — under cap"
    return
  fi
  tail -c "$LOG_KEEP_BYTES" "$DEVLOG" > "$DEVLOG.1" 2>/dev/null
  : > "$DEVLOG"
  echo "$(stamp) [log] rotated devserver.log ($((size/1024))KB -> 0, tail kept in devserver.log.1)"
}

reap_simulators
rotate_devserver_log
