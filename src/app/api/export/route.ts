import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, isPremium } from "@/lib/auth";
import { generateCSV, generateJSON } from "@/lib/export-data";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const format = request.nextUrl.searchParams.get("format") ?? "csv";

  if (format === "json") {
    if (!isPremium(user)) {
      return NextResponse.json(
        { error: "Full export requires a Based Reader subscription" },
        { status: 403 }
      );
    }

    const data = await generateJSON(user.userId);
    const json = JSON.stringify(data, null, 2);
    const filename = `tbra-export-${new Date().toISOString().split("T")[0]}.json`;

    return new NextResponse(json, {
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // Default: CSV
  const csv = await generateCSV(user.userId);
  const filename = `tbra-library-${new Date().toISOString().split("T")[0]}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
