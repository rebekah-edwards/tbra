import { NextRequest, NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { generateCSV, generateJSON } from "@/lib/export-data";

/**
 * GET /api/v1/export?format=csv|json — bearer twin of /api/export for the
 * native app's Export Your Data cards. Same premium gate on JSON.
 */
export async function GET(req: NextRequest) {
  const user = await getApiUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const format = req.nextUrl.searchParams.get("format") ?? "csv";
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === "json") {
    const row = await db.select({ accountType: users.accountType })
      .from(users).where(eq(users.id, user.userId)).get();
    if (!row || !["premium", "beta_tester", "admin", "super_admin"].includes(row.accountType)) {
      return NextResponse.json({ error: "Full export requires a Based Reader subscription" }, { status: 403 });
    }
    const data = await generateJSON(user.userId);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="tbra-export-${stamp}.json"`,
      },
    });
  }

  const csv = await generateCSV(user.userId);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="tbra-library-${stamp}.csv"`,
    },
  });
}
