# tbr*a Beta Launch Roadmap

## Tier 1: Must-Have Before Beta Launch

1. **Account types & admin access** — Super admin sharing (1-2 others), beta tester premium without payment, account type flags displayed properly
2. **Corrections triage pipeline** — Admin review system for beta tester submissions
3. **Beta issue reporting button** — Visible button for testers to report issues, logged for daily review
4. **Light mode green-on-green fixes** — Fix all instances of green text on green backgrounds. Exceptions (keep green): mood buttons + ignore preferences on Discover, year/all-time toggles on Stats, match details on Discover gems, hearted options in reading preferences
5. **Hide book option** — Let users permanently hide a book from all recommendations
6. **Account/display/notification settings + contact us** — Full settings page with functioning contact option
7. **Social features: following + activity** — Follow users, see followed users' activity on book pages and Home feed

## Tier 2: Polished Beta Experience

8. **System mode toggle** — Add "system" option to light/dark mode toggle
9. ~~**Rename Dig → Discover**~~ ✅ — Page renamed, H1 is "Find Your Next Read", info tooltip updated
10. **Search bar visual redesign** — New expansion behavior (details TBD)
11. **SEO for book pages** — Meta tags, Open Graph, structured data for book pages; extend to other pages
12. **Desktop/web layout** — Responsive layouts for non-mobile screens
13. **Stats page overhaul** — More app-like design inspired by Fable/Pagebound

## Tier 3: Post-Beta / Parallel

14. Google + Apple login (waiting on credentials from user)
15. Free vs. premium feature gating
16. Custom shelves / book lists (premium feature)
17. User submission process for content details (non-admin)
18. Xcode / App Store packaging (needs Apple Developer account)
19. Google Play packaging (needs Google Play Console)
20. Mobile animations refinement
21. Buddy reads (much later phase)
22. **Pacing-based recommendations** — Once enough user reviews include pacing data (slow/medium/fast), aggregate review pacing tags into a book-level pacing score, then add a pacing filter to Discover and wire pacing into the recommendation scoring logic (scaffold #6 in recommendations.ts). Requires: aggregation query, book-level pacing field or materialized view, Discover UI filter, scoring integration.

## Completed

- Security hardening (password hashing, sessions, email verification via Resend)
- Spoiler tags on featured reviews
- Series shelf vertical centering
- Delete option on reading journal notes from Profile
- Public profile & social sharing (share links, social icons, follow button placeholder)
- Bottom nav redesign (Dig/Bookshelf/Home/Stats/Profile with Home standout)
- Pull-to-refresh + page transitions
- Database cleanup: 3,240+ junk/duplicate/foreign books removed
- Enrichment pipeline overhaul: OL → Brave → Google Books tiered approach
- Series health audit: 66 auto-positioned, 30+ junk series dissolved, 82 duplicate positions fixed
- Box set auto-detection and filtering from recommendations
- Non-English book filtering in enrichment pipeline
- Similar Books: excludes same-series and out-of-order books
- Stats page: gradient cards, reading goal, genre donut, monthly bar chart
- Discover/Dig page: mood cards, gem sparkle, gradient dividers, visual polish
- LitRPG genre priority over Sci-Fi
- Summary truncation to 190 chars
- Content rating deduplication
- Enrichment: Phase 0 OL search by title, Brave metadata fallback, author/series discovery with Brave+GBooks fallback
- Rename Dig → Discover (page name, H1, info tooltip)
- Home page info bubbles on "Because You Liked" and "Discover Something New" sections
- Friends Activity horizontal scroll on mobile (unified layout with desktop)
