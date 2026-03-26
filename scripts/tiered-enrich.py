#!/usr/bin/env python3
"""
Tiered Enrichment Script
========================
Fills missing book metadata using the cheapest sources first:

Tier 1: Open Library (free, unlimited) — pages, descriptions, years, covers, genres
Tier 2: Brave Search (paid) — fallback for items OL missed
Tier 3: Google Books (1K/day free, resets 12AM PST) — covers only
Tier 4: Log remaining gaps for manual review

Usage:
  python3 scripts/tiered-enrich.py --tier 1          # OL only
  python3 scripts/tiered-enrich.py --tier 2          # Brave fallback
  python3 scripts/tiered-enrich.py --tier 3          # Google Books covers
  python3 scripts/tiered-enrich.py --tier 4          # Generate gap report
  python3 scripts/tiered-enrich.py --all             # Run all tiers in order
  python3 scripts/tiered-enrich.py --tier 1 --limit 500  # Limit batch size
"""

import sqlite3
import json
import time
import sys
import os
import argparse
import urllib.request
import urllib.parse
import urllib.error
from datetime import datetime
from pathlib import Path

# Load env
ENV_PATH = Path(__file__).parent.parent / ".env.local"
env_vars = {}
if ENV_PATH.exists():
    for line in ENV_PATH.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env_vars[k.strip()] = v.strip()

DB_PATH = Path(__file__).parent.parent / "data" / "tbra.db"
LOG_DIR = Path(__file__).parent
BRAVE_KEY = env_vars.get("BRAVE_SEARCH_API_KEY", "")
GBOOKS_KEY = env_vars.get("GOOGLE_BOOKS_API_KEY", "")

# Rate limiting
OL_DELAY = 0.2        # 5 req/s is fine for OL
BRAVE_DELAY = 1.0      # conservative
GBOOKS_DELAY = 0.5

def log(msg):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)

def db_execute_safe(conn, sql, params=None, retries=5):
    """Execute with retry on database lock."""
    for attempt in range(retries):
        try:
            if params:
                return conn.execute(sql, params)
            return conn.execute(sql)
        except sqlite3.OperationalError as e:
            if "locked" in str(e) and attempt < retries - 1:
                time.sleep(1 + attempt)
                continue
            raise

def db_commit_safe(conn, retries=5):
    """Commit with retry on database lock."""
    for attempt in range(retries):
        try:
            conn.commit()
            return
        except sqlite3.OperationalError as e:
            if "locked" in str(e) and attempt < retries - 1:
                time.sleep(1 + attempt)
                continue
            raise

def fetch_json(url, timeout=10):
    """Fetch JSON from URL, return dict or None on error."""
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "TBRA-Enrichment/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except Exception as e:
        return None

def check_url_exists(url, timeout=5):
    """HEAD request to check if a URL resolves (non-redirect)."""
    try:
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "TBRA/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status == 200 and resp.url == url  # No redirect
    except:
        return False


# =============================================
# TIER 1: Open Library
# =============================================
def tier1_open_library(conn, limit=None):
    log("=== TIER 1: Open Library (free) ===")

    # Get books that have OL keys and are missing data
    query = """
        SELECT id, title, open_library_key, description, pages,
               publication_year, publication_date, cover_image_url, isbn_13, isbn_10
        FROM books
        WHERE open_library_key IS NOT NULL AND open_library_key != ''
        AND (
            description IS NULL OR pages IS NULL OR
            publication_year IS NULL OR publication_year = 0 OR
            cover_image_url IS NULL OR publication_date IS NULL
        )
        ORDER BY id
    """
    if limit:
        query += f" LIMIT {limit}"

    books = conn.execute(query).fetchall()
    log(f"Found {len(books)} books with OL keys needing data")

    stats = {"pages": 0, "desc": 0, "year": 0, "date": 0, "cover": 0, "genres": 0, "skipped": 0, "errors": 0}

    for i, row in enumerate(books):
        book_id, title, ol_key, desc, pages, year, pub_date, cover_url, isbn13, isbn10 = row

        if i > 0 and i % 100 == 0:
            conn.commit()
            log(f"  Progress: {i}/{len(books)} | pages:{stats['pages']} desc:{stats['desc']} year:{stats['year']} cover:{stats['cover']} genres:{stats['genres']}")

        # Fetch work data
        work_url = f"https://openlibrary.org{ol_key}.json"
        work = fetch_json(work_url)
        time.sleep(OL_DELAY)

        if not work:
            stats["errors"] += 1
            continue

        updates = {}

        # Description
        if desc is None:
            work_desc = work.get("description")
            if isinstance(work_desc, dict):
                work_desc = work_desc.get("value", "")
            if work_desc and len(str(work_desc)) > 20:
                updates["description"] = str(work_desc)[:2000]
                stats["desc"] += 1

        # Subjects -> genres (if missing)
        has_genres = conn.execute("SELECT COUNT(*) FROM book_genres WHERE book_id = ?", (book_id,)).fetchone()[0]
        if has_genres == 0:
            subjects = work.get("subjects", [])
            if subjects:
                for subj in subjects[:5]:
                    subj_name = subj if isinstance(subj, str) else subj.get("name", "")
                    if not subj_name:
                        continue
                    # Try to match to existing genre
                    genre = conn.execute("SELECT id FROM genres WHERE LOWER(name) = LOWER(?)", (subj_name,)).fetchone()
                    if genre:
                        conn.execute("INSERT OR IGNORE INTO book_genres (book_id, genre_id) VALUES (?, ?)",
                                     (book_id, genre[0]))
                        stats["genres"] += 1

        # Now fetch edition data for pages, year, cover
        needs_edition = pages is None or (year is None or year == 0) or cover_url is None or pub_date is None

        if needs_edition:
            # Try ISBN-based edition first
            edition = None
            if isbn13:
                edition = fetch_json(f"https://openlibrary.org/isbn/{isbn13}.json")
                time.sleep(OL_DELAY)
            if not edition and isbn10:
                edition = fetch_json(f"https://openlibrary.org/isbn/{isbn10}.json")
                time.sleep(OL_DELAY)

            # Fallback to editions list
            if not edition:
                editions_url = f"https://openlibrary.org{ol_key}/editions.json?limit=10"
                editions_data = fetch_json(editions_url)
                time.sleep(OL_DELAY)

                if editions_data and editions_data.get("entries"):
                    # Prefer English editions with the most data
                    best = None
                    best_score = -1
                    for ed in editions_data["entries"]:
                        langs = ed.get("languages", [])
                        lang_keys = [l.get("key", "") for l in langs] if langs else []
                        is_english = not langs or any("/eng" in k for k in lang_keys)
                        if not is_english:
                            continue
                        score = 0
                        if ed.get("number_of_pages"): score += 3
                        if ed.get("publish_date"): score += 2
                        if ed.get("covers"): score += 2
                        if ed.get("isbn_13") or ed.get("isbn_10"): score += 1
                        if score > best_score:
                            best_score = score
                            best = ed
                    edition = best

            if edition:
                # Pages
                if pages is None:
                    ed_pages = edition.get("number_of_pages")
                    if ed_pages and int(ed_pages) > 10:
                        updates["pages"] = int(ed_pages)
                        stats["pages"] += 1

                # Publication year and date
                pub_date_str = edition.get("publish_date", "")
                if pub_date_str:
                    if pub_date is None:
                        updates["publication_date"] = pub_date_str
                        stats["date"] += 1
                    if year is None or year == 0:
                        # Extract year from date string — only accept 1900+ to avoid
                        # OL returning ancient edition dates for modern books
                        import re
                        year_match = re.search(r'\b(19\d{2}|20[0-2]\d)\b', pub_date_str)
                        if year_match:
                            extracted_year = int(year_match.group(1))
                            if extracted_year >= 1900:
                                updates["publication_year"] = extracted_year
                                stats["year"] += 1

                # Cover
                if cover_url is None:
                    covers = edition.get("covers", [])
                    if covers:
                        cover_id = covers[0]
                        if cover_id and cover_id > 0:
                            updates["cover_image_url"] = f"https://covers.openlibrary.org/b/id/{cover_id}-L.jpg"
                            updates["cover_source"] = "openlibrary"
                            stats["cover"] += 1

                # ISBN backfill
                if not isbn13:
                    ed_isbn13 = edition.get("isbn_13")
                    if ed_isbn13 and isinstance(ed_isbn13, list) and ed_isbn13:
                        # Check for collision before setting
                        existing = conn.execute("SELECT id FROM books WHERE isbn_13 = ? AND id != ?", (ed_isbn13[0], book_id)).fetchone()
                        if not existing:
                            updates["isbn_13"] = ed_isbn13[0]
                if not isbn10:
                    ed_isbn10 = edition.get("isbn_10")
                    if ed_isbn10 and isinstance(ed_isbn10, list) and ed_isbn10:
                        existing = conn.execute("SELECT id FROM books WHERE isbn_10 = ? AND id != ?", (ed_isbn10[0], book_id)).fetchone()
                        if not existing:
                            updates["isbn_10"] = ed_isbn10[0]

        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            values = list(updates.values()) + [book_id]
            try:
                conn.execute(f"UPDATE books SET {set_clause}, updated_at = datetime('now') WHERE id = ?", values)
            except Exception as e:
                stats["errors"] += 1
                continue

    conn.commit()
    log(f"Tier 1 complete: pages:{stats['pages']} desc:{stats['desc']} year:{stats['year']} date:{stats['date']} cover:{stats['cover']} genres:{stats['genres']} errors:{stats['errors']}")
    return stats


# =============================================
# TIER 1b: OL search for books WITHOUT OL keys
# =============================================
def tier1b_ol_search(conn, limit=None):
    log("=== TIER 1b: Open Library search (books without OL keys) ===")

    query = """
        SELECT b.id, b.title, b.description, b.pages, b.publication_year,
               b.cover_image_url, b.isbn_13, b.isbn_10,
               (SELECT a.name FROM book_authors ba JOIN authors a ON ba.author_id = a.id
                WHERE ba.book_id = b.id LIMIT 1) as author_name
        FROM books b
        WHERE (b.open_library_key IS NULL OR b.open_library_key = '')
        AND (
            b.description IS NULL OR b.pages IS NULL OR
            b.publication_year IS NULL OR b.publication_year = 0 OR
            b.cover_image_url IS NULL
        )
        AND b.id NOT IN (SELECT book_id FROM user_book_state)
        ORDER BY b.id
    """
    if limit:
        query += f" LIMIT {limit}"

    books = conn.execute(query).fetchall()
    log(f"Found {len(books)} books without OL keys needing search")

    stats = {"matched": 0, "pages": 0, "desc": 0, "year": 0, "cover": 0, "errors": 0}

    for i, row in enumerate(books):
        book_id, title, desc, pages, year, cover_url, isbn13, isbn10, author = row

        if i > 0 and i % 50 == 0:
            conn.commit()
            log(f"  Progress: {i}/{len(books)} | matched:{stats['matched']} pages:{stats['pages']} desc:{stats['desc']} cover:{stats['cover']}")

        # Try ISBN search first
        search_data = None
        if isbn13:
            search_data = fetch_json(f"https://openlibrary.org/isbn/{isbn13}.json")
            time.sleep(OL_DELAY)

        if not search_data and isbn10:
            search_data = fetch_json(f"https://openlibrary.org/isbn/{isbn10}.json")
            time.sleep(OL_DELAY)

        # Fallback to title+author search
        if not search_data:
            q = urllib.parse.quote(f"{title} {author}" if author else title)
            search_result = fetch_json(f"https://openlibrary.org/search.json?q={q}&limit=3&fields=key,title,author_name,cover_i,number_of_pages_median,first_publish_year")
            time.sleep(OL_DELAY)

            if search_result and search_result.get("docs"):
                doc = search_result["docs"][0]
                # Verify title similarity
                if title.lower().split()[0] in doc.get("title", "").lower():
                    ol_key = doc.get("key")
                    if ol_key:
                        conn.execute("UPDATE books SET open_library_key = ? WHERE id = ?", (ol_key, book_id))
                        stats["matched"] += 1

                        updates = {}
                        if pages is None and doc.get("number_of_pages_median"):
                            p = doc["number_of_pages_median"]
                            if p > 10:
                                updates["pages"] = p
                                stats["pages"] += 1
                        if (year is None or year == 0) and doc.get("first_publish_year"):
                            updates["publication_year"] = doc["first_publish_year"]
                            stats["year"] += 1
                        if cover_url is None and doc.get("cover_i"):
                            updates["cover_image_url"] = f"https://covers.openlibrary.org/b/id/{doc['cover_i']}-L.jpg"
                            updates["cover_source"] = "openlibrary"
                            stats["cover"] += 1

                        if updates:
                            set_clause = ", ".join(f"{k} = ?" for k in updates)
                            values = list(updates.values()) + [book_id]
                            conn.execute(f"UPDATE books SET {set_clause}, updated_at = datetime('now') WHERE id = ?", values)
                continue

        # If we got edition data from ISBN lookup
        if search_data:
            stats["matched"] += 1
            updates = {}

            # Save OL key
            work_key = None
            works = search_data.get("works", [])
            if works:
                work_key = works[0].get("key")
                if work_key:
                    updates["open_library_key"] = work_key

            if pages is None and search_data.get("number_of_pages"):
                p = search_data["number_of_pages"]
                if p > 10:
                    updates["pages"] = p
                    stats["pages"] += 1
            if cover_url is None and search_data.get("covers"):
                c = search_data["covers"][0]
                if c > 0:
                    updates["cover_image_url"] = f"https://covers.openlibrary.org/b/id/{c}-L.jpg"
                    updates["cover_source"] = "openlibrary"
                    stats["cover"] += 1
            pub_str = search_data.get("publish_date", "")
            if (year is None or year == 0) and pub_str:
                import re
                ym = re.search(r'\b(1[5-9]\d{2}|20[0-2]\d)\b', pub_str)
                if ym:
                    updates["publication_year"] = int(ym.group(1))
                    stats["year"] += 1

            if updates:
                set_clause = ", ".join(f"{k} = ?" for k in updates)
                values = list(updates.values()) + [book_id]
                conn.execute(f"UPDATE books SET {set_clause}, updated_at = datetime('now') WHERE id = ?", values)

    conn.commit()
    log(f"Tier 1b complete: matched:{stats['matched']} pages:{stats['pages']} desc:{stats['desc']} year:{stats['year']} cover:{stats['cover']}")
    return stats


# =============================================
# TIER 2: Brave Search fallback
# =============================================
def tier2_brave_search(conn, limit=None):
    if not BRAVE_KEY:
        log("SKIPPING Tier 2: No BRAVE_SEARCH_API_KEY found")
        return {}

    log("=== TIER 2: Brave Search fallback ===")

    # Books still missing description or cover after OL
    query = """
        SELECT b.id, b.title,
               (SELECT a.name FROM book_authors ba JOIN authors a ON ba.author_id = a.id
                WHERE ba.book_id = b.id LIMIT 1) as author_name,
               b.description, b.cover_image_url
        FROM books b
        WHERE (b.description IS NULL OR b.cover_image_url IS NULL)
        AND b.id NOT IN (SELECT book_id FROM user_book_state WHERE 1=0)
        ORDER BY b.id
    """
    if limit:
        query += f" LIMIT {limit}"

    books = conn.execute(query).fetchall()
    log(f"Found {len(books)} books still missing description or cover")

    stats = {"desc": 0, "cover": 0, "errors": 0}

    for i, row in enumerate(books):
        book_id, title, author, desc, cover_url = row

        if i > 0 and i % 50 == 0:
            conn.commit()
            log(f"  Progress: {i}/{len(books)} | desc:{stats['desc']} cover:{stats['cover']}")

        query_str = f"{title} {author} book" if author else f"{title} book"
        search_url = f"https://api.search.brave.com/res/v1/web/search?q={urllib.parse.quote(query_str)}&count=5"

        try:
            req = urllib.request.Request(search_url, headers={
                "Accept": "application/json",
                "X-Subscription-Token": BRAVE_KEY
            })
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read())
        except Exception as e:
            stats["errors"] += 1
            if "429" in str(e) or "403" in str(e):
                log(f"  Rate limited at book {i}, stopping Tier 2")
                break
            time.sleep(BRAVE_DELAY)
            continue

        time.sleep(BRAVE_DELAY)

        updates = {}
        results = data.get("web", {}).get("results", [])

        if desc is None:
            # Try to extract a description from search results
            for r in results:
                snippet = r.get("description", "")
                if len(snippet) > 80 and title.split()[0].lower() in snippet.lower():
                    updates["description"] = snippet[:2000]
                    stats["desc"] += 1
                    break

        if cover_url is None:
            # Look for cover images in results
            for r in results:
                thumb = r.get("thumbnail", {}).get("src", "")
                if thumb and ("cover" in thumb.lower() or "book" in thumb.lower()):
                    updates["cover_image_url"] = thumb
                    updates["cover_source"] = "brave"
                    stats["cover"] += 1
                    break

        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            values = list(updates.values()) + [book_id]
            conn.execute(f"UPDATE books SET {set_clause}, updated_at = datetime('now') WHERE id = ?", values)

    conn.commit()
    log(f"Tier 2 complete: desc:{stats['desc']} cover:{stats['cover']} errors:{stats['errors']}")
    return stats


# =============================================
# TIER 3: Google Books covers
# =============================================
def tier3_google_books(conn, limit=None):
    if not GBOOKS_KEY:
        log("SKIPPING Tier 3: No GOOGLE_BOOKS_API_KEY found")
        return {}

    log("=== TIER 3: Google Books covers (1K/day limit) ===")
    max_calls = min(limit or 900, 900)  # Leave buffer under 1K

    query = """
        SELECT b.id, b.title, b.isbn_13, b.isbn_10,
               (SELECT a.name FROM book_authors ba JOIN authors a ON ba.author_id = a.id
                WHERE ba.book_id = b.id LIMIT 1) as author_name
        FROM books b
        WHERE b.cover_image_url IS NULL
        ORDER BY b.id
    """

    books = conn.execute(query).fetchall()
    log(f"Found {len(books)} books still missing covers, will process up to {max_calls}")

    stats = {"cover": 0, "errors": 0}
    calls = 0

    for i, row in enumerate(books):
        if calls >= max_calls:
            log(f"  Hit Google Books limit ({max_calls}), stopping")
            break

        book_id, title, isbn13, isbn10, author = row

        # Try ISBN first
        if isbn13:
            url = f"https://www.googleapis.com/books/v1/volumes?q=isbn:{isbn13}&key={GBOOKS_KEY}"
        elif isbn10:
            url = f"https://www.googleapis.com/books/v1/volumes?q=isbn:{isbn10}&key={GBOOKS_KEY}"
        else:
            q = f"{title} {author}" if author else title
            url = f"https://www.googleapis.com/books/v1/volumes?q={urllib.parse.quote(q)}&maxResults=1&key={GBOOKS_KEY}"

        data = fetch_json(url)
        calls += 1
        time.sleep(GBOOKS_DELAY)

        if not data:
            stats["errors"] += 1
            continue

        items = data.get("items", [])
        if not items:
            continue

        img_links = items[0].get("volumeInfo", {}).get("imageLinks", {})
        thumb = img_links.get("thumbnail", "")
        if thumb:
            # Upgrade to larger image
            cover = thumb.replace("zoom=1", "zoom=2").replace("http://", "https://")
            conn.execute("""UPDATE books SET cover_image_url = ?, cover_source = 'google_books',
                           updated_at = datetime('now') WHERE id = ?""", (cover, book_id))
            stats["cover"] += 1

        if i > 0 and i % 50 == 0:
            conn.commit()
            log(f"  Progress: {i}/{len(books)} | covers:{stats['cover']} calls:{calls}")

    conn.commit()
    log(f"Tier 3 complete: covers:{stats['cover']} api_calls:{calls} errors:{stats['errors']}")
    return stats


# =============================================
# TIER 4: Gap report
# =============================================
def tier4_gap_report(conn):
    log("=== TIER 4: Generating gap report ===")

    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    report_path = LOG_DIR / f"gap-report-{timestamp}.txt"

    with open(report_path, "w") as f:
        f.write(f"TBRA Gap Report — {datetime.now().strftime('%Y-%m-%d %H:%M')}\n")
        f.write("=" * 60 + "\n\n")

        # Summary
        total = conn.execute("SELECT COUNT(*) FROM books").fetchone()[0]
        no_desc = conn.execute("SELECT COUNT(*) FROM books WHERE description IS NULL").fetchone()[0]
        no_cover = conn.execute("SELECT COUNT(*) FROM books WHERE cover_image_url IS NULL").fetchone()[0]
        no_pages = conn.execute("SELECT COUNT(*) FROM books WHERE pages IS NULL").fetchone()[0]
        no_year = conn.execute("SELECT COUNT(*) FROM books WHERE publication_year IS NULL OR publication_year = 0").fetchone()[0]
        no_genres = conn.execute("SELECT COUNT(*) FROM books WHERE id NOT IN (SELECT book_id FROM book_genres)").fetchone()[0]

        f.write(f"Total books: {total}\n")
        f.write(f"No description: {no_desc} ({100*no_desc//total}%)\n")
        f.write(f"No cover: {no_cover} ({100*no_cover//total}%)\n")
        f.write(f"No pages: {no_pages} ({100*no_pages//total}%)\n")
        f.write(f"No year: {no_year} ({100*no_year//total}%)\n")
        f.write(f"No genres: {no_genres} ({100*no_genres//total}%)\n\n")

        # Books missing covers (most visible to users)
        f.write("BOOKS MISSING COVERS (priority for manual fix):\n")
        f.write("-" * 60 + "\n")
        rows = conn.execute("""
            SELECT b.title,
                   (SELECT a.name FROM book_authors ba JOIN authors a ON ba.author_id = a.id
                    WHERE ba.book_id = b.id LIMIT 1) as author,
                   (SELECT COUNT(*) FROM user_book_state WHERE book_id = b.id) as users
            FROM books b
            WHERE b.cover_image_url IS NULL
            ORDER BY users DESC, b.title
            LIMIT 200
        """).fetchall()
        for title, author, users in rows:
            user_tag = f" [{users} users]" if users > 0 else ""
            f.write(f"  {title} — {author or 'Unknown'}{user_tag}\n")

        f.write(f"\n\nBOOKS MISSING DESCRIPTION (with users):\n")
        f.write("-" * 60 + "\n")
        rows = conn.execute("""
            SELECT b.title,
                   (SELECT a.name FROM book_authors ba JOIN authors a ON ba.author_id = a.id
                    WHERE ba.book_id = b.id LIMIT 1) as author
            FROM books b
            JOIN user_book_state ubs ON ubs.book_id = b.id
            WHERE b.description IS NULL
            GROUP BY b.id
            ORDER BY COUNT(ubs.user_id) DESC
            LIMIT 100
        """).fetchall()
        for title, author in rows:
            f.write(f"  {title} — {author or 'Unknown'}\n")

    log(f"Gap report saved to: {report_path}")
    return {"report": str(report_path)}


# =============================================
# Main
# =============================================
def main():
    parser = argparse.ArgumentParser(description="Tiered book enrichment")
    parser.add_argument("--tier", type=int, choices=[1, 2, 3, 4], help="Run specific tier")
    parser.add_argument("--all", action="store_true", help="Run all tiers in order")
    parser.add_argument("--limit", type=int, default=None, help="Limit books per tier")
    args = parser.parse_args()

    if not args.tier and not args.all:
        parser.print_help()
        return

    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=30000")

    start = datetime.now()
    log(f"Starting tiered enrichment (DB: {DB_PATH})")

    tiers = []
    if args.all:
        tiers = [1, 2, 3, 4]
    else:
        tiers = [args.tier]

    for tier in tiers:
        if tier == 1:
            tier1_open_library(conn, args.limit)
            tier1b_ol_search(conn, args.limit)
        elif tier == 2:
            tier2_brave_search(conn, args.limit)
        elif tier == 3:
            tier3_google_books(conn, args.limit)
        elif tier == 4:
            tier4_gap_report(conn)

    elapsed = (datetime.now() - start).total_seconds()
    log(f"Done in {elapsed:.0f}s")

    # Final stats
    total = conn.execute("SELECT COUNT(*) FROM books").fetchone()[0]
    no_desc = conn.execute("SELECT COUNT(*) FROM books WHERE description IS NULL").fetchone()[0]
    no_cover = conn.execute("SELECT COUNT(*) FROM books WHERE cover_image_url IS NULL").fetchone()[0]
    no_pages = conn.execute("SELECT COUNT(*) FROM books WHERE pages IS NULL").fetchone()[0]
    no_year = conn.execute("SELECT COUNT(*) FROM books WHERE publication_year IS NULL OR publication_year = 0").fetchone()[0]

    log(f"Final: {total} books | no_desc:{no_desc} no_cover:{no_cover} no_pages:{no_pages} no_year:{no_year}")
    conn.close()


if __name__ == "__main__":
    main()
