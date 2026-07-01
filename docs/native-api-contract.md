# Native API contract — v1 (Shelves + Up Next)

> The exact request/response spec for the `/api/v1` endpoints the SwiftUI app calls, plus copy-paste `curl` tests. Companion to `docs/native-api-plan.md`. Endpoints implemented 2026-06-30 (Steps 1–5). **Live tests must run where the app runs** (a Mac session with the real `data/tbra.db` + `.env`); they cannot run in the cloud container that authored this.

## Conventions

- **Base URL:** `http://localhost:3000` in dev; the production origin otherwise.
- **Auth:** every endpoint except `login` / `refresh` requires an `Authorization: Bearer <token>` header. The `token` is a **short-lived (1-hour) access JWT** from `login`/`refresh`. Alongside it the client gets a **long-lived (60-day) `refreshToken`**; when the access token 401s, POST the refresh token to `/api/v1/auth/refresh` for a new pair (rotation). Both are stored in the iOS Keychain. As long as the app is opened within any 60-day window it stays logged in ("never log out"); `logout` revokes the refresh token.
- **Request bodies** are JSON; send `Content-Type: application/json`.
- **Success** responses are `200` (or `201` for create) with a JSON body. The `/api/v1` shelf + Up Next endpoints wrap data as `{ "ok": true, ... }`; the two `auth` endpoints return the bare object (`{ token, user }` / `{ user }`).
- **Errors** are `{ "error": "<message>" }` with an appropriate status:
  | Status | Meaning |
  |---|---|
  | 400 | Bad/missing input (e.g. no `bookId`, malformed reorder list) |
  | 401 | Missing/expired/invalid token |
  | 403 | Authenticated but not allowed (e.g. creating a shelf without premium) |
  | 404 | Not found, or a shelf the user doesn't own (existence not leaked) |
  | 409 | Capacity conflict (Up Next full) |

---

## Auth

### `POST /api/v1/auth/login`
Body: `{ "email": string, "password": string }`
Success `200`: `{ "token": string, "refreshToken": string, "user": PublicUser }`
Errors: `400` missing fields · `401` invalid credentials (same generic message whether the email exists or the password is wrong).

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"yourpassword"}'
```

### `POST /api/v1/auth/refresh`
Body: `{ "refreshToken": string }`
Success `200`: `{ "token": string, "refreshToken": string }` — a new access token and a new refresh token (the old refresh token is now revoked). Error `401` if the refresh token is unknown/used/expired → the app must send the user back to login.

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/refresh \
  -H 'Content-Type: application/json' \
  -d "{\"refreshToken\":\"$REFRESH\"}"
```

### `POST /api/v1/auth/logout`
Body: `{ "refreshToken": string }` to log out this device, or `{ "all": true }` (with a valid `Authorization` header) to log out everywhere.
Success `200`: `{ "ok": true }` (idempotent).

### `GET /api/v1/auth/me`
Validates a stored access token on app launch.
Success `200`: `{ "user": PublicUser }` · Error `401` (→ try `refresh`, then login).

```bash
curl -s http://localhost:3000/api/v1/auth/me -H "Authorization: Bearer $TOKEN"
```

**`PublicUser`** = `{ id, email, username, displayName, avatarUrl, accountType, emailVerified }` (never includes the password hash or any secret/verification tokens).

---

## Up Next

### `GET /api/v1/up-next`
Success `200`: `{ "ok": true, "items": UpNextItem[] }` — up to 6, ordered by position.
`UpNextItem` = `{ id, bookId, slug, position, title, coverImageUrl, authorName, topLevelGenre, pages, audioLengthMinutes, userRating }`.

```bash
curl -s http://localhost:3000/api/v1/up-next -H "Authorization: Bearer $TOKEN"
```

### `POST /api/v1/up-next`
Body: `{ "bookId": string }`
Success `200`: `{ "ok": true, "position": number, "added": boolean }` (`added:false` if it was already queued).
Errors: `400` missing `bookId` · `409` queue full (max 6).

```bash
curl -s -X POST http://localhost:3000/api/v1/up-next \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"bookId":"BOOK_UUID"}'
```

### `DELETE /api/v1/up-next/:bookId`
Success `200`: `{ "ok": true }` (idempotent — ok even if not queued).

```bash
curl -s -X DELETE http://localhost:3000/api/v1/up-next/BOOK_UUID \
  -H "Authorization: Bearer $TOKEN"
```

### `PUT /api/v1/up-next/order`  ← drag-to-reorder
Body: `{ "bookIds": string[] }` — the **complete** current queue in the new order.
Success `200`: `{ "ok": true }`.
Error `400` if `bookIds` isn't exactly the current queued set (guards the unique-position constraint).

```bash
curl -s -X PUT http://localhost:3000/api/v1/up-next/order \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"bookIds":["UUID_A","UUID_B","UUID_C"]}'
```

---

## Shelves

### `GET /api/v1/shelves`
Success `200`: `{ "ok": true, "shelves": ShelfSummary[] }`, ordered by position.
`ShelfSummary` = `{ id, name, slug, description, color, coverImageUrl, isPublic, position, bookCount, coverUrls[], coverSlugs[], createdAt }`.

### `GET /api/v1/shelves/:shelfId`
Success `200`: `{ "ok": true, "shelf": ShelfDetail }`. Owner sees public/private; others see public only; missing-or-unauthorized → `404`.
`ShelfDetail` = summary fields + `userId` + `books: ShelfBook[]`, where `ShelfBook` = `{ bookId, slug, title, coverImageUrl, authors[], position, note, state, addedAt, userRating, publicationYear, pages, isFiction, genres[], ownedFormats[], aggregateRating }`.

### `POST /api/v1/shelves`
Body: `{ "name": string, "description"?: string, "isPublic"?: boolean, "color"?: string }`
Success `201`: `{ "ok": true, "shelfId": string, "slug": string }`.
Errors: `400` bad name / 50-shelf limit · `403` not premium.

```bash
curl -s -X POST http://localhost:3000/api/v1/shelves \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Summer Reads","isPublic":true,"color":"#a3e635"}'
```

### `PATCH /api/v1/shelves/:shelfId`
Body (any subset): `{ name?, description?, isPublic?, color?, coverImageUrl? }`
Success `200`: `{ "ok": true, "slug": string }` (slug changes if the name changed). Errors: `404` not owner/missing · `400` bad name.

### `DELETE /api/v1/shelves/:shelfId`
Deletes the shelf and its book links (cascade). Owner only.
Success `200`: `{ "ok": true }` · Error `404`.

### `PUT /api/v1/shelves/order`
Body: `{ "shelfIds": string[] }` — the complete set of the user's shelves in the new order.
Success `200`: `{ "ok": true }` · Error `400` if not exactly the user's shelves.

### `POST /api/v1/shelves/:shelfId/books`
Body: `{ "bookId": string, "note"?: string }`
Success `200`: `{ "ok": true, "added": boolean }` (`added:false` if already on the shelf).
Errors: `404` not owner/missing · `400` shelf full (max 500).

### `DELETE /api/v1/shelves/:shelfId/books/:bookId`
Success `200`: `{ "ok": true, "removed": boolean }` · Error `404` not owner/missing.

### `PUT /api/v1/shelves/:shelfId/order`  ← drag-to-reorder
Body: `{ "bookIds": string[] }` — the **complete** set of the shelf's books in the new order. Owner only.
Success `200`: `{ "ok": true }` · Errors: `404` not owner · `400` if not exactly the shelf's current books.

```bash
curl -s -X PUT http://localhost:3000/api/v1/shelves/SHELF_ID/order \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"bookIds":["UUID_A","UUID_B"]}'
```

---

## End-to-end smoke test

Run against a dev server with a real account. Confirms auth + a read + a write round-trip.

```bash
BASE=http://localhost:3000

# 1. Log in and capture the token
TOKEN=$(curl -s -X POST $BASE/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"yourpassword"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')
echo "token: ${TOKEN:0:24}..."

# 2. Validate it
curl -s $BASE/api/v1/auth/me -H "Authorization: Bearer $TOKEN"; echo

# 3. Read shelves + Up Next
curl -s $BASE/api/v1/shelves  -H "Authorization: Bearer $TOKEN"; echo
curl -s $BASE/api/v1/up-next  -H "Authorization: Bearer $TOKEN"; echo

# 4. Negative checks
curl -s -o /dev/null -w "no-token -> %{http_code}\n" $BASE/api/v1/up-next
curl -s -o /dev/null -w "bad-token -> %{http_code}\n" $BASE/api/v1/auth/me -H "Authorization: Bearer garbage"
```

Expected: step 2/3 return `{ "ok": true, ... }` / `{ "user": ... }`; step 4 prints `401` for both.

---

## Not in v1 (future slices)
Cross-shelf move, multi-select drag, bulk remove, shelf-book notes, follow/unfollow, and everything outside Shelves + Up Next (reading state, ratings, reviews, discover, profile). Refresh-token rotation (revocable "log out everywhere") is a **required pre-launch task** — see `docs/native-api-plan.md`.
