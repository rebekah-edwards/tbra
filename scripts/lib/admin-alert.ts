/**
 * admin-alert.ts — file and auto-resolve deduped /admin/issues alerts on Turso.
 *
 * Extracted 2026-07-30 when `user-activity-sync`, `sitemap-threshold-check` and
 * `nightly-key-health` moved off the Claude scheduled-task runner and onto
 * launchd (see scripts/lib/install-cron-jobs.sh). Those tasks used to rely on a
 * Claude session reading their stdout and deciding whether something needed
 * Rebekah's attention; under launchd nobody reads stdout, so anything that needs
 * a human has to land in /admin/issues on its own.
 *
 * The dedupe/auto-resolve pattern here is lifted from check-api-keys.ts, which
 * has been running it since 2026-06-20.
 *
 * Callers pass their OWN guarded client — do not create a second turso-guard
 * inside a script that already holds one (the PID lockfile is per-name, but a
 * second connection pool is pure waste).
 */

const SYSTEM_USER_EMAIL = "clankerinfrastructure@gmail.com";

type RemoteClient = {
  execute: (q: { sql: string; args?: any[] }) => Promise<any>;
};

/** Resolve the system user's id, or null if it isn't on Turso. */
async function systemUserId(remote: RemoteClient): Promise<string | null> {
  const r = await remote.execute({
    sql: "SELECT id FROM users WHERE email = ? LIMIT 1",
    args: [SYSTEM_USER_EMAIL],
  });
  return r.rows.length ? (r.rows[0].id as string) : null;
}

/**
 * File an alert under `[AUTO-FLAG: <tag>] <key>` unless one is already open.
 * Returns true if a new row was inserted.
 */
export async function fileAdminAlert(
  remote: RemoteClient,
  opts: { tag: string; key: string; description: string },
): Promise<boolean> {
  const prefix = `[AUTO-FLAG: ${opts.tag}] ${opts.key}`;
  const existing = await remote.execute({
    sql: `SELECT 1 FROM reported_issues
          WHERE status IN ('new','in_progress') AND description LIKE ? LIMIT 1`,
    args: [`${prefix}%`],
  });
  if (existing.rows.length) return false;

  const userId = await systemUserId(remote);
  if (!userId) {
    console.error(`[admin-alert] system user ${SYSTEM_USER_EMAIL} not on Turso — cannot file "${prefix}"`);
    return false;
  }
  await remote.execute({
    sql: `INSERT INTO reported_issues (id, user_id, book_id, description, status, created_at)
          VALUES (?, ?, NULL, ?, 'new', datetime('now'))`,
    args: [crypto.randomUUID(), userId, `${prefix} — ${opts.description}`],
  });
  return true;
}

/**
 * Resolve any open alert for `<tag> <key>`. Returns how many rows were closed.
 */
export async function resolveAdminAlert(
  remote: RemoteClient,
  opts: { tag: string; key: string; resolution: string },
): Promise<number> {
  const r = await remote.execute({
    sql: `UPDATE reported_issues SET status='resolved', resolved_at=datetime('now'), resolution=?
          WHERE status IN ('new','in_progress') AND description LIKE ?`,
    args: [opts.resolution, `[AUTO-FLAG: ${opts.tag}] ${opts.key}%`],
  });
  return Number(r.rowsAffected ?? 0);
}
