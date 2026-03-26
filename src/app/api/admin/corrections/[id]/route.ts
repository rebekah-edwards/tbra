import { NextResponse } from "next/server";
import { db } from "@/db";
import { reportCorrections } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCurrentUser, isAdmin } from "@/lib/auth";

/**
 * PATCH /api/admin/corrections/[id]
 *
 * Update correction status. Body: { status: "triaged" | "rejected" }
 * Use the /apply sub-route to accept + write back to bookCategoryRatings.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const { status } = body as { status: string };

  const allowed = ["triaged", "rejected", "new"];
  if (!allowed.includes(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }

  await db
    .update(reportCorrections)
    .set({ status })
    .where(eq(reportCorrections.id, id));

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/admin/corrections/[id]
 *
 * Hard-delete a correction (admin only).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!isAdmin(user)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  await db.delete(reportCorrections).where(eq(reportCorrections.id, id));

  return NextResponse.json({ ok: true });
}
