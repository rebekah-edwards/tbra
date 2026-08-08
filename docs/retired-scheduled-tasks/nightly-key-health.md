---
name: nightly-key-health
description: Verify production enrichment API keys (Brave/xAI/ISBNdb/Google Books) are live; alert to /admin/issues on failure.
---

Run the enrichment API key-health canary. Execute this command:

cd /Users/clankeredwards/claude/tbra && npx tsx scripts/check-api-keys.ts

What it does:
- Calls the production endpoint https://thebasedreader.app/api/health/keys (authenticated with ENRICHMENT_SECRET), which exercises the LIVE production env vars for the four enrichment providers: Brave Search, xAI/Grok, ISBNdb, Google Books. This is the only reliable way to detect production key drift — `vercel env pull` cannot read Sensitive vars (they decrypt to empty), and a local .env check says nothing about what production is actually running.
- Brave and xAI are CRITICAL (they hard-block enrichment: no web research → no Grok analysis → no summary/ratings). ISBNdb and Google Books are report-only (they degrade quality but don't block).
- If a CRITICAL provider key is failing in production, it files an /admin/issues alert (Turso, system user clankerinfrastructure@gmail.com, description prefix "[AUTO-FLAG: key-health]"), de-duplicated against any already-open alert, and exits non-zero. It auto-resolves stale alerts when a provider recovers. The DB write uses the Turso guard.

Background: this canary exists because an invalid Brave key sat in Vercel production for ~89 days (the "fix" only ever landed in local .env.local, never pushed to Vercel), silently breaking all new-import enrichment until a user noticed. See memory feedback_brave_disabled.md.

After running, report each provider's status (✓/✗ + HTTP status), and whether any /admin/issues alert was filed. If a critical key is failing, the fix is to rotate that key on Vercel (production + preview + development) via `echo "$KEY" | npx vercel env add <NAME> <env>` then `npx vercel redeploy <latest-prod-url>` — and note that newly-added Vercel vars are stored Sensitive, so verify the fix with a live request to the health endpoint, NOT via `vercel env pull` (which shows Sensitive vars as empty).