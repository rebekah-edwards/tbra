import { NextResponse } from "next/server";
import { db } from "@/db";
import { reportedIssues } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser } from "@/lib/auth";

/**
 * POST /api/issues/{id}/resolve
 *
 * Updates an issue's status and resolution notes.
 * Body: { resolution: string, status: 'resolved' | 'wontfix' | 'in_progress' }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { resolution, status } = body as {
    resolution?: string;
    status?: string;
  };

  if (!status || !["resolved", "wontfix", "in_progress"].includes(status)) {
    return NextResponse.json(
      { error: "Invalid status. Must be 'resolved', 'wontfix', or 'in_progress'." },
      { status: 400 }
    );
  }

  const existing = await db
    .select({ id: reportedIssues.id })
    .from(reportedIssues)
    .where(eq(reportedIssues.id, id))
    .get();

  if (!existing) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  const updates: Record<string, string | null> = { status };
  if (resolution) updates.resolution = resolution;
  if (status === "resolved" || status === "wontfix") {
    updates.resolvedAt = new Date().toISOString();
  }

  await db.update(reportedIssues)
    .set(updates)
    .where(eq(reportedIssues.id, id))
    .run();

  return NextResponse.json({ success: true });
}
