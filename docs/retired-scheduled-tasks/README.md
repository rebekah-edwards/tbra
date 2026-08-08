# Retired Claude scheduled tasks (moved to launchd 2026-07-30)

These three tasks were converted from Claude scheduled tasks to plain launchd
agents. They were purely mechanical — one command each, no judgment — and every
firing left a resident ~380MB claude-code process behind. `user-activity-sync`
alone fires 34×/day; together the three were ~36 of the ~45 daily Claude sessions
that accumulated until the iMac hit load 80 and the dev server took 6-8 min per
request (see memory `project_mac_process_pileup`, incidents 2026-07-27 and
2026-07-30).

| Was | Now | Schedule |
|---|---|---|
| `user-activity-sync` | `com.tbra.user-activity-sync` | every 30 min, quiet 3-9 AM |
| `sitemap-threshold-check` | `com.tbra.sitemap-threshold` | daily 05:36 |
| `nightly-key-health` | `com.tbra.key-health` | daily 06:20 |

Plists live in `~/Library/LaunchAgents/`; all three invoke
`scripts/lib/cron-run.sh <job> <command...>`, which handles logging
(`data/<job>.log`, rotated at 5MB), single-instance locking, and quiet hours.

**The judgment each task's SKILL.md used to describe now lives in the scripts:**
- `sync-user-activity.ts` tracks per-table consecutive failures in
  `data/user-activity-sync-errors.json` and files a deduped `/admin/issues` alert
  at 3 consecutive failures, auto-resolving when the table syncs cleanly again.
  This is the "only escalate if it persists across 3+ runs" rule from the SKILL.
- `sitemap-threshold-check.ts` files an `/admin/issues` alert when the public book
  count crosses a 5K boundary (it previously only wrote a report file that a
  Claude session had to read and relay).
- `check-api-keys.ts` already filed its own alerts — unchanged.

Shared helper: `scripts/lib/admin-alert.ts` (`fileAdminAlert` / `resolveAdminAlert`).

Useful commands:
```
launchctl print gui/501/com.tbra.user-activity-sync   # state, runs, last exit code
launchctl kickstart -p gui/501/com.tbra.key-health    # run one now
tail -f data/user-activity-sync.log
```

The original SKILL.md text is preserved in this directory for reference.
