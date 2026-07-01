# Hand-off prompt — on-device (Mac) session to build the SwiftUI screens

Copy everything in the box below into a **Claude Code session running on your Mac** (desktop app or CLI — it needs Xcode, the real `data/tbra.db`, and your `.env`). It's written to be self-contained.

---

```
You're picking up the tbr*a project on my Mac to start the native iOS (SwiftUI) app.
Context and the current state are already in the repo — read these first, in order:

  1. docs/ios27-redesign.md        — why we're going native SwiftUI (not Capacitor)
  2. docs/native-api-plan.md        — the architecture: native app + existing
                                      Next.js backend as a JSON API, shared DB
  3. docs/native-api-contract.md    — the exact /api/v1 endpoints, with curl tests
  4. native-ios/README.md           — the draft SwiftUI scaffold and how to use it

Branch: work on `claude/native-ios-api-shelves-upnext` (already pushed; check it out).

WHAT'S ALREADY DONE (by a cloud session, so it's committed but NOT run):
  - A JSON API for Shelves + Up Next under src/app/api/v1/ (auth, reads, writes,
    drag-reorder), sharing logic with the web via src/lib/mutations/.
  - Refresh-token auth (1h access JWT + 60d rotating refresh): src/lib/auth-refresh.ts,
    /api/v1/auth/{login,refresh,logout}. New table auth_refresh_tokens
    (drizzle/0003_auth_refresh_tokens.sql).
  - A draft SwiftUI scaffold in native-ios/ (Models, Keychain, APIClient with
    auto-refresh, AuthStore, and the Up Next + Shelves + Shelf Detail screens with
    drag-to-reorder). It has NOT been compiled — expect small fixes.

DO THESE IN ORDER:

  STEP A — Create the new auth table locally, then VERIFY THE API (do this before
  any Swift). It has never run:
    1. `npm run db:push` to create auth_refresh_tokens in data/tbra.db.
    2. Start the dev server (`npm run dev`).
    3. Run the smoke script at the bottom of docs/native-api-contract.md against a
       real account. Confirm: login returns token+refreshToken+user; /auth/me works;
       shelves and up-next read back; a reorder round-trips; bad/no token → 401;
       /auth/refresh returns a new pair. Fix anything that fails and re-verify.

  STEP B — Stand up the Xcode project:
    1. New Xcode 27 project, SwiftUI App, minimum deployment iOS 27 (the app targets
       the iOS 27 drag-and-drop; Xcode 27 beta + iOS 27 simulator required).
    2. Add all files from native-ios/ to the app target. Set the root to RootView.
    3. Set APIClient.baseURL (http://localhost:3000 reaches a Mac dev server from the
       simulator; add Info.plist NSAppTransportSecurity → NSAllowsLocalNetworking for
       cleartext localhost in dev).
    4. Build. Fix compile errors — most likely spots: the iOS 27 Tab(...) initializer,
       AsyncImage, and @Observable usage. The drag-reorder currently uses List +
       .onMove (correct and idiomatic for single-list reorder; it gets iOS 27's
       improved drag automatically). Only if you specifically want reorder inside a
       custom non-List layout do you need the new .reorderable()/.reorderContainer(for:)
       modifiers — see docs/ios27-redesign.md §2.
    5. Run on an iOS 27 simulator. Log in, confirm shelves + Up Next load and that
       drag-to-reorder persists (kill/reopen the app; order should stick).

  STEP C — Report back with: what compiled as-is, what you had to fix in native-ios/,
  and screenshots of the two screens. Commit fixes to the same branch.

IMPORTANT CONSTRAINTS (from CLAUDE.md — read it):
  - The one hard DB rule: never nuke-and-replace the production database (no wholesale
    wipe / delete-and-re-import of curated data, ever, without an explicit specific ask).
    Everything short of that — schema migrations, incremental writes, deploys — is
    routine and does NOT need per-change approval. For this work: apply the
    auth_refresh_tokens table to production BEFORE the code that uses it ships (ordering
    is for correctness, not permission).
  - Verify visual changes with a screenshot before claiming done.

NOT in scope for this pass (later): Sign in with Apple, cross-shelf drag, and any
screen beyond Shelves + Up Next.
```

---

## Notes for you (not part of the prompt)
- The single most important instruction above is **Step A** — verifying the API on real data before any Swift is written. That's the check the cloud session couldn't run.
- If the Mac session reports the iOS 27 `reorderable()` signatures differ from the notes, that's expected (beta) — the List/`.onMove` approach in the scaffold sidesteps it and still delivers native drag.
- When Shelves + Up Next work, the next slices (reading state, ratings, reviews) follow the exact same pattern documented in `docs/native-api-plan.md`, and can be built back in a cloud session.
