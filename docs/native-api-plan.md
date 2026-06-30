# Native API plan — Shelves + Up Next (Phase 1 slice)

> Companion to `docs/ios27-redesign.md`. This is the **first concrete slice** of the JSON API the native SwiftUI app talks to. Scope is deliberately narrow: only what the Shelves and Up Next screens need, because those are the first native screens (the WWDC 2026 drag-and-drop showcase). Written 2026-06-30. **No code changed yet — this is the plan to approve before implementation.**

## Design principles

1. **Additive, no behavior change to web.** Every existing server action keeps working byte-for-byte. We only *extract* logic the actions already run, then call it from two places.
2. **One source of truth per operation.** A plain function holds the logic; the server action (web) and the API route (native) are both thin callers.
3. **Reuse reads as-is.** `src/lib/queries/{shelves,up-next}.ts` are already plain, cookie-free functions. API routes call them directly — no refactor.
4. **The JWT is the bearer token.** Your session is already a `jose` HS256 JWT (`src/lib/auth.ts`); it just lives in a cookie today. Native sends it in `Authorization: Bearer …`. No new token system.
5. **No CORS work.** Native HTTP clients (URLSession) aren't subject to browser CORS, so these routes need no CORS headers for the app. (If we ever call them from a browser on another origin, revisit.)

## Auth shim (the only change to existing auth code)

Refactor `src/lib/auth.ts` so token verification is shared, then add a request-based reader. `getCurrentUser()` keeps its exact current behavior.

```ts
// NEW: shared verifier (extracted from getCurrentUser's body)
export async function verifySessionToken(token: string): Promise<AuthUser | null> { … }

// getCurrentUser() becomes: read cookie -> verifySessionToken(token)   (behavior identical)

// NEW: request-based reader for API routes — header first, cookie fallback
export async function getApiUser(req: Request): Promise<AuthUser | null> {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return verifySessionToken(auth.slice(7));
  return getCurrentUser(); // lets the same routes work from the web too
}
```

**Auth endpoints (new, `/api/v1/auth/`):**
- `POST /api/v1/auth/login` — `{ email, password }` → `{ token, user }`. Reuses `verifyPassword` + `createSession` from `auth.ts`; returns the JWT in the **body** (web login keeps setting the cookie; native reads the body).
- `GET /api/v1/auth/me` — bearer → `{ user }`. Lets the app validate a stored token on launch.
- Sign in with Apple → deferred to a follow-up (required by App Store once Google Sign-In ships; not needed to build/test the screens).

## Where the extracted logic lives

- **Reads:** stay in `src/lib/queries/` (already reusable). No new files.
- **Writes:** new `src/lib/mutations/{shelves,up-next}.ts` holding plain `userId`-taking functions. The existing `src/lib/actions/{shelves,up-next}.ts` become thin wrappers: `getCurrentUser()` → call the mutation → `revalidatePath(...)`. `revalidatePath` is web-only and stays in the action wrapper (irrelevant to native).

Example of the split (reorder books within a shelf):

```ts
// src/lib/mutations/shelves.ts  (plain, shared)
export async function reorderShelfBooksFor(userId: string, shelfId: string, bookIds: string[]) { …current logic… }

// src/lib/actions/shelves.ts  (web wrapper — same signature/behavior as today)
export async function reorderShelfBooks(shelfId: string, bookIds: string[]) {
  const user = await getCurrentUser(); if (!user) return { success: false };
  const r = await reorderShelfBooksFor(user.userId, shelfId, bookIds);
  revalidatePath(`/library/shelves/${…}`); return r;
}

// src/app/api/v1/shelves/[shelfId]/order/route.ts  (native)
export async function PUT(req, { params }) {
  const user = await getApiUser(req); if (!user) return json(401);
  const { bookIds } = await req.json();
  await reorderShelfBooksFor(user.userId, params.shelfId, bookIds);
  return json({ ok: true });
}
```

## Endpoint set (v1 — Shelves + Up Next only)

Base path `/api/v1/`. JSON in/out. `200/4xx` status codes; errors as `{ error: string }`.

### Up Next
| Method | Path | Body | Core fn |
|---|---|---|---|
| GET | `/up-next` | — | `getUserUpNext(userId)` *(exists)* |
| POST | `/up-next` | `{ bookId }` | `addToUpNextFor` |
| DELETE | `/up-next/{bookId}` | — | `removeFromUpNextFor` |
| PUT | `/up-next/order` | `{ bookIds: [...] }` | `reorderUpNextFor` **(new, array-based)** |

> **API mismatch to fix:** today's `reorderUpNext(bookId, newPosition)` is single-item. The native drag gesture produces a **whole new order array** (same as shelves). I'll add an array-based `reorderUpNextFor(userId, bookIds)` and have both the new web action and the API use it. The old single-item action can stay or be retired — your call.

### Shelves
| Method | Path | Body | Core fn |
|---|---|---|---|
| GET | `/shelves` | — | `getUserShelves(userId)` *(exists)* |
| GET | `/shelves/{shelfId}` | — | `getShelfWithBooks` *(exists)* + ownership/public check |
| POST | `/shelves` | `{ name, description?, isPublic?, color? }` | `createShelfFor` (premium-gated) |
| PATCH | `/shelves/{shelfId}` | `{ name?, description?, isPublic?, color? }` | `updateShelfFor` |
| DELETE | `/shelves/{shelfId}` | — | `deleteShelfFor` |
| PUT | `/shelves/order` | `{ shelfIds: [...] }` | `reorderShelvesFor` |
| POST | `/shelves/{shelfId}/books` | `{ bookId, note? }` | `addBookToShelfFor` |
| DELETE | `/shelves/{shelfId}/books/{bookId}` | — | `removeBookFromShelfFor` |
| PUT | `/shelves/{shelfId}/order` | `{ bookIds: [...] }` | `reorderShelfBooksFor` |

> **Out of scope (decided 2026-06-30):** cross-shelf drag (dragging a book from one shelf onto another) is **not** part of this design. Drag-and-drop is used only for *reordering within* a single list — Up Next and within one shelf. Adding/removing a book to/from a shelf stays a tap action, not a drag.

### Authorization notes
- `getShelfWithBooks` returns `userId` but does **not** itself enforce access. The route must allow it only if the requester owns the shelf **or** the shelf `isPublic`. (Web enforces this at the page level today; the API must do it explicitly.)
- `createShelfFor` keeps the existing `hasPremiumAccess` gate.

## What I will NOT touch in this slice
- No SwiftUI/Xcode code (can't build it here — that's your Mac).
- No changes to reading-state, ratings, reviews, follows, discover, etc. — later slices.
- No deploy. Local-only until you review.

## Implementation order (each step independently verifiable)
1. **Auth shim** — `verifySessionToken` + `getApiUser`; refactor `getCurrentUser` to use the shared verifier. Verify web login still works unchanged.
2. **Auth endpoints** — `POST /api/v1/auth/login`, `GET /api/v1/auth/me`. Verify with `curl` (email/password → token → `me`).
3. **Read endpoints** — `/up-next`, `/shelves`, `/shelves/{id}` (calling existing query fns). `curl` with a bearer token.
4. **Extract write mutations** — move action bodies into `src/lib/mutations/`, rewire the actions as wrappers. Confirm web shelves/Up Next still behave identically. **Correctness invariant (must preserve):** the existing two-phase renumbering — move every row to a temporary negative position, then back to a clean `1..N` — is what prevents the `UNIQUE(user_id, position)` collisions and the "a position is mysteriously empty / order breaks" bug. This logic (`compactUpNext` in up-next; the negative-then-final loops in shelf reorder) is carried over **verbatim**, not rewritten.
5. **Write endpoints** — reorder/add/remove/move for both surfaces, including the new array reorder + cross-shelf move.
6. **Hand-off doc** — request/response examples for each endpoint so the SwiftUI side has a contract to code against.

## Decisions I need from you (defaults in bold — I'll proceed with these unless you say otherwise)
- **`/api/v1/` path prefix** for the native API (keeps it separate from existing internal `/api/*`, room to evolve). ✅ confirmed
- Up Next reorder uses the whole-new-order approach (internal detail, no user-facing effect). ✅ no decision needed
- **Token lifetime: aim for "never log out"** (user preference, 2026-06-30). Staged: **(A)** ship a long-lived access token now for build/test, **(B)** implement proper **refresh-token rotation** (silent renewal + revocable "log out everywhere") as a **required pre-launch task** before App Store submission. Refresh tokens add ~100–150 lines + one schema table (`auth_refresh_tokens`) + refresh/logout endpoints. The on-device token is stored in the iOS Keychain (OS-encrypted); the password is never in the token (stays bcrypt-hashed server-side).
