#!/usr/bin/env python3
"""Fill missing books in series that have gaps in position numbering."""

import html
import os
import re
import sqlite3
import time
import unicodedata
import uuid
from collections import Counter

import requests
from dotenv import load_dotenv

load_dotenv('.env.local')

BRAVE_API_KEY = os.getenv('BRAVE_SEARCH_API_KEY')
GOOGLE_BOOKS_API_KEY = os.getenv('GOOGLE_BOOKS_API_KEY')

DB_PATH = 'data/tbra.db'
GOOGLE_BOOKS_CAP = 900
google_books_calls = 0

stats = {'filled': 0, 'skipped': 0}


def normalize_title(title: str) -> str:
    t = title.lower().strip()
    t = unicodedata.normalize('NFKD', t)
    t = re.sub(r'[^\w\s]', '', t)
    t = re.sub(r'\s+', ' ', t)
    return t


def strip_html(text: str) -> str:
    text = re.sub(r'<[^>]+>', '', text)
    text = html.unescape(text)
    return text.strip()


def extract_clean_title(raw: str, series_name: str) -> str | None:
    """Extract just the book title from a raw match, stripping everything after it."""
    t = strip_html(raw).strip()

    # Cut at first occurrence of common terminators
    # Year in parens: (2019), (1984)
    t = re.split(r'\s*\(\d{4}\)', t)[0].strip()
    # Next numbered entry: "5." or "#5" or "Book 5"
    t = re.split(r'\s+\d+\.\s', t)[0].strip()
    t = re.split(r'\s+#\d', t)[0].strip()
    t = re.split(r'\s+Book\s+\d', t, flags=re.IGNORECASE)[0].strip()
    # Pipe, middot, or similar
    t = re.split(r'\s*[·|]\s*', t)[0].strip()
    # "by Author" pattern
    t = re.split(r'\s+by\s+[A-Z]', t)[0].strip()
    # Comma followed by number (next entry in comma-sep list)
    t = re.split(r',\s*\d', t)[0].strip()
    # Open paren (subtitle or metadata)
    # Only split if there's content before the paren
    parts = re.split(r'\s*\(', t)
    if parts[0].strip():
        t = parts[0].strip()
    # "..." or ellipsis
    t = re.split(r'\s*\.{2,}', t)[0].strip()
    t = re.split(r'\s*…', t)[0].strip()
    # " - " followed by subtitle or description
    # Be careful: some titles have " - " legitimately
    # Only strip if what follows looks like metadata
    m = re.match(r'^(.+?)\s+[-–—]\s+(?:Book|Vol|Part|Series|The\s+\w+\s+Saga)', t)
    if m:
        t = m.group(1).strip()

    # Final cleanup
    t = t.strip(' -–—|:;,*"\'()[]')
    # Remove trailing " * " artifacts
    t = re.sub(r'\s*\*\s*$', '', t).strip()

    if not t or len(t) < 3 or len(t) > 80:
        return None
    if not t[0].isalpha():
        return None
    alpha = sum(1 for c in t if c.isalpha())
    if alpha < 3:
        return None
    if normalize_title(t) == normalize_title(series_name):
        return None

    # Reject junk
    junk = [
        r'amazon', r'\.com', r'reviews?\b', r'ISBN\b', r'PDF\b',
        r'collects?\b', r'published\b', r'editors?\b', r'learn\s+more',
        r'upvotes', r'comments\b', r'r/', r'announcement',
        r'sexy', r'charming', r'eagerly', r'anticipated', r'respected',
        r'originally', r'description\b', r'fortress', r'minneapolis',
        r'\d{10}', r'on\s+sale', r'buy\s+now', r'free\s+shipping',
        r'paperback\b', r'hardcover\b', r'kindle\b', r'audible\b',
        r'audiobook\b', r'price\b', r'\$\d', r'sassy\s+review',
        r'founding\s+author', r'start\s+reading', r'google\s+books',
        r'salvatore', r'riftwar', r'follow\b',
    ]
    for pat in junk:
        if re.search(pat, t, re.IGNORECASE):
            return None

    if ';' in t:
        return None

    # Reject likely author names (2 capitalized words, all alpha)
    words = t.split()
    if len(words) == 2 and all(w[0].isupper() and w.isalpha() for w in words):
        # Likely a person name unless contains book-ish words
        book_words = {'blood', 'fire', 'war', 'dark', 'light', 'night', 'storm',
                      'shadow', 'throne', 'king', 'queen', 'dragon', 'magic',
                      'death', 'dead', 'bone', 'iron', 'steel', 'glass', 'stone',
                      'sword', 'crown', 'tower', 'star', 'moon', 'sun', 'sea',
                      'wind', 'frost', 'ice', 'gold', 'silver', 'red', 'black',
                      'white', 'blue', 'green', 'wild', 'lost', 'last', 'first',
                      'heat', 'cold', 'ivory', 'secret', 'evil', 'holy', 'sacred'}
        if not any(w.lower() in book_words for w in words):
            return None

    return t


def find_series_with_gaps(conn):
    cur = conn.execute("""
        SELECT s.id, s.name,
               GROUP_CONCAT(CAST(bs.position_in_series AS INTEGER), ',') as positions
        FROM series s
        JOIN book_series bs ON bs.series_id = s.id
        WHERE bs.position_in_series IS NOT NULL
          AND CAST(bs.position_in_series AS INTEGER) = bs.position_in_series
          AND bs.position_in_series > 0
        GROUP BY s.id
        HAVING MAX(bs.position_in_series) <= 20
    """)

    gaps = []
    for row in cur.fetchall():
        series_id, series_name, pos_str = row
        positions = sorted(set(int(p) for p in pos_str.split(',')))
        if not positions:
            continue
        min_pos = positions[0]
        max_pos = positions[-1]
        expected = set(range(min_pos, max_pos + 1))
        missing = sorted(expected - set(positions))
        if 1 <= len(missing) <= 5:
            gaps.append((series_id, series_name, missing, positions))
    return gaps


def get_series_author(conn, series_id):
    cur = conn.execute("""
        SELECT ba.author_id, COUNT(*) as cnt
        FROM book_series bs
        JOIN book_authors ba ON ba.book_id = bs.book_id
        WHERE bs.series_id = ?
        GROUP BY ba.author_id
        ORDER BY cnt DESC
        LIMIT 1
    """, (series_id,))
    row = cur.fetchone()
    return row[0] if row else None


def title_exists(conn, title):
    norm = normalize_title(title)
    cur = conn.execute("SELECT title FROM books")
    for (existing,) in cur.fetchall():
        if normalize_title(existing) == norm:
            return True
    return False


def ol_key_exists(conn, ol_key):
    if not ol_key:
        return False
    cur = conn.execute("SELECT 1 FROM books WHERE open_library_key = ?", (ol_key,))
    return cur.fetchone() is not None


def brave_search(query):
    if not BRAVE_API_KEY:
        return None
    url = 'https://api.search.brave.com/res/v1/web/search'
    headers = {'X-Subscription-Token': BRAVE_API_KEY, 'Accept': 'application/json'}
    params = {'q': query, 'count': 10}
    try:
        r = requests.get(url, headers=headers, params=params, timeout=15)
        time.sleep(1)
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        print(f"  Brave search error: {e}")
    return None


def extract_titles_from_brave(results, series_name, position):
    if not results or 'web' not in results:
        return []

    candidates = []
    pos = str(position)

    for item in results.get('web', {}).get('results', []):
        raw_title = strip_html(item.get('title', ''))
        raw_desc = strip_html(item.get('description', ''))

        for text in [raw_title, raw_desc]:
            # "Book N: Title" / "#N: Title" / "Book N - Title"
            for m in re.finditer(
                rf'(?:book|#)\s*{pos}\s*[:\-–—]\s*(.+)',
                text, re.IGNORECASE
            ):
                title = extract_clean_title(m.group(1), series_name)
                if title:
                    candidates.append(title)

            # "N. Title" in a numbered list
            for m in re.finditer(
                rf'(?:^|\s){pos}\.\s+([A-Z].+)', text
            ):
                title = extract_clean_title(m.group(1), series_name)
                if title:
                    candidates.append(title)

    return candidates


def search_open_library(title, author_name=None):
    params = {'title': title, 'limit': 5}
    if author_name:
        params['author'] = author_name
    try:
        r = requests.get('https://openlibrary.org/search.json', params=params, timeout=15)
        time.sleep(0.5)
        if r.status_code != 200:
            return {}
        data = r.json()
        docs = data.get('docs', [])
        if not docs:
            return {}

        norm_title = normalize_title(title)
        best = None
        for doc in docs:
            if normalize_title(doc.get('title', '')) == norm_title:
                best = doc
                break
        if not best:
            doc_norm = normalize_title(docs[0].get('title', ''))
            if norm_title in doc_norm or doc_norm in norm_title:
                best = docs[0]
            else:
                return {}

        result = {}
        if best.get('key'):
            result['open_library_key'] = best['key']
        if best.get('cover_i'):
            result['cover_image_url'] = f"https://covers.openlibrary.org/b/id/{best['cover_i']}-L.jpg"
        if best.get('number_of_pages_median'):
            result['pages'] = best['number_of_pages_median']
        if best.get('first_publish_year'):
            result['publication_year'] = best['first_publish_year']
        if best.get('isbn') and len(best['isbn']) > 0:
            for isbn in best['isbn']:
                if len(isbn) == 13:
                    result['isbn_13'] = isbn
                    break
            if 'isbn_13' not in result:
                for isbn in best['isbn']:
                    if len(isbn) == 10:
                        result['isbn_10'] = isbn
                        break
        if best.get('first_sentence'):
            sentences = best['first_sentence']
            if isinstance(sentences, list) and sentences:
                result['description'] = sentences[0]
        return result
    except Exception as e:
        print(f"  Open Library error: {e}")
        return {}


def search_google_books_cover(title, author_name=None):
    global google_books_calls
    if not GOOGLE_BOOKS_API_KEY or google_books_calls >= GOOGLE_BOOKS_CAP:
        return None
    q = f'intitle:{title}'
    if author_name:
        q += f' inauthor:{author_name}'
    params = {'q': q, 'key': GOOGLE_BOOKS_API_KEY, 'maxResults': 1}
    try:
        r = requests.get('https://www.googleapis.com/books/v1/volumes', params=params, timeout=15)
        google_books_calls += 1
        time.sleep(0.5)
        if r.status_code != 200:
            return None
        data = r.json()
        items = data.get('items', [])
        if items:
            info = items[0].get('volumeInfo', {})
            imgs = info.get('imageLinks', {})
            return imgs.get('thumbnail') or imgs.get('smallThumbnail')
    except Exception as e:
        print(f"  Google Books error: {e}")
    return None


def get_author_name(conn, author_id):
    cur = conn.execute("SELECT name FROM authors WHERE id = ?", (author_id,))
    row = cur.fetchone()
    return row[0] if row else None


def create_book(conn, title, metadata, series_id, position, author_id):
    book_id = str(uuid.uuid4())
    ol_key = metadata.get('open_library_key')
    if ol_key_exists(conn, ol_key):
        ol_key = None

    conn.execute("""
        INSERT INTO books (id, title, description, publication_year, isbn_10, isbn_13,
                           pages, cover_image_url, open_library_key, language, is_fiction,
                           created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'English', 1, datetime('now'), datetime('now'))
    """, (
        book_id, title, metadata.get('description'), metadata.get('publication_year'),
        metadata.get('isbn_10'), metadata.get('isbn_13'), metadata.get('pages'),
        metadata.get('cover_image_url'), ol_key,
    ))

    if author_id:
        conn.execute("INSERT INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'author')",
                     (book_id, author_id))

    conn.execute("INSERT INTO book_series (book_id, series_id, position_in_series) VALUES (?, ?, ?)",
                 (book_id, series_id, position))

    conn.commit()
    return book_id


def pick_best_title(candidates):
    if not candidates:
        return None
    counts = Counter(normalize_title(c) for c in candidates)
    best_norm, _ = counts.most_common(1)[0]
    for c in candidates:
        if normalize_title(c) == best_norm:
            return c
    return None


def main():
    os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")

    print("Finding series with gaps...")
    gaps = find_series_with_gaps(conn)
    print(f"Found {len(gaps)} series with gaps\n")

    for series_id, series_name, missing_positions, existing_positions in gaps:
        author_id = get_series_author(conn, series_id)
        author_name = get_author_name(conn, author_id) if author_id else None

        for position in missing_positions:
            all_candidates = []

            q1 = f'"{series_name}" series reading order'
            if author_name:
                q1 += f' {author_name}'
            r1 = brave_search(q1)
            all_candidates.extend(extract_titles_from_brave(r1, series_name, position))

            if len(all_candidates) < 2:
                q2 = f'"{series_name}" book {position}'
                if author_name:
                    q2 += f' {author_name}'
                r2 = brave_search(q2)
                all_candidates.extend(extract_titles_from_brave(r2, series_name, position))

            title = pick_best_title(all_candidates)

            if not title:
                print(f"[series-gap] SKIP {series_name} #{position}: could not identify title")
                stats['skipped'] += 1
                continue

            if title_exists(conn, title):
                print(f"[series-gap] SKIP {series_name} #{position}: '{title}' already exists")
                stats['skipped'] += 1
                continue

            ol_meta = search_open_library(title, author_name)

            if not ol_meta.get('cover_image_url'):
                gb_cover = search_google_books_cover(title, author_name)
                if gb_cover:
                    ol_meta['cover_image_url'] = gb_cover

            try:
                create_book(conn, title, ol_meta, series_id, position, author_id)
                print(f"[series-gap] Filling {series_name} #{position}: {title}")
                stats['filled'] += 1
            except Exception as e:
                print(f"[series-gap] ERROR {series_name} #{position}: {title} - {e}")
                conn.rollback()
                stats['skipped'] += 1

    conn.close()

    print(f"\n{'='*50}")
    print(f"Summary:")
    print(f"  Total filled:          {stats['filled']}")
    print(f"  Total skipped:         {stats['skipped']}")
    print(f"  Google Books calls:    {google_books_calls}")


if __name__ == '__main__':
    main()
