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
- [x] Notifications panel wired to the bell (unread dot, mark-read, linkUrl routing)
- [x] Hamburger menu (theme Dark/Light/Auto, Profile, web links, Sign Out)
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
| `/book/[id]` | Book page (full functional inventory below) | BUILT v1 (commit b65dab5) — hero, action cluster w/ every dropdown functional, summary, What's Inside gate+grid; app-wide cover navigation wired. BOOK PAGE INVENTORY COMPLETE 2026-07-03 (all items BUILT except the admin-only pencil; empty-stars rendering check pending a data-rich visual pass). Edition picker: ✅ BUILT + verified 2026-07-03 (OL editions, per-format select/remove, pagination). TBR-note editor + month/year precision: ✅ BUILT + verified 2026-07-03. Notes + More Like This: ✅ BUILT + verified 2026-07-03. Reading History: ✅ BUILT + verified 2026-07-03 (session editor, format retro-tag, re-reads). Review wizard: ✅ BUILT + verified 2026-07-03 (5 steps, edit mode round-trip, delete, GET/PUT/DELETE /books/[id]/review). | ✅ /books/[id] + formats + library + reading-state 'none' |

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
| `/library/shelves/top-shelf` | Top Shelf (favorites) | BUILT (toggle in Shelves picker + Profile rail; the dedicated /top-shelf page itself still opens web) | ✅ /api/v1/books/[id]/favorite |
| `/search` + `/search/add` | Search page, local-first + add flows | BUILT: FTS search, compact 5-state pills, ISBNdb MORE-RESULTS supplement w/ import-on-add (2026-07 — covers the Martian-Deluxe report case). Open: Owned pill on cards, /search/add page. | ✅ /api/v1/search + /external + /import |

## Phase 2 — Discovery + identity

| Route | Screen | Status | API needs |
|---|---|---|---|
| `/discover` | Discover mood search | BUILT (14-mood tinted grid, all filters, Find Books, results w/ reasons). Results-grid visual pass pending on a tap-capable session; content-comfort overrides panel not yet inventoried. | ✅ /api/v1/discover |
| `/browse`, `/find` | Browse/find surfaces | BUILT (browse: sort pills + paginated grid; advanced filters + genre picker still open; /find still web) | ✅ /api/v1/browse |
| `/stats` | Stats dashboards | BUILT (year pills, hero cards, goal ring, monthly/yearly chart, rating dist, fiction split, authors, genres). Charts verified on empty-ish data — re-verify visually on a data-rich account. | ✅ /api/v1/stats |
| `/profile` (+ `/edit`, `/journal`, `/referrals`, `/reviews`) | Profile suite | BUILT (main page: header/badges/stats/referral/top-shelf/shelf rails/journal/import/sign-out). Sub-pages (edit, journal full view, referrals, reviews) open the web for now. Reviews section needs a data-rich account to inventory review cards. | ✅ /api/v1/profile |
| `/u/[username]` (+ followers/following/shelves) | Public profiles + social graph | BUILT (profile, privacy gate, follow/unfollow, shelves, reviews). Followers/following LIST pages + public shelf detail still open web. | ✅ /api/v1/users/[username] |
| `/author/[id]`, `/series/[slug]` | Author + series pages | BUILT (series: Core/All/Sets + compact pills; author: follow/unfollow, bio, series-grouped rails). Covers-variant toggle + admin pencils not ported. | ✅ /api/v1/series/[slug] + /api/v1/authors/[id] |
| `/people` | Find Readers | BUILT (search + follow pills + profile navigation) | ✅ /api/v1/users/search |
| `/book/[id]/notes`, `/book/[id]/reviews` | Notes + reviews detail | — | notes/reviews endpoints |

## Phase 3 — Flows + long tail

| Route | Screen | Status | API needs |
|---|---|---|---|
| `/login` | Login (wordmark, branded fields, lime CTA) | BUILT | ✅ email/password verified on device 2026-07-02 |
| `/login` | **Google Sign-In on native** (user-flagged gap) | — | Needs design with user: ASWebAuthenticationSession against the existing /api/auth/google flow + a v1 token handoff endpoint. NOTE: App Store rules require offering Sign in with Apple once any third-party login ships — plan both together. |
| `/signup`, `/verify-email`, `/forgot-password`, `/reset-password` | Auth suite | BUILT (native signup + forgot-password; verify-email + reset land on web via emailed links — correct by design) | ✅ /api/v1/auth/register + /forgot-password |
| `/onboarding` | Onboarding | — | TBD |
| `/buddy-reads` (+ slug/join/new) | Buddy reads suite | BUILT (list, join-by-code, detail w/ members+discussion+leave, create from book page). Invite-someone + complete-read host flows still open web. | ✅ /api/v1/buddy-reads (+ [slug]) |
| `/import` | Goodreads/StoryGraph/Libby import | — | likely stays web-first |
| `/settings` | Settings | BUILT (comfort zone, topics-to-avoid, theme, notif toggles, hidden books; password/export/account open web; text-size + location not yet native) | ✅ /api/v1/settings |
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

- 2026-07: Light-mode pass done (Theme.scrim adaptive token; all tabs verified light). Browse + follow lists + buddy reads + reviews list + auth sub-pages + Find Readers + external search all BUILT — see route table.

- 2026-07-07: NAVIGATION BUG HUNT (commits 9fc89ad + 0da3940) — her live report: up-next
  taps opened the book one grid row down, Reading Now taps dead, book-page back dead.
  THREE iOS 27 hit-test bugs found via sim instrumentation (TBRA_DEBUG_TAPS=1 logs tap
  locations, item frames, fired routes — kept in the code, env-gated):
  1. TapScaleButtonStyle (isPressed scaleEffect) misroutes button ACTIVATION to a sibling
     in runs of card/cell buttons — data, frames, tap location all correct, wrong button
     fires. REMOVED app-wide (tombstone in AppShell.swift). Never reintroduce pressed-scale
     ButtonStyles on grids/rails.
  2. Tab stacks were VStack-sandwiched between TopBar/BottomNav → UIKit hit-tested the
     whole home stack ~114pt off (dead Reading Now, etc.). Bars are now .safeAreaInset and
     the NavigationStacks own the full screen (AppShell).
  3. Pushed destinations don't inherit the shell's safeAreaInset → content slid under the
     TopBar, and scroll-content TOP-STRIP buttons go hit-test-dead on repeat pushes.
     PushedScreenChrome (env-measured bar heights) pads every destination, and every pushed
     screen's back chevron is now a screen-level .floatingBack() overlay (circle + bare
     variants). Headers keep 40pt placeholders so titles don't shift.
  Also: Up Next grid is non-lazy + home renders once behind a ready-gate (no insert-above
  churn). Sim-verified: all grid cells open the right book across repeated push/pop,
  Reading Now navigates, back pops every time. Both commits pushed to her phone.

- 2026-07-08: LIQUID-GLASS CHROME (commit 67246cd, user-requested) — both bars are now
  detached floating glass pills (iOS 26 style): bottom pill with the lime Home circle
  centered; top has a search/bell/menu glass bubble and the tbr*a wordmark renders ONLY
  while the page rests at its top (fades on scroll; tap = Home root). Content scrolls
  under and blurs through both pills. ARCHITECTURE NOTE: the bars are shell OVERLAYS,
  not safeAreaInsets — an inset outside the NavigationStacks collapses + z-fights on
  iOS 27 whenever a stack's content swaps (scroll-geometry logs showed the top inset
  drop 168→62 at home's ready-gate swap). Every TAB ROOT therefore reserves bar space
  itself via pushedScreenChrome() (same measured-height env the pushed screens use).
  ChromeState + tracksScrollAtTop() (onScrollGeometryChange; at-rest offset = -inset)
  feed the wordmark visibility from each main ScrollView. Verified dark+light in sim:
  blur-through, logo hide/show, taps + back still correct. Pushed to phone.

- 2026-07-08 (punch list round 2, item 1): PROFILE SHELVES PARITY — shared TopShelfCase +
  ShelfRailCase components now render the web's bookcase design on BOTH profile pages:
  amber wooden Top-Shelf case w/ avatar+rating pills (FavoriteBookRow gained userRating),
  tinted padded rail cards w/ shelf-edge planks + floor shadows, dashed empty state,
  .read-more-link colors on View links. DEFERRED from web favorites-shelf.tsx: same-series
  STACKING on the top shelf (stack + count badge) — add when she asks or in a later pass.

- 2026-07-08 (live report): CHROME TAPS ALWAYS WIN — tapping the menu bubble with a book
  link scrolled beneath navigated to the book: shell-level overlays LOSE iOS 27
  hit-testing to interactive content inside the NavigationStacks (in-screen overlays like
  the floating back chevron WIN — verified both ways). Fix: every bar is one component
  with two modes — visual (shell overlay, allowsHitTesting(false), free to mutate/never
  slides with transitions) + hitLayerOnly (clear-ink geometry twin rendered inside every
  screen via PushedScreenChrome, negative padding cancels the bar-spacer insets).
  ChromeState = chrome hub (tab + wired actions); TopBarActions stateless (sheets +
  notifications hoisted to AppShell). Debug: TBRA_DEBUG_TAPS=1 paints the hit twins red.

- 2026-07-08 (live report #2): READING NOW DEAD WITH 2+ BOOKS — iOS 27 hit-test bug #7,
  the one her phone hit (she reads several books at once; the test account's single card
  masked it). CoverBlurImage's `.resizable().aspectRatio(.fill)` backdrop takes an
  UNBOUNDED layout frame that spills far past its card; with 2+ Reading Now cards the
  overlapping oversized frames kill button activation for the ENTIRE run — taps land in
  the right frames (TAPDEBUG) but no button fires. One card is fine. Bisect cleared the
  suspects: scrim, blur, AsyncImage phase-swap, zIndex, sheets, HitFrameReporter all
  innocent; the unbounded fill frame is the poison. FIX inside CoverBlurImage (protects
  Reading Now + Up Next cells + book-page hero): `Color.clear.overlay { image }.clipped()`
  bounds the layout frame to the card; also swapped AsyncImage for a stable-identity
  Image(uiImage:) + .task loader and .allowsHitTesting(false) as defense-in-depth.
  RULE: any decorative fill-image backdrop MUST be frame-bounded via the clear-overlay
  pattern — never a bare resizable-fill in a ZStack background. Test account now has 3
  currently_reading books as a permanent multi-card regression fixture. Sim-verified:
  all 3 cards navigate, Track Progress/dropdown/goal/menu/bell/up-next/back all correct.

- 2026-07-08 (book-page chrome polish, commit ed25713, user-requested): wordmark on its
  own glass pill (legible over vivid heroes; still fades on scroll, taps home; pill
  metrics mirror the actions bubble; both chrome modes share geometry). Book hero: back-
  button row REMOVED — floating back chevron overlaps the card's top edge ~30% (mobile-
  site style; floatingBack(topPadding: -8), card padding.top 20), card sits ~45pt higher.
  chromeCircle() = shared opaque circle treatment (bg base + scrim + border + shadow)
  for back chevron + share button so the two match. Verified light+dark, scroll fade,
  back/logo taps. On phone (next open).

- 2026-07-11 (audiobook square covers + admin queue, iOS commit + main e17048e): square
  audiobook rendering everywhere (home Reading Now, My Library activity, book hero) now
  gated on books.audiobook_cover_url actually existing — format choice alone NEVER
  square-crops the 2:3 cover (was broken on live too; fixed both). Plumbing: getUserBooks
  computes usesAudiobookCover (cover-cascade winner == audiobook image) → v1 home/library
  pass through, v1 books/[id] computes from userState; native ReadingNowBook/LibraryBook/
  BookDetailData decode it (optional Bool for old payloads). Native BookHero dropped the
  audioLength&&pages==nil square heuristic; swaps to book.audiobookCoverUrl only when
  flagged (80×80 home, square grid cell library, 110×110 hero). ADMIN: /admin/covers
  "Audiobook" tab = live queue of books w/ audiobook marked (active reading/paused OR
  owned) but no square image, paste-URL saves via setAudiobookCover; PLUS admin bell
  ping on the marking event (notifyAdminsIfAudiobookCoverMissing, hooked in the format
  mutations on branch / actions on main, deduped per book while unread). Verified sim +
  web both directions (square w/ image, rect without). Test data left: clanker_test has
  WoK active=audiobook (real queue entry + 1 unread admin ping for each super_admin).

- 2026-07-11 (home punch list #2, user-requested): (1) Reading Now state menu hangs BELOW
  the card (chevron stays tappable). (2) Up Next reorder = iOS-home-screen wiggle: 1s
  long-press → jiggle + Done pill, whole-card drag, no handle; taps inert while wiggling.
  (3) **iOS 27 BUG #8 pinned**: deferred home sections insert below Up Next after first
  layout and HELD touches (long-press/drag lifts) keep routing by pre-insertion offsets
  while quick taps follow fresh layout — this was the long-standing "glitchy reorder".
  Fix: discover-loaded is part of the home content rebuild .id(). ALSO: Buttons in this
  scroll never receive long-presses at all (cells now use onTap/onLongPress gestures),
  and a whole-content simultaneousGesture RETRIGGERS bug #8 — never attach one to scroll
  content. (4) Friends Activity: cards navigate (book page; reviews → the review via
  ReviewsRoute.scrollToReviewId + lime highlight), avatar+name+time in banner w/ book
  image (web mirrored, main 02e7e82), CoverBlurImage backdrop fixes light mode; note
  bodies never leave the server. (5) Pick From Your Shelf tag: branded blue in light.
  (6) Left-edge back swipe everywhere via an 18pt overlay strip in PushedScreenChrome
  (UIKit interactive-pop delegate-nil trick is DEAD on iOS 27 w/ hidden nav bar).
  FORWARD swipe not shipped: NavigationPath is opaque (can't know what was popped to
  re-push it) — needs the typed-route refactor of every stack + NavigationLink first.
  Sim-verified: dropdown open/act/cancel, wiggle enter/Done/exit, post-scroll taps,
  friends card nav, back-swipe (incl. data-safe start zone <18pt), reading-now nav.

- 2026-07-11 (Discover polish + premium gate, iOS commit + main 28cbc20): "gems" wording
  retired on BOTH surfaces ("N matches found", no ✨; empty state "No matches found";
  match-reason pill kept). Native results rebuilt to web parity: 2-up bordered cards
  (cover/title/authors/💎-reason pill on lime→blue gradient), "N matches found" + Shuffle
  header, cells Button+path.append. Length cards: black-on-green selection in light mode
  (translucent-green rule), bg 15%. PREMIUM GATE (was never enforced anywhere!): /discover
  page wraps in PremiumGate, /api/discover + /api/v1/discover 403 non-premium
  (hasPremiumAccess = premium/beta_tester/admin/super_admin), native DiscoverView reads
  accountType from AuthStore env and shows the mirrored upgrade card (Learn More →
  thebasedreader.app/upgrade). Home's free "Discover Something New" strip untouched
  (per the tier sheet, only the /discover mood tool is premium). Sim-verified light mode:
  gate logic, black-on-green length, header+Shuffle, card grid, reason pills.

- 2026-07-12 (Admin access from the app, user-requested): hamburger menu shows an
  "Admin" row (neonPurple, wrench icon) ONLY for accountType admin/super_admin —
  mirrors the web menu gating. Opens AdminSheet: fullScreenCover with a WKWebView
  (AdminWebView.swift) loading APIClient.baseURL + /admin, authenticated by injecting
  Keychain.accessToken as the `tbra-session` cookie (bearer + web cookie are the SAME
  jose JWT; verifySessionToken serves both — no server change needed). Non-persistent
  cookie store, re-injected per open; cookie set BEFORE load (races otherwise). Deliberate
  choice: the real web dashboards instead of native rebuilds (no drift). Admin edits hit
  the LOCAL DB like everything in the app and ride the nightly sync to live. NOTE: the
  webview shows the full web chrome, so the web bottom-nav can wander out of /admin —
  Done closes. NEW FILE gotcha: Tbra.xcodeproj is GITIGNORED; AdminWebView.swift was
  added to project.pbxproj locally via the classic 4-entry pattern (PBXBuildFile +
  PBXFileReference + group child + Sources phase). Sim-verified: gated row, hub renders
  authenticated, Cover Review sub-page loads w/ tabs + save inputs. On phone (relaunched).

- 2026-07-12 (admin cover picker in the app, user-requested): native book hero shows the
  admin-gated pencil (accountType admin/super_admin, same as web) on the cover's top-right.
  Tap → AdminSheet("Edit Cover", path: book/<slug>, query: editCover=1): the authenticated
  webview opens the book's web page and ?editCover=1 auto-opens the REAL cover picker
  (extracted openCoverEditor() in book-page-client.tsx, main d94b736) — upload, paste-URL,
  OL edition covers, ISBNdb/Google candidates. Book reloads onDismiss so the new cover
  shows immediately. Sim-verified end-to-end (picker rendered w/ 34 OL + 8 external
  candidates for Way of Kings). On phone (relaunched).

- 2026-07-12 (chevron slide-up, user-requested): FloatingBackButton now reads chrome.atTop
  + shellBarInsets; when !atTop (and showsShellChrome && bars.top>0) it offsets by
  -(bars.top + topPadding - 8) with easeOut 0.18 — rides up into the faded wordmark's
  top-left slot, level with the actions bubble; slides back at top. Logo hit twin is
  already disabled when !atTop so no tap conflict. Sim-verified on book page: at-top
  overlap position, slide-up on scroll, tap-to-pop in the bar slot.

- 2026-07-12 (webview auth fix, her report): WKHTTPCookieStore-injected cookies never
  attach when the host is a raw IP (Tailscale) — device webviews were SIGNED OUT (book
  page but no pencil/picker; sim/localhost masked it). Fix: GET /api/v1/auth/web-session
  ?token&next — verifies bearer JWT, sets tbra-session via server Set-Cookie, redirects
  (relative next only). AdminWebView loads through the bridge; no client cookie code.
  Bridge curl-tested (bogus→401, real→307+Set-Cookie); sim pencil→picker re-verified.

- 2026-07-12 (theme toggle fix, her report): dark→light required an app kill. Cause:
  .preferredColorScheme applied at BOTH Scene (TbraApp — @AppStorage in an App struct
  never re-evaluates, pinning the launch theme) and RootView; the stale Scene copy won
  on conflict. Fix: both removed; RootView.applyTheme() sets
  UIWindow.overrideUserInterfaceStyle across all windows (onAppear + onChange of
  themeOverride) — sheets/covers/alerts now follow the toggle too. Sim-verified full
  cycle light→dark→light live, menu sheet re-themes in place.

- 2026-07-12 (profile finish, user-requested): Edit Profile / View public profile links
  BLUE in light mode (lime illegible). Recent Reviews native → web grid parity: 3-up
  covers capped 6, star pill + red DNF tag bottom-right, owner avatar bottom-left when
  written review (web review-history.tsx got the DNF tag + avatar too, main a144fc2;
  profile page passes avatarUrl). Cells Button+path.append → ReviewsRoute w/ scrollTo.
  Reading Journal native → web stacked design: 3 most-recent books, latest note w/ peek
  edges, per-book "View all N notes" → BookRoute, "View all N entries". NEW: AllReviewsView
  + AllJournalView fullScreenCovers backed by GET /api/v1/profile/reviews + /journal
  (500-cap; profile payload stays 6/20). Sim-verified light mode: blue links, grid pills +
  avatar badge, stacked journal, All Reviews cover w/ rows + back.

- **2026-07-12 — Reviews page → book link.** The book-title subtitle under the
  "Reviews" heading is now a NavigationLink (neonBlue, chevron) to BookRoute —
  arriving from the profile's review grid previously left no path to the book
  itself. Sim-verified: Profile → review cell → "Skyward ›" → book page.

- **2026-07-12 — Profile review pills + cover back-button fix.** (1) AllReviewsView/
  AllJournalView fullScreenCovers now zero out shellBarInsets + showsShellChrome
  (the AppShell cover pattern) — the back chevron was inheriting the presenting
  screen's scrolled chrome state and sliding up out of reach. (2) Recent Reviews
  grid: avatar now rides INSIDE the rating pill (Top Shelf treatment, accent-star
  fallback), attached to the DNF pill when unrated; separate bottom-left badge
  removed. Web review-history.tsx matches (ReviewerAvatar in-pill).

- **2026-07-12 — Stats parity: bidirectional user-activity sync.** Root cause of
  "web shows 27 books, app shows 26": (a) sync-pull silently swallowed UNIQUE
  collisions, so the same logical read recorded independently on both sides
  (different session ids, same user+book+read_number) never converged — Nouscraft
  stayed currently_reading locally while live said completed 2026-04-11; Space
  Fleet Academy had two divergent sessions; (b) sync-push had NO user-activity
  step (only up_next) — app-side activity never reached live at all. NEW
  scripts/sync-user-activity.ts: guarded bidirectional sync of all user tables,
  natural-key newest-wins merge (local adopts live ids; live rows updated in
  place), PUSH SAFETY FILTER (only APP_USERS rows stamped ≥ 2026-06-20 — 83
  local-only ghost sessions from live-side deletions must never be resurrected).
  Runs every 30 min (task user-activity-sync, ET 10:00–02:59 window skipping the
  nightly chain) + appended to sync-incremental.sh push. sync-pull.ts got the
  same NATURAL_KEYS merge for its nightly path. Data repaired + verified: both
  sides now 27 books / 29 sessions / 11,444 raw pages for Rebekah; "A Safe Place
  to Die" pages metadata backfilled locally (322). StatsView: pages get comma
  grouping under 10k and LISTENED shows "97h 10m" (exact stats-client.tsx
  formatMinutes port). Deleted the clanker Skyward test review locally before
  first push so it never lands on the live reviews page.

- **2026-07-12 — Cover picker black-screen fix.** The web-session bridge built its
  redirect from `url.origin`, which behind the dev proxy is ALWAYS localhost:3000 —
  so the phone's webview (calling via the Tailscale IP) was 307'd to its own
  localhost and sat black forever. Route now redirects to the Host header the
  client actually used (curl-verified per-host; bogus token still 401). Server-side
  fix = live for the phone immediately. AdminSheet also gained a loading spinner +
  load-error state (dev-server first compile takes seconds — blank read as broken)
  and a sim-only debug route `TBRA_DEBUG_ROUTE=cover:<slug>` used to verify the
  editor headlessly (screen-locked Mac): upload/URL/OL(34)/ISBNdb sections all
  render in-app.

- **2026-07-13 — Library + My Shelves punch list #3.** (1) Sub-filter chips: stroke
  was clipped by the horizontal ScrollView — chips now scroll full-bleed with
  breathing padding. (2) Advanced Filters expander ported from web (TBR+Activity):
  Year/Type/Format/Sort dropdowns, min-rating stars (Finished/DNF), genre pills,
  active-count badge, Clear all; Owned tab gets the standalone Sort. (3) Library
  rating pill → profile treatment: avatar bubble inside black capsule, exact
  .25/.75 rendering (AvatarRatingPill, shared). (4) TBR note-to-self now shows
  (green pencil badge on cover + 2-line note below, web BookCard parity).
  (5) "Error cancelled" alert after backing out of Shelves: SwiftUI cancels the
  covered screen's .task load — APIError.isCancellation() guard added to
  Library/Shelves/ShelfDetail models. (6) Shelf card plank: thin (5pt) and
  FULL-BLEED like the profile rails. (7) Card redesigned for title space: 2-line
  title, count+Public second row, slimmer mosaic. (8) Following tab WIRED: root
  cause — shelves + shelf_books were absent from EVERY sync path, so followed
  live shelves had no local row; both added to sync-pull + sync-user-activity
  (shelf_books push-guarded via owner-through-shelf lookup), v1 GET /shelves now
  returns `followed`, native Following tab renders owner-attributed cards →
  read-only shelf view. (9) Card tap = shelf view; pencil = EditShelfSheet
  directly (new: name/description/8 color presets/public toggle/delete, backed by
  new APIClient create/update/deleteShelf); detail-page Edit button opens the
  same sheet (owner only). (10) Shelves + shelf detail back buttons → standard
  glass chromeCircle floatingBack (sticky slide-up on scroll). Debug routes:
  TBRA_DEBUG_ROUTE=shelves | library:activity. Sim-verified headless: chips,
  filters toggle, TBR note card, 4.25★ avatar pill, shelves card layout.

- **2026-07-13 — Shelf detail punch list #4.** (1) "by <owner>" + Edit now blue in
  light mode (lime kept in dark) via Color(dark:a3e635, light:0ea5e9). (2) Owner
  name is a real link → public profile (v1 shelf GET now returns ownerUsername/
  DisplayName/AvatarUrl). (3) Shelf color finally ports: count dot, bookcase
  container gradient/border, and per-row planks all tint from shelf.color —
  bookcase rebuilt as the web's chunked 3-up rows with floating shelf lines
  (shelf-view-client parity); shelf-book covers gained spine shadow + owner-
  avatar rating pills. (4) Share → real ShareLink to the public shelf URL
  (public shelves only; lives in a screen overlay — iOS 27 bug #4 kills
  top-strip buttons); Shelf Order → 8-option sort menu; Filters → genre +
  ownership panel w/ clear; drag-reorder disabled while sorted/filtered.
  (5) "Only 4 shelves show": her 5th ("On The King of Kings") was live-only —
  the 2026-07-13 shelves sync gap fix already pulled it; no UI bug. (6) "+ New
  Shelf did nothing": bug #4 again (top-strip button in scroll content) — moved
  to a screen-level overlay, header keeps a placeholder. Debug route added:
  TBRA_DEBUG_ROUTE=shelf:<id>. Sim-verified light mode: blue links, Sky tint
  end-to-end, planked rows, overlay share + New Shelf.

- **2026-07-13 — Shelves rework (user corrections).** Shelves list now matches web:
  amber TOP SHELF card always first, full-width (mosaic of favorites, count line,
  chevron; never reorderable/recolorable) → pushes new TopShelfView (3-col favorites
  grid, drag-reorder, ✕ unpin, avatar+rating pills); custom shelves sit INDENTED
  beneath with LEFT grip handles (hand-drawn GripDots — the circle.grid.2x3.fill
  SF symbol silently renders EMPTY on the iOS 27 SDK, caught via headless
  screenshot) — drag starts on the handle only, card tap = viewer. ✎ now pushes the
  FULL editor (new ShelfEditorView, web /library/shelves/[slug] parity): Add Books
  bottom sheet (search own library, checkbox toggle), Select mode + bulk remove,
  Delete Shelf w/ confirm, drag-reorder rows, per-book notes (inline editor), ✕
  remove w/ confirm, header pencil → name/color sheet + ShareLink. Shelf viewer's
  Edit pill pushes the editor too; viewer reloads onAppear after editor pops.
  NEW v1: GET/PUT /api/v1/favorites (list/reorder), PATCH shelves/:id/books/:bookId
  ({note}, updateShelfBookNoteFor). Debug routes: TBRA_DEBUG_ROUTE=shelfeditor:<id>.
  Sim-verified headless (screenshots): list layout + editor screen.

- **2026-07-13 — Top Shelf card: wood, not orange.** TopShelfListCard (app) + the web
  shelves-client Top Shelf card swapped from #f59e0b amber-orange to the profile
  bookcase's ShelfWood browns (amber-700/800/900), light+dark variants; ShelfWood
  palette made internal (was private to ProfileView). Sim-verified.

- **2026-07-13 — Shelves list follow-ups.** Shelf names now actually wrap to 2 lines
  in ShelfCard + FollowedShelfCard (`.fixedSize(horizontal:false, vertical:true)` —
  without it SwiftUI rendered one truncated line despite lineLimit(2); verified with
  a two-line test shelf). Free tier: custom-shelf list replaced by the web's
  "Upgrade to Based Reader" prompt (custom shelves = premium-only). Clarified in
  code comments: Top Shelf is NEVER recolorable/reorderable for any profile —
  always the real-wood look (already enforced: no pencil/handle/edit path).

- **2026-07-13 — Cover picker dead-on-device root cause: allowedDevOrigins.** Next
  dev blocks /_next assets from non-allowlisted origins: pages served via the
  Tailscale IP rendered (SSR) but NEVER hydrated — no clicks worked in ANY app
  webview, ?editCover=1 silently no-oped, and the page showed the base cover
  instead of the user's edition-selected one ("wrong cover for Between Two Fires";
  live site was fine because it hydrates). Sim never reproduced it (localhost is
  same-origin) until pointed at the IP via new sim-only TBRA_DEBUG_BASEURL env.
  Fix: `allowedDevOrigins: ["100.84.95.103"]` in next.config.ts + dev-server
  kickstart; sim-over-IP verified the picker auto-opens with all sections.

- **2026-07-13 — NATIVE cover picker (webview retired for the pencil).** User asked
  why the picker was a web page — it isn't anymore. New CoverPickerSheet (SwiftUI,
  in BookDetailView.swift): Choose Photo (PhotosPicker, client-side scale/compress
  to the 2MB cap), paste-URL + Set, OL editions grid, ISBNdb/Google grid, audiobook
  square URL field, Remove w/ confirm. Backed by new v1 admin routes: GET
  /api/v1/admin/cover-editor?bookId= (server-side ISBNdb/Google/OL-candidate cascade
  + OL edition covers in one payload; reuses the /api/admin/covers helpers) and
  POST /api/v1/admin/books/[id]/cover (JSON {url|null} · {audiobookUrl|null} ·
  multipart upload; mirrors setBookCover/setAudiobookCover/uploadBookCover
  semantics, ALWAYS bumps updated_at for sync). requireApiAdmin (bearer + users.role)
  in src/lib/api/admin.ts. curl-verified all branches (403 unauth, Amazon-page URL
  rejected, upload lands in /uploads/covers) + sim screenshot via new
  TBRA_DEBUG_ROUTE=coverpicker:<slug>. AdminSheet webview remains ONLY for the
  /admin hub pages.

- **2026-07-13 — Web BottomSheet keyboard trap.** Tall sheets (cover picker) lifted
  by --kb-lift kept their 85vh height, shoving the header + focused input off the
  top of the screen with no way back (user report, mobile web). The visualViewport
  handler now ALSO caps panel maxHeight to vv.height-8 while the keyboard is up,
  so the top edge stays on-screen. Deployed to main.

- **2026-07-14 — "Wrong cover" mystery: edition covers + same-day cover sync.**
  Diagnosis: Between Two Fires was never admin-overridden — the web book page shows
  the user's OWNED-EDITION cover (getEffectiveCoverUrl branch 2) while the v1 book
  payload only implemented the audiobook branch, so the app showed the canonical
  cover. Fix: v1 books/[id] now runs the FULL cascade (getUserOwnedEditions +
  getEffectiveCoverUrl, size L) → new `effectiveCoverUrl` field; BookHero uses it
  (curl-verified with her real data: edition 15093954 over canonical 8044643).
  ALSO: admin cover fixes only rode the NIGHTLY sync — sync-user-activity.ts gained
  a recent-book-covers pass (last 7 days, newest-wins, update-only by PK, source
  side must be cover_source manual/admin-removed so enrichment updated_at bumps
  can't carry a stale cover over a manual fix). Needed idx_books_updated_at on
  local + Turso (live scan timed out without it). Her two native-picker fixes
  (Black Sun, Warp speed) verified on live same-day.

- **2026-07-14 — Book-page punch list #5 (13 items) + home titles.** (1) Home
  Reading Now titles wrap to 3 lines (fixedSize). (2) Audio length next to year
  ONLY when effective format is audiobook (web showAudioLength); else "N pages" —
  verified: Skyward(audio)=15h 28m, BTF=456 pages. (3) NEW FormatIcon helper
  (Models.swift) mirrors web leadFormatIcon: hardcover=book.closed, paperback=book,
  ebook=ipad, audiobook=headphones, multiple/none=books.vertical — Format button no
  longer hardcodes headphones; history rows per-format. (4) Hero bleed extends
  behind the status bar (-140 top, 460h) — no hard line. (5) Bleed + card blur use
  effectiveCoverUrl (edition cover drives the wash color). (6) Reading-state
  dropdown closes on any outside tap (oversized clear catcher under the menu).
  (7) Buddy Read: confirm dialog before create + cover env overrides (was the
  unreachable-back bug again). (8) Summary card = web frosted variant: visible
  border both modes, breathing purple/blue radial blobs (6s), Georgia ” at 280pt
  overhanging bottom-right, clipped. (9+12) SIMILAR BOOKS + SERIES RAIL were
  PERMANENTLY DEAD: body was EmptyView while books empty, and EmptyView never
  fires onAppear/.task → fetch never ran (iOS 27 fires appear lazily; .task also
  cancelled on scroll-past). Fix: 1pt clear placeholder + unstructured Task in
  onAppear. Rails now match web: "Similar Books" heading, 120pt cards w/ italic
  reason captions; "More In This Series" includes current book w/ lime ring,
  integer-position filter, auto-centers. (10) Rate & review = RoundedRectangle 14
  like every other button. (11) ReviewHTML parser (ReviewsListView.swift): sanitized
  HTML → styled AttributedString (p/div/br/b/i/u/s/lists/entities) + spoiler-tag
  spans as tappable links — hidden = transparent text on surface-alt chip (web
  parity), tap reveals/re-hides each independently. Verified on the Skyward review
  that used to show raw <div>s. (13) NATIVE Admin Edit panel on book page
  (super-admin): 13 fields + genre chips, GET/POST /api/v1/admin/books/[id]/fields
  + /genres (always bump updated_at; web updateBookFields patched to bump too).

- **2026-07-14 — Book page round 6.** Admin Edit moved up to sit directly below the
  summary card. Summary quote glyph fixed: at the old offset only the round HEADS
  of the 280pt ” survived the clip — two meaningless circles on device; now 200pt
  at y:78 shows heads+tails (opacity bumped to .08/.10). Reading Notes collapse to
  a peek stack: newest note over disappearing edges (count-aware, profile-journal
  pattern) + "View all N notes" / "Show latest only". Friends Who Read: rows with a
  review now route to ReviewsRoute(scrollTo: reviewId) — payload always carried
  reviewId, the Swift model just dropped it; label gains "· reviewed it" + quote
  icon; others still open the profile. Sim-verified all four.
