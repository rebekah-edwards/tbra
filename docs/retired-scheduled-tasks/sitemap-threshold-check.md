---
name: sitemap-threshold-check
description: Alert when Turso book count crosses a new 5K threshold (for GSC sitemap submission).
---

Run the sitemap-threshold check. Execute this command:

cd /Users/clankeredwards/claude/tbra && npx tsx scripts/sitemap-threshold-check.ts

What it does:
- Read-only against Turso via @libsql/client (.env.vercel.local credentials)
- Counts books where visibility='public'
- Compares against /Users/clankeredwards/claude/tbra/reports/sitemap-threshold-last.json
- If the count has crossed a new 5K boundary since the last run, writes an alert report to reports/sitemap-threshold-{date}.md with next-steps for GSC submission
- Updates the state file regardless

After running, report whether a threshold was crossed. If yes, share the alert report contents. If no, just note the current count and previous count.