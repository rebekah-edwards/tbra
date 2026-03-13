# tbr(a) — Postgres schema sketch (v0)

This is a pragmatic starting point optimized for: (1) searchable book pages, (2) structured content profiles, (3) internal citations + evidence levels.

## Core tables

### books
- id (uuid pk)
- title
- description
- publication_year (int)
- isbn_10 (text, nullable)
- isbn_13 (text, nullable)
- pages (int, nullable)
- words (int, nullable)
- audio_length_minutes (int, nullable)
- created_at, updated_at

Indexes:
- unique index on isbn_13 where not null
- full-text index on (title, description)

### authors
- id (uuid pk)
- name
- bio (text, nullable)

### book_authors
- book_id (fk)
- author_id (fk)
- role (text default 'author')

### narrators
- id (uuid pk)
- name

### book_narrators
- book_id (fk)
- narrator_id (fk)

### genres
- id (uuid pk)
- name

### book_genres
- book_id (fk)
- genre_id (fk)

### links
- id (uuid pk)
- book_id (fk)
- type (enum-ish text: 'amazon' | 'presave' | 'publisher')
- url

---

## Taxonomy tables

### taxonomy_categories
- id (uuid pk)
- key (text unique)  // e.g., 'sexual_content'
- name (text)        // e.g., 'Sexual content'
- description (text)
- active (bool)

### book_category_ratings
One row per (book, category).
- id (uuid pk)
- book_id (fk)
- category_id (fk)
- intensity (smallint) // 0–4
- notes (text, nullable)
- evidence_level (text) // 'ai_inferred' | 'cited' | 'human_verified'
- updated_by_user_id (uuid, nullable)
- updated_at

Constraints:
- intensity between 0 and 4
- notes required when intensity >= 2 (enforce in app layer first; DB CHECK later)

---

## Citations / evidence

### citations
- id (uuid pk)
- source_type (text) // 'review' | 'excerpt' | 'publisher' | 'user_report' | 'other'
- url (text, nullable)
- quote (text, nullable)
- locator (text, nullable) // e.g. 'chapter 12', 'timestamp 03:21', 'page 184'
- created_at

### rating_citations
Many-to-many between ratings and citations.
- rating_id (fk book_category_ratings)
- citation_id (fk citations)

---

## Users & reading state (login required)

### users
- id (uuid pk)
- email (unique)
- password_hash (or external auth id)
- created_at

### user_book_state
- user_id (fk)
- book_id (fk)
- state (text) // 'tbr' | 'owned' | 'currently_reading' | 'completed' | 'paused' | 'dnf'
- updated_at

### report_corrections
- id (uuid pk)
- user_id (fk, nullable if allow anon later)
- book_id (fk)
- category_id (fk, nullable)
- proposed_intensity (smallint, nullable)
- proposed_notes (text, nullable)
- message (text) // freeform
- status (text) // 'new' | 'triaged' | 'accepted' | 'rejected'
- created_at

---

## Front-end presentation notes
- ISBN is visible on book page but not prominent.
- Add optional “Why we think this” section by reading citations linked to a rating.
- Keep public UI descriptive and non-judgmental; reserve citations for disputes & editorial workflows.
