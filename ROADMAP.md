# tbr*a Beta Launch Roadmap

## Tier 1: Must-Have Before Beta Launch

1. ~~**Account types & admin access**~~ ✅ — Super admin sharing (Seth Cordle added), beta tester type with report access and pacing trust, account type dropdown on admin Users page
2. **Corrections triage pipeline** — Admin review system for beta tester submissions
3. ~~**Beta issue reporting button**~~ ✅ — Report button visible for beta_tester, admin, and super_admin accounts on all book pages
4. ~~**Light mode green-on-green fixes**~~ ✅ — Fixed all instances; exceptions preserved (mood buttons, ignore preferences on Discover, year/all-time toggles on Stats, match details on Discover gems, hearted options in reading preferences)
5. ~~**Hide book option**~~ ✅ — Users can permanently hide a book from all recommendations
6. ~~**Account/display/notification settings + contact us**~~ ✅ — Full settings page with change password, reading preferences, content comfort zone, display settings, notification preferences, and contact page
7. ~~**Social features: following + activity**~~ ✅ — Follow users, see followed users' activity on Home feed (horizontal scroll on mobile, card layout on desktop)

## Tier 2: Polished Beta Experience

8. ~~**System mode toggle**~~ ✅ — Light/Dark/System toggle with device-adaptive icon
9. ~~**Rename Dig → Discover**~~ ✅ — Page renamed, H1 is "Find Your Next Read", info tooltip updated
10. **Search bar visual redesign** — 🟡 In progress; additional search UX edits planned
11. **SEO for all pages** — 🟡 Metadata + OpenGraph done for homepage, book pages, author pages, series pages, discover, methodology, bookshelf, stats, user profiles. Still needed: robots.txt, sitemap.ts, JSON-LD structured data (Book schema, Organization/Website schema), Twitter Card tags, auth page metadata
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
22. **Pacing-based recommendations** — Pacing aggregation and display built (stoplight-colored pills on book pages, beta_tester + super_admin pacing trusted). Once enough reviews include pacing data, add pacing filter to Discover and wire into recommendation scoring (scaffold #6 in recommendations.ts).
23. **New follower notifications** — Email and/or in-app notification when someone follows you. Currently no notification is triggered on follow.

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

### Design & UI
- Discover/Dig page: mood cards, gem sparkle, gradient dividers, visual polish
- Stats page: gradient cards, reading goal, genre donut, monthly bar chart
- LitRPG genre priority over Sci-Fi
- Methodology page: removed Home link, reordered sections (Evidence Levels before What We Track), updated contact email to hello@thebasedreader.app
- Pill/badge styles: translucent backgrounds, never solid fills
