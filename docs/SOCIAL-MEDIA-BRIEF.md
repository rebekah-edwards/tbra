# The Based Reader (tbr*a) — Social Media Content Brief

> **Purpose of this file:** A single, self-contained reference for writing social media posts about The Based Reader app. It covers the aspirational story (why the app exists, who it serves), the product (what it does), and the technical substance (how it's built, what data sources power it, how content details and recommendations are generated). Hand this to a content/marketing session and it should be able to write accurate posts without needing the codebase.
>
> _Last compiled: 2026-06-20. Product details verified against the live codebase at compile time, but the app evolves — treat feature-completeness claims as "true as of mid-2026."_

---

## 0. The one-paragraph version

The Based Reader (stylized **tbr*a**, also written "The Based Reader App") is a book-discovery and reading-tracking app whose core differentiator is **content transparency**: for every book it tells you *exactly what's inside* — across 12 content categories, each rated by intensity — so you can decide what matters to *you* before you read. It pairs that with the full reading-life toolkit (shelves, reviews, reading sessions, stats, social follows, buddy reads) and a recommendation engine that respects your content comfort levels, not just your genre taste. It's free, ad-free, and explicitly **not** built to sell your attention or your data.

---

## 1. WHY THE APP EXISTS (the mission / the story)

**Headline promise:** *"Know what's in a book before you read it."*

**Subheadline:** *"Detailed content ratings, smart recommendations, and reading tools — built for readers who care about what they read."*

The founding insight is simple and emotionally resonant: **readers get blindsided.** You pick up a book on a recommendation, get invested, and then hit graphic content, themes, or values you didn't want or didn't expect — with no warning. Existing platforms give you a 4.2-star average and a pile of subjective reviews, but they won't tell you, plainly, *what's actually in the book.*

The Based Reader exists to close that gap. Its philosophy is **descriptive, not prescriptive**:

- It describes what's in a book **without judging it.** It doesn't tell you a book is "bad" or "off-limits" — it tells you what's there and how intense it is, and lets *you* draw the line.
- It measures **intensity and specificity**, not just presence: not merely "there is violence," but how graphic, how frequent, and in what context.

**Verbatim positioning copy (from the live landing/methodology pages):**

- *"tbr*a provides detailed, structured content information for books — not star ratings, not subjective reviews. We tell you exactly what's in a book so you can decide what matters to you."*
- *"Free to use. No ads. No algorithms selling you things."*

**The deeper "why" to lean on in aspirational posts:**
- **Agency.** Reading should be a confident choice, not a gamble. The app hands the decision back to the reader.
- **Respect for difference.** People draw lines in different places — for faith, for age, for personal history, for taste. The app doesn't pick the line for them; it gives everyone the same honest information.
- **Trust over engagement.** It's deliberately built *against* the attention-economy playbook — no ads, no data-targeted manipulation, no algorithm optimizing for time-on-app.

---

## 2. WHO IT SERVES (the audiences)

The product speaks to two primary audiences, with explicit on-site copy for each:

**A. Readers who care what they read.**
> *"Ever been blindsided by content you didn't want to read? tbr*a gives you detailed, structured content information for every book — so you can read with confidence and choose books that match your values."*

This includes readers avoiding specific content for reasons of **faith, values, trauma/triggers, or simple preference** (e.g. "I want a fantasy with no explicit romance"). The taxonomy is intentionally broad enough to serve all of them with the *same neutral data*.

**B. Parents.**
> *"Not sure what's in the book your kid wants to read? tbr*a breaks down exactly how sensitive topics are handled — from mild to intense — so you can make informed decisions without reading every page yourself."*

The pitch to parents is **time + peace of mind**: you don't have to pre-read every book your kid brings home. (A planned **Family accounts** feature — up to 4 reader profiles per account — extends this so kids' tastes don't pollute a parent's recommendations.)

**Secondary / overlapping audiences worth addressing in content:**
- **Christian / faith-driven readers** — reflected in the catalog's discovery weighting (Christian fiction is the heaviest-weighted discovery subject) and in dedicated taxonomy categories (Religious content; Occult/Demonology distinct from fantasy Magic).
- **ARC reviewers & book influencers** — the app has first-class ARC (Advance Reader Copy) review tooling and social profile features (Instagram / TikTok / Threads / Twitter handles on profiles).
- **Power readers / trackers** — people migrating from Goodreads or StoryGraph who want better data and tracking (import tools exist for both, plus Libby).

---

## 3. WHAT MAKES IT DIFFERENT (the hook for "why us" posts)

1. **Content details, not star ratings.** The headline feature. 12 categories, each with an intensity score — see §4.
2. **Recommendations that respect your comfort levels.** Content compatibility is weighted heavily in the rec engine (see §6) — most apps recommend on genre/popularity alone.
3. **Neutral and inclusive by design.** The same descriptive data serves a parent screening for their 12-year-old, a reader avoiding explicit content for faith reasons, and a reader who simply wants more of it. No moralizing.
4. **Ad-free, no data-targeting.** Explicit anti-surveillance stance.
5. **Honest, multi-source data.** Book info is assembled from many sources (see §7), not a single vendor feed, then analyzed for content — high quality without lock-in.

---

## 4. HOW CONTENT DETAILS WORK (the signature feature)

Every book is rated across **12 content categories.** Each category gets an **intensity score from 0 to 4** plus a short descriptive note.

**The intensity scale:**
| Score | Label | Meaning |
|---|---|---|
| 0 | None | Not present |
| 1 | Minor | Brief, background, or fleeting |
| 2 | Moderate | Recurring but not dominant |
| 3 | Major | Frequent or central to the story |
| 4 | Extreme | Graphic, pervasive, or defining |

**The 12 categories:**
1. **Sexual content** — on-page vs. fade-to-black romantic/sexual content; explicitness and frequency.
2. **Violence & gore** — body horror, torture, graphic depictions, intensity of violent scenes.
3. **Profanity / language** — frequency and severity of strong language.
4. **Substance use** — alcohol and drugs; glamorized vs. cautionary; addiction themes.
5. **LGBTQ+ representation** — presence and centrality of LGBTQ+ characters, relationships, and identity themes. *(Always written "LGBTQ+" — brand standard, never "LGBTQIA+".)*
6. **Religious content** — overt religiosity, clergy/rituals, conversion themes, devotional framing.
7. **Magic & witchcraft** — *fantasy* magic and spellcasting as story elements (e.g. Harry Potter). Distinct from real-world occult.
8. **Occult / demonology** — *real-world* occult: Wicca, demons, séances, tarot, divination, ritual magic, possession, Satanism.
9. **Political & ideological content** — political/social/cultural messaging, described not evaluated.
10. **Self-harm / suicide** — ideation vs. attempt; on-page depiction.
11. **Abuse & suffering** — child/domestic/animal abuse, slavery, sexual assault/coercion, systemic cruelty.
12. **Other** — anything that doesn't fit above (e.g. eating disorders, medical trauma, religious trauma) plus extra trigger warnings.

**How a rating is generated (worth describing in "how it's built" posts):**
- The app gathers context about the book (title, author, description, genres) and, when needed, pulls supporting web research.
- That context is analyzed by an **AI model (Grok, from xAI)** running at low temperature for consistency, which outputs the 12 category scores, the short notes, a concise summary, fiction/non-fiction classification, and pacing.
- **Notes are written to be concise and reader-facing** (roughly 70–190 characters, mobile-friendly, no "research process" language).
- Users can **submit corrections** to any rating, and the catalog continuously backfills ratings nightly across tens of thousands of books.

> Honest framing for posts: ratings are **AI-assisted and human-correctable**, designed to be a fast, consistent first read on a book's content — not a substitute for personal judgment. Lean into "transparent and improvable," not "infallible."

---

## 5. THE FULL FEATURE SET (what you can actually do)

**Reading & library**
- **Shelves** — system shelves (TBR, Currently Reading, Completed, DNF, Paused) plus **custom shelves** with custom colors, descriptions, and public sharing.
- **Reading sessions** — track each read individually (re-reads supported): start/finish dates, format(s), paused periods.
- **Up Next queue**, **edition tracking** (which edition you own), **annual reading goals**, **reading streaks**.

**Reviews & ratings**
- Star ratings in **0.25 increments**, text reviews with an optional **mood** (lighthearted → devastated) and intensity slider.
- **DNF tracking** (why + how far you got), dimension ratings (characters/plot/setting/writing), descriptor tags, anonymity option, and **helpful votes** from other readers.
- **Reading notes / journal** — per-page or per-%-complete, private or shared.

**Discovery & search**
- **Smart recommendations**, **mood-based discovery** ("Discover by Mood"), **"Because You Liked…"**, and a full discover page with genre/pacing/length/trope/content filters.
- Fast local search with an external fallback so you can add nearly any book.

**Social & community**
- **Follow readers**, **follow authors** (get notified on new releases), **buddy reads** (group reads with invite codes), **follow public shelves**, **activity feed**, **public profiles** with social handles.

**Creators / reviewers**
- **ARC review tooling** — track source (NetGalley, Edelweiss, BookSirens, publisher/author copy), upload proof, admin verification queue.

**Import / export**
- Import from **Goodreads, StoryGraph, and Libby**; export your data (CSV free, full JSON for premium).

**Premium tier ("Based Reader")** — paid upgrade adds: custom shelves, reading challenges, advanced stats, custom themes & app icons, buddy reads, family accounts (4 profiles), an **AI book-discovery chatbot** ("a cozy fantasy with no romance, female lead, under 300 pages"), priority content updates, enhanced profile controls, full data exports, priority support. *(Free tier remains fully usable for core reading, tracking, discovery, and social.)*

---

## 6. HOW RECOMMENDATIONS WORK (for "how the app thinks" posts)

Books are scored against your personal preference profile. The standout fact: **content compatibility is weighted heavily** — because, in the app's words, "content comfort is critical for user trust." Approximate weighting:

- Genre overlap **~35%**
- Content compatibility **~20%** (deliberately doubled from a baseline)
- Series continuation **~15%**
- Parent-genre match **~12%**
- Fiction/non-fiction alignment **~8%**
- Length fit **~7%**
- Data quality **~3%**

It learns from: books you rate 4★+ or favorite, genres you love/dislike, your **per-category content tolerances (0–4)**, fiction/non-fiction preference, page-length and pacing preferences, story-focus (worldbuilding/plot/characters), and liked character tropes (found-family, morally-grey, etc.). You can **hide** books from recommendations entirely.

**Headline for posts:** *"Most apps recommend books like the ones you've read. We also make sure they fit what you're comfortable reading."*

---

## 7. HOW IT'S BUILT (tech & data sources)

**Stack:** Next.js 16 / React 19 (App Router), TypeScript, Tailwind CSS 4. Database is SQLite locally synced to **Turso** (serverless libSQL) in production, via Drizzle ORM. Hosted on **Vercel**. Auth is email/password (JWT) plus optional **Google sign-in**. Search is powered by **Meilisearch**. Transactional email via **Resend**. Images stored on **Vercel Blob**. AI content analysis via **Grok (xAI)**.

**Where book data comes from (multi-source enrichment pipeline):**

| Source | What it provides |
|---|---|
| **OpenLibrary** | Primary metadata: titles, authors, genres, descriptions, ISBNs, covers (free) |
| **ISBNdb** | Secondary metadata — fills gaps OL misses: covers, page counts, publisher, year, descriptions |
| **Google Books** | Supplemental covers & metadata |
| **Library of Congress** | Supplemental genre/subject data (free) |
| **BookBrainz** | Backup identification when other sources fail (free) |
| **NYT Books API** | Bestseller lists — surfaces fresh/popular titles and descriptions |
| **Brave Search** | Web research context that feeds the AI content analyzer |
| **xAI (Grok)** | The AI that generates content ratings, summaries, and classifications |
| **Amazon** | Cover images + affiliate "buy" links |

**The pipeline in plain English:** new books are discovered nightly (paginated subject feeds + NYT bestsellers, weighted toward Christian fiction and other priority subjects), matched and de-duplicated, then enriched in tiers — metadata first (OpenLibrary → ISBNdb → others), covers via a fallback cascade, and finally **AI content analysis** that produces the 12-category ratings. Everything is built with strict API budget guards so data quality scales without runaway cost. The catalog is **tens of thousands of books** and growing nightly.

**Talking points for "how it's built" / indie-builder posts:**
- A genuinely **multi-source** catalog — not reselling one vendor's feed.
- **AI-assisted content analysis** as the core IP, with human correction built in.
- **Privacy-respecting by architecture** — no ad/data-targeting business model.
- Runs an automated **nightly enrichment system** that continuously improves the catalog.

---

## 8. BRAND & VOICE GUARDRAILS (so posts stay on-brand)

- **Name:** "The Based Reader" / "The Based Reader App" in prose; **tbr*a** as the stylized short form. (Both are used intentionally.)
- **Stance is descriptive, never preachy.** Never frame books as "bad," "dirty," or "safe." Frame as *informed*, *your choice*, *know before you read*.
- **Inclusive:** the same feature serves parents, faith-driven readers, trauma-aware readers, and readers who simply want more content. Don't make it sound like a content-*blocking* or censorship tool — it's a content-*transparency* tool.
- **Always "LGBTQ+"** — never "LGBTQIA+".
- **Anti-ad / pro-reader:** "Free. No ads. No algorithms selling you things." is a core, repeatable line.
- **Signature color** (if visuals are produced): bright lime green **#a3e635** — always bright, never darkened/olive; black text on green in light contexts.

---

## 9. READY-MADE POST ANGLES

**Aspirational / brand**
- "Ever been blindsided by a book?" — the founding pain point.
- "Reading should be a confident choice, not a gamble."
- "We tell you what's in a book. You decide what matters." (descriptive-not-prescriptive)
- "Free. No ads. No algorithm selling you things." (anti-surveillance)
- For parents: "Stop pre-reading every book your kid brings home."

**Feature spotlights**
- The 12 content categories, one post each (e.g. "Why we separate *fantasy magic* from *real-world occult*").
- The 0–4 intensity scale explained with an example book.
- "Recommendations that respect your comfort levels, not just your taste."
- Buddy reads / shelves / reading stats / streaks.
- ARC tooling — aimed at bookstagram/booktok reviewers.

**"How it's built" / build-in-public**
- The multi-source enrichment pipeline (9 data sources → one clean book page).
- How AI generates content ratings — and why humans can correct them.
- Nightly automation that grows and cleans the catalog while you sleep.
- Why we chose transparency over the engagement/ad model.

**Comparison / switch**
- "Coming from Goodreads or StoryGraph? Import in one click."
- "Star ratings tell you if people liked it. We tell you what's in it."

---

_End of brief._
