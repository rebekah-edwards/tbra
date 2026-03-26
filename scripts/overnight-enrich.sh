#!/bin/bash
# Overnight enrichment script — runs via curl, no Claude involvement.
# Skips Google Books API. Logs results to a file.
#
# Usage:
#   ./scripts/overnight-enrich.sh          # runs until all books done or API exhausted
#   ./scripts/overnight-enrich.sh --dry-run # just shows status, doesn't enrich
#
# Prerequisites: Next.js dev server running on localhost:3000
#   cd tbra && npm run dev

set -euo pipefail

BASE="http://localhost:3000/api/enrichment"
LOG_FILE="scripts/enrichment-log-$(date +%Y%m%d-%H%M%S).txt"
BATCH_SIZE=25
SLEEP_BETWEEN=30  # seconds between batches
TOTAL_SUCCESS=0
TOTAL_FAILED=0
BATCH_NUM=0

log() {
  echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

# Check server is up
if ! curl -s -o /dev/null -w '' "$BASE/status" 2>/dev/null; then
  echo "ERROR: Dev server not running at localhost:3000"
  exit 1
fi

# Show current status
STATUS=$(curl -s "$BASE/status")
NEEDS=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin)['needsEnrichment'])")
log "Starting overnight enrichment. Books needing enrichment: $NEEDS"
log "Google Books: SKIPPED. Batch size: $BATCH_SIZE. Delay: ${SLEEP_BETWEEN}s"
log "---"

if [ "${1:-}" = "--dry-run" ]; then
  echo "$STATUS" | python3 -m json.tool
  exit 0
fi

# Phase 1: Initial enrichment (books with no data at all)
log "=== PHASE 1: Initial enrichment (no summary, no ratings) ==="
while true; do
  BATCH_NUM=$((BATCH_NUM + 1))
  RESULT=$(curl -s -X POST "$BASE/run?limit=$BATCH_SIZE&skipGoogleBooks=true")

  SUCCESS=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',0))")
  FAILED=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('failed',0))")
  EXHAUSTED=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('apiExhausted',False))")
  PROCESSED=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('processed',0))")

  TOTAL_SUCCESS=$((TOTAL_SUCCESS + SUCCESS))
  TOTAL_FAILED=$((TOTAL_FAILED + FAILED))

  log "Batch $BATCH_NUM: $SUCCESS ok, $FAILED failed (total: $TOTAL_SUCCESS ok, $TOTAL_FAILED failed)"

  # Log errors if any
  ERRORS=$(echo "$RESULT" | python3 -c "import sys,json; errs=json.load(sys.stdin).get('errors',[]); [print(f'  ERROR: {e[\"title\"]}: {e[\"error\"]}') for e in errs]" 2>/dev/null || true)
  [ -n "$ERRORS" ] && echo "$ERRORS" | tee -a "$LOG_FILE"

  if [ "$EXHAUSTED" = "True" ]; then
    log "API exhausted — stopping Phase 1."
    break
  fi

  if [ "$PROCESSED" -eq 0 ]; then
    log "Phase 1 complete — no more books need initial enrichment."
    break
  fi

  log "Sleeping ${SLEEP_BETWEEN}s..."
  sleep "$SLEEP_BETWEEN"
done

# Phase 2: Heal pass (fix data quality issues — no external API needed for most)
log ""
log "=== PHASE 2: Heal pass (titles, descriptions, genres, pub dates) ==="
HEAL_BATCH=0
while true; do
  HEAL_BATCH=$((HEAL_BATCH + 1))
  RESULT=$(curl -s -X POST "$BASE/heal?limit=100")

  PROCESSED=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('processed',0))")
  FIXES=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('totalFixes',0))")

  log "Heal batch $HEAL_BATCH: $PROCESSED books processed, $FIXES fixes applied"

  if [ "$PROCESSED" -eq 0 ]; then
    log "Phase 2 complete — no more books need healing."
    break
  fi

  # Don't run heal endlessly — cap at 20 batches (2000 books)
  if [ "$HEAL_BATCH" -ge 20 ]; then
    log "Phase 2 capped at 20 batches."
    break
  fi

  sleep 5
done

# Phase 3: Re-enrich (quality improvements — summaries, descriptions, covers via non-Google sources)
log ""
log "=== PHASE 3: Re-enrich (summaries, descriptions, covers — no Google Books) ==="
REENRICH_BATCH=0
while true; do
  REENRICH_BATCH=$((REENRICH_BATCH + 1))
  RESULT=$(curl -s -X POST "$BASE/re-enrich?limit=$BATCH_SIZE&focus=all")

  SUCCESS=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('success',0))")
  FAILED=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('failed',0))")
  EXHAUSTED=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('apiExhausted',False))")
  PROCESSED=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('processed',0))")

  TOTAL_SUCCESS=$((TOTAL_SUCCESS + SUCCESS))
  TOTAL_FAILED=$((TOTAL_FAILED + FAILED))

  log "Re-enrich batch $REENRICH_BATCH: $SUCCESS ok, $FAILED failed"

  ERRORS=$(echo "$RESULT" | python3 -c "import sys,json; errs=json.load(sys.stdin).get('errors',[]); [print(f'  ERROR: {e[\"title\"]}: {e[\"error\"]}') for e in errs]" 2>/dev/null || true)
  [ -n "$ERRORS" ] && echo "$ERRORS" | tee -a "$LOG_FILE"

  if [ "$EXHAUSTED" = "True" ]; then
    log "API exhausted — stopping Phase 3."
    break
  fi

  if [ "$PROCESSED" -eq 0 ]; then
    log "Phase 3 complete."
    break
  fi

  log "Sleeping ${SLEEP_BETWEEN}s..."
  sleep "$SLEEP_BETWEEN"
done

# Phase 4: Generate "needs Google Books later" list
log ""
log "=== PHASE 4: Generating Google Books backlog ==="
GBOOKS_FILE="scripts/google-books-backlog-$(date +%Y%m%d).txt"

# Query for books still missing covers or publisher info after all non-Google enrichment
python3 -c "
import sqlite3, os

db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath('$LOG_FILE'))), 'data', 'tbra.db')
if not os.path.exists(db_path):
    db_path = 'data/tbra.db'

conn = sqlite3.connect(db_path)
c = conn.cursor()

# Books missing covers (couldn't resolve via OL, Brave, or Amazon)
c.execute('''
    SELECT b.id, b.title, GROUP_CONCAT(a.name, ', ')
    FROM books b
    LEFT JOIN book_authors ba ON ba.book_id = b.id
    LEFT JOIN authors a ON a.id = ba.author_id
    WHERE b.cover_image_url IS NULL
    AND b.summary IS NOT NULL
    GROUP BY b.id
    ORDER BY
      CASE WHEN EXISTS (SELECT 1 FROM user_book_state ubs WHERE ubs.book_id = b.id) THEN 0 ELSE 1 END,
      b.title
''')
missing_covers = c.fetchall()

# Books missing description (OL often lacks these)
c.execute('''
    SELECT b.id, b.title, GROUP_CONCAT(a.name, ', ')
    FROM books b
    LEFT JOIN book_authors ba ON ba.book_id = b.id
    LEFT JOIN authors a ON a.id = ba.author_id
    WHERE b.description IS NULL
    AND b.summary IS NOT NULL
    GROUP BY b.id
    ORDER BY
      CASE WHEN EXISTS (SELECT 1 FROM user_book_state ubs WHERE ubs.book_id = b.id) THEN 0 ELSE 1 END,
      b.title
''')
missing_description = c.fetchall()

# Books missing publisher
c.execute('''
    SELECT b.id, b.title, GROUP_CONCAT(a.name, ', ')
    FROM books b
    LEFT JOIN book_authors ba ON ba.book_id = b.id
    LEFT JOIN authors a ON a.id = ba.author_id
    WHERE b.publisher IS NULL
    AND b.summary IS NOT NULL
    GROUP BY b.id
    ORDER BY
      CASE WHEN EXISTS (SELECT 1 FROM user_book_state ubs WHERE ubs.book_id = b.id) THEN 0 ELSE 1 END,
      b.title
''')
missing_publisher = c.fetchall()

conn.close()

with open('$GBOOKS_FILE', 'w') as f:
    f.write('# Google Books Backlog — Generated $(date +%Y-%m-%d)\n')
    f.write('# These books need Google Books API for covers, descriptions, and/or publisher.\n')
    f.write('# Run when API credits are refreshed.\n\n')

    f.write(f'## Missing Covers ({len(missing_covers)} books)\n\n')
    for book_id, title, authors in missing_covers:
        f.write(f'- {title} — {authors or \"Unknown\"} [{book_id}]\n')

    f.write(f'\n## Missing Descriptions ({len(missing_description)} books)\n\n')
    for book_id, title, authors in missing_description:
        f.write(f'- {title} — {authors or \"Unknown\"} [{book_id}]\n')

    f.write(f'\n## Missing Publisher ({len(missing_publisher)} books)\n\n')
    for book_id, title, authors in missing_publisher:
        f.write(f'- {title} — {authors or \"Unknown\"} [{book_id}]\n')

print(f'{len(missing_covers)} missing covers, {len(missing_description)} missing descriptions, {len(missing_publisher)} missing publisher')
" | tee -a "$LOG_FILE"

log "Google Books backlog saved to: $GBOOKS_FILE"

# Final status
log ""
log "=== DONE ==="
STATUS=$(curl -s "$BASE/status")
REMAINING=$(echo "$STATUS" | python3 -c "import sys,json; print(json.load(sys.stdin)['needsEnrichment'])")
log "Total: $TOTAL_SUCCESS enriched, $TOTAL_FAILED failed. Still needing enrichment: $REMAINING"
log "Full log: $LOG_FILE"
log "Google Books backlog: $GBOOKS_FILE"
