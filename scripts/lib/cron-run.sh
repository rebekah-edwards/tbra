#!/bin/bash
# cron-run.sh — launchd entrypoint for tbra's mechanical (no-judgment) tasks.
#
# Added 2026-07-30. These three jobs used to be Claude scheduled tasks. Each
# firing left a resident ~380MB claude-code process behind, and user-activity-sync
# alone fires 34×/day — together ~76% of the session pileup that drove the iMac to
# load 80 and starved the dev server (memory: project_mac_process_pileup).
# None of them need a language model: they are one command each, and anything
# needing a human now files an /admin/issues alert from inside the script.
#
# Usage: cron-run.sh <job-name> <command...>
#   - Logs stdout+stderr to data/<job-name>.log, capped at 5MB (keeps last 2MB).
#   - Skips the run entirely if TBRA_CRON_QUIET_HOURS covers the current hour
#     (used by user-activity-sync to stay out of the 3-9 AM nightly window,
#     where single-writer SQLite contention would fight the big import jobs).
#   - Never runs two copies of the same job (flock-style PID lockfile).

set -u

JOB="${1:?usage: cron-run.sh <job-name> <command...>}"
shift

REPO="/Users/clankeredwards/claude/tbra"
LOG="$REPO/data/$JOB.log"
LOCK="/tmp/tbra-cron-$JOB.lock"

cd "$REPO" || exit 1
mkdir -p "$REPO/data"

# Log rotation
if [ -f "$LOG" ] && [ "$(stat -f%z "$LOG" 2>/dev/null || echo 0)" -gt 5242880 ]; then
  tail -c 2097152 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi

stamp() { date '+%Y-%m-%dT%H:%M:%S%z'; }

# Quiet hours: comma-separated hour list, e.g. "3,4,5,6,7,8,9"
if [ -n "${TBRA_CRON_QUIET_HOURS:-}" ]; then
  hour=$(date +%-H)
  case ",${TBRA_CRON_QUIET_HOURS}," in
    *",${hour},"*)
      echo "$(stamp) [$JOB] quiet hour ($hour) — skipping" >> "$LOG"
      exit 0
      ;;
  esac
fi

# Single-instance lock. A stale lockfile (process gone) is reclaimed.
if [ -f "$LOCK" ]; then
  old=$(cat "$LOCK" 2>/dev/null || echo "")
  if [ -n "$old" ] && kill -0 "$old" 2>/dev/null; then
    echo "$(stamp) [$JOB] already running (pid $old) — skipping" >> "$LOG"
    exit 0
  fi
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT

echo "$(stamp) [$JOB] START: $*" >> "$LOG"
start=$(date +%s)
"$@" >> "$LOG" 2>&1
code=$?
dur=$(( $(date +%s) - start ))
echo "$(stamp) [$JOB] END exit=$code duration=${dur}s" >> "$LOG"
exit $code
