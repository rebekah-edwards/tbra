#!/usr/bin/env bash
set -euo pipefail

file=$(jq -r '.tool_input.file_path // .tool_input.path // ""')

if echo "$file" | grep -qiE "(^|/)data/tbra\.db$"; then
  echo "BLOCKED: Direct edits to 'data/tbra.db' are not allowed. Use Drizzle migrations or scripts to modify the database." >&2
  exit 2
fi

exit 0
