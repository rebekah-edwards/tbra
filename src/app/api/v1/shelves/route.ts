import { getApiUser } from "@/lib/auth";
import { getUserShelves, getFollowedShelves } from "@/lib/queries/shelves";
import { createShelfFor } from "@/lib/mutations/shelves";
import {
  jsonError,
  jsonOk,
  parseJsonBody,
  asString,
  asOptionalString,
  asOptionalBoolean,
} from "@/lib/api/http";

/**
 * GET /api/v1/shelves
 * All of the signed-in user's shelves (summaries with book counts + mosaic
 * cover URLs), ordered by position, plus the shelves they FOLLOW (the web
 * shelves page's Following tab). Reuses the web query fns.
 */
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const [shelves, followed] = await Promise.all([
    getUserShelves(user.userId),
    getFollowedShelves(user.userId),
  ]);
  return jsonOk({ shelves, followed });
}

/**
 * POST /api/v1/shelves  { name, description?, isPublic?, color? }
 * Create a shelf (premium only). 403 if the account isn't premium; 400 for a
 * bad name or when the shelf limit is reached.
 */
export async function POST(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const body = await parseJsonBody(req);
  const name = body ? asString(body.name) : null;
  if (!name) return jsonError("name is required.", 400);

  const description = body ? asOptionalString(body.description) : undefined;
  const isPublic = body ? asOptionalBoolean(body.isPublic) : undefined;
  const color = body ? asOptionalString(body.color) : undefined;

  const result = await createShelfFor(
    user.userId,
    user.accountType,
    name,
    description ?? undefined,
    isPublic,
    color ?? undefined,
  );

  if (!result.success) {
    const status = result.error === "Premium required" ? 403 : 400;
    return jsonError(result.error ?? "Could not create shelf.", status);
  }
  return jsonOk({ shelfId: result.shelfId, slug: result.slug }, 201);
}
