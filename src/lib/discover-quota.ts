import { db } from "@/db";
import { discoverUsage } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";

/** Free accounts get this many Find My Next Read searches per calendar
 *  month; Based Reader (premium) is unlimited. */
export const FREE_DISCOVER_SEARCHES_PER_MONTH = 3;

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7); // 'YYYY-MM'
}

export async function getDiscoverRemaining(userId: string): Promise<number> {
  const row = await db
    .select({ count: discoverUsage.count })
    .from(discoverUsage)
    .where(and(eq(discoverUsage.userId, userId), eq(discoverUsage.month, currentMonth())))
    .get();
  return Math.max(0, FREE_DISCOVER_SEARCHES_PER_MONTH - (row?.count ?? 0));
}

/** Spend one free search. Returns whether the search may proceed and how
 *  many remain AFTER this one. */
export async function consumeDiscoverSearch(
  userId: string
): Promise<{ allowed: boolean; remaining: number }> {
  const month = currentMonth();
  const row = await db
    .select({ count: discoverUsage.count })
    .from(discoverUsage)
    .where(and(eq(discoverUsage.userId, userId), eq(discoverUsage.month, month)))
    .get();
  const used = row?.count ?? 0;
  if (used >= FREE_DISCOVER_SEARCHES_PER_MONTH) {
    return { allowed: false, remaining: 0 };
  }
  await db
    .insert(discoverUsage)
    .values({ userId, month, count: 1, updatedAt: new Date().toISOString() })
    .onConflictDoUpdate({
      target: [discoverUsage.userId, discoverUsage.month],
      set: { count: sql`${discoverUsage.count} + 1`, updatedAt: new Date().toISOString() },
    });
  return { allowed: true, remaining: FREE_DISCOVER_SEARCHES_PER_MONTH - used - 1 };
}
