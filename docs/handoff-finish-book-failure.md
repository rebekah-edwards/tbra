# Handoff: "can't mark a book Finished"

**Status:** open. 4 user reports, all still `status='new'` in `reported_issues`.
**Written:** 2026-08-14, from the nightly-report-triage run.
**Scope:** the Finished/DNF completion flow, web + native iOS.

---

## 1. The reports

| # | When (created_at, UTC) | Surface | What they said |
|---|---|---|---|
| 1 | 2026-07-24 13:44 | web, `/` | "Something went wrong" screen, reference code `3639975603` |
| 2 | 2026-07-31 15:12 | web, Mouseheart Vol. 1 | same, reference `3423654888` |
| 3 | 2026-07-31 23:14 | web, `/` | "haven't been able to mark any books finished in several days" — laptop *and* phone |
| 4 | 2026-08-04 14:35 | iOS / TestFlight `tf:AEH_mBUJuGDYsjDIqpStAuQ` | stuck in **pending**; tried 100% progress *and* the Finished pill; refreshing hangs; navigating away and back shows the **old status** |

Screenshots for #4: `data/testflight-feedback/AEH_mBUJuGDYsjDIqpStAuQ-*.jpg` (the App Store Connect URLs in the report body have expired).

### The timeline is the single most important fact here

`ec28222` ("Fix crash on Finished / save review / helpful vote (unbound userId)") landed **2026-08-01 02:49 -0400**.

- Reports **1, 2, 3 all predate it.** They are almost certainly the bug that commit fixed.
- Report **4 is the only post-fix report**, it is **iOS-only**, and its symptom is *different*: not a crash screen, but a silent no-op that reverts.

So do **not** start from "the web finish flow is still broken." There is no post-`ec28222` evidence for that. Start from iOS. If you want to close reports 1–3, the correct move is to verify the web flow once end-to-end and resolve them as already-fixed, not to re-debug them.

---

## 2. What has already been verified (don't redo this)

- **The server code the testers hit is byte-identical to the working tree.** `git diff origin/main` is empty for both `src/app/api/v1/reading-state/route.ts` and `src/lib/mutations/reading-state.ts`. The repo checkout sits on `claude/native-ios-api-shelves-upnext`, but for these two files there is no drift from `main`. You can read the local files and trust them as prod.
- **The v1 route binds the user correctly.** `route.ts:43` passes `user.userId` into `setBookStateWithCompletionFor` — this is the exact bug `ec28222` fixed elsewhere, and it is correct here.
- **The route's state machine looks right**: `completed`/`dnf` go to `setBookStateWithCompletionFor` with date + precision; `none` clears; simple states go to `setBookStateFor`.

---

## 3. Confirmed defect: the iOS client throws every error on the floor

This is a real finding, independent of whatever the underlying failure is.

`native-ios/APIClient.swift:477` declares `setReadingState(...) async throws`. **All 16 call sites discard the error with `try?`:**

```
native-ios/BookDetailView.swift:1207,1209,1228,1230,1239
native-ios/CompactStatePill.swift:120,123,140,143,152
native-ios/SearchView.swift:392,395,408,411,418
native-ios/CompletionDateSheet.swift:260
```

The completion path specifically — `BookDetailView.swift:1236-1246`:

```swift
private func setState(_ state: String, completionDate: String?, precision: String? = nil) async {
    busy = true; defer { busy = false }
    try? await APIClient.shared.setReadingState(       // <-- error discarded
        bookId: book.id, state: state,
        completionDate: completionDate,
        completionPrecision: precision
    )
    await model.load()                                 // <-- re-reads server, gets the OLD state
    if state == "completed" || state == "dnf" { model.completionTick += 1 }
}
```

If the POST fails for **any** reason — 500, expired token, timeout, offline — the app swallows it, immediately reloads from the server, and renders the unchanged state. That is precisely report #4's description: *"going elsewhere and back it just goes back to the old status."* No error is ever shown to the tester, and nothing is logged for us.

**This must be fixed regardless of root cause**, because right now it is why we have no diagnostic signal from the field. `CompactStatePill.swift:152` has the identical completion path and needs the same treatment.

---

## 4. Where to look next

### 4a. Reproduce on iOS first
Build, install, and drive the real flow with a real account:
1. Book → Finished → date picker → confirm.
2. Watch the actual HTTP exchange. If the POST returns non-2xx, you have your answer immediately.
3. Also try the *other* entry point the tester used: setting progress to 100%, which may take a different code path than the Finished pill. Confirm whether that path even calls `/api/v1/reading-state`.

The tester was on iPhone17_1 / iOS 26.5.

### 4b. The two reference codes
`3639975603` and `3423654888` are Next.js **error digests** — see `src/app/error.tsx:44-46`, which renders `error.digest` as "Reference:". The matching stack trace is in the Vercel runtime logs for that deploy. Given the dates (07-24, 07-31) these are **very likely past Vercel's log retention** — spend five minutes checking, not an hour. They also belong to reports 1–2, which are the pre-`ec28222` bug, so they are lower value than they look.

### 4c. Candidate failure modes worth checking on the server path
Read `src/lib/mutations/reading-state.ts:251-400` (`setBookStateWithCompletionFor`). Notes:
- This function has **already been the site of two separate production bugs** — an `activeFormats` serialization crash (see the long comment at ~line 305: a JS array assigned to a text column coerced to a bare `paperback`, which then broke every `JSON.parse` reader) and the unbound `userId`. Treat it as fragile.
- The no-active-session branch (~line 380) inserts with `completionDate` / `completionPrecision` possibly `null`. Check what the readers do with a session that has a null completion date — that is a plausible "shows as pending forever" mechanism, since a completed row with no completion date may not satisfy whatever the UI treats as finished.
- `getActiveSession` / `getNextReadNumber` behavior when a user has prior sessions on the same book (re-read path) is worth a look; report #4's tester may have had an existing session.

### 4d. Server-side logging
There is currently no logging on this path. Before or alongside the fix, add error logging to the v1 route so the next occurrence leaves a trace instead of a digest we can't resolve.

---

## 5. Definition of done

1. iOS surfaces failures instead of silently reverting — at minimum the completion paths in `BookDetailView.swift` and `CompactStatePill.swift`; ideally all 16 `try?` sites.
2. The underlying cause of report #4 is identified and fixed, or explicitly ruled out with a reproduction attempt documented here.
3. Web flow verified end-to-end once (Finished + date confirm → `user_book_state='completed'` + a reading session row) so reports 1–3 can be closed honestly.
4. Reports resolved in `/admin/issues` — and per `feedback_triage_verification`, "resolved" claims must be DB-verified, not assumed.

## 6. Shipping requirements (project rules, non-negotiable)

- **Web changes go to prod as part of "done."** Use the worktree flow: branch `main-deploy` from `origin/main` — the checkout is on the iOS branch, so parity-check any file you copy against `origin/main` first. Verify with a one-shot `npx vercel inspect thebasedreader.app`. Never `vercel --prod`. Never watch-loop `vercel ls`.
- **After any native iOS change that builds: run `./native-ios/push-to-phone.sh`.** Don't ask first.
- **Never touch the port 3000 dev server** — it's a launchd service (`com.tbra.devserver`). Restart only via `launchctl kickstart -k gui/501/com.tbra.devserver`.
- Stage only the files you touched. Never `git add -A`.

## 7. Key files

| Path | What |
|---|---|
| `src/app/api/v1/reading-state/route.ts` | native entry point; identical to `origin/main` |
| `src/lib/mutations/reading-state.ts:251` | `setBookStateWithCompletionFor` — the shared core |
| `src/lib/actions/reading-session.ts:16` | web server action wrapper |
| `src/components/reading-state-button.tsx:209` | web call site |
| `src/components/home/currently-reading-section.tsx:263` | web call site (home) |
| `native-ios/BookDetailView.swift:1236` | iOS completion path |
| `native-ios/CompactStatePill.swift:152` | iOS completion path (pill) |
| `native-ios/APIClient.swift:477` | `setReadingState` |
| `src/app/error.tsx:44` | where the "Reference:" digest is rendered |

Related memory: `project_finished_flow_userid_crash`, `project_ios_status`, `feedback_triage_verification`.
