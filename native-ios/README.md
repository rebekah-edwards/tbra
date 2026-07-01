# tbr*a — native iOS (SwiftUI) draft

**Status:** DRAFT scaffold, authored on Linux — **not yet opened in Xcode or compiled.** Treat every file here as a strong starting point to paste into an Xcode 27 project, not as build-verified code. Signatures for the iOS 27 drag-and-drop APIs (`reorderable`, `reorderContainer`) are from WWDC 2026 notes and may need small adjustments against the actual SDK.

## What this is
The Shelves + Up Next screens (the first native surfaces) coded against the JSON API in `docs/native-api-contract.md`. It talks to the existing Next.js backend — there is no separate server.

## Requirements
- **Xcode 27** (beta) + an iOS 27 simulator/device — the drag-and-drop APIs are iOS 27-only.
- The tbr*a backend running (dev: `npm run dev` on the Mac, or point `APIClient.baseURL` at production).

## Files
| File | Purpose |
|---|---|
| `Models.swift` | `Codable` structs mirroring the API contract (PublicUser, UpNextItem, ShelfSummary, ShelfDetail, ShelfBook) + response envelopes |
| `Keychain.swift` | Minimal Keychain wrapper — stores the access + refresh tokens (OS-encrypted) |
| `APIClient.swift` | `URLSession` client with bearer auth and **automatic access-token refresh on 401** (rotation) |
| `AuthStore.swift` | `@Observable` session: login / logout / launch session-restore |
| `UpNextView.swift` | The queue, with iOS 27 drag-to-reorder |
| `ShelvesView.swift` | Shelf list |
| `ShelfDetailView.swift` | One shelf's books, with iOS 27 drag-to-reorder |

## First steps on the Mac
1. **Verify the API first** — run the smoke script in `docs/native-api-contract.md` against your dev server. Don't build Swift on an unverified backend.
2. New Xcode 27 project (SwiftUI App, min iOS 27), add these files.
3. Set `APIClient.baseURL`. On the simulator, `http://localhost:3000` reaches a Mac-hosted dev server. Add an ATS exception for cleartext localhost during dev (Info.plist `NSAllowsLocalNetworking`).
4. Set the app's root view to `RootView` (in `AuthStore.swift`).

## Reorder contract reminder
The reorder endpoints require the **complete** current ordering. Each view rebuilds the full ordered ID list from local state after a move and sends that — see the `reorder` calls in the two views.
