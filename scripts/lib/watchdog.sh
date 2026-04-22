#!/bin/bash
# tbra process watchdog.
# Kills any `tsx` process running out of /Users/clankeredwards/claude/tbra/
# that has been alive for more than MAX_AGE_MIN minutes.
#
# Invoked by the launchd agent at ~/Library/LaunchAgents/com.tbra.watchdog.plist
# (see scripts/lib/install-watchdog.sh) every 5 minutes.
#
# Exemptions: a PID is skipped if /tmp/tbra-longrun-<pid> exists. Scripts that
# legitimately need to run >MAX_AGE_MIN minutes should `touch` that file at
# startup and `rm` it at exit. The turso-guard helper does this automatically
# when constructed with { longRunning: true }.
#
# Leaves a log at /tmp/tbra-watchdog.log. Caps at 1MB (keeps last 500KB).

set -u

MAX_AGE_MIN="${TBRA_WATCHDOG_MAX_AGE_MIN:-60}"
LOG="${TBRA_WATCHDOG_LOG:-/tmp/tbra-watchdog.log}"
TBRA_PATH="/Users/clankeredwards/claude/tbra"
EXEMPT_PREFIX="/tmp/tbra-longrun-"

if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG" 2>/dev/null || echo 0)" -gt 1048576 ]; then
  tail -c 500000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

now_ts=$(date +%s)

# ps -Ao lstart prints 5 fields: "Tue Apr 22 14:05:12 2026"
ps -Ao pid,lstart,command | awk -v tbra="$TBRA_PATH" '
  /tsx/ && $0 ~ tbra {
    if (/scripts\/lib\/watchdog\.sh/) next
    # pid=$1, lstart=$2..$6, command=$7..NF
    lstart = $2 " " $3 " " $4 " " $5 " " $6
    cmd = ""
    for (i=7; i<=NF; i++) cmd = cmd $i " "
    print $1 "|" lstart "|" cmd
  }
' | while IFS='|' read -r pid lstart cmd; do
  # Exemption marker
  if [ -f "${EXEMPT_PREFIX}${pid}" ]; then
    continue
  fi

  start_ts=$(date -jf "%a %b %d %T %Y" "$lstart" +%s 2>/dev/null)
  if [ -z "$start_ts" ]; then
    echo "$(date '+%Y-%m-%dT%H:%M:%S%z') could not parse lstart='$lstart' for PID $pid; skipping" >> "$LOG"
    continue
  fi
  age_min=$(( (now_ts - start_ts) / 60 ))
  if [ "$age_min" -ge "$MAX_AGE_MIN" ]; then
    echo "$(date '+%Y-%m-%dT%H:%M:%S%z') KILL pid=$pid age=${age_min}min cmd=$cmd" >> "$LOG"
    kill "$pid" 2>/dev/null
    sleep 2
    if kill -0 "$pid" 2>/dev/null; then
      echo "$(date '+%Y-%m-%dT%H:%M:%S%z') SIGKILL pid=$pid (ignored SIGTERM)" >> "$LOG"
      kill -9 "$pid" 2>/dev/null
    fi
  fi
done
