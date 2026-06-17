import { db } from "@/db";
import { apiQuotaUsage } from "@/db/schema";
import { and, eq, like, sql } from "drizzle-orm";

/**
 * Get today's date as YYYY-MM-DD in UTC.
 * Using UTC avoids timezone skew between Vercel serverless regions.
 */
function todayUtc(): string {
  return new Date().toISOString().split("T")[0];
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
