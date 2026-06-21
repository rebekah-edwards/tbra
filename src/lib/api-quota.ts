import { db } from "@/db";
import { apiQuotaUsage } from "@/db/schema";
import { and, eq, like, sql } from "drizzle-orm";
import { createClient, type Client } from "@libsql/client";

/**
 * Get today's date as YYYY-MM-DD in UTC.
 * Using UTC avoids timezone skew between Vercel serverless regions.
 */
function todayUtc(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Shared (cross-environment) quota counter.
 *
 * The money-bound Brave budget must be enforced against ONE counter, but `@/db`
 * resolves to local SQLite in standalone scripts and to Turso in production — so
 * left alone, the nightly local jobs and the production enrichment paths keep two
 * separate counters on the SAME Brave subscription, and combined spend can blow
 * past $505/mo without either guard tripping.
 *
 * This client always talks to Turso (the one shared store). It reads a DEDICATED
 * env var (QUOTA_TURSO_URL) so adding it to scripts' `.env.local` does NOT flip
 * `@/db` to Turso (that switch keys off TURSO_DATABASE_URL). In production, where
 * TURSO_DATABASE_URL is already set, it falls back to that automatically. If no
 * creds are present, callers fall back to the local `db` (graceful degradation).
 */
let _sharedClient: Client | null | undefined;
function sharedQuotaClient(): Client | null {
  if (_sharedClient !== undefined) return _sharedClient;
  const url = process.env.QUOTA_TURSO_URL || process.env.TURSO_DATABASE_URL;
  const authToken = process.env.QUOTA_TURSO_TOKEN || process.env.TURSO_AUTH_TOKEN;
  if (!url) return (_sharedClient = null);
  try {
    _sharedClient = createClient({ url, authToken });
  } catch {
    _sharedClient = null;
  }
  return _sharedClient;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("shared quota timeout")), ms)),
  ]);
}

/**
 * Atomically increment the daily quota counter for an API.
 * Returns true if the increment succeeded (quota not yet exceeded),
 * false if the daily limit has been reached.
 *
 * Uses an INSERT ... ON CONFLICT to avoid race conditions.
 */
export async function consumeApiQuota(
  apiName: string,
  dailyMax: number,
): Promise<boolean> {
  const date = todayUtc();

  // Check current count first to short-circuit if already at limit
  const existing = await db
    .select({ count: apiQuotaUsage.count })
    .from(apiQuotaUsage)
    .where(and(eq(apiQuotaUsage.apiName, apiName), eq(apiQuotaUsage.date, date)))
    .get();

  if (existing && existing.count >= dailyMax) {
    return false;
  }

  // Upsert: insert new row if missing, otherwise increment
  await db
    .insert(apiQuotaUsage)
    .values({ apiName, date, count: 1 })
    .onConflictDoUpdate({
      target: [apiQuotaUsage.apiName, apiQuotaUsage.date],
      set: { count: sql`${apiQuotaUsage.count} + 1` },
    });

  return true;
}

/**
 * Atomically consume one unit of quota subject to BOTH a daily and a
 * month-to-date cap. Returns { ok: true } when the call is allowed (and the
 * daily counter was incremented), or { ok: false, reason } when either cap is
 * already reached.
 *
 * Used for Brave Search, where the binding constraint is the monthly spend
 * ($505/mo ÷ $5 per 1,000 = 101,000 calls/mo) alongside a daily smoothing cap.
 * The monthly total is summed over all daily rows in the current YYYY-MM.
 */
export async function consumeApiQuotaWithMonthly(
  apiName: string,
  dailyMax: number,
  monthlyMax: number,
): Promise<{ ok: boolean; reason?: "daily" | "monthly"; dailyCount: number; monthlyCount: number }> {
  const date = todayUtc();
  const month = date.slice(0, 7); // YYYY-MM

  // Shared Turso counter — one budget across local nightly jobs + production.
  const shared = sharedQuotaClient();
  if (shared) {
    try {
      const m = await withTimeout(shared.execute({
        sql: "SELECT COALESCE(SUM(count), 0) AS total FROM api_quota_usage WHERE api_name = ? AND date LIKE ?",
        args: [apiName, `${month}%`],
      }), 10_000);
      const monthlyCount = Number(m.rows[0]?.total ?? 0);
      const d = await withTimeout(shared.execute({
        sql: "SELECT count FROM api_quota_usage WHERE api_name = ? AND date = ?",
        args: [apiName, date],
      }), 10_000);
      const dailyCount = Number(d.rows[0]?.count ?? 0);

      if (monthlyCount >= monthlyMax) return { ok: false, reason: "monthly", dailyCount, monthlyCount };
      if (dailyCount >= dailyMax) return { ok: false, reason: "daily", dailyCount, monthlyCount };

      await withTimeout(shared.execute({
        sql: "INSERT INTO api_quota_usage (api_name, date, count) VALUES (?, ?, 1) ON CONFLICT(api_name, date) DO UPDATE SET count = count + 1",
        args: [apiName, date],
      }), 10_000);
      return { ok: true, dailyCount: dailyCount + 1, monthlyCount: monthlyCount + 1 };
    } catch (e) {
      // Turso unreachable — degrade to the local counter rather than break
      // enrichment. Rare; logged so it's visible if it becomes chronic.
      console.warn(`[api-quota] shared Turso counter failed for ${apiName}, using local db:`, (e as Error).message);
    }
  }

  // Month-to-date total across every daily row in this month.
  const monthRow = await db
    .select({ total: sql<number>`COALESCE(SUM(${apiQuotaUsage.count}), 0)` })
    .from(apiQuotaUsage)
    .where(and(eq(apiQuotaUsage.apiName, apiName), like(apiQuotaUsage.date, `${month}%`)))
    .get();
  const monthlyCount = monthRow?.total ?? 0;

  const dayRow = await db
    .select({ count: apiQuotaUsage.count })
    .from(apiQuotaUsage)
    .where(and(eq(apiQuotaUsage.apiName, apiName), eq(apiQuotaUsage.date, date)))
    .get();
  const dailyCount = dayRow?.count ?? 0;

  if (monthlyCount >= monthlyMax) return { ok: false, reason: "monthly", dailyCount, monthlyCount };
  if (dailyCount >= dailyMax) return { ok: false, reason: "daily", dailyCount, monthlyCount };

  await db
    .insert(apiQuotaUsage)
    .values({ apiName, date, count: 1 })
    .onConflictDoUpdate({
      target: [apiQuotaUsage.apiName, apiQuotaUsage.date],
      set: { count: sql`${apiQuotaUsage.count} + 1` },
    });

  return { ok: true, dailyCount: dailyCount + 1, monthlyCount: monthlyCount + 1 };
}

/**
 * Read the current count without incrementing.
 * Useful for dashboards or admin monitoring.
 */
export async function getApiQuotaUsage(apiName: string): Promise<number> {
  const date = todayUtc();
  const row = await db
    .select({ count: apiQuotaUsage.count })
    .from(apiQuotaUsage)
    .where(and(eq(apiQuotaUsage.apiName, apiName), eq(apiQuotaUsage.date, date)))
    .get();
  return row?.count ?? 0;
}
