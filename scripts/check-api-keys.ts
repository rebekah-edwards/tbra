/**
 * nightly-key-health canary
 *
 * Calls the production /api/health/keys endpoint (which exercises the LIVE
 * production env vars — the only way to detect key drift, since Sensitive vars
 * can't be read back via `vercel env pull`). If a CRITICAL provider (Brave or
 * xAI — the two that hard-block enrichment) is failing, it files an /admin/issues
 * alert so a dead/expired key is caught within 24h instead of via a user report
 * weeks later.
 *
 * Background: on 2026-06-20 an invalid Brave key had been live in production for
 * ~89 days, silently breaking all new-import enrichment, because the "fix" only
 * ever updated local .env.local and was never pushed to Vercel. This canary is
 * the durable backstop against a repeat.
 *
 * Read-only against the providers; the only DB write is the alert row, so it uses
 * the Turso guard per the project's script-safety rule.
 */
import { config } from "dotenv";
config({ path: ".env.vercel.local" }); // Turso creds + ENRICHMENT_SECRET
config({ path: ".env.local" });        // fallback for any locally-defined secret

import { createGuardedTurso } from "./lib/turso-guard";

const PROD_URL = process.env.KEY_HEALTH_URL || "https://thebasedreader.app/api/health/keys";
const SYSTEM_USER_EMAIL = "clankerinfrastructure@gmail.com";
const FLAG_PREFIX = "[AUTO-FLAG: key-health]";

type ProviderHealth = { present: boolean; ok: boolean; status: number | null; detail: string };
type HealthResponse = {
  ok: boolean;
  providers: Record<string, ProviderHealth>;
  criticalProviders: string[];
};

(async () => {
  const secret = process.env.ENRICHMENT_SECRET;
  if (!secret) {
    console.error("ENRICHMENT_SECRET not set — cannot authenticate to health endpoint");
    process.exit(1);
  }

  console.log(`Checking production key health → ${PROD_URL}`);
  let health: HealthResponse;
  try {
    const res = await fetch(PROD_URL, { headers: { "x-enrichment-secret": secret } });
    health = (await res.json()) as HealthResponse;
    console.log(`HTTP ${res.status} — overall ok=${health.ok}`);
  } catch (e) {
    console.error("Failed to reach health endpoint:", (e as Error).message);
    process.exit(1);
  }

  const critical = health.criticalProviders ?? ["brave", "xai"];
  for (const [name, p] of Object.entries(health.providers ?? {})) {
    const tag = critical.includes(name) ? "CRITICAL" : "info";
    console.log(`  ${p.ok ? "✓" : "✗"} ${name} [${tag}] status=${p.status ?? "-"} ${p.detail}`);
  }

  const failures = critical.filter((name) => health.providers?.[name] && !health.providers[name].ok);

  const { remote } = await createGuardedTurso({
    name: "check-api-keys",
    maxRuntimeMs: 5 * 60 * 1000,
    queryTimeoutMs: 30_000,
  });

  const sysUser = await remote.execute({
    sql: "SELECT id FROM users WHERE email = ? LIMIT 1",
    args: [SYSTEM_USER_EMAIL],
  });
  if (!sysUser.rows.length) {
    console.error(`System user (${SYSTEM_USER_EMAIL}) not found on Turso — cannot file alert`);
    process.exit(1);
  }
  const userId = sysUser.rows[0].id as string;

  // Auto-resolve stale alerts for providers that have recovered.
  const recovered = critical.filter((name) => health.providers?.[name]?.ok);
  for (const name of recovered) {
    const r = await remote.execute({
      sql: `UPDATE reported_issues SET status='resolved', resolved_at=datetime('now'), resolution=?
            WHERE status IN ('new','in_progress') AND description LIKE ?`,
      args: [`Recovered: ${name} key healthy as of canary run`, `${FLAG_PREFIX} ${name}%`],
    });
    if (r.rowsAffected > 0) console.log(`Auto-resolved ${r.rowsAffected} stale ${name} alert(s)`);
  }

  let filed = 0;
  for (const name of failures) {
    const p = health.providers[name];
    // Dedupe: skip if an open alert for this provider already exists.
    const existing = await remote.execute({
      sql: `SELECT 1 FROM reported_issues
            WHERE status IN ('new','in_progress') AND description LIKE ? LIMIT 1`,
      args: [`${FLAG_PREFIX} ${name}%`],
    });
    if (existing.rows.length) {
      console.log(`Alert for ${name} already open — not duplicating`);
      continue;
    }
    const impact = name === "turso"
      ? `The production database connection is failing — a rotated/expired Turso auth token not pushed to Vercel takes the whole app down.`
      : `Enrichment is blocked for new imports until this key is rotated on Vercel.`;
    const desc = `${FLAG_PREFIX} ${name} FAILING in production (status=${p.status ?? "-"}: ${p.detail}). `
      + `${impact} `
      + `Verify with: curl -s "${PROD_URL}" -H "x-enrichment-secret: $ENRICHMENT_SECRET".`;
    await remote.execute({
      sql: `INSERT INTO reported_issues (id, user_id, book_id, description, status, created_at)
            VALUES (?, ?, NULL, ?, 'new', datetime('now'))`,
      args: [crypto.randomUUID(), userId, desc],
    });
    filed++;
    console.log(`Filed /admin/issues alert for ${name}`);
  }

  console.log(`\nDone. Critical failures: ${failures.length}; alerts filed: ${filed}.`);
  // Non-zero exit on unresolved critical failure so the scheduled-task run surfaces it too.
  process.exit(failures.length > 0 ? 2 : 0);
})();
