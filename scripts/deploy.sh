#!/bin/bash
# deploy.sh — One-command deploy: code + database sync to production
# Usage: ./scripts/deploy.sh [--db-only] [--code-only] [--dry-run]
#
# This script:
#   1. Pushes code to origin/main (triggers Vercel auto-deploy)
#   2. Syncs the local SQLite database to Turso (production)
#
# Prerequisites:
#   - turso CLI installed and authenticated
#   - Git remote 'origin' configured
#   - Local SQLite DB at data/tbra.db

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DB_PATH="$PROJECT_DIR/data/tbra.db"
TURSO_DB="tbra-web-app"
DUMP_DIR="$PROJECT_DIR/.turso-sync"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Parse args
DB_ONLY=false
CODE_ONLY=false
DRY_RUN=false
for arg in "$@"; do
  case $arg in
    --db-only)  DB_ONLY=true ;;
    --code-only) CODE_ONLY=true ;;
    --dry-run)  DRY_RUN=true ;;
    --help|-h)
      echo "Usage: ./scripts/deploy.sh [--db-only] [--code-only] [--dry-run]"
      echo ""
      echo "  --db-only    Only sync database to Turso (skip git push)"
      echo "  --code-only  Only push code (skip database sync)"
      echo "  --dry-run    Show what would happen without doing it"
      exit 0
      ;;
  esac
done

cd "$PROJECT_DIR"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  tbr(a) Deploy Script${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# ─── Step 1: Push code ───────────────────────────────────────────────
if [ "$DB_ONLY" = false ]; then
  echo -e "${YELLOW}[1/2] Pushing code to origin/main...${NC}"

  if [ "$DRY_RUN" = true ]; then
    echo "  (dry run) Would run: git push origin main"
  else
    # Check for uncommitted changes
    if ! git diff --quiet HEAD 2>/dev/null; then
      echo -e "${RED}  Warning: You have uncommitted changes.${NC}"
      echo "  Commit or stash them first, or use --db-only."
      exit 1
    fi

    git push origin main 2>&1 | sed 's/^/  /'
    echo -e "${GREEN}  Code pushed. Vercel will auto-deploy.${NC}"
  fi
  echo ""
fi

# ─── Step 2: Sync database ──────────────────────────────────────────
if [ "$CODE_ONLY" = false ]; then
  echo -e "${YELLOW}[2/2] Syncing database to Turso...${NC}"

  if [ ! -f "$DB_PATH" ]; then
    echo -e "${RED}  Error: Local database not found at $DB_PATH${NC}"
    exit 1
  fi

  # Verify turso CLI
  if ! command -v turso &>/dev/null; then
    echo -e "${RED}  Error: turso CLI not found. Install: curl -sSfL https://get.tur.so/install.sh | bash${NC}"
    exit 1
  fi

  # Create dump directory
  mkdir -p "$DUMP_DIR"

  # Tables in safe deletion order (dependents first, then base tables)
  # This order ensures foreign key constraints aren't violated
  TABLES_DELETE_ORDER=(
    "rating_citations"
    "review_descriptor_tags"
    "review_helpful_votes"
    "user_book_dimension_ratings"
    "user_owned_editions"
    "user_book_ratings"
    "user_book_reviews"
    "user_book_state"
    "user_favorite_books"
    "user_hidden_books"
    "user_follows"
    "user_genre_preferences"
    "user_content_preferences"
    "user_reading_preferences"
    "user_notification_preferences"
    "reading_goals"
    "reading_sessions"
    "reading_notes"
    "up_next"
    "report_corrections"
    "reported_issues"
    "book_category_ratings"
    "book_authors"
    "book_genres"
    "book_narrators"
    "book_series"
    "enrichment_log"
    "links"
    "editions"
    "books"
    "authors"
    "narrators"
    "series"
    "genres"
    "taxonomy_categories"
    "citations"
    "users"
  )

  # Tables in safe insertion order (base tables first, then dependents)
  TABLES_INSERT_ORDER=(
    "users"
    "authors"
    "narrators"
    "series"
    "genres"
    "taxonomy_categories"
    "citations"
    "books"
    "editions"
    "links"
    "enrichment_log"
    "book_authors"
    "book_genres"
    "book_narrators"
    "book_series"
    "book_category_ratings"
    "rating_citations"
    "user_book_state"
    "user_book_ratings"
    "user_book_reviews"
    "user_book_dimension_ratings"
    "review_descriptor_tags"
    "review_helpful_votes"
    "user_owned_editions"
    "user_favorite_books"
    "user_hidden_books"
    "user_follows"
    "user_genre_preferences"
    "user_content_preferences"
    "user_reading_preferences"
    "user_notification_preferences"
    "reading_goals"
    "reading_sessions"
    "reading_notes"
    "up_next"
    "report_corrections"
    "reported_issues"
  )

  echo "  Exporting tables from local SQLite..."

  # Use Python for reliable Unicode handling in exports
  python3 -c "
import sqlite3, os, sys

db_path = '$DB_PATH'
dump_dir = '$DUMP_DIR'
conn = sqlite3.connect(db_path)
conn.row_factory = sqlite3.Row
cursor = conn.cursor()

tables = [r[0] for r in cursor.execute(\"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '__drizzle%'\").fetchall()]

for table in tables:
    rows = cursor.execute(f'SELECT * FROM {table}').fetchall()
    if not rows:
        # Write empty file to signal 'delete all, insert nothing'
        with open(os.path.join(dump_dir, f'{table}.sql'), 'w') as f:
            f.write('')
        continue

    cols = [d[0] for d in cursor.description]
    col_list = ', '.join(cols)

    with open(os.path.join(dump_dir, f'{table}.sql'), 'w', encoding='utf-8') as f:
        for row in rows:
            vals = []
            for v in row:
                if v is None:
                    vals.append('NULL')
                elif isinstance(v, (int, float)):
                    vals.append(str(v))
                else:
                    escaped = str(v).replace(\"'\", \"''\")
                    vals.append(f\"'{escaped}'\")
            val_list = ', '.join(vals)
            f.write(f'INSERT INTO {table} ({col_list}) VALUES ({val_list});\\n')

conn.close()
print(f'  Exported {len(tables)} tables')
" 2>&1

  if [ "$DRY_RUN" = true ]; then
    echo "  (dry run) Would sync ${#TABLES_INSERT_ORDER[@]} tables to Turso"
    echo "  Dump files are in $DUMP_DIR"
  else
    # Delete all data in dependency-safe order
    echo "  Clearing remote tables..."
    DELETE_SQL="PRAGMA foreign_keys=OFF;"
    for table in "${TABLES_DELETE_ORDER[@]}"; do
      DELETE_SQL="${DELETE_SQL} DELETE FROM ${table};"
    done
    echo "$DELETE_SQL" | turso db shell "$TURSO_DB" 2>&1 | sed 's/^/  /'

    # Insert data in dependency-safe order
    echo "  Uploading data..."
    TOTAL=${#TABLES_INSERT_ORDER[@]}
    CURRENT=0
    FAILED=()

    for table in "${TABLES_INSERT_ORDER[@]}"; do
      CURRENT=$((CURRENT + 1))
      SQL_FILE="$DUMP_DIR/${table}.sql"

      if [ ! -f "$SQL_FILE" ] || [ ! -s "$SQL_FILE" ]; then
        printf "  [%2d/%d] %-35s %s\n" "$CURRENT" "$TOTAL" "$table" "skipped (empty)"
        continue
      fi

      ROW_COUNT=$(wc -l < "$SQL_FILE" | tr -d ' ')

      # For large tables, split into batches of 500 to avoid shell limits
      if [ "$ROW_COUNT" -gt 500 ]; then
        printf "  [%2d/%d] %-35s %s rows (batched)..." "$CURRENT" "$TOTAL" "$table" "$ROW_COUNT"
        split -l 500 "$SQL_FILE" "$DUMP_DIR/${table}_batch_"
        BATCH_OK=true
        for batch in "$DUMP_DIR/${table}_batch_"*; do
          if ! (echo "PRAGMA foreign_keys=OFF;" && cat "$batch") | turso db shell "$TURSO_DB" 2>/dev/null; then
            BATCH_OK=false
            break
          fi
          rm "$batch"
        done
        if [ "$BATCH_OK" = true ]; then
          echo -e " ${GREEN}done${NC}"
        else
          echo -e " ${RED}FAILED${NC}"
          FAILED+=("$table")
        fi
      else
        printf "  [%2d/%d] %-35s %s rows..." "$CURRENT" "$TOTAL" "$table" "$ROW_COUNT"
        if (echo "PRAGMA foreign_keys=OFF;" && cat "$SQL_FILE") | turso db shell "$TURSO_DB" 2>/dev/null; then
          echo -e " ${GREEN}done${NC}"
        else
          echo -e " ${RED}FAILED${NC}"
          FAILED+=("$table")
        fi
      fi
    done

    echo ""
    if [ ${#FAILED[@]} -eq 0 ]; then
      echo -e "${GREEN}  All tables synced successfully!${NC}"
    else
      echo -e "${RED}  Failed tables: ${FAILED[*]}${NC}"
      echo "  Re-run with: ./scripts/deploy.sh --db-only"
    fi

    # Verify counts
    echo ""
    echo "  Verifying row counts..."
    python3 -c "
import sqlite3, subprocess, json

conn = sqlite3.connect('$DB_PATH')
cursor = conn.cursor()
tables = [r[0] for r in cursor.execute(\"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '__drizzle%'\").fetchall()]

mismatches = []
for table in sorted(tables):
    local_count = cursor.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
    if local_count == 0:
        continue
    try:
        result = subprocess.run(
            ['turso', 'db', 'shell', '$TURSO_DB', f'SELECT COUNT(*) FROM {table};'],
            capture_output=True, text=True, timeout=10
        )
        remote_count = int(result.stdout.strip().split('\\n')[-1].strip()) if result.stdout.strip() else 0
    except:
        remote_count = '?'

    status = 'OK' if local_count == remote_count else 'MISMATCH'
    if status == 'MISMATCH':
        mismatches.append(f'    {table}: local={local_count} remote={remote_count}')

conn.close()

if mismatches:
    print('  Mismatches found:')
    for m in mismatches:
        print(m)
else:
    print('  All counts match!')
" 2>&1
  fi

  # Cleanup dump files
  rm -rf "$DUMP_DIR"
  echo ""
fi

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Deploy complete!${NC}"
echo -e "${GREEN}========================================${NC}"
