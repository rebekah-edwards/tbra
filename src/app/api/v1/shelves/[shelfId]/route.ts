import { NextResponse } from "next/server";
import { getApiUser } from "@/lib/auth";
import { getShelfWithBooks } from "@/lib/queries/shelves";

/**
 * GET /api/v1/shelves/:shelfId
 * A single shelf, fully hydrated with its books in position order.
 *
 * Authorization: the owner may view their own (public or private) shelf;
 * other users may view it only if it's public. To avoid leaking the
 * existence of private shelves, an unauthorized/missing shelf both return
 * 404 with the same body.
 */
export async function GET(
  req: Request,
  context: { params: Promise<{ shelfId: string }> },
) {
  const user = await getApiUser(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { shelfId } = await context.params;
  const shelf = await getShelfWithBooks(shelfId);

  if (!shelf || (shelf.userId !== user.userId && !shelf.isPublic)) {
    return NextResponse.json({ error: "Shelf not found." }, { status: 404 });
  }

  return NextResponse.json({ shelf });
}
