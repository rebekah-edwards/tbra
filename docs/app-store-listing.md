# App Store listing copy (iOS 1.0)

Agreed with Rebekah on 2026-11-16 and ENTERED into App Store Connect the same
day (name, subtitle, categories, keywords, promotional text, description,
support/marketing/privacy URLs, copyright, release type). This file is the
source of truth: edit here, then re-run the PATCHes. Character limits are Apple's; keep each field inside them when editing.

| Field | Limit | Value |
|---|---|---|
| Name | 30 | tbr*a — The Based Reader |
| Subtitle | 30 | Know what's inside every book |
| Primary category | | Books |
| Secondary category | | Lifestyle |
| Keywords | 100 | `book tracker,reading log,tbr,content warnings,trigger warnings,clean reads,reading goal,bookshelf` |
| Promotional text | 170 | See content ratings for violence, language, sexual content and more before you start a book. Track your reading, set a goal, and find your next read by mood. |
| Support URL | | https://thebasedreader.app/contact |
| Marketing URL | | https://thebasedreader.app |
| Privacy policy URL | | https://thebasedreader.app/privacy |

Other apps' names (Goodreads, StoryGraph) are deliberately absent from the
keywords and description: Apple can reject listings that use them.

## Description (limit 4000)

```text
Know what's in a book before you read it.

tbr*a is a book tracker built around one idea: you should get to decide what you read. Every book has a "What's Inside" profile with content ratings for violence, language, sexual content and more, each on a clear scale from None to Extreme. Set your Content Comfort Zone once and tbr*a flags any book that crosses it.

TRACK YOUR READING
• Keep your TBR, current reads, finished books and DNFs in one library
• Log progress by page or percent, in print, ebook or audio
• Record the formats you own
• Queue what's next and reorder it by hand

SEE HOW YOU READ
• Set a yearly goal and watch your pace
• Keep a reading streak going
• Stats for books, pages, listening time, ratings and your reading by month

FIND YOUR NEXT READ
• Pick a mood and get books matched to your taste and your comfort zone
• Browse by series, author and genre
• Heart the genres you love and dismiss the ones you don't

READ WITH OTHER PEOPLE
• Rate and review, with spoilers hidden until tapped
• Follow readers whose taste you trust
• Share a public profile and your top-shelf reads

BASED READER PREMIUM
• Custom shelves you can share
• Buddy reads with friends
• Private notes on your TBR
• Unlimited Find My Next Read
• Custom goals for pages, hours listened, days read or a genre

Home Screen widgets keep your current read and reading goal in view.

Already tracking somewhere else? Bring your library over from the tbr*a website or another reading app in about a minute.

Based Reader is an optional auto-renewing subscription, billed monthly or yearly to your Apple Account. It renews automatically unless you cancel at least 24 hours before the end of the current period. Manage or cancel it in your Apple Account settings.

Terms of Use (EULA): https://thebasedreader.app/terms
Privacy Policy: https://thebasedreader.app/privacy
```

The "Already tracking" line is Rebekah's wording (2026-11-16). The
subscription paragraph and the two links were added on 2026-11-21 after the
3.1.2 rejection (below). **Never remove the Terms of Use link from the
description**: Apple rejects any version with subscriptions that lacks it.

## Decided (Rebekah, 2026-11-16)

- Copyright line: `2026 Rebekah Edwards`
- Age rating: answer Apple's questionnaire for 13+ (public reviews plus
  written descriptions of mature book content).
- Minimum age for the Terms of Use: 13.
- Release: go live automatically once Apple approves.

## Entered 2026-11-16

- Age rating questionnaire answered (social media = No, Rebekah's call).
  Apple computed **12+** (Brazil 14).
- 2026-11-25: Apple's two new age-rating questions answered at Rebekah's
  request: Shared Location = No, Dating and Relationships = No (that question
  means dating features or a romantic AI companion, not book content). The
  rating stayed 13+ (12+ Vietnam/Korea, 14 Brazil); submission still in queue.
- Screenshots: six 6.9-inch (1320x2868, dark) in
  `docs/app-store-assets/screenshots-6.9/`, uploaded in the order book,
  What's Inside, home, library, Discover, stats. Shot from the simulator with
  `TBRA_DEBUG_NO_TOURS=1 TBRA_DEBUG_AS_READER=1`; the book page is Project
  Hail Mary because other books showed testers' names under "Friends Who Read
  It", and the library is the Owned tab because TBR showed a private note.
- App Review contact details and reviewer notes (sign-in, In-App Purchase,
  report/block/Terms for guideline 1.2, account deletion).
- Build 17 attached to version 1.0; both subscriptions `READY_TO_SUBMIT`.

## Submitted for review 2026-11-16

Version 1.0, the Based Reader subscription group and both plans went to App
Review together; release is automatic on approval. First sent with build 17
(22:44 ET); pulled and resubmitted the same night with **build 18** (23:59 ET,
review submission `64d0f824-d48d-415a-bfba-5b9481107869`), because build 17
predates the design refresh, the Up Next and shelf reorder, note to self on the
book page and the Friends Activity list.

**Resubmitted with build 19 on 2026-11-19 11:19 ET** (Rebekah's call,
review submission `fe3c1ff8-e249-4865-8911-8dcfee0c854b`; version 1.0, the
group and both plans all WAITING_FOR_REVIEW). The build 18 submission was
cancelled on 11-17 at about 01:20 ET, but the group and plans could not be
added until 11-19: the App Store Connect website had signed out, then had an
outage, so the app was out of the queue for about two and a half days.

**Rejected 2026-11-20 04:03, guideline 3.1.2 (automated check):** the
description had no functional link to the Terms of Use (EULA), which every app
with auto-renewable subscriptions needs on its product page. The in-app plan
screen already linked Terms and Privacy; only the metadata was missing it.

**Fixed and resubmitted 2026-11-21 08:42 ET** with **build 20** (Rebekah asked
for the newest TestFlight build to go with the fix): description gained the
subscription paragraph, the Terms and Privacy links and the custom goals line;
reviewer notes mention custom goals and the new links. Same review submission
`fe3c1ff8-…`, now WAITING_FOR_REVIEW with all four items.

### Resubmitting after a rejection

The API cannot do the final step: `PATCH reviewSubmissions {submitted: true}`
returns 409 "Version is not ready to be submitted yet" while the version is
REJECTED. What worked: edit metadata and `PATCH` the build relationship via the
API, then in the website open the version (Edit on the submission page), click
**Update Review**, which puts the version back in the same submission as Ready
for Review, then **Resubmit to App Review**. The subscription group and plans
stayed in the submission, so nothing had to be re-added.

### Swapping the build on a version that is waiting for review

0. First open the App Store Connect website and confirm it is signed in
   (step 4 needs it, and the session lapses within about an hour). If it is
   not, ask Rebekah to sign in before cancelling anything.
1. `PATCH /v1/reviewSubmissions/{id}` with `canceled: true`. The version goes
   to `DEVELOPER_REJECTED`/`PREPARE_FOR_SUBMISSION` within a minute and the
   subscriptions return to `READY_TO_SUBMIT`.
2. `PATCH /v1/appStoreVersions/{id}/relationships/build` to the new build.
3. `POST /v1/reviewSubmissions` (draft), then `POST /v1/reviewSubmissionItems`
   for the version.
4. The subscription group and each plan must be added in the App Store Connect
   website: open the group, then each plan, and choose Add for Review > the
   draft submission. The API refuses them ("has no pending version for
   submission") and the version page has no purchases section. A group cannot
   go without at least one of its plans.
5. Check the draft has four items, then `PATCH` the submission with
   `submitted: true`.

- App Privacy labels published: name, email address, photos or videos, other
  user content, user ID, purchase history. Each is used for App Functionality,
  linked to the user, not used for tracking.
- App price: Free. Content rights: uses third-party content, with rights
  (Rebekah's declaration).
- Availability: 174 countries and regions. China mainland is excluded by
  choice (it requires a security assessment and an AI-content filing).
- Reviewer sign-in: a non-premium reader account, entered by Rebekah. Keep it
  non-premium so the reviewer sees the plan picker.

## Still open

- A real sandbox purchase (subscribe, then restore) from a TestFlight build
  has not been run yet. Rebekah chose on 2026-11-16 to skip it for now and
  look at it herself in the following days.
- App Compliance shows the developer declared as a non-trader under the EU
  Digital Services Act; with paid subscriptions that may need revisiting.
