#!/bin/bash
# sync-incremental.sh — Two-way incremental sync between local SQLite and Turso
#
# Usage:
#   ./scripts/sync-incremental.sh pull    # Pull live changes INTO local
#   ./scripts/sync-incremental.sh push    # Push local changes TO live (new/changed only)
#   ./scripts/sync-incremental.sh status  # Show what's different between local and live
#
# This script NEVER deletes data. It only adds or updates rows.
# Always run "pull" before "push" to avoid overwriting live edits.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DB_PATH="$PROJECT_DIR/data/tbra.db"
TURSO_DB="tbra-web-app"
TEMP_DIR="$PROJECT_DIR/.turso-sync-incremental"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ACTION="${1:-status}"

mkdir -p "$TEMP_DIR"
cd "$PROJECT_DIR"

case "$ACTION" in

# ─── STATUS: Compare local vs live ─────────────────────────────────
status)
  echo -e "${BLUE}Comparing local vs live...${NC}"
  python3 -c "
import sqlite3, subprocess, sys

conn = sqlite3.connect('$DB_PATH')
cursor = conn.cursor()

tables = ['users', 'books', 'authors', 'series', 'genres',
          'book_authors', 'book_genres', 'book_series', 'book_category_ratings',
          'user_book_state', 'user_book_ratings', 'user_book_reviews',
          'user_favorite_books', 'reading_notes', 'reading_sessions',
          'reading_goals', 'up_next', 'reported_issues', 'report_corrections',
          'enrichment_log', 'editions', 'links', 'user_hidden_books',
          'user_follows', 'user_content_preferences', 'user_reading_preferences']

print(f'{'Table':<35} {'Local':>8} {'Live':>8} {'Diff':>8}')
print('-' * 65)

for table in tables:
    try:
        local_count = cursor.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
    except:
        local_count = 0

    try:
        result = subprocess.run(
            ['turso', 'db', 'shell', '$TURSO_DB', f'SELECT COUNT(*) FROM {table};'],
            capture_output=True, text=True, timeout=10
        )
        lines = [l.strip() for l in result.stdout.strip().split('\n') if l.strip() and not l.strip().startswith('COUNT')]
        remote_count = int(lines[-1]) if lines else 0
    except:
        remote_count = '?'

    if isinstance(remote_count, int):
        diff = local_count - remote_count
        diff_str = f'+{diff}' if diff > 0 else str(diff)
        color = '\033[0;32m' if diff > 0 else ('\033[0;31m' if diff < 0 else '')
        reset = '\033[0m' if diff != 0 else ''
    else:
        diff_str = '?'
        color = ''
        reset = ''

    print(f'{table:<35} {local_count:>8} {str(remote_count):>8} {color}{diff_str:>8}{reset}')

conn.close()
"
  ;;

# ─── PULL: Fetch live changes into local ───────────────────────────
pull)
  echo -e "${BLUE}Pulling live changes into local database...${NC}"
  echo ""

  python3 << 'PYEOF'
import sqlite3, subprocess, sys, json, os

DB_PATH = "data/tbra.db"
TURSO_DB = "tbra-web-app"

def turso_json(sql, timeout=60):
    """Run a query against Turso using json_group_array for reliable parsing.
    Returns a list of dicts."""
    result = subprocess.run(
        ["turso", "db", "shell", TURSO_DB, sql],
        capture_output=True, text=True, timeout=timeout
    )
    raw = result.stdout.strip()
    # The output has a header line then the JSON array
    lines = raw.split("\n")
    for line in lines:
        line = line.strip()
        if line.startswith("["):
            try:
                return json.loads(line)
            except json.JSONDecodeError:
                pass
    return []

def turso_count(table):
    """Get row count from a live table."""
    result = subprocess.run(
        ["turso", "db", "shell", TURSO_DB, f"SELECT COUNT(*) FROM {table};"],
        capture_output=True, text=True, timeout=15
    )
    for line in result.stdout.strip().split("\n"):
        line = line.strip()
        if line.isdigit():
            return int(line)
    return 0

def get_columns(cursor, table):
    """Get column names for a local table."""
    cursor.execute(f"PRAGMA table_info({table})")
    return [row[1] for row in cursor.fetchall()]

def get_pk(cursor, table):
    """Get primary key column(s) for a table."""
    cursor.execute(f"PRAGMA table_info({table})")
    pk_cols = [row[1] for row in cursor.fetchall() if row[5] > 0]
    return pk_cols if pk_cols else None

def build_json_query(table, columns):
    """Build a Turso query that returns all rows as a JSON array."""
    obj_parts = ", ".join([f"'{c}', {c}" for c in columns])
    return f"SELECT json_group_array(json_object({obj_parts})) FROM {table};"

def escape_val(v):
    """Escape a value for SQLite insertion."""
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    escaped = str(v).replace("'", "''")
    return f"'{escaped}'"

conn = sqlite3.connect(DB_PATH)
conn.execute("PRAGMA foreign_keys=OFF")
cursor = conn.cursor()

# ── Tables to sync, grouped by type ──
# Format: (table_name, pk_columns, has_updated_at)
# pk_columns: list of columns that uniquely identify a row
TABLES = [
    # Core content tables (may have new/updated rows on live)
    ("users",                    ["id"],                    False),
    ("books",                    ["id"],                    True),
    ("authors",                  ["id"],                    False),
    ("series",                   ["id"],                    False),
    ("genres",                   ["id"],                    False),
    ("narrators",                ["id"],                    False),
    ("editions",                 ["id"],                    False),
    # Junction tables (insert-only, no updates)
    ("book_authors",             ["book_id", "author_id"],  False),
    ("book_genres",              ["book_id", "genre_id"],   False),
    ("book_series",              ["book_id", "series_id"],  False),
    ("book_narrators",           ["book_id", "narrator_id"],False),
    ("book_category_ratings",    ["id"],                    False),
    ("links",                    ["id"],                    False),
    # User data tables
    ("user_book_state",          ["user_id", "book_id"],    False),
    ("user_book_ratings",        ["user_id", "book_id"],    False),
    ("user_book_reviews",        ["id"],                    False),
    ("user_favorite_books",      ["user_id", "book_id"],    False),
    ("user_hidden_books",        ["user_id", "book_id"],    False),
    ("user_follows",             ["follower_id", "followed_id"], False),
    ("user_owned_editions",      ["user_id", "edition_id"], False),
    ("user_content_preferences", ["user_id", "category_id"], False),
    ("user_reading_preferences", ["user_id"],               False),
    ("user_genre_preferences",   ["user_id", "genre_name"],  False),
    ("user_notification_preferences", ["user_id"],          False),
    ("reading_goals",            ["id"],                    False),
    ("reading_sessions",         ["id"],                    False),
    ("reading_notes",            ["id"],                    False),
    ("up_next",                  ["user_id", "book_id"],    False),
    ("review_descriptor_tags",   ["id"],                    False),
    ("review_helpful_votes",     ["user_id", "review_id"],  False),
    ("user_book_dimension_ratings", ["id"],                 False),
    # Admin/system tables
    ("reported_issues",          ["id"],                    False),
    ("report_corrections",       ["id"],                    False),
    ("enrichment_log",           ["id"],                    False),
    ("rating_citations",         ["rating_id", "citation_id"], False),
]

total_inserted = 0
total_updated = 0
errors = []

for table, pk_cols, has_updated_at in TABLES:
    try:
        columns = get_columns(cursor, table)
    except Exception as e:
        print(f"  ⚠  {table}: skipped (table not in local DB)")
        continue

    # Get local primary key set for fast lookup
    pk_select = ", ".join(pk_cols)
    local_pks = set()
    for row in cursor.execute(f"SELECT {pk_select} FROM {table}").fetchall():
        local_pks.add(tuple(row) if len(pk_cols) > 1 else (row[0],))

    # Fetch all rows from live as JSON (one query per table)
    json_query = build_json_query(table, columns)
    try:
        live_rows = turso_json(json_query, timeout=90)
    except Exception as e:
        errors.append(f"{table}: {e}")
        print(f"  ✗  {table}: fetch failed ({e})")
        continue

    if not live_rows:
        print(f"  ·  {table}: empty on live")
        continue

    inserted = 0
    updated = 0

    for row in live_rows:
        pk_val = tuple(row.get(c) for c in pk_cols)

        if pk_val not in local_pks:
            # INSERT — row exists on live but not locally
            col_list = ", ".join(columns)
            val_list = ", ".join([escape_val(row.get(c)) for c in columns])
            try:
                cursor.execute(f"INSERT INTO {table} ({col_list}) VALUES ({val_list})")
                inserted += 1
            except Exception as e:
                if "UNIQUE constraint" not in str(e):
                    errors.append(f"{table} insert: {e}")
        elif has_updated_at:
            # UPDATE — check if live version is newer
            local_row = cursor.execute(
                f"SELECT updated_at FROM {table} WHERE " +
                " AND ".join([f"{c} = ?" for c in pk_cols]),
                pk_val
            ).fetchone()

            live_updated = row.get("updated_at", "")
            local_updated = local_row[0] if local_row else ""

            if live_updated and local_updated and live_updated > local_updated:
                set_parts = ", ".join([
                    f"{c} = {escape_val(row.get(c))}" for c in columns if c not in pk_cols
                ])
                where_parts = " AND ".join([f"{c} = ?" for c in pk_cols])
                try:
                    cursor.execute(f"UPDATE {table} SET {set_parts} WHERE {where_parts}", pk_val)
                    updated += 1
                except Exception as e:
                    errors.append(f"{table} update: {e}")

    status_parts = []
    if inserted: status_parts.append(f"+{inserted} new")
    if updated: status_parts.append(f"~{updated} updated")
    if not status_parts: status_parts.append("in sync")

    icon = "✓" if (inserted or updated) else "·"
    print(f"  {icon}  {table:<35} {', '.join(status_parts)}")

    total_inserted += inserted
    total_updated += updated

conn.commit()

# ── Always sync covers from live → local (live covers are authoritative) ──
try:
    cover_query = "SELECT json_group_array(json_object('id', id, 'cover', cover_image_url)) FROM books WHERE cover_image_url IS NOT NULL;"
    live_covers = turso_json(cover_query, timeout=120)
    cover_fixed = 0
    for row in live_covers:
        bid = row.get("id")
        live_cover = row.get("cover")
        if not bid or not live_cover:
            continue
        local_row = cursor.execute("SELECT cover_image_url FROM books WHERE id = ?", (bid,)).fetchone()
        if local_row and local_row[0] != live_cover:
            cursor.execute("UPDATE books SET cover_image_url = ? WHERE id = ?", (live_cover, bid))
            cover_fixed += 1
        elif local_row and local_row[0] is None:
            cursor.execute("UPDATE books SET cover_image_url = ? WHERE id = ?", (live_cover, bid))
            cover_fixed += 1
    if cover_fixed:
        conn.commit()
        print(f"  ✓  covers                              ~{cover_fixed} synced from live")
except Exception as e:
    print(f"  ⚠  cover sync: {e}")

conn.close()

print("")
print(f"  ────────────────────────────────────")
print(f"  Total: {total_inserted} rows inserted, {total_updated} rows updated")
if errors:
    print(f"  ⚠  {len(errors)} errors:")
    for e in errors:
        print(f"     {e}")
print(f"  Pull complete.")
PYEOF
  ;;

# ─── PUSH: Send local changes to live ─────────────────────────────
push)
  echo -e "${YELLOW}⚠  Have you run 'pull' first? Live edits will be overwritten otherwise.${NC}"
  echo -e "${BLUE}Pushing new/changed rows to live...${NC}"
  echo ""

  python3 << 'PYEOF'
import sqlite3, subprocess, sys, os, tempfile

DB_PATH = "data/tbra.db"
TURSO_DB = "tbra-web-app"
TEMP_DIR = ".turso-sync-incremental"

def turso_shell(sql_or_file, is_file=False):
    """Execute SQL against Turso."""
    if is_file:
        with open(sql_or_file, "r") as f:
            result = subprocess.run(
                ["turso", "db", "shell", TURSO_DB],
                stdin=f, capture_output=True, text=True, timeout=60
            )
    else:
        result = subprocess.run(
            ["turso", "db", "shell", TURSO_DB, sql_or_file],
            capture_output=True, text=True, timeout=30
        )
    return result

def get_live_ids(table):
    """Get set of IDs from live table."""
    result = subprocess.run(
        ["turso", "db", "shell", TURSO_DB, f"SELECT id FROM {table};"],
        capture_output=True, text=True, timeout=30
    )
    ids = set()
    for line in result.stdout.strip().split("\n")[1:]:
        val = line.strip()
        if val and len(val) >= 8:
            ids.add(val)
    return ids

conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

os.makedirs(TEMP_DIR, exist_ok=True)

# ── Push new books ──
print("  Checking for new books to push...")
live_book_ids = get_live_ids("books")
local_books = cursor.execute("SELECT * FROM books").fetchall()
cols = [desc[0] for desc in cursor.description]
col_list = ", ".join(cols)

new_books = [b for b in local_books if b[0] not in live_book_ids]
print(f"  {len(new_books)} new books to push")

if new_books:
    batch_size = 200
    for i in range(0, len(new_books), batch_size):
        batch = new_books[i:i+batch_size]
        sql_file = os.path.join(TEMP_DIR, f"new_books_batch_{i}.sql")
        with open(sql_file, "w", encoding="utf-8") as f:
            f.write("PRAGMA foreign_keys=OFF;\n")
            for row in batch:
                vals = []
                for v in row:
                    if v is None:
                        vals.append("NULL")
                    elif isinstance(v, (int, float)):
                        vals.append(str(v))
                    else:
                        escaped = str(v).replace("'", "''")
                        vals.append(f"'{escaped}'")
                f.write(f"INSERT OR IGNORE INTO books ({col_list}) VALUES ({', '.join(vals)});\n")

        result = turso_shell(sql_file, is_file=True)
        if result.returncode != 0:
            print(f"    ✗ Batch {i} failed: {result.stderr[:100]}")
        else:
            print(f"    ✓ Pushed books {i+1}-{min(i+batch_size, len(new_books))}")

    # Push associated data for new books
    new_book_ids = set(b[0] for b in new_books)

    for join_table, fk_col in [
        ("book_authors", "book_id"), ("book_genres", "book_id"),
        ("book_series", "book_id"), ("book_category_ratings", "book_id"),
        ("enrichment_log", "book_id")
    ]:
        try:
            join_rows = cursor.execute(f"SELECT * FROM {join_table} WHERE {fk_col} IN ({','.join('?' * len(new_book_ids))})", list(new_book_ids)).fetchall()
        except:
            continue

        if not join_rows:
            continue

        join_cols = [desc[0] for desc in cursor.description]
        join_col_list = ", ".join(join_cols)

        sql_file = os.path.join(TEMP_DIR, f"new_{join_table}.sql")
        with open(sql_file, "w", encoding="utf-8") as f:
            f.write("PRAGMA foreign_keys=OFF;\n")
            for row in join_rows:
                vals = []
                for v in row:
                    if v is None:
                        vals.append("NULL")
                    elif isinstance(v, (int, float)):
                        vals.append(str(v))
                    else:
                        escaped = str(v).replace("'", "''")
                        vals.append(f"'{escaped}'")
                f.write(f"INSERT OR IGNORE INTO {join_table} ({join_col_list}) VALUES ({', '.join(vals)});\n")

        # Batch large files
        line_count = len(join_rows)
        if line_count > 500:
            subprocess.run(["split", "-l", "500", sql_file, os.path.join(TEMP_DIR, f"{join_table}_batch_")], check=True)
            for batch_file in sorted(f for f in os.listdir(TEMP_DIR) if f.startswith(f"{join_table}_batch_")):
                batch_path = os.path.join(TEMP_DIR, batch_file)
                # Prepend pragma
                with open(batch_path, "r") as bf:
                    content = bf.read()
                with open(batch_path, "w") as bf:
                    bf.write("PRAGMA foreign_keys=OFF;\n" + content)
                turso_shell(batch_path, is_file=True)
                os.remove(batch_path)
            print(f"    ✓ Pushed {line_count} rows to {join_table} (batched)")
        else:
            turso_shell(sql_file, is_file=True)
            print(f"    ✓ Pushed {line_count} rows to {join_table}")

    # Push new authors for new books
    new_author_ids_rows = cursor.execute(
        f"SELECT DISTINCT author_id FROM book_authors WHERE book_id IN ({','.join('?' * len(new_book_ids))})",
        list(new_book_ids)
    ).fetchall()
    new_author_ids = set(r[0] for r in new_author_ids_rows)

    live_author_ids = get_live_ids("authors")
    authors_to_push = new_author_ids - live_author_ids

    if authors_to_push:
        author_rows = cursor.execute(
            f"SELECT * FROM authors WHERE id IN ({','.join('?' * len(authors_to_push))})",
            list(authors_to_push)
        ).fetchall()
        author_cols = [desc[0] for desc in cursor.description]
        author_col_list = ", ".join(author_cols)

        sql_file = os.path.join(TEMP_DIR, "new_authors.sql")
        with open(sql_file, "w", encoding="utf-8") as f:
            f.write("PRAGMA foreign_keys=OFF;\n")
            for row in author_rows:
                vals = []
                for v in row:
                    if v is None:
                        vals.append("NULL")
                    elif isinstance(v, (int, float)):
                        vals.append(str(v))
                    else:
                        escaped = str(v).replace("'", "''")
                        vals.append(f"'{escaped}'")
                f.write(f"INSERT OR IGNORE INTO authors ({author_col_list}) VALUES ({', '.join(vals)});\n")
        turso_shell(sql_file, is_file=True)
        print(f"    ✓ Pushed {len(authors_to_push)} new authors")

    # Push new series
    new_series_ids_rows = cursor.execute(
        f"SELECT DISTINCT series_id FROM book_series WHERE book_id IN ({','.join('?' * len(new_book_ids))})",
        list(new_book_ids)
    ).fetchall()
    new_series_ids = set(r[0] for r in new_series_ids_rows)
    live_series_ids = get_live_ids("series")
    series_to_push = new_series_ids - live_series_ids

    if series_to_push:
        series_rows = cursor.execute(
            f"SELECT * FROM series WHERE id IN ({','.join('?' * len(series_to_push))})",
            list(series_to_push)
        ).fetchall()
        series_cols = [desc[0] for desc in cursor.description]
        series_col_list = ", ".join(series_cols)

        sql_file = os.path.join(TEMP_DIR, "new_series.sql")
        with open(sql_file, "w", encoding="utf-8") as f:
            f.write("PRAGMA foreign_keys=OFF;\n")
            for row in series_rows:
                vals = []
                for v in row:
                    if v is None:
                        vals.append("NULL")
                    elif isinstance(v, (int, float)):
                        vals.append(str(v))
                    else:
                        escaped = str(v).replace("'", "''")
                        vals.append(f"'{escaped}'")
                f.write(f"INSERT OR IGNORE INTO series ({series_col_list}) VALUES ({', '.join(vals)});\n")
        turso_shell(sql_file, is_file=True)
        print(f"    ✓ Pushed {len(series_to_push)} new series")

    # Push new genres
    new_genre_ids_rows = cursor.execute(
        f"SELECT DISTINCT genre_id FROM book_genres WHERE book_id IN ({','.join('?' * len(new_book_ids))})",
        list(new_book_ids)
    ).fetchall()
    new_genre_ids = set(r[0] for r in new_genre_ids_rows)
    live_genre_ids = get_live_ids("genres")
    genres_to_push = new_genre_ids - live_genre_ids

    if genres_to_push:
        genre_rows = cursor.execute(
            f"SELECT * FROM genres WHERE id IN ({','.join('?' * len(genres_to_push))})",
            list(genres_to_push)
        ).fetchall()
        genre_cols = [desc[0] for desc in cursor.description]
        genre_col_list = ", ".join(genre_cols)

        sql_file = os.path.join(TEMP_DIR, "new_genres.sql")
        with open(sql_file, "w", encoding="utf-8") as f:
            f.write("PRAGMA foreign_keys=OFF;\n")
            for row in genre_rows:
                vals = []
                for v in row:
                    if v is None:
                        vals.append("NULL")
                    elif isinstance(v, (int, float)):
                        vals.append(str(v))
                    else:
                        escaped = str(v).replace("'", "''")
                        vals.append(f"'{escaped}'")
                f.write(f"INSERT OR IGNORE INTO genres ({genre_col_list}) VALUES ({', '.join(vals)});\n")
        turso_shell(sql_file, is_file=True)
        print(f"    ✓ Pushed {len(genres_to_push)} new genres")

print("\n  Push complete.")

# Cleanup
import shutil
shutil.rmtree(TEMP_DIR, ignore_errors=True)

conn.close()
PYEOF
  ;;

*)
  echo "Usage: $0 {pull|push|status}"
  exit 1
  ;;
esac
