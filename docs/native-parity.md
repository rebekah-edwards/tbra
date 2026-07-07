# Native iOS Parity Manifest

**The governing document for the full-native SwiftUI rebuild.** Decision made 2026-07-02: the
native app recreates the mobile web app **1:1** — its chrome, screens, and every granular
feature — with iOS-specific enhancements added only after a screen reaches parity.

## The rules (non-negotiable)

1. **Screenshot-first.** No native screen gets designed from memory or docs. Before building,
   log into `localhost:3000` in the preview browser at **390×844** (test account) and
   screenshot the real page. The screenshot is the spec.
2. **Feature inventory before code.** When a screen's build starts, read its page/component
   source and list every interactive element and state in its section below. That list is the
   acceptance checklist — nothing ships half-inventoried.
3. **Side-by-side proof.** A screen is `VERIFIED` only when web and native screenshots have
   been visually reconciled by the agent (layout, spacing, colors, typography, all states),
   and the comparison shots were sent to the user. The user reviews finished screens, never
   hunts for missing features.
4. **API honesty.** If a screen needs data `/api/v1` doesn't serve yet, the endpoint gets
   built (on the branch, mirroring the web queries) — never mocked, never faked with
   placeholder data that could be mistaken for parity.
5. **Statuses:** `—` not started · `API` endpoint work in progress · `WIP` building ·
   `BUILT` compiles + runs with real data · `VERIFIED` side-by-side reconciled + user-seen.
6. **Auto-push to the phone (standing user order — do NOT ask).** After every native
   change that builds, run `native-ios/push-to-phone.sh`. It installs + relaunches on
   Rebekah's iPhone over cable or home-network wireless. If the phone isn't reachable,
   the script says so — just note it and move on; push again when it's back.

## App chrome (cross-screen) — BUILT

- [x] Top bar: gradient `tbr*a` wordmark (Space Grotesk), search / bell / hamburger — **icons not yet functional**
- [x] Bottom nav: Discover / My Library / raised lime Home circle / Stats / Profile avatar,
      neon-purple active state, SVG-accurate icons (AppShell.swift)
- [ ] Search overlay/page wired to the search icon
- [ ] Notifications panel wired to the bell
- [ ] Hamburger menu (theme toggle, settings, logout live here on the web)
- [ ] Global report (flag) floating button
- [ ] Pull-to-refresh app-wide; View-Transitions-style 200ms/30px push-pop slide

## Phase 1 — Core reading loop

| Route | Screen | Status | API needs |
|---|---|---|---|
| `/` | Home: Reading Now card (progress pill, Track Progress sheet w/ page-%/mood/pace, state dropdown → Paused confirm / Finished+DNF date sheet) | BUILT | ✅ /api/v1/home + /reading-notes + /reading-state |
| `/` | Home: reading goal ring + tbr streak cards | BUILT (goal EDITING not wired — needs goal-set endpoint) | ✅ /api/v1/home |
| `/` | Home: Up Next numbered grid w/ drag-reorder | BUILT | ✅ served |
| `/` | Home: Pick From Your Shelf (suggestion + shuffle + empty state) | BUILT | ✅ /home + /home/tbr-suggestion |
| `/` | Home: Discover Something New (cover row, info bubble, fade hint) | BUILT | ✅ /home/discover |
| `/` | Home: Because You Liked + Friends Activity | BUILT (code-spec — test acct has no follows/high ratings to render them; verify visually on a real account) | ✅ /home/discover |
| `/` | Home: goal editing (pencil → sheet) | BUILT | ✅ /reading-goal |
| `/book/[id]` | Book page (full functional inventory below) | BUILT v1 (commit b65dab5) — hero, action cluster w/ every dropdown functional, summary, What's Inside gate+grid; app-wide cover navigation wired. Still open: edition picker, review wizard, reading history, notes, similar books, friends-who-read, hide/report, TBR-note editor in dropdown, month/year completion precision, empty-stars rendering check vs web. | ✅ /books/[id] + formats + library + reading-state 'none' |

### /book/[id] — functional inventory (captured 2026-07-02, from live UI + component code)

**Hero (book-header.tsx):** back circle · top-level genre pill (lime) + audience pill (purple) · admin pencil (admin only) · title · author link → `/author/[id]` · "#N in <series> ›" (neon-blue) → `/series/[slug]` · year · pages/audio-length (🎧 15h 28m when audio) · genre pills (translucent) · pacing pill (amber clock, "Medium-paced") · cover w/ hero blur bg (overlay tokens) · share circle (share-button.tsx → share sheet).

**Action cluster (reading-state-selector.tsx):**
- **Signed-out variant:** "Sign in to track" lime CTA → /login · Buy button still visible (Amazon compliance!) · disabled Owned ghost.
- **Reading-state split button (reading-state-button.tsx):** main label = current state or "To Read"+bookmark icon; lime solid when active, translucent lime 20%/border 60% when not.
  - Main tap: inactive → set `tbr` (+toast); active → REMOVE state entirely (removeBookState — keeps owned formats).
  - Chevron dropdown items: **To Read / Reading Now / Finished / Paused / DNF** (✓ on current; tapping current = remove state). Finished/DNF intercept → CompletionDatePicker ("When did you finish?" / "When did you stop reading?", exact/month/year precision) → setBookStateWithCompletion. Every change fires a state toast (STATE_TOAST_MESSAGES).
  - When current = tbr: dropdown embeds **TbrNoteEditor** (premium-gated note on the TBR entry).
  - **Buddy Read** row (people icon) → `/buddy-reads/new?bookId=`.
  - When active: destructive **"Remove from Library"** → confirm modal ("clears reading history, review, and rating — cannot be undone") → removeFromLibrary.
- **Up Next button** (up-next-button.tsx, shown ONLY when state = tbr): not queued → "Add to Up Next" (addToUpNext, disabled + "Up Next is full (6 max)" at capacity); queued → "Up Next #N — tap to remove".
- **Buy button (buy-button.tsx):** SSR `<a href>` with affiliate tag (amazonUrl → asin → isbn13 search → title search fallback); click intercepted → affiliate-disclosure dialog → Continue opens Amazon. NATIVE: same interstitial then open URL; keep the tag env-driven.
- **Format button** (format-button.tsx, shown when state = currently_reading/paused; auto-opens right after switching to Reading Now): multi-select checkboxes of hardcover/paperback/ebook/audiobook → setActiveFormats ("how I'm reading it"; never assume hardcover).
- **Owned button** (owned-button.tsx): popover of Hardcover/Paperback/eBook/Audiobook toggles ("Box Set" single option when is_box_set) → setOwnedFormats; per-format "specify editions" → EditionPicker bottom sheet (OL editions); "unknown" import placeholder excluded from "Owned · N" count and dropped once a real format is chosen.
- **Shelves button** (add-to-shelf-button.tsx): popover listing user shelves w/ checkmarks (add/remove via shelf APIs — v1 exists) + "New Shelf" creation. *(popover detail TO INVENTORY at build)*
- **Stars row:** community avg + review count → reviews; "Mark as finished to review" hint; own rating stars after completion.

**Below the fold (components on page, each needs its own inventory pass at build):** book-summary (frosted quote card) · content-warning-banner · **content-profile.tsx (What's Inside — THE core feature, 494 lines: category intensity rows, expanders w/ notes, spoiler handling)** · book-description · book-about-details · book-series (More in this Series rail) · reading-history (per-session editor incl. format retro-tag) · book-reading-notes · reviews block (review wizard entry) · friends-who-read · similar-books · favorite-button (Top Shelf) · hide-book-button · report-issue-button · post-completion-suggestions · ARC form (arc-source-form).
| `/library` | Library: TBR/Activity/Owned groups, sub-filters w/ counts, book grid (audiobook-square rule), My Shelves entry, header stats | BUILT (sort menu + advanced Filters expander still open; Find-books link inert until search) | ✅ /api/v1/library |
| `/library/shelves` | Shelves list, My Shelves/Following pills, shelf cards | BUILT | Following + Top Shelf missing |
| `/library/shelves/[slug]` | Shelf detail: cover grid, Shelf Order, Filters, Edit, share | BUILT (controls visual-only) | sort/filter params |
| `/library/shelves/top-shelf` | Top Shelf (favorites) | — | favorites endpoint |
| `/search` + `/search/add` | Search page, local-first + add flows | BUILT (commit 872b773): FTS search, result cards w/ compact 5-state pill + date sheet, book navigation, top-bar + Find-books entry points. Open: ISBNdb external supplement + import-from-external, Owned pill on cards, /search/add page. | ✅ /api/v1/search |

## Phase 2 — Discovery + identity

| Route | Screen | Status | API needs |
|---|---|---|---|
| `/discover` | Discover mood search | BUILT (14-mood tinted grid, all filters, Find Books, results w/ reasons). Results-grid visual pass pending on a tap-capable session; content-comfort overrides panel not yet inventoried. | ✅ /api/v1/discover |
| `/browse`, `/find` | Browse/find surfaces | — | TBD |
| `/stats` | Stats dashboards | BUILT (year pills, hero cards, goal ring, monthly/yearly chart, rating dist, fiction split, authors, genres). Charts verified on empty-ish data — re-verify visually on a data-rich account. | ✅ /api/v1/stats |
| `/profile` (+ `/edit`, `/journal`, `/referrals`, `/reviews`) | Profile suite | BUILT (main page: header/badges/stats/referral/top-shelf/shelf rails/journal/import/sign-out). Sub-pages (edit, journal full view, referrals, reviews) open the web for now. Reviews section needs a data-rich account to inventory review cards. | ✅ /api/v1/profile |
| `/u/[username]` (+ followers/following/shelves) | Public profiles + social graph | — | public-profile endpoints |
| `/author/[id]`, `/series/[slug]` | Author + series pages | BUILT (series: Core/All/Sets + compact pills; author: follow/unfollow, bio, series-grouped rails). Covers-variant toggle + admin pencils not ported. | ✅ /api/v1/series/[slug] + /api/v1/authors/[id] |
| `/people` | Find people | — | TBD |
| `/book/[id]/notes`, `/book/[id]/reviews` | Notes + reviews detail | — | notes/reviews endpoints |

## Phase 3 — Flows + long tail

| Route | Screen | Status | API needs |
|---|---|---|---|
| `/login` | Login (wordmark, branded fields, lime CTA) | BUILT | ✅ email/password verified on device 2026-07-02 |
| `/login` | **Google Sign-In on native** (user-flagged gap) | — | Needs design with user: ASWebAuthenticationSession against the existing /api/auth/google flow + a v1 token handoff endpoint. NOTE: App Store rules require offering Sign in with Apple once any third-party login ships — plan both together. |
| `/signup`, `/verify-email`, `/forgot-password`, `/reset-password` | Auth suite | — | v1 wrappers |
| `/onboarding` | Onboarding | — | TBD |
| `/buddy-reads` (+ slug/join/new) | Buddy reads suite | — | buddy-read endpoints |
| `/import` | Goodreads/StoryGraph/Libby import | — | likely stays web-first |
| `/settings` | Settings (text size, theme, notification prefs) | — | settings endpoints |
| `/upgrade`, `/methodology`, `/contact` | Static-ish pages | — | low priority |

## iOS-specific touches (AFTER parity, per screen)

Haptics on reorder/complete · home-screen widgets (Up Next, streak) · Live Activity for
reading sessions · share sheets · Sign in with Apple · push notifications · offline shelf
cache. None of these may change a screen's visual design from the web version without
explicit user sign-off.

## Log

- 2026-07-02 (Phase 1 start): Home Reading Now + goal + streak BUILT. New v1 endpoints:
  GET /home, POST /reading-notes, POST /reading-state — each reuses the web's exact
  query/mutation code via new user-scoped modules (src/lib/mutations/reading-state.ts,
  reading-session.ts, reading-notes.ts); the cookie server actions now delegate to them,
  so web and native share ONE state machine. Verified: API round-trips (note→progress %,
  pause→resume w/ session accounting), web home regression (42% pill renders from an
  API-written note), native dropdown z-order fix mirroring the web's hoisted state.
  Known follow-ups: goal editing endpoint, month/year completion precision, post-completion
  review wizard, remaining home sections (Pick From Your Shelf, Friends Activity,
  Discover Something New, Because You Liked).
- 2026-07-02: Manifest created. Chrome + Home(Up Next) + Shelves + Shelf detail BUILT
  (commit 0e45aa4) via the screenshot-first protocol; earlier iOS-idiom pass (6a89d90)
  rejected by user and replaced. Xcode 27 beta at /Applications/Xcode-beta.app is the
  build toolchain (see project memory for the Simulator.app rescue).

- 2026-07-03: Review wizard BUILT + verified (5 steps, edit mode, delete).
