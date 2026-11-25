import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import {
  getBuddyReadBySlug,
  getBuddyReadDetail,
  getBuddyReadMessages,
  isBuddyReadMember,
} from "@/lib/queries/buddy-reads";
import { leaveBuddyReadFor, postBuddyReadMessageFor } from "@/lib/actions/buddy-reads";
import { setBuddyReadStatusFor } from "@/lib/mutations/buddy-reads";

/** GET /api/v1/buddy-reads/[slug] — detail + members + discussion. */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { slug } = await ctx.params;
  const row = await getBuddyReadBySlug(slug);
  if (!row) return jsonError("Buddy read not found.", 404);

  const [detail, messages, membership] = await Promise.all([
    getBuddyReadDetail(row.id),
    getBuddyReadMessages(row.id, 100, 0, user.userId),
    isBuddyReadMember(row.id, user.userId),
  ]);
  if (!detail) return jsonError("Buddy read not found.", 404);

  return jsonOk({ detail, messages, membership });
}

/**
 * POST /api/v1/buddy-reads/[slug]
 *  { message }      → post to the discussion
 *  { leave: true }  → leave the buddy read
 *  { status: "completed" | "active" | "archived" } → host marks it finished,
 *                      reopens it, or cancels it (soft; hidden from lists)
 */
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { slug } = await ctx.params;
  const row = await getBuddyReadBySlug(slug);
  if (!row) return jsonError("Buddy read not found.", 404);

  const body = await parseJsonBody(req);
  if (!body) return jsonError("Invalid JSON body.", 400);

  if (body.leave === true) {
    const result = await leaveBuddyReadFor(user.userId, row.id);
    if (!result.success) return jsonError(result.error ?? "Couldn't leave.", 400);
    return jsonOk({ left: true });
  }

  if (body.status === "completed" || body.status === "active" || body.status === "archived") {
    const result = await setBuddyReadStatusFor(user.userId, row.id, body.status);
    if (!result.success) return jsonError(result.error ?? "Couldn't update.", 400);
    return jsonOk({ status: body.status });
  }

  if (typeof body.message === "string") {
    const result = await postBuddyReadMessageFor(user.userId, row.id, body.message);
    if (!result.success) return jsonError(result.error ?? "Couldn't post.", 400);
    return jsonOk({ posted: true });
  }

  return jsonError("Provide { message }, { leave } or { status }.", 400);
}
