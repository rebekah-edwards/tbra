#!/usr/bin/env bash
set -euo pipefail

cmd=$(jq -r '.tool_input.command // ""')

dangerous_patterns=(
  "deploy"
  "turso"
  "sync-incremental"
  "db:push"
  "deploy:db"
  "deploy:code"
  "rm -rf"
  "git reset --hard"
  "git push.*--force"
  "DROP TABLE"
  "DROP DATABASE"
)

for pattern in "${dangerous_patterns[@]}"; do
  if echo "$cmd" | grep -qiE "$pattern"; then
    echo "BLOCKED: '$cmd' matches protected pattern '$pattern'. Ask the user for explicit approval before running this command." >&2
    exit 2
  fi
done

exit 0
