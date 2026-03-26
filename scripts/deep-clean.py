#!/usr/bin/env python3
"""
DEEP CLEAN — Zero-cost database cleanup for tbr*a
No API calls. Pure SQL + local logic.

Phases:
  1. Duplicate detection & merging (normalized title + author)
  2. Title cleanup (suffixes, inversions, caps, verbose catalog entries)
  3. Box set auto-detection
  4. Broken cover URL detection (HTTP HEAD checks)
  5. Orphan cleanup (no authors, no genres, empty series)
  6. Individual parts removal (Wool 2, Part 8, etc.)
"""

import sqlite3
import sys
import os
import re
import time
from datetime import datetime
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
from concurrent.futures import ThreadPoolExecutor, as_completed

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "tbra.db")
LOG_PATH = os.path.join(os.path.dirname(__file__), f"deep-clean-{datetime.now().strftime('%Y%m%d-%H%M%S')}.log")

log_file = None
stats = {
    "duplicates_merged": 0,
    "titles_cleaned": 0,
    "box_sets_marked": 0,
    "broken_covers_cleared": 0,
    "orphans_deleted": 0,
    "parts_deleted": 0,
    "total_deleted": 0,
}


def log(msg):
    line = f"[{datetime.now().strftime('%H:%M:%S')}] {msg}"
    print(line)
    if log_file:
        log_file.write(line + "\n")
        log_file.flush()


def has_users(conn, book_id):
    row = conn.execute(
        "SELECT COUNT(*) FROM user_book_state WHERE book_id = ?", (book_id,)
    ).fetchone()
    return row[0] > 0


def delete_book(conn, book_id, title, reason):
    if has_users(conn, book_id):
        log(f"  SKIP (has users): {title}")
        return False

    for table in [
        "book_series",
        "book_authors",
        "book_genres",
        "book_category_ratings",
        "enrichment_log",
        "reported_issues",
        "user_book_ratings",
        "user_book_reviews",
        "user_favorite_books",
        "reading_sessions",
    ]:
        conn.execute(f"DELETE FROM {table} WHERE book_id = ?", (book_id,))

    conn.execute("DELETE FROM books WHERE id = ?", (book_id,))
    log(f"  DELETED: {title} — {reason}")
    stats["total_deleted"] += 1
    return True


# =============================================================================
# PHASE 1: Duplicate detection & merging
# =============================================================================
def normalize_title(title):
    """Normalize a title for dedup comparison."""
    t = title.lower().strip()
    # Remove series suffixes like (Series Name, #3) or [Book 2]
    t = re.sub(r"\s*[\(\[].*?[\)\]]$", "", t)
    t = re.sub(r"\s*[\(\[].*?[\)\]]", "", t)
    # Remove leading articles
    t = re.sub(r"^(the|a|an)\s+", "", t)
    # Remove all non-alphanumeric
    t = re.sub(r"[^a-z0-9]", "", t)
    return t


def get_primary_author(conn, book_id):
    row = conn.execute(
        """SELECT a.name FROM book_authors ba
           JOIN authors a ON ba.author_id = a.id
           WHERE ba.book_id = ?
           ORDER BY a.name LIMIT 1""",
        (book_id,),
    ).fetchone()
    if not row:
        return ""
    return re.sub(r"[^a-z]", "", row[0].lower())


def score_book(conn, book):
    """Score a book for quality — higher is better to keep."""
    book_id, title = book["id"], book["title"]
    score = 0

    # Users on this book
    user_count = conn.execute(
        "SELECT COUNT(*) FROM user_book_state WHERE book_id = ?", (book_id,)
    ).fetchone()[0]
    score += user_count * 100  # Users are the highest priority

    # Has description
    if book.get("description"):
        score += 10
    # Has summary
    if book.get("summary"):
        score += 8
    # Has cover
    if book.get("cover_image_url"):
        score += 5
    # Has pages
    if book.get("pages"):
        score += 3
    # Has year
    if book.get("publication_year"):
        score += 3
    # Has ISBN
    if book.get("isbn_13") or book.get("isbn_10"):
        score += 3
    # Shorter, cleaner title is better
    if len(title) < 80:
        score += 2
    # Has genres
    genre_count = conn.execute(
        "SELECT COUNT(*) FROM book_genres WHERE book_id = ?", (book_id,)
    ).fetchone()[0]
    score += min(genre_count, 5)
    # Has content ratings
    rating_count = conn.execute(
        "SELECT COUNT(*) FROM book_category_ratings WHERE book_id = ?", (book_id,)
    ).fetchone()[0]
    score += min(rating_count, 5)

    return score


def phase1_duplicates(conn):
    log("=== PHASE 1: Duplicate detection & merging ===")

    all_books = conn.execute(
        """SELECT id, title, description, summary, cover_image_url,
                  pages, publication_year, isbn_13, isbn_10, is_box_set
           FROM books WHERE is_box_set = 0"""
    ).fetchall()

    columns = [
        "id", "title", "description", "summary", "cover_image_url",
        "pages", "publication_year", "isbn_13", "isbn_10", "is_box_set",
    ]

    # Group by normalized title + primary author
    groups = {}
    for row in all_books:
        book = dict(zip(columns, row))
        norm = normalize_title(book["title"])
        if len(norm) < 3:
            continue  # Too short to dedup reliably
        author = get_primary_author(conn, book["id"])
        key = f"{norm}:{author}"
        groups.setdefault(key, []).append(book)

    # Process groups with multiple entries
    merged = 0
    for key, books in groups.items():
        if len(books) < 2:
            continue

        # Score each book
        scored = [(score_book(conn, b), b) for b in books]
        scored.sort(key=lambda x: x[0], reverse=True)

        keeper = scored[0][1]
        dupes = [s[1] for s in scored[1:]]

        for dupe in dupes:
            if delete_book(conn, dupe["id"], dupe["title"], f"duplicate of '{keeper['title']}'"):
                merged += 1

    stats["duplicates_merged"] = merged
    log(f"Phase 1 complete: {merged} duplicates merged")
    conn.commit()


# =============================================================================
# PHASE 2: Title cleanup
# =============================================================================
SERIES_SUFFIX = re.compile(
    r"\s*\((?:[A-Z][a-zA-Z\s&':]+,?\s*)?#?\d+(?:\.\d+)?\)$"
)
SERIES_SUFFIX_2 = re.compile(
    r"\s*\([^)]*(?:Series|Trilogy|Saga|Chronicles|Cycle|Book|Novel)[^)]*\)$",
    re.IGNORECASE,
)
INVERTED_TITLE = re.compile(r"^(.+),\s+(The|A|An)$")
VERBOSE_SUFFIX = re.compile(
    r"\s*[:;]\s*(?:With|By|From|Including|Featuring|Containing|A Novel|A Memoir).*$",
    re.IGNORECASE,
)

SMALL_WORDS = {
    "a", "an", "the", "and", "but", "or", "nor", "for", "yet", "so",
    "in", "on", "at", "to", "of", "by", "up", "as", "is", "it",
    "if", "vs", "via",
}

PRESERVE_UPPER = {
    "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
    "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX",
    "DNA", "USA", "UK", "FBI", "CIA", "CEO", "DIY", "TV", "AI", "WWII",
    "NYC", "ADHD", "PhD", "FBI", "NASA", "UN",
}


def smart_title_case(title):
    words = title.split()
    result = []
    for i, word in enumerate(words):
        if word.upper() in PRESERVE_UPPER:
            result.append(word.upper())
        elif i == 0 or i == len(words) - 1:
            result.append(word.capitalize())
        elif word.lower() in SMALL_WORDS:
            result.append(word.lower())
        else:
            result.append(word.capitalize())
    return " ".join(result)


def needs_title_fix(title):
    """Check if a title needs cleanup."""
    if title != title.strip():
        return True
    if title == title.upper() and len(title) > 5:
        return True
    if title == title.lower():
        return True
    if SERIES_SUFFIX.search(title):
        return True
    if SERIES_SUFFIX_2.search(title):
        return True
    if INVERTED_TITLE.match(title):
        return True
    return False


def clean_title(title):
    """Clean a title without changing meaning."""
    t = title.strip()

    # Fix inverted: "Dark Thorn, The" → "The Dark Thorn"
    m = INVERTED_TITLE.match(t)
    if m:
        t = f"{m.group(2)} {m.group(1)}"

    # Remove series suffixes
    t = SERIES_SUFFIX.sub("", t)
    t = SERIES_SUFFIX_2.sub("", t)

    # Fix all-caps or all-lowercase
    if t == t.upper() and len(t) > 5:
        t = smart_title_case(t.lower())
    elif t == t.lower():
        t = smart_title_case(t)

    return t.strip()


def phase2_titles(conn):
    log("=== PHASE 2: Title cleanup ===")

    rows = conn.execute("SELECT id, title FROM books").fetchall()
    cleaned = 0

    for book_id, title in rows:
        if not needs_title_fix(title):
            continue

        new_title = clean_title(title)
        if new_title != title and len(new_title) > 2:
            # Check we won't create a collision
            existing = conn.execute(
                "SELECT COUNT(*) FROM books WHERE title = ? AND id != ?",
                (new_title, book_id),
            ).fetchone()[0]
            if existing > 0:
                continue  # Would create duplicate

            conn.execute(
                "UPDATE books SET title = ? WHERE id = ?",
                (new_title, book_id),
            )
            log(f"  TITLE: '{title}' → '{new_title}'")
            cleaned += 1

    stats["titles_cleaned"] = cleaned
    log(f"Phase 2 complete: {cleaned} titles cleaned")
    conn.commit()


# =============================================================================
# PHASE 3: Box set auto-detection
# =============================================================================
BOX_SET_PATTERNS = [
    re.compile(r"\bbox\s*set\b", re.IGNORECASE),
    re.compile(r"\bcollection\b.*\bbooks?\b", re.IGNORECASE),
    re.compile(r"\bomnibus\b", re.IGNORECASE),
    re.compile(r"\bbooks?\s+\d+\s*[-–—]\s*\d+\b", re.IGNORECASE),
    re.compile(r"\bcomplete\s+(?:series|trilogy|saga)\b", re.IGNORECASE),
    re.compile(r"\bvolume\s+set\b", re.IGNORECASE),
    re.compile(r"\b\d+\s*(?:book|novel)s?\s+(?:in|set)\b", re.IGNORECASE),
    re.compile(r"\bbundle\b", re.IGNORECASE),
    re.compile(r"\bboxed\b", re.IGNORECASE),
    re.compile(r"\b(?:2|3|4|5|6|7|8|9|10)\s*-?\s*in\s*-?\s*1\b", re.IGNORECASE),
]


def phase3_box_sets(conn):
    log("=== PHASE 3: Box set auto-detection ===")

    rows = conn.execute(
        "SELECT id, title FROM books WHERE is_box_set = 0"
    ).fetchall()
    marked = 0

    for book_id, title in rows:
        for pattern in BOX_SET_PATTERNS:
            if pattern.search(title):
                conn.execute(
                    "UPDATE books SET is_box_set = 1 WHERE id = ?", (book_id,)
                )
                # Clear position in any series
                conn.execute(
                    "UPDATE book_series SET position_in_series = NULL WHERE book_id = ?",
                    (book_id,),
                )
                log(f"  BOX SET: {title}")
                marked += 1
                break

    stats["box_sets_marked"] = marked
    log(f"Phase 3 complete: {marked} box sets marked")
    conn.commit()


# =============================================================================
# PHASE 4: Broken cover URL detection
# =============================================================================
def check_cover_url(url, book_id, title):
    """HEAD-check a cover URL. Returns (book_id, title, url, status)."""
    try:
        req = Request(url, method="HEAD")
        req.add_header("User-Agent", "tbra-cover-check/1.0")
        resp = urlopen(req, timeout=10)
        code = resp.getcode()
        # Some servers return 200 but redirect to a placeholder
        content_type = resp.headers.get("Content-Type", "")
        if code == 200 and "image" in content_type:
            return None  # OK
        return (book_id, title, url, code)
    except HTTPError as e:
        return (book_id, title, url, e.code)
    except (URLError, OSError, TimeoutError):
        return (book_id, title, url, "timeout")


def phase4_broken_covers(conn):
    log("=== PHASE 4: Broken cover URL detection ===")

    rows = conn.execute(
        """SELECT id, title, cover_image_url FROM books
           WHERE cover_image_url IS NOT NULL AND cover_image_url != ''"""
    ).fetchall()

    log(f"  Checking {len(rows)} cover URLs...")
    broken = 0

    # Check in batches with thread pool
    with ThreadPoolExecutor(max_workers=10) as executor:
        futures = {
            executor.submit(check_cover_url, url, bid, title): (bid, title, url)
            for bid, title, url in rows
        }

        for i, future in enumerate(as_completed(futures)):
            if i > 0 and i % 500 == 0:
                log(f"  ... checked {i}/{len(rows)}")

            result = future.result()
            if result:
                book_id, title, url, status = result
                # Clear the broken URL so it can be re-resolved
                conn.execute(
                    "UPDATE books SET cover_image_url = NULL WHERE id = ?",
                    (book_id,),
                )
                log(f"  BROKEN ({status}): {title} — {url[:80]}")
                broken += 1

    stats["broken_covers_cleared"] = broken
    log(f"Phase 4 complete: {broken} broken covers cleared")
    conn.commit()


# =============================================================================
# PHASE 5: Orphan cleanup
# =============================================================================
def phase5_orphans(conn):
    log("=== PHASE 5: Orphan cleanup ===")
    deleted = 0

    # Books with no authors AND no genres AND no users AND no description
    orphans = conn.execute(
        """SELECT b.id, b.title FROM books b
           WHERE NOT EXISTS (SELECT 1 FROM book_authors ba WHERE ba.book_id = b.id)
           AND NOT EXISTS (SELECT 1 FROM book_genres bg WHERE bg.book_id = b.id)
           AND NOT EXISTS (SELECT 1 FROM user_book_state ubs WHERE ubs.book_id = b.id)
           AND b.description IS NULL AND b.summary IS NULL
           AND b.cover_image_url IS NULL"""
    ).fetchall()

    for book_id, title in orphans:
        if delete_book(conn, book_id, title, "orphan (no author, genre, description, cover, or users)"):
            deleted += 1

    # Empty series (0 books linked)
    empty_series = conn.execute(
        """SELECT s.id, s.name FROM series s
           WHERE NOT EXISTS (SELECT 1 FROM book_series bs WHERE bs.series_id = s.id)"""
    ).fetchall()

    for series_id, name in empty_series:
        conn.execute("DELETE FROM series WHERE id = ?", (series_id,))
        log(f"  EMPTY SERIES DELETED: {name}")

    # Single-book series (often junk)
    single_series = conn.execute(
        """SELECT s.id, s.name, COUNT(bs.book_id) as cnt FROM series s
           JOIN book_series bs ON bs.series_id = s.id
           GROUP BY s.id HAVING cnt = 1"""
    ).fetchall()

    for series_id, name, cnt in single_series:
        # Just unlink the book from the series, don't delete the book
        conn.execute("DELETE FROM book_series WHERE series_id = ?", (series_id,))
        conn.execute("DELETE FROM series WHERE id = ?", (series_id,))
        log(f"  SINGLE-BOOK SERIES DISSOLVED: {name}")

    stats["orphans_deleted"] = deleted
    log(f"Phase 5 complete: {deleted} orphan books deleted, {len(empty_series)} empty series, {len(single_series)} single-book series dissolved")
    conn.commit()


# =============================================================================
# PHASE 6: Individual parts removal
# =============================================================================
PART_PATTERN = re.compile(
    r"^(.+?)\s+(?:Part|Pt\.?)\s+\d+",
    re.IGNORECASE,
)
NUMBERED_PART = re.compile(
    r"^(.+?)\s+(\d+)$"
)


def phase6_parts(conn):
    log("=== PHASE 6: Individual parts removal ===")
    deleted = 0

    # Find books that look like individual parts
    rows = conn.execute(
        "SELECT id, title FROM books WHERE is_box_set = 0"
    ).fetchall()

    for book_id, title in rows:
        m = PART_PATTERN.match(title)
        if not m:
            # Check for "Title Number" pattern like "Wool 2"
            m2 = NUMBERED_PART.match(title)
            if m2:
                base = m2.group(1)
                num = int(m2.group(2))
                # Only match if number is small (1-20) and base title exists as a standalone
                if 1 <= num <= 20:
                    existing = conn.execute(
                        "SELECT COUNT(*) FROM books WHERE title = ? AND id != ?",
                        (base, book_id),
                    ).fetchone()[0]
                    if existing > 0 and not has_users(conn, book_id):
                        if delete_book(conn, book_id, title, f"individual part of '{base}'"):
                            deleted += 1
            continue

        # "Part N" pattern
        base = m.group(1).strip()
        existing = conn.execute(
            "SELECT COUNT(*) FROM books WHERE title LIKE ? AND id != ?",
            (f"{base}%", book_id),
        ).fetchone()[0]

        if existing > 0 and not has_users(conn, book_id):
            if delete_book(conn, book_id, title, f"individual part of '{base}'"):
                deleted += 1

    stats["parts_deleted"] = deleted
    log(f"Phase 6 complete: {deleted} individual parts deleted")
    conn.commit()


# =============================================================================
# MAIN
# =============================================================================
def main():
    global log_file

    log_file = open(LOG_PATH, "w")
    log("=" * 60)
    log("DEEP CLEAN — Zero-cost database cleanup")
    log("=" * 60)

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")

    initial_count = conn.execute("SELECT COUNT(*) FROM books").fetchone()[0]
    log(f"Starting book count: {initial_count}")
    log("")

    phase1_duplicates(conn)
    log("")
    phase2_titles(conn)
    log("")
    phase3_box_sets(conn)
    log("")

    # Phase 4 is slow (HTTP checks) — ask before running
    if "--skip-covers" not in sys.argv:
        phase4_broken_covers(conn)
    else:
        log("=== PHASE 4: Skipped (--skip-covers) ===")
    log("")

    phase5_orphans(conn)
    log("")
    phase6_parts(conn)
    log("")

    final_count = conn.execute("SELECT COUNT(*) FROM books").fetchone()[0]

    log("=" * 60)
    log("DEEP CLEAN COMPLETE")
    log(f"  Starting books:      {initial_count}")
    log(f"  Final books:         {final_count}")
    log(f"  Total removed:       {initial_count - final_count}")
    log(f"  ---")
    log(f"  Duplicates merged:   {stats['duplicates_merged']}")
    log(f"  Titles cleaned:      {stats['titles_cleaned']}")
    log(f"  Box sets marked:     {stats['box_sets_marked']}")
    log(f"  Broken covers:       {stats['broken_covers_cleared']}")
    log(f"  Orphans deleted:     {stats['orphans_deleted']}")
    log(f"  Parts deleted:       {stats['parts_deleted']}")
    log("=" * 60)
    log(f"Log saved to: {LOG_PATH}")

    conn.close()
    log_file.close()


if __name__ == "__main__":
    main()
