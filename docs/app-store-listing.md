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

Home Screen widgets keep your current read and reading goal in view.

Already tracking somewhere else? Bring your library over from the tbr*a website or another reading app in about a minute.
```

The closing line is Rebekah's wording (2026-11-16).

## Decided (Rebekah, 2026-11-16)

- Copyright line: `2026 Rebekah Edwards`
- Age rating: answer Apple's questionnaire for 13+ (public reviews plus
  written descriptions of mature book content).
- Minimum age for the Terms of Use: 13.
- Release: go live automatically once Apple approves.

## Entered 2026-11-16

- Age rating questionnaire answered (social media = No, Rebekah's call).
  Apple computed **12+** (Brazil 14).
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

Version 1.0 (build 17), the Based Reader subscription group and both plans
went to App Review together; release is automatic on approval.

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

- A real sandbox purchase from TestFlight build 17 has not been run yet.
- App Compliance shows the developer declared as a non-trader under the EU
  Digital Services Act; with paid subscriptions that may need revisiting.
