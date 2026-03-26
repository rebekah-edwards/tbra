# Landing Page Configuration

The landing page is what logged-out visitors see at `/`. It's built to convert two primary audiences: conscientious readers and conscientious parents.

## How to update the landing page

All changes to the landing page should be made by asking Claude. Here's what you can ask for:

### Change the featured book in "What's Inside"
The "What's Inside" showcase section displays real content ratings from one book. To change which book is featured, ask Claude to update the `FEATURED_BOOK_SLUG` constant in `src/app/page.tsx`. The book must have content ratings in the database to show anything useful.

**Current featured book:** Angels and Demons (`angels-and-demons-dan-brown`)

### Change the headline or copy
All landing page text lives in `src/components/landing/landing-page.tsx`. Key sections and their current copy:

- **Hero headline:** "Know what's in a book before you read it."
- **Hero subtext:** "Detailed content ratings, smart recommendations, and reading tools — built for readers who care about what they read."
- **Avatar section heading:** "Built for readers who want to know more."
- **For Readers card:** Talks about being blindsided by unwanted content, reading with confidence
- **For Parents card:** Talks about pre-screening books for kids, understanding how sensitive topics are handled
- **What's Inside heading:** "See exactly what's inside."
- **Feature cards:** Smart Recommendations, Discover by Mood, Track Your Reading
- **Book count heading:** Shows actual database count rounded down to nearest thousand (e.g., "10,000+")
- **Final CTA:** "Start reading with confidence." / "Free to use. No ads. No algorithms selling you things."

### Change the books shown on the landing page
The hero background and "books and growing" parade both pull from a curated list of book slugs in `src/app/page.tsx` — the `LANDING_BOOK_SLUGS` array. These are hand-picked for attractive, recognizable covers. The order is randomized on each page load, but only books in this list will appear.

To add a book: ask Claude to add its slug to the `LANDING_BOOK_SLUGS` array.
To remove a book: ask Claude to remove its slug from the array.
To find a book's slug: go to its page on the site — the slug is in the URL (e.g., `/book/the-way-of-kings-brandon-sanderson`).

**Current curated list (24 books):**
- The Will of the Many, The Way of Kings, The Final Empire, Red Rising, Wool
- Hitchhiker's Guide, Looking for Alaska, Mere Christianity, The Great Divorce, The Black Prism
- Wild at Heart, Captivating, An Abundance of Katherines, Irresistible, Franny and Zooey
- The Cost of Discipleship, The Negotiator, Loveology, God Has a Name, Garden City
- Surprised by Joy, Saga Volume One, Player's Handbook, Reappearing Church

### Change the nav buttons
The green "Sign Up" pill and "Sign in" link for logged-out users are in `src/app/layout.tsx`.

### Enable search engine indexing
The homepage currently has `robots: { index: false }` in `src/app/page.tsx` metadata. When ready for Google/Bing to index the landing page, ask Claude to remove or make this conditional (only noindex for logged-in users).

## File locations
| What | File |
|------|------|
| Landing page component | `src/components/landing/landing-page.tsx` |
| Data fetching + featured book config | `src/app/page.tsx` (logged-out branch) |
| Nav sign-up button | `src/app/layout.tsx` |
| Design system / colors | `docs/BRANDING.md` |
| CSS variables | `src/app/globals.css` |
