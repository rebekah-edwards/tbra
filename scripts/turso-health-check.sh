#!/bin/bash
# Measure Turso book-page response time from CLI.
while true; do
  t=$(curl -o /dev/null -s -w '%{time_total}' "https://www.thebasedreader.app/book/the-will-of-the-many-james-islington?cb=$(date +%s)")
  ts=$(date '+%H:%M:%S')
  echo "$ts  ${t}s"
  if awk "BEGIN {exit !($t > 10.0)}"; then
    echo "$ts  WARNING: book page took ${t}s (>10s) — consider stopping dedup"
  fi
  sleep 60
done
