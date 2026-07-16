import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { resolveAuthor, getAuthorBooks } from "@/lib/queries/authors";
import { isFollowingAuthor, getAuthorFollowerCount } from "@/lib/queries/author-follows";
import { db } from "@/db";
import { authorFollows } from "@/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * GET /api/v1/authors/[id]  (slug or id)
 * The author page payload — same queries as /author/[id].
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { id } = await ctx.params;
  const resolved = await resolveAuthor(id);
  if (!resolved) return jsonError("Author not found.", 404);
  const author = resolved.author;

  const [books, following, followerCount] = await Promise.all([
    getAuthorBooks(author.id),
    isFollowingAuthor(user.userId, author.id),
    getAuthorFollowerCount(author.id),
  ]);

  return jsonOk({
    author: { id: author.id, name: author.name, slug: author.slug, bio: author.bio ?? null },
    isFollowing: following,
    followerCount,
    books,
  });
}

/**
 * POST /api/v1/authors/[id]  { follow: true|false }
 * Follow/unfollow — same writes as the web actions.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { id } = await ctx.params;
  const resolved = await resolveAuthor(id);
  if (!resolved) return jsonError("Author not found.", 404);
  const authorId = resolved.author.id;

  const body = await parseJsonBody(req);
  const follow = body?.follow === true;

  if (follow) {
    const existing = await db
      .select({ userId: authorFollows.userId })
      .from(authorFollows)
      .where(and(eq(authorFollows.userId, user.userId), eq(authorFollows.authorId, authorId)))
      .get();
    if (!existing) {
      await db.insert(authorFollows).values({ userId: user.userId, authorId });
    }
  } else {
    await db
      .delete(authorFollows)
      .where(and(eq(authorFollows.userId, user.userId), eq(authorFollows.authorId, authorId)));
  }
  return jsonOk({ following: follow });
}
