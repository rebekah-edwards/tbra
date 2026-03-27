# tbr*a Beta Launch Roadmap

## Tier 1: Must-Have Before Beta Launch

1. ~~**Account types & admin access**~~ ✅ — Super admin sharing (Seth Cordle added), beta tester type with report access and pacing trust, account type dropdown on admin Users page
2. ~~**Corrections triage pipeline**~~ → Moved to Tier 3 (beta testers use issue reporting; formal corrections pipeline not needed for beta launch)
3. ~~**Beta issue reporting button**~~ ✅ — Report button visible for beta_tester, admin, and super_admin accounts on all book pages
4. ~~**Light mode green-on-green fixes**~~ ✅ — Fixed all instances; exceptions preserved (mood buttons, ignore preferences on Discover, year/all-time toggles on Stats, match details on Discover gems, hearted options in reading preferences)
5. ~~**Hide book option**~~ ✅ — Users can permanently hide a book from all recommendations
6. ~~**Account/display/notification settings + contact us**~~ ✅ — Full settings page with change password, reading preferences, content comfort zone, display settings, notification preferences, and contact page
7. ~~**Social features: following + activity**~~ ✅ — Follow users, see followed users' activity on Home feed (horizontal scroll on mobile, card layout on desktop)

## Tier 2: Polished Beta Experience

8. ~~**System mode toggle**~~ ✅ — Light/Dark/System toggle with device-adaptive icon
9. ~~**Rename Dig → Discover**~~ ✅ — Page renamed, H1 is "Find Your Next Read", info tooltip updated
10. ~~**Search bar visual redesign**~~ ✅ — Deduplication (strips parentheticals, scores by quality), fuzzy/typo-tolerant search (Levenshtein distance), race condition fix (AbortController), dropdown shows only tbr*a library books
11. ~~**SEO for all pages**~~ ✅ — Full metadata, OpenGraph, Twitter Cards, robots.ts, sitemap.ts, Organization + WebSite + Book JSON-LD structured data, auth page noindex, logo.png
12. **Desktop/web layout** — 🟡 Nearly complete; a few small changes remaining
13. ~~**Stats page overhaul**~~ ✅ — Gradient cards, reading goal, genre donut, monthly bar chart, streak tracking

## Tier 3: Post-Beta / Parallel

14. Google + Apple login (waiting on credentials from user)
15. Free vs. premium feature gating
16. Custom shelves / book lists (premium feature)
17. User submission process for content details (non-admin)
18. Xcode / App Store packaging (needs Apple Developer account)
19. Google Play packaging (needs Google Play Console)
20. Mobile animations refinement
21. Buddy reads (much later phase)
22. **Reading challenges for premium users** — Challenges that offer discount codes from advertisers (non-data-targeted ad model)
23. **Pacing-based recommendations** — Pacing aggregation and display built (stoplight-colored pills on book pages, beta_tester + super_admin pacing trusted). Once enough reviews include pacing data, add pacing filter to Discover and wire into recommendation scoring (scaffold #6 in recommendations.ts).
23. **New follower notifications** — Email and/or in-app notification when someone follows you. Currently no notification is triggered on follow.
24. **Corrections triage pipeline** — Formal admin review system for beta tester content detail submissions. Currently handled via issue reports.

## Completed

### Infrastructure & Security
- Security hardening (password hashing, sessions, email verification via Resend)
- Password reset flow (forgot password page + reset via email link)
- Change password in Settings
- Signup notification emails to hello@thebasedreader.app
- Database sync tooling (incremental pull/push, admin Sync Users button)
- Vercel deploy pipeline fixed (root directory config)
- Homepage performance caching (unstable_cache for landing page data)

### Landing Page & Navigation
- New landing page for logged-out users (hero section, feature cards, book parade, CTA)
- Admin landing page book manager (/admin/landing) for curating hero/parade books
- Nav cleanup: theme toggle moved into hamburger menu, green Sign Up pill on mobile
- Desktop nav: logged-out users see Home, Discover, Our Methodology
- Hamburger menu: logged-out users see Sign In, Our Methodology, Discover, Theme toggle
- Favicon: Space Grotesk asterisk with brand gradient (lime → blue → purple)

### Book Pages & Content
- Pacing system: aggregation from reviews, stoplight-colored pills (green/amber/red), super_admin + beta_tester trust
- Info bubbles on Home ("Discover Something New") and Discover page with overlay tooltips
- Top Shelf toast notification on adding favorites
- Amazon buy button updated to affiliate homepage link
- Summary backfill for books with descriptions
- Similar Books: excludes same-series and out-of-order books
- Content rating deduplication
- Summary truncation to 190 chars

### SEO & Metadata
- Homepage: meta description + OpenGraph tags
- Bookshelf: title + description (noindex)
- Stats: title + description (noindex)
- Methodology: title + description + OpenGraph
- Book pages: dynamic title, description, canonical URL, OpenGraph with cover image
- Author pages: dynamic title, description, canonical URL, OpenGraph
- Series pages: dynamic title, description, canonical URL, OpenGraph
- User profiles: dynamic title, description, OpenGraph

### Reading & Social Features
- Social features: follow users, activity feed on Home (horizontal scroll mobile, cards desktop)
- Friends Activity refactored to horizontal scroll on mobile
- Pull-to-refresh + page transitions
- Bottom nav redesign (Discover/Bookshelf/Home/Stats/Profile with Home standout)
- Public profile & social sharing (share links, social icons, follow button)

### Database & Enrichment
- Database cleanup: 3,240+ junk/duplicate/foreign books removed
- Enrichment pipeline overhaul: OL → Brave → Google Books tiered approach
- Series health audit: 66 auto-positioned, 30+ junk series dissolved, 82 duplicate positions fixed
- Box set auto-detection and filtering from recommendations
- Non-English book filtering in enrichment pipeline
- Enrichment: Phase 0 OL search by title, Brave metadata fallback, author/series discovery with Brave+GBooks fallback
- Example/test accounts cleaned up (deleted @example.com and test@spine.dev accounts)

### Import System
- Two-phase import: fast Phase 1 (DB matching + state setting, no API calls) then background Phase 2 (OL search + enrichment)
- Chunked imports: client sends 100-book batches to avoid Vercel 5-min timeout
- Pre-loaded lookup cache: ISBNs, titles, authors, slugs all in memory — eliminates per-book DB round-trips
- Goodreads, StoryGraph, and Libby (OverDrive) importers
- Libby import: parses audiobook loan history, three default state options (completed/TBR/review each), Safari warning
- Re-import checkbox: skips books already in user's library (prevents duplicate sessions)
- Navigation warning during import (beforeunload + route change interceptor)
- Book-opening animation on import completion with count ticker
- In-app notification bell when background enrichment completes
- Fixed re-read session duplication (Goodreads only has one dateRead per book)

### Book Pages & Content
- Pacing system: aggregation from reviews, stoplight-colored pills (green/amber/red), super_admin + beta_tester trust
- Info bubbles on Home ("Discover Something New") and Discover page with overlay tooltips
- Top Shelf toast notification on adding favorites
- Amazon buy button updated to affiliate homepage link
- Summary backfill for books with descriptions
- Similar Books: excludes same-series and out-of-order books
- Content rating deduplication
- Standardized intensity labels: None / Mild / Moderate / Significant / Extreme
- Reading History section: view/edit start & finish dates, add re-reads, delete sessions
- Reading progress pills on Currently Reading cards (frosted glass, percentage from notes)
- DNF/Pause confirmation dialogs from Home page
- Featured book "See full descriptions" link with #whats-inside anchor
- Desktop book page: summary flush with card top, duplicate report button removed

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

### Search & Discovery
- Search deduplication: normalizes titles, scores by quality, groups by title+author
- Fuzzy/typo-tolerant search: Levenshtein edit distance, ~35% tolerance, works on books/authors/series
- Race condition fix: AbortController, request ID tracking, no flash-to-empty
- Discover page: filter state persisted in URL params (back button restores selections + results)

### Bookshelf & Stats
- Advanced bookshelf filters: year, genre, fiction/nonfiction, format, min rating, sort
- All filter state URL-driven (deep links work, back button preserves)
- Genre pills populated from user's actual books
- Default tab changed to TBR (was Activity)
- Deep links: reading goal on Home → bookshelf filtered view, books count on Stats → bookshelf
- Pencil icon for editing reading goal (separate from card navigation)

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
- Settings and Import pages: 60% width centered on desktop

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
- Series health: Ender universe (4 series created/fixed), Divergent, Maximum Ride, Game Changers, Quicksilver, Shadow and Bone, ACOTAR, Naturals, and many more

### User & Account Features
- Password reset flow (forgot password page + reset via email link)
- Change password in Settings
- Email verification: auto-redirect on verify, polling for verification status
- Signup notification emails to hello@thebasedreader.app
- Auto-generate handles from display names (or email prefix if no name)
- Profile bio: line breaks preserved
- Reviews: show all sources on profile (not just user-created), fix "Anonymous" display
- Notification bell with unread badge in nav bar
- Beta tester report icon visibility fixed
- Database sync tooling (incremental pull/push, admin Sync Users button, cover sync)

### Design & UI
- Discover/Dig page: mood cards, gem sparkle, gradient dividers, visual polish
- Stats page: gradient cards, reading goal, genre donut, monthly bar chart
- LitRPG genre priority over Sci-Fi
- Methodology page: removed Home link, reordered sections, updated contact email
- Pill/badge styles: translucent backgrounds, never solid fills
