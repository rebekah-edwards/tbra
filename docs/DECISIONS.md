# DECISIONS.md — tbr(a) / Spine

Short, dated decisions log. Keep entries crisp: *decision → why → implications*. 

## 2026-02-26
- v0 requires login (persist TBR + reading state).
- v0 core flow: Home (TBR + Recently Read) → Search → Book Page → Report correction.
- Evidence levels: AI Inferred / Cited (internal citations) / Human Verified (full read).

## 2026-03-12
- "Why we think this" citations shown for ALL categories, not just disputed ones. Expandable section on every book page.
- Tech stack: Next.js + SQLite locally for development; swap to PostgreSQL at deploy time. Zero hosting cost until launch.
- Spine defaults to Sonnet 4.6 for cron runs. Escalates to Opus for complex architectural tasks (multi-file refactors, deep design decisions).
- Overnight schedule: Tue/Thu 3 AM ET. Interleaved with Lore (Mon/Wed/Fri 3 AM).
