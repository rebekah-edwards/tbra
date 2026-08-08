---
name: user-activity-sync
description: Bidirectional user-activity sync between local SQLite and production Turso (30-min cadence)
---

Run the bidirectional user-activity sync between the local tbr*a SQLite database and production Turso:

```
cd /Users/clankeredwards/claude/tbra && npx tsx scripts/sync-user-activity.ts
```

This keeps reading activity (sessions, states, ratings, reviews, notes, goals, up-next queues) converged between the native iOS app (which writes to the local DB via the v1 API) and the live web app (which writes to Turso). It is guarded by turso-guard (PID lockfile `/tmp/tbra-sync-user-activity.lock`, 15-min ceiling, 30s query timeout) and has a built-in ghost filter — it only pushes rows owned by the two app accounts, so it can never resurrect live-side deletions.

Interpretation of output:
- Lines like `✓ reading_sessions →local 2, →live 1` are normal activity.
- `in sync` everywhere is the common healthy result.
- If it exits non-zero or prints repeated errors for the SAME table across multiple runs (a one-off FOREIGN KEY error can just mean a brand-new locally-created book/edition hasn't been pushed by the nightly chain yet — those self-heal), file a deduped issue via /admin/issues ONLY if the same error persists across 3+ consecutive runs. Otherwise do nothing.
- If the lockfile blocks the run (another sync in progress), exit quietly — the next half-hour run covers it.

Do not run any other sync scripts from this task. Do not modify the database directly.