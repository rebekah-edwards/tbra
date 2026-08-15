import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody, asString } from "@/lib/api/http";
import { setBookStateFor, setBookStateWithCompletionFor, removeBookStateFor } from "@/lib/mutations/reading-state";

const SIMPLE_STATES = ["currently_reading", "paused", "tbr"] as const;
const COMPLETION_STATES = ["completed", "dnf"] as const;
const PRECISIONS = ["exact", "month", "year"] as const;

/**
 * POST /api/v1/reading-state
 * { bookId, state, completionDate?, completionPrecision? }
 *
 * Same state machine as the web: currently_reading/paused/tbr go through
 * setBookStateFor (sessions, pause accounting, Up Next removal);
 * completed/dnf go through setBookStateWithCompletionFor with the
 * completion date + precision from the date picker.
 */
export async function POST(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const body = await parseJsonBody(req);
  const bookId = body ? asString(body.bookId) : null;
  const state = body ? asString(body.state) : null;
  if (!bookId || !state) return jsonError("bookId and state are required.", 400);

  // "none" clears the reading state (web: tapping the active state / current
  // dropdown item) — keeps the row when owned formats exist.
  if (state === "none") {
    try {
      await removeBookStateFor(user.userId, bookId);
    } catch (err) {
      return logAndFail(err, { userId: user.userId, bookId, state });
    }
    return jsonOk({ state: null });
  }

  if ((COMPLETION_STATES as readonly string[]).includes(state)) {
    const completionDate = body ? asString(body.completionDate) : null; // YYYY-MM-DD (or YYYY-MM / YYYY per precision)
    const rawPrecision = body ? asString(body.completionPrecision) : null;
    const completionPrecision =
      rawPrecision && (PRECISIONS as readonly string[]).includes(rawPrecision)
        ? (rawPrecision as (typeof PRECISIONS)[number])
        : completionDate
          ? "exact"
          : null;
    try {
      await setBookStateWithCompletionFor(
        user.userId,
        bookId,
        state as (typeof COMPLETION_STATES)[number],
        completionDate,
        completionPrecision
      );
    } catch (err) {
      return logAndFail(err, { userId: user.userId, bookId, state, completionDate, completionPrecision });
    }
    return jsonOk({ state });
  }

  if (!(SIMPLE_STATES as readonly string[]).includes(state)) {
    return jsonError(`Invalid state. Use one of: ${[...SIMPLE_STATES, ...COMPLETION_STATES].join(", ")}.`, 400);
  }

  try {
    await setBookStateFor(user.userId, bookId, state);
  } catch (err) {
    return logAndFail(err, { userId: user.userId, bookId, state });
  }
  return jsonOk({ state });
}

/**
 * The completion path has already been the site of two production bugs (an
 * activeFormats serialization crash and an unbound userId), and four user
 * reports about "can't mark a book Finished" arrived with nothing on the
 * server to correlate them against. Log enough to identify WHICH user and
 * book failed, then return a real error instead of a 500 the client drops.
 */
function logAndFail(err: unknown, ctx: Record<string, unknown>) {
  console.error("[reading-state] mutation failed", {
    ...ctx,
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack?.split("\n").slice(0, 4).join(" | ") : undefined,
  });
  return jsonError("Couldn't update this book. Please try again.", 500);
}
