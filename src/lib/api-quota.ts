import { db } from "@/db";
import { apiQuotaUsage } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";

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
