# tbr*a Beta Launch Roadmap

## Round 6 (2026-04-07) ✅ — Pre-beta bug bash + search rewrite

### Critical fixes
- **Amazon affiliate button** visible for logged-out users (unblocks Amazon Associates approval — was rejected twice). Renamed from "Affiliate" to "Buy".
- **UUID URLs no longer leak to Google** — all internal links use slugs, `robots.txt` disallows UUID-pattern paths.
- **PWA white screen (20s)** — added `src/app/loading.tsx` for streaming, splash waits for `<nav>` element, SW uses exponential backoff retry (was meta-refresh loop).
- **Search crash on live** — `/api/search` `searchSeries()` now fetches books per series and client has defensive optional chaining.
- **CRON_SECRET env var whitespace** had been silently blocking all Vercel deploys for 3 days — no code had actually been shipping. Fixed.

### Buddy Reads overhaul
- Removed custom "buddy read name" field — auto-names from book title
- Progress shows 100% for finished books (was stuck at last note percentage)
- "Mark Complete" → "End Buddy Read" with confirmation dialog
- All 10 notification types now have `link_url` for clickable navigation
- "Share to buddy read" toggle on reading notes posts formatted update to discussion
- Full color sweep (`text-primary` → `text-foreground`, undefined `text-secondary`/`text-tertiary` → `text-muted`)
- New `getActiveBuddyReadsForBook()` query

### Review wizard, reading history, and dates
- Keyboard layout fixed via `100dvh` on root container (was pushing header off-screen on mobile)
- Step 2 mood pill color fixed (`text-primary` → `text-accent` so global light-mode override applies)
- New `reading_sessions.started_at_explicit` column tracks user-specified start dates
- `formatDate()` respects `completionPrecision` — year-only shows "2024", month/year shows "Apr 2026"
- Default finish date to today ONLY when transitioning from `currently_reading` → `completed`; leave null for direct TBR → Finished skips
- Re-read finish no longer auto-opens review wizard (gated on `!hasCompleted`)
- Finish date dialog uses `createPortal` + `z-[200]` to escape stacking contexts
- Friends' feed reviews link directly to `/book/{slug}/reviews#review-{id}`

### Classification & taxonomy
- `classifyGenres()` takes `isFiction` and filters whitelist (nonfiction books like Jesus Revolution no longer pick "Christian Fiction" primary)
- Added "Christian Nonfiction", "Christian Living" to `NONFICTION_GENRES`
- **Graphic novel backfill:** ~3,276 books tagged based on publisher match (Marvel, DC, Image, IDW, Dark Horse, Vertigo, Viz Media, Kodansha, Tokyopop, Yen Press, Seven Seas, Idea & Design Works, Boom Studios, Vault Comics, etc.). Both local and Turso.
- LGBTQIA+ → LGBTQ+ sitewide (seed, taxonomy, methodology, onboarding, settings, enrichment)

### Search rewrite ⚡
- **Full search page now queries local DB only** — 20-80ms typical (was 5-30 seconds)
- Previously made up to 11 sequential OpenLibrary HTTP calls per query
- ISBNdb fallback only fires when local returns fewer than 5 results
- **Hard daily cap: 2,000 ISBNdb search calls** via new `api_quota_usage` table (atomic `INSERT ... ON CONFLICT`). Enrichment gets the rest of the 15K/day premium budget.
- In-memory LRU cache (200 entries, 5-min TTL) per query on `/api/search/external`
- New `importFromISBNdbAndReturn()` creates minimal book row + generates SEO slug + triggers background enrichment
- `ReadingStateButton` + `setBookStateWithImport` accept `externalImport` prop to route ISBNdb-sourced clicks through the new import path

### SEO regression fix
- Book page title restored to `What's Inside {book} | tbr*a` (was silently changed to `{book} by {author} | tbr*a` on March 30 in the "Performance overhaul" round)
- Audited all 29 `generateMetadata`/metadata files sitewide — no other templates were changed from the original SEO plan
- Mixed `tbr*a` vs `The Based Reader App` brand naming is intentional (short UI pages vs conversion/landing pages)

### Schema migrations applied (local + Turso)
- `user_notifications.link_url TEXT` (nullable)
- `reading_sessions.started_at_explicit INTEGER NOT NULL DEFAULT 0` (backfilled to 1 for all existing rows)
- `api_quota_usage (api_name, date, count)` with unique index

## Tier 1: Must-Have Before Beta Launch ✅ COMPLETE

1. ~~**Account types & admin access**~~ ✅ — Super admin sharing (Seth Cordle added), beta tester type with report access and pacing trust, account type dropdown on admin Users page
2. ~~**Corrections triage pipeline**~~ → Moved to Tier 3 (beta testers use issue reporting; formal corrections pipeline not needed for beta launch)
3. ~~**Beta issue reporting button**~~ ✅ — Report button visible for beta_tester, admin, and super_admin accounts on all book pages
4. ~~**Light mode green-on-green fixes**~~ ✅ — Fixed all instances; exceptions preserved (mood buttons, ignore preferences on Discover, year/all-time toggles on Stats, match details on Discover gems, hearted options in reading preferences)
5. ~~**Hide book option**~~ ✅ — Users can permanently hide a book from all recommendations
6. ~~**Account/display/notification settings + contact us**~~ ✅ — Full settings page with change password, reading preferences, content comfort zone, display settings, notification preferences, and contact page
7. ~~**Social features: following + activity**~~ ✅ — Follow users, see followed users' activity on Home feed (horizontal scroll on mobile, card layout on desktop)

## Tier 2: Polished Beta Experience ✅ COMPLETE

8. ~~**System mode toggle**~~ ✅ — Light/Dark/System toggle with device-adaptive icon
9. ~~**Rename Dig → Discover**~~ ✅ — Page renamed, H1 is "Find Your Next Read", info tooltip updated
10. ~~**Search bar visual redesign**~~ ✅ — Deduplication (strips parentheticals, scores by quality), fuzzy/typo-tolerant search (Levenshtein distance), race condition fix (AbortController), smart quote normalization, box set filtering
11. ~~**SEO for all pages**~~ ✅ — Full metadata, OpenGraph, Twitter Cards, robots.ts, sitemap.ts, Organization + WebSite + Book JSON-LD structured data, auth page noindex, logo.png
12. ~~**Desktop/web layout**~~ ✅ — All admin pages at 60% width centered on desktop (matching Settings/Import)
12b. ~~**Up Next drag-to-reorder**~~ ✅ — Apple-style item shifting animation with CSS order + transitions, drop target highlight
12c. ~~**Consistent "Finished" flow**~~ ✅ — Review wizard now auto-opens after date picker confirmation from all locations (book page, series page, search). Fixed by moving onStateChange outside startTransition.
13. ~~**Stats page overhaul**~~ ✅ — Gradient cards, reading goal, genre donut, monthly bar chart, streak tracking

## Tier 3: Post-Beta / Parallel

### Blocked — waiting on external dependencies
- **Amazon Creators API integration** — Replace OpenLibrary as primary data source for book discovery and series gap-filling. Will dramatically improve coverage for self-pub and niche books. Script `scripts/audit-series.ts` and gap report `data/series-missing-book1.md` (1,302 series) ready to re-run once API access is granted.

### Revenue & Premium Features
1. ~~**Free vs. premium feature gating**~~ ✅ — isPremium() helper, PremiumGate component, /upgrade page, based_reader→premium rename (2026-03-28)
2. ~~**Custom shelves / book lists**~~ ✅ — Premium feature. Create/edit/delete shelves with custom colors (8 presets), add/remove books, per-book notes, mass select, public sharing via `/u/[username]/shelves/[slug]`, bookshelf-style public view (3 books per shelf row), profile display with horizontal book scroll per shelf, "Add to Shelf" button on book pages. Following others' public shelves is free; creating/sharing requires Based Reader. (2026-03-28)
3. ~~**Full data exports**~~ ✅ — CSV (free, Goodreads-compatible) + JSON (premium, complete dump) via Settings page (2026-03-28)
4. **Reading challenges for premium users** — Challenges that offer discount codes from advertisers (non-data-targeted ad model)

### User Experience & Polish
4. **Mobile animations refinement** — Page transitions, interactive element polish
5. **Corrections triage pipeline** — Formal admin review system for beta tester content detail submissions. Currently handled via issue reports.
6. **User submission process for content details** (non-admin) — Let users contribute content ratings
7. **Pacing-based recommendations** — Pacing aggregation and display built (stoplight-colored pills on book pages, beta_tester + super_admin pacing trusted). Once enough reviews include pacing data, add pacing filter to Discover and wire into recommendation scoring.
8. **Comic/manga series parent pages** — Group high-volume series into season/arc/volume sub-series with parent page linking them.

### Round 4
- ~~**Follow Author + notifications**~~ ✅ — Follow button on author pages, follower count, new-book notification script (2026-03-31)
- ~~**TBR Notes (Based Reader)**~~ ✅ — Premium note editor inside state dropdown, note previews on library TBR grid (2026-03-31)
- ~~**Pre-publication ARC review gates**~~ ✅ — ARC source dropdown + proof upload → admin review queue at `/admin/arc-reviews` → ARC badge on approved reviews (2026-03-31)
- ~~**Admin notification broadcast**~~ ✅ — Super admin sends to all users via `/admin/broadcast` (2026-03-31)
- ~~**Shelf following + discovery**~~ ✅ — "Other shelves with this book" in Shelves bottom sheet, My Shelves/Following tabs, shelf reorder with @dnd-kit (2026-03-31)
- ~~**Shelf followed → notification**~~ ✅ — (2026-03-30)
- ~~**Review marked as helpful → notification**~~ ✅ — (2026-03-30)
- ~~**Book page button declutter**~~ ✅ — Conditional Up Next/Format, combined Top Shelf into Shelves bottom sheet, neon-blue Shelves button (2026-03-31)
- ~~**Amazon affiliate disclosure**~~ ✅ — Confirmation dialog + FTC-compliant footer (2026-03-31)
- ~~**Speed fixes**~~ ✅ — Cached heavy queries, added indexes, reduced revalidation blast radius (2026-03-31)
- ~~**Referral program**~~ ✅ — Tracking only: unique referral codes, signup capture via ?ref=CODE, in-app notifications to referrer, profile card with copy link + count (2026-03-31)
- ~~**PWA (Progressive Web App)**~~ ✅ — Installable from browser, offline fallback page, service worker with static asset caching, web app manifest, generated icons from logo. Bridge distribution until app store packaging. (2026-03-31)

### Later Phase
9. **Buddy reads** — Social reading feature (much later)
10. **Handle change redirects** — Store previous usernames and add redirect middleware so old `/u/` links still work after a handle change

### Needs External Accounts/Credentials
10. Google + Apple login (waiting on credentials)
11. Xcode / App Store packaging (needs Apple Developer account)
12. Google Play packaging (needs Google Play Console)

### Completed
- ~~**Custom shelves / book lists**~~ ✅ (2026-03-28)
- ~~**Free vs. premium feature gating**~~ ✅ (2026-03-28)
- ~~**Full data exports**~~ ✅ (2026-03-28)
- ~~**New follower notifications**~~ ✅ (2026-03-28)
- ~~**Follow Author + notifications**~~ ✅ (2026-03-31)
- ~~**TBR Notes (Based Reader)**~~ ✅ (2026-03-31)
- ~~**Pre-publication ARC review gates**~~ ✅ (2026-03-31)
- ~~**Admin notification broadcast**~~ ✅ (2026-03-31)
- ~~**Shelf following + discovery + reorder**~~ ✅ (2026-03-31)
- ~~**Book page button declutter**~~ ✅ (2026-03-31)
- ~~**Amazon affiliate disclosure**~~ ✅ (2026-03-31)
- ~~**Speed optimizations (caching + indexes + revalidation)**~~ ✅ (2026-03-31)

## Completed (2026-03-28 Session)

### Data Integrity & Series Fixes
- Sanderson/Cosmere series restructured: Hoid's Travails, Secret Projects, Elantris, Cosmere (Other), Stormlight Archive supplementary novellas
- 22 user-reported issues resolved: duplicates merged, missing books added, genres fixed, series positions corrected
- Series audit script (`scripts/audit-series.ts`): scans all series for missing book 1, position gaps, missing years; comic/manga detection; OL rate limiting
- 337 missing publication years fixed across all series
- 31 missing books added/linked to series
- 1,302 series with missing book 1 documented for future Amazon API integration
- He Who Fights with Monsters series cleaned up (dupes removed, positions set)
- Requiem (Lauren Oliver) fixed: wrong OL key was pointing to 1940 edition

### Deploy & Sync Safety
- **deploy.sh fixed** — was doing destructive DELETE-all + re-insert on every deploy, destroying live user data. Now uses incremental sync (pull then push), never deletes.
- Sync script properly handles bidirectional data flow: user data stays on live, book data pushed from local

### Search Fixes
- Smart/curly quote normalization in search (mobile keyboards insert U+2019 instead of U+0027)
- Box sets filtered from search bar dropdown results
- Duplicate search entries merged (Assassin's Apprentice, Babel, Assistant to the Villain, etc.)

### Reading State & Stats
- Paused books excluded from Discover and Home recommendations
- Paused books always get a reading session with start date (ensureReadingSession before pause)
- StoryGraph import now recognizes "paused" state (was silently mapping to TBR)
- Pause/resume time tracking: `paused_at` and `total_paused_days` columns on reading_sessions
- Stats "Avg pace" now subtracts paused days for accurate active reading time
- Reading History: paused sessions show 3 date spots (start → paused → finish)
- Reading History date inputs: save on blur (not onChange) to prevent partial saves
- Optimistic UI for date edits (instant visual update, server save in background)
- "Invalid Date" display fixed (rejects years <1900 or >2100)

### Analytics & Email
- GA4 tracking added (G-WMF29PM9E2) via next/script afterInteractive
- GSC verified via DNS TXT record
- Resend upgraded to Pro plan ($20/mo, 50k emails)
- Per-signup notification emails replaced with daily digest (conserves Resend quota)

### Settings & UI
- "Auto-saved" pill added to Reading Preferences header
- Admin pages (all 6) set to 60% width on desktop

## Previously Completed

### Infrastructure & Security
- Security hardening (password hashing, sessions, email verification via Resend)
- Password reset flow (forgot password page + reset via email link)
- Change password in Settings
- Signup notification emails to hello@thebasedreader.app (now daily digest)
- Database sync tooling (incremental pull/push, admin Sync Users button)
- Vercel deploy pipeline fixed (root directory config, then incremental sync)
- Homepage performance caching (unstable_cache for landing page data)

### Landing Page & Navigation
- New landing page for logged-out users (hero section, feature cards, book parade, CTA)
- Admin CMS for all landing page copy (20 editable sections in DB, admin UI at /admin/landing)
- Admin landing page book manager (/admin/landing) for curating hero/parade books
- Hero cover mosaic: proper aspect ratios, light mode opacity boost
- Frosted glass cards (For Readers/Parents, feature cards) with gradient tints
- "Sign in" links in branded neon-blue
- Nav cleanup: theme toggle moved into hamburger menu, green Sign Up pill on mobile
- Desktop nav: logged-out users see Home, Discover, Our Methodology
- Hamburger menu: logged-out users see Sign In, Our Methodology, Discover, Theme toggle
- Favicon: Space Grotesk asterisk with brand gradient (lime → blue → purple)
- Light mode: warmer background (#f5f4f8), vibrant gradient glows, softer surfaces
- Settings, Import, and all Admin pages: 60% width centered on desktop

### Book Pages & Content
- Pacing system: aggregation from reviews, stoplight-colored pills (green/amber/red), super_admin + beta_tester trust
- Info bubbles on Home ("Discover Something New") and Discover page with overlay tooltips
- Top Shelf toast notification on adding favorites
- Amazon buy button updated to affiliate homepage link
- Summary backfill for books with descriptions
- Similar Books: excludes same-series and out-of-order books
- Content rating deduplication
- Standardized intensity labels: None / Mild / Moderate / Significant / Extreme
- Reading History section: view/edit start & finish dates, add re-reads, delete sessions, optimistic UI
- Reading progress pills on Currently Reading cards (frosted glass, percentage from notes)
- DNF/Pause confirmation dialogs from Home page
- Featured book "See full descriptions" link with #whats-inside anchor
- Desktop book page: summary flush with card top, duplicate report button removed
- Consistent "Finished" flow: review wizard auto-opens from all locations after date picker

### SEO & Metadata
- Homepage: meta description + OpenGraph tags
- Bookshelf: title + description (noindex)
- Stats: title + description (noindex)
- Methodology: title + description + OpenGraph
- Book pages: dynamic title, description, canonical URL, OpenGraph with cover image, Book JSON-LD schema
- Author pages: dynamic title, description, canonical URL, OpenGraph
- Series pages: dynamic title, description, canonical URL, OpenGraph
- User profiles: dynamic title, description, OpenGraph
- Organization schema with founder (Rebekah Edwards), social accounts, logo
- WebSite schema with SearchAction
- Dynamic sitemap.ts covering all public books, authors, series, profiles
- robots.ts with crawl rules and sitemap reference
- Twitter Card and theme-color meta tags
- Auth page noindex (login, signup, forgot-password)
- GA4 tracking (G-WMF29PM9E2)
- GSC verified via DNS

### Search & Discovery
- Search deduplication: normalizes titles, scores by quality, groups by title+author
- Fuzzy/typo-tolerant search: Levenshtein edit distance, ~35% tolerance, works on books/authors/series
- Smart/curly quote normalization for mobile keyboard compatibility
- Box sets filtered from search dropdown results
- Race condition fix: AbortController, request ID tracking, no flash-to-empty
- Discover page: filter state persisted in URL params (back button restores selections + results)
- Paused books excluded from recommendations (Discover + Home)

### Bookshelf & Stats
- Advanced bookshelf filters: year, genre, fiction/nonfiction, format, min rating, sort
- All filter state URL-driven (deep links work, back button preserves)
- Genre pills populated from user's actual books
- Default tab changed to TBR (was Activity)
- Deep links: reading goal on Home → bookshelf filtered view, books count on Stats → bookshelf
- Pencil icon for editing reading goal (separate from card navigation)
- Reading pace calculation subtracts paused time for accuracy

### Database & Enrichment
- Comprehensive dedup system: 1400+ duplicate books merged/deleted across local and live
- Dedup script with scoring (cover, ratings, clean title), user data migration, dry-run mode
- Hardened import matching: normalized title comparison prevents future dupes
- Enrichment: never overwrites manually-set covers (Amazon URLs, manual source)
- Sync script: always pulls live covers as authoritative source
- Non-English book filtering tightened (French, Spanish, suffix patterns, Estuche/Coffret)
- Auto-pause enrichment on API exhaustion
- 5,500+ books enriched in overnight runs
- 314 non-English junk entries cleaned
- Enrichment pipeline overhaul: OL → Brave → Google Books tiered approach
- Series health: Ender universe, Divergent, Maximum Ride, Sanderson/Cosmere, HWFWM, Riyria, Three-Body Problem, Lunar Chronicles, and many more
- Series audit script with comic/manga detection, position gap filling, year backfill

### Import System
- Two-phase import: fast Phase 1 (DB matching + state setting, no API calls) then background Phase 2 (OL search + enrichment)
- Chunked imports: client sends 100-book batches to avoid Vercel 5-min timeout
- Pre-loaded lookup cache: ISBNs, titles, authors, slugs all in memory — eliminates per-book DB round-trips
- Goodreads, StoryGraph (with paused state support), and Libby (OverDrive) importers
- Libby import: parses audiobook loan history, three default state options (completed/TBR/review each), Safari warning
- Re-import checkbox: skips books already in user's library (prevents duplicate sessions)
- Navigation warning during import (beforeunload + route change interceptor)
- Book-opening animation on import completion with count ticker
- In-app notification bell when background enrichment completes
- Fixed re-read session duplication (Goodreads only has one dateRead per book)

### User & Account Features
- Password reset flow (forgot password page + reset via email link)
- Change password in Settings
- Email verification: auto-redirect on verify, polling for verification status
- Daily signup digest email (replaces per-signup notifications, conserves Resend quota)
- Auto-generate handles from display names (or email prefix if no name)
- Profile bio: line breaks preserved
- Reviews: show all sources on profile (not just user-created), fix "Anonymous" display
- Notification bell with unread badge in nav bar
- Beta tester report icon visibility fixed
- Database sync tooling (incremental pull/push, admin Sync Users button, cover sync)
- "Auto-saved" indicator on Reading Preferences settings

### Design & UI
- Discover/Dig page: mood cards, gem sparkle, gradient dividers, visual polish
- Stats page: gradient cards, reading goal, genre donut, monthly bar chart
- LitRPG genre priority over Sci-Fi
- Methodology page: removed Home link, reordered sections, updated contact email
- Pill/badge styles: translucent backgrounds, never solid fills
- Up Next drag-to-reorder: Apple-style item shifting with CSS order transitions
