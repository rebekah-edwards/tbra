#!/bin/bash
# =============================================================================
# BULK CLEANUP: Remove non-English books, junk entries, and duplicates
# =============================================================================
# This script:
# 1. Deletes books explicitly marked as non-English (language != 'English')
# 2. Deletes books with non-ASCII titles that aren't shelved by users
# 3. Deletes retail/placeholder junk entries
# 4. Detects likely foreign-language books by title patterns
# 5. Logs everything it does
#
# Safety: NEVER deletes a book that has user_book_state records.
# Those are flagged for manual review instead.
# =============================================================================

set -euo pipefail

DB="data/tbra.db"
LOG="scripts/cleanup-log-$(date +%Y%m%d-%H%M%S).txt"
DELETED=0
SKIPPED=0
FLAGGED=0

log() {
  echo "[$(date +%H:%M:%S)] $1" | tee -a "$LOG"
}

delete_book() {
  local book_id="$1"
  local reason="$2"
  local title="$3"

  # Safety check: does this book have users?
  local user_count
  user_count=$(sqlite3 "$DB" "SELECT COUNT(*) FROM user_book_state WHERE book_id = '$book_id';")

  if [ "$user_count" -gt 0 ]; then
    log "  SKIP (has $user_count users): $title — $reason"
    SKIPPED=$((SKIPPED + 1))
    return
  fi

  # Delete from all related tables
  sqlite3 "$DB" "
    DELETE FROM book_series WHERE book_id = '$book_id';
    DELETE FROM book_authors WHERE book_id = '$book_id';
    DELETE FROM book_genres WHERE book_id = '$book_id';
    DELETE FROM book_category_ratings WHERE book_id = '$book_id';
    DELETE FROM enrichment_log WHERE book_id = '$book_id';
    DELETE FROM reported_issues WHERE book_id = '$book_id';
    DELETE FROM user_book_ratings WHERE book_id = '$book_id';
    DELETE FROM user_book_reviews WHERE book_id = '$book_id';
    DELETE FROM user_favorite_books WHERE book_id = '$book_id';
    DELETE FROM reading_sessions WHERE book_id = '$book_id';
    DELETE FROM books WHERE id = '$book_id';
  "

  log "  DELETED: $title — $reason"
  DELETED=$((DELETED + 1))
}

# =============================================================================
# PHASE 1: Explicitly non-English books
# =============================================================================
log "=== PHASE 1: Books explicitly marked as non-English ==="

sqlite3 "$DB" "
  SELECT id, title, language FROM books
  WHERE language IS NOT NULL AND language != 'English' AND language != ''
  ORDER BY language, title;
" | while IFS='|' read -r id title lang; do
  delete_book "$id" "Language: $lang" "$title"
done

log "Phase 1 complete."
log ""

# =============================================================================
# PHASE 2: Non-ASCII titles (likely foreign language)
# Exclude known-good patterns (apostrophes, accents in English titles, etc.)
# =============================================================================
log "=== PHASE 2: Non-ASCII titles (likely foreign) ==="

sqlite3 "$DB" "
  SELECT b.id, b.title, b.language FROM books b
  WHERE b.title GLOB '*[^ -~]*'
  AND b.id NOT IN (SELECT book_id FROM user_book_state)
  ORDER BY b.title;
" | while IFS='|' read -r id title lang; do
  # Skip if it's marked English and only has common English special chars
  # (apostrophes, em-dashes, accented names like Brontë, Númenor, etc.)
  if [ "$lang" = "English" ]; then
    # Check if title is mostly ASCII (just a few special chars)
    ascii_ratio=$(python3 -c "
t = '''$title'''
ascii_count = sum(1 for c in t if ord(c) < 128)
total = len(t)
print(f'{ascii_count/total:.2f}' if total > 0 else '1.00')
" 2>/dev/null || echo "1.00")

    # If > 85% ASCII, it's probably an English title with a few special chars
    is_mostly_ascii=$(python3 -c "print('yes' if float('$ascii_ratio') > 0.85 else 'no')" 2>/dev/null || echo "yes")
    if [ "$is_mostly_ascii" = "yes" ]; then
      continue
    fi
  fi

  delete_book "$id" "Non-ASCII title (likely foreign)" "$title"
done

log "Phase 2 complete."
log ""

# =============================================================================
# PHASE 3: Foreign-language title patterns
# Common foreign articles and patterns that indicate non-English books
# =============================================================================
log "=== PHASE 3: Foreign-language title patterns ==="

# German articles/patterns
sqlite3 "$DB" "
  SELECT id, title FROM books
  WHERE (
    title LIKE 'Der %' OR title LIKE 'Die %' OR title LIKE 'Das %' OR
    title LIKE 'Ein %' OR title LIKE 'Eine %' OR
    title LIKE '% der %' OR title LIKE '% und %'
  )
  AND language IS NULL OR language = ''
  AND id NOT IN (SELECT book_id FROM user_book_state)
  ORDER BY title;
" | while IFS='|' read -r id title; do
  # Check it's not an English book that happens to start with these words
  # e.g., "Die Hard" is English. Use heuristic: if title has other German patterns
  # For safety, only delete if title is mostly non-English looking
  has_english=$(python3 -c "
t = '''$title'''.lower()
english_indicators = ['the ', ' of ', ' and ', ' in ', ' for ', ' with ', ' from ']
foreign_indicators = ['und ', ' des ', ' von ', ' nach ', ' über ', ' für ', ' mit ']
eng = sum(1 for e in english_indicators if e in t)
fgn = sum(1 for f in foreign_indicators if f in t)
print('english' if eng > fgn else 'foreign')
" 2>/dev/null || echo "english")

  if [ "$has_english" = "foreign" ]; then
    delete_book "$id" "German title pattern" "$title"
  fi
done

# Spanish patterns
sqlite3 "$DB" "
  SELECT id, title FROM books
  WHERE (
    title LIKE 'El %' OR title LIKE 'La %' OR title LIKE 'Las %' OR
    title LIKE 'Los %' OR title LIKE 'Una %' OR title LIKE 'Uno %'
  )
  AND (language IS NULL OR language = '')
  AND id NOT IN (SELECT book_id FROM user_book_state)
  ORDER BY title;
" | while IFS='|' read -r id title; do
  has_english=$(python3 -c "
t = '''$title'''.lower()
english_indicators = ['the ', ' of ', ' and ', ' in ', ' for ', ' with ']
spanish_indicators = [' de ', ' del ', ' los ', ' las ', ' por ', ' con ', ' para ', ' en ']
eng = sum(1 for e in english_indicators if e in t)
spn = sum(1 for s in spanish_indicators if s in t)
print('english' if eng > spn or len(t.split()) <= 3 else 'foreign')
" 2>/dev/null || echo "english")

  if [ "$has_english" = "foreign" ]; then
    delete_book "$id" "Spanish title pattern" "$title"
  fi
done

# French patterns
sqlite3 "$DB" "
  SELECT id, title FROM books
  WHERE (
    title LIKE 'Le %' OR title LIKE 'Les %' OR title LIKE 'Une %'
  )
  AND (language IS NULL OR language = '')
  AND id NOT IN (SELECT book_id FROM user_book_state)
  ORDER BY title;
" | while IFS='|' read -r id title; do
  has_english=$(python3 -c "
t = '''$title'''.lower()
english_indicators = ['the ', ' of ', ' and ', ' in ', ' for ']
french_indicators = [' de ', ' des ', ' du ', ' et ', ' pour ', ' dans ', ' avec ']
eng = sum(1 for e in english_indicators if e in t)
frn = sum(1 for f in french_indicators if f in t)
print('english' if eng > frn or len(t.split()) <= 3 else 'foreign')
" 2>/dev/null || echo "english")

  if [ "$has_english" = "foreign" ]; then
    delete_book "$id" "French title pattern" "$title"
  fi
done

# Dutch patterns
sqlite3 "$DB" "
  SELECT id, title FROM books
  WHERE (
    title LIKE 'Het %' OR title LIKE 'Een %' OR title LIKE 'De %'
  )
  AND (language IS NULL OR language = '')
  AND id NOT IN (SELECT book_id FROM user_book_state)
  ORDER BY title;
" | while IFS='|' read -r id title; do
  has_english=$(python3 -c "
t = '''$title'''.lower()
english_indicators = ['the ', ' of ', ' and ', ' in ', ' for ']
dutch_indicators = [' van ', ' het ', ' een ', ' naar ', ' voor ', ' met ']
eng = sum(1 for e in english_indicators if e in t)
dut = sum(1 for d in dutch_indicators if d in t)
print('english' if eng > dut or len(t.split()) <= 3 else 'foreign')
" 2>/dev/null || echo "english")

  if [ "$has_english" = "foreign" ]; then
    delete_book "$id" "Dutch title pattern" "$title"
  fi
done

log "Phase 3 complete."
log ""

# =============================================================================
# PHASE 4: Retail/placeholder/junk entries
# =============================================================================
log "=== PHASE 4: Junk entries ==="

sqlite3 "$DB" "
  SELECT id, title FROM books
  WHERE (
    title LIKE '%to be announced%' OR
    title LIKE '%Title to Be%' OR
    title LIKE '% TBA%' OR
    title LIKE '%Assort%' OR
    title LIKE '%PB Assort%' OR
    title LIKE '%Lib/E%' OR
    title LIKE '%PROP POD%' OR
    title LIKE '%Sampler%' OR
    title LIKE '%Excerpt Only%' OR
    title LIKE '%Placeholder%' OR
    title LIKE '%Display Copy%' OR
    title LIKE '%Not for Sale%' OR
    title LIKE '%Proof Copy%' OR
    title LIKE '%Galley%' OR
    title LIKE '%Uncorrected Proof%' OR
    title LIKE '%Advanced Reader%' OR
    title LIKE '%ARC %' OR
    title LIKE '%(Digests)%' OR
    title LIKE '%Spring 20%' OR
    title LIKE '%Fall 20%' OR
    title LIKE '%Summer 20%' OR
    title LIKE '%Winter 20%' OR
    title LIKE '%[__/__]%' OR
    title LIKE '%[_/_]%'
  )
  AND id NOT IN (SELECT book_id FROM user_book_state)
  ORDER BY title;
" | while IFS='|' read -r id title; do
  delete_book "$id" "Junk/placeholder entry" "$title"
done

log "Phase 4 complete."
log ""

# =============================================================================
# PHASE 5: Titles with verbose metadata in them (series info, edition info)
# These are often duplicates or catalog entries, not real book titles
# =============================================================================
log "=== PHASE 5: Verbose/catalog-style titles ==="

sqlite3 "$DB" "
  SELECT id, title FROM books
  WHERE LENGTH(title) > 120
  AND id NOT IN (SELECT book_id FROM user_book_state)
  ORDER BY title;
" | while IFS='|' read -r id title; do
  delete_book "$id" "Excessively long title (catalog entry)" "$title"
done

log "Phase 5 complete."
log ""

# =============================================================================
# PHASE 6: Books with [language] tags in title
# =============================================================================
log "=== PHASE 6: Language tags in titles ==="

sqlite3 "$DB" "
  SELECT id, title FROM books
  WHERE (
    title LIKE '%[In Japanese%' OR title LIKE '%[In Spanish%' OR
    title LIKE '%[In French%' OR title LIKE '%[In German%' OR
    title LIKE '%[In Italian%' OR title LIKE '%[In Portuguese%' OR
    title LIKE '%[In Russian%' OR title LIKE '%[In Chinese%' OR
    title LIKE '%[In Korean%' OR title LIKE '%[In Arabic%' OR
    title LIKE '%[In Hindi%' OR title LIKE '%[In Turkish%' OR
    title LIKE '%[In Polish%' OR title LIKE '%[In Dutch%' OR
    title LIKE '%[In Hebrew%' OR title LIKE '%[In Swedish%' OR
    title LIKE '%In Japanese Language%' OR title LIKE '%In Spanish Language%' OR
    title LIKE '%Japanese Edition%' OR title LIKE '%Spanish Edition%' OR
    title LIKE '%French Edition%' OR title LIKE '%German Edition%' OR
    title LIKE '%Korean Edition%' OR title LIKE '%Chinese Edition%' OR
    title LIKE '%edición%' OR title LIKE '%édition%' OR title LIKE '%Ausgabe%' OR
    title LIKE '%traduc%'
  )
  AND id NOT IN (SELECT book_id FROM user_book_state)
  ORDER BY title;
" | while IFS='|' read -r id title; do
  delete_book "$id" "Foreign edition tag in title" "$title"
done

log "Phase 6 complete."
log ""

# =============================================================================
# PHASE 7: Common foreign-language suffixes and patterns
# =============================================================================
log "=== PHASE 7: Foreign suffix patterns ==="

sqlite3 "$DB" "
  SELECT id, title FROM books
  WHERE (
    title LIKE '% Romanı' OR title LIKE '% Kitabı' OR
    title LIKE '% тайн%' OR title LIKE '% книг%' OR
    title LIKE '% навыки%' OR title LIKE '% привыч%' OR
    title LIKE '% Cilt%' OR title LIKE '% Bölüm%' OR
    title LIKE '% Deel%' OR title LIKE '% Buch%' OR
    title LIKE '% Libro%' OR title LIKE '% Tome%' OR
    title LIKE '% Livro%' OR title LIKE '% Τόμος%' OR
    title LIKE '% Том%' OR title LIKE '% 巻%' OR title LIKE '% 卷%'
  )
  AND id NOT IN (SELECT book_id FROM user_book_state)
  ORDER BY title;
" | while IFS='|' read -r id title; do
  delete_book "$id" "Foreign suffix pattern" "$title"
done

log "Phase 7 complete."
log ""

# =============================================================================
# SUMMARY
# =============================================================================
log ""
log "============================================="
log "CLEANUP COMPLETE"
log "  Deleted: $DELETED"
log "  Skipped (has users): $SKIPPED"
log "  Total books remaining: $(sqlite3 "$DB" 'SELECT COUNT(*) FROM books;')"
log "============================================="
log ""
log "Log saved to: $LOG"
