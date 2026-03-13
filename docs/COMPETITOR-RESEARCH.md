# Competitor Research — tbr(a)
*Last updated: March 2026 by Spine 📖*

---

## Overview

tbr(a) operates at the intersection of several existing categories: book tracking/discovery apps, content classification tools, and reader-facing information sites. No single competitor covers the full territory we're targeting — which is both our opportunity and our challenge. This document breaks down the primary and secondary competitive landscape.

**Primary competitors** are platforms readers actively use to decide what to read and learn about book content.
**Secondary competitors** are adjacent services that serve overlapping needs for specific audiences.

---

## Primary Competitors

---

### 1. Goodreads
**goodreads.com** | Amazon-owned | ~150M users

#### What It Does
The default destination for readers globally. Book tracking (want to read, currently reading, read), star ratings, text reviews, reading challenges, community lists, author Q&As, and a recommendation engine ("readers also enjoyed"). It is the database everyone defaults to.

#### Brand Vibe
Legacy, slightly creaky. The brand hasn't meaningfully evolved since Amazon acquired it in 2013. The UI is famously dated — it looks like a mid-2000s social network. The emotional promise is "keep track of what you've read and connect with readers." It delivers on the tracking promise but the social features feel flat and the recommendation engine is widely considered mediocre.

#### Book Page Structure
- Title, author, cover, ISBN/edition data
- Average star rating (1–5) + number of ratings/reviews
- Genre tags (community-shelved, e.g. "fiction," "fantasy," "romance")
- Publisher blurb / synopsis
- Community reviews (sorted by Most Recent / Most Popular)
- "Readers also enjoyed" carousel
- Details (format, page count, publisher, language, ISBN)
- Quotes (user-contributed)
- Lists the book appears on (community-curated)
- Q&A with the author (for some titles)

**Zero content information.** No content warnings. No intensity levels. No descriptors beyond what's in community shelves (e.g., "dark romance," "trigger warnings" as informal shelf names — not structured data).

#### Tools Beyond Book Pages
- Reading challenge (annual goal tracking)
- Quotes database (searchable)
- Community groups/discussion boards
- "Listopia" — curated community lists
- Author profiles + follow
- Friend network + activity feed
- Mobile apps (iOS/Android)
- "Want to Read" shelf integration with public libraries (via OverDrive, limited)

#### What It Does Well
- **Scale.** Unmatched catalog depth. Almost any book you search is there.
- **Social proof.** Ratings from millions of readers. Even if the system is imperfect, the data mass is valuable.
- **Goodreads Choice Awards.** Annual reader vote that carries real cultural weight in publishing.
- **Author presence.** Many authors maintain active Goodreads profiles. It's part of book launch strategy.
- **Inertia.** Everyone's library is already there. Import/export creates lock-in.

#### What It Does Poorly
- **No content information.** None. Not even a "this is a dark book" flag.
- **Stale UI/UX.** Despite Amazon's resources, basically nothing has improved in 10+ years.
- **Recommendation quality.** "Readers also enjoyed" is genre-proximity, not actual taste-matching.
- **Review quality.** Buried under spam, bot reviews, and one-sentence takes. No surfacing of high-signal reviews.
- **No reading analytics.** Can't analyze your own reading habits meaningfully.
- **Community tools.** Groups exist but feel abandoned. No modern discussion features.

#### tbr(a) Opportunity
Goodreads readers who want "what's actually IN this book" have nowhere to go on Goodreads. The content gap is total. The "refugee readers" who've left for StoryGraph still use Goodreads as a catalog reference. tbr(a) can provide the content layer that Goodreads will never build.

---

### 2. StoryGraph
**thestorygraph.com** | Independent | Founded 2019

#### What It Does
The primary Goodreads alternative. Book tracking with analytics, reading mood/pace matching, diverse author tracking, and community-submitted content warnings. Positioned as "smarter" than Goodreads — AI-powered recommendations, deeper reading analytics. Specifically markets to readers who feel Goodreads doesn't serve them.

#### Brand Vibe
Modern, thoughtful, progressive, intentional. Heavy emphasis on diversity and inclusion — the founder (Nadia Odunayo) built it partly as a response to Goodreads' failure to highlight diverse authors. Dark mode-first UI. Feels like a product built by someone who reads a lot and was annoyed by the alternative. The brand is genuine and mission-driven, which resonates with its community.

#### Book Page Structure
- Title, author, cover, rating
- **Moods** (community-tagged, multiple): Adventurous / Dark / Emotional / Funny / Hopeful / Informative / Inspiring / Lighthearted / Mysterious / Reflective / Relaxing / Sad / Tense
- **Pace** (community-determined): Fast / Medium / Slow
- **Focus** (% plot-driven vs character-driven, rounded to nearest 25%)
- **Content Warnings** (community-submitted, collapsible) — binary flags, no intensity, no standardization. Examples: "abuse," "addiction," "death," "eating disorder," "sexual content," etc.
- Genres/subgenres (more granular than Goodreads)
- Reviews (star rating + text)
- "Reading stats" from users who've tracked it

#### Trigger Warning Controversy (important context)
StoryGraph originally used the term "trigger warnings" and later renamed the section to "content warnings" after community debate. The content warnings are entirely community-submitted, meaning:
- Coverage is inconsistent (popular books have many; obscure books have none)
- Categories are standardized by the platform but intensity/specificity is not
- You can only see if a warning EXISTS — not how prevalent or severe it is
- No political/cultural content flags at all (no progressive themes, no traditional values, no religious content — nothing in that category space)

#### Tools Beyond Book Pages
- **Reading analytics** — charts of your reading by genre, mood, pace, diversity stats (% books by authors of color, % by women, etc.), pages read over time
- **Recommendation engine** — "Find your next read" with mood/pace/genre filters + a "not in the mood for" filter (genuinely useful)
- **Reading journal** — log entries per book while reading
- **Reading challenges** — custom or community challenges
- **DNF tracking** — explicit "Did Not Finish" shelf with reason
- **Import from Goodreads** — smooth import flow
- **Book clubs** — create/join
- **Series tracker** — shows where you are in a series
- **Author diversity tracker** — tracks books by underrepresented authors

#### What It Does Well
- **Reading analytics** are genuinely excellent and differentiated
- **Mood/pace metadata** is a clever UX solution to "what do I want to read right now?"
- **Recommendation engine** — filters are more useful than Goodreads
- **Content warnings exist at all** — proves demand, even if execution is rough
- **Community authenticity** — the user base is engaged and enthusiastic
- **Design** — modern, clean, responsive

#### What It Does Poorly
- **Content warnings are binary, unstructured, community-dependent.** "Sexual content" tells you nothing about whether it's a mention or 40 pages of explicit scenes.
- **No political/cultural content classification.** Nothing about progressive messaging, religious themes, traditional values — the categories most underserved in the market.
- **Editorial bias baked into the platform.** The diversity tracking and framing implicitly positions the app within a specific cultural lens. This is intentional for their audience but excludes readers who want content info without the cultural framing.
- **Catalog gaps.** Smaller catalog than Goodreads; less community data on less popular books.
- **No evidence level for content data.** No way to know if a warning comes from someone who read the book vs someone who saw it mentioned online.

#### tbr(a) Opportunity
StoryGraph proves the market wants structured content info. We need to do what they couldn't: (1) add intensity levels, (2) add political/cultural/religious content flags, (3) add evidence levels, (4) remove the ideological framing so the data speaks for itself.

---

### 3. DoesTheDogDie.com
**doesthedogdie.com** | Independent | Founded 2013

#### What It Does
A crowdsourced database answering "does [potentially upsetting content] happen in [this media]?" Originally just the eponymous question about dogs, it now covers 100+ trigger categories across books, movies, TV, games, and more. Pure content information — no reviews, no tracking, no social features.

#### Brand Vibe
Quirky, community-driven, matter-of-fact. The name is both a joke and a sincere answer to a sincere question. The vibe is "we're just answering the question, no judgment." Beloved by people with specific sensitivities (animal death, self-harm, eating disorders, etc.). The brand is small, scrappy, and genuine.

#### How It Works
Users vote Yes/No/Kinda on each question for each piece of media. The platform aggregates votes into a confidence indicator (green = probably no, red = probably yes, yellow = uncertain). Questions are crowdsourced; anyone can suggest a new category. No text explanations by default — just the vote aggregate. Some entries have community comments.

#### Category Structure (Books + All Media)
As of 2025, covers 100+ categories, including:
- **Animal content**: dog dies, cat dies, animal abuse, animal torture
- **Mental health**: suicide, self-harm, eating disorders, suicidal ideation
- **Violence**: graphic violence, sexual violence, child abuse, torture
- **Sexual content**: rape, sexual assault, on-page sex
- **Relationship content**: infidelity, divorce, toxic relationships
- **Addiction**: alcohol abuse, drug use
- **Grief/loss**: character death, child death, pregnancy loss, abortion
- **Medical**: cancer, terminal illness, dementia
- **Identity**: racism, homophobia, transphobia (as harmful depictions)

**Notable absence:** No political content, religious content, or cultural messaging categories. The system is designed around triggers/sensitivities, not values/preferences.

#### Tools Beyond Book Pages
- Filtering by content category ("show me books with NO animal death")
- Browse by media type (books, movies, TV, games, podcasts)
- Personal profile to mark what you want to avoid
- Email notifications when something you follow gets updated
- Community comments per entry
- Category suggestion system

#### What It Does Well
- **The core concept is excellent** — binary yes/no with confidence level is deeply usable
- **Coverage breadth** — 100+ categories is impressive
- **Multi-media** — cross-media consistency is useful (same questions for a book and its adaptation)
- **Community trust** — readers trust the data because it's aggregated from many votes
- **Specificity** — "does a dog die" is more useful than "violence: moderate"
- **No-judgment framing** — doesn't editorialize, just answers

#### What It Does Poorly
- **Binary only.** Yes/No/Kinda doesn't tell you if the thing happens once vs. is a central theme.
- **No intensity or context.** "Torture: yes" is very different information depending on whether it's a brief scene or 200 pages of it.
- **Books are a secondary medium.** The product was built around film/TV; book coverage is thinner.
- **No structure beyond the vote.** No "evidence" level, no page numbers, no citations.
- **No values-based categories.** Political leanings, religious content, progressive messaging — none of it.
- **No narrative quality info** — this is purely content warnings, not a reading experience guide.
- **UI is functional but dated.**

#### tbr(a) Opportunity
The binary vote model is useful but we need to go further: intensity levels, contextual descriptions, evidence levels, and the values/cultural categories that DTDD doesn't touch. We can absorb the best of what they do (specific question framing, aggregated community confidence) into a richer system.

---

### 4. Common Sense Media
**commonsensemedia.org** | Nonprofit | Founded 2003

#### What It Does
Editorial content ratings for children's and family media (movies, TV, books, apps, games, podcasts). Professional staff writers review each piece of media and produce a structured report covering age appropriateness, educational value, and specific content categories. Trusted by parents and educators.

#### Brand Vibe
Authoritative, educational, family-values-adjacent (but careful to be politically neutral), slightly institutional. The brand is "trusted expert guidance for parents." Not quirky, not community-driven — editorial voice is consistent and measured. Heavy presence in schools and libraries. Feels like Consumer Reports for media.

#### Book Page Structure (for books)
- **Age rating** (primary signal — "age 10+", "age 14+", etc.)
- **Star rating** for quality (separate from age rating)
- **One-line summary** of the book's content profile
- **Detailed categories** with color-coded ratings:
  - Educational value
  - Positive messages
  - Positive role models
  - Violence (1–5 scale)
  - Sex (1–5 scale)
  - Language (1–5 scale)
  - Consumerism (1–5 scale)
  - Drinking/drugs (1–5 scale)
- **Parents' Guide** — prose summary written by editorial staff
- **What parents need to know** — bottom-line assessment
- **What kids learn** — educational framing
- **Community reviews** — parent reviews and kid reviews (separate)

#### Tools Beyond Book Pages
- **Age-based filtering** — browse books appropriate for a specific age
- **Topic-based browsing** — search by educational theme
- **"Best Of" lists** — curated by age, genre, topic
- **Family media agreements** — downloadable templates for family screen/reading rules
- **Newsletters** — parent-focused content
- **Privacy ratings** — rates apps on data privacy (their most unique feature in the digital age)

#### What It Does Well
- **Editorial authority.** Every rating is written by a trained staff member, not crowdsourced. Consistency is high.
- **Intensity scales** — the 1–5 scales are more useful than binary flags
- **Age-based framing** is extremely useful for parents and works well as a proxy for content intensity
- **The structure** of "here's what's in it, here's why it matters" is a good model
- **Trusted brand.** Teachers, librarians, and parents trust CSM data.

#### What It Does Poorly
- **Age-framing is paternalistic for adult readers.** "Age 14+" is not useful information for a 34-year-old deciding whether she wants to read dark fiction.
- **Book coverage is thin** compared to their film/TV coverage. Fewer titles, slower to add new releases.
- **Editorial lens skews left** (documented criticism from conservative parents). Categories like "diversity," "positive messages," and "role models" are rated through a specific cultural lens.
- **No political/values content flags.** Doesn't address political leanings or traditional vs. progressive framing.
- **Not designed for adult fiction.** Everything is filtered through child-appropriateness.
- **Coverage is slow.** Staff can only review so many titles.

#### tbr(a) Opportunity
The editorial authority model is aspirational — consistent quality, structured data, professional voice. But we need it for adult readers, without the age-framing and without the implicit cultural lens. The intensity scales are a model worth borrowing; the "parents' guide" format is a useful template for our "evidence" summaries.

---

## Secondary Competitors

---

### 5. Rated Reads
**ratedreads.com** | Small independent site

#### What It Does
Editorial reviews of adult and YA books with a 4-tier content rating system (None/Mild/Moderate/High) analogous to movie ratings. Focuses on language, sexual content, and violence. Created by and for readers who want clean or family-friendly books.

#### Rating System
- **Green (None)** — Essentially clean, family-friendly for all ages
- **Yellow (Mild)** — PG equivalent. Light language, closed-door romance, minimal violence
- **Orange (Moderate)** — PG-13. Some language, some sexual references, some violence
- **Red (High)** — R equivalent. Strong language, explicit sex, graphic violence

Each review includes a prose explanation of why the rating was assigned, with specifics.

#### What It Does Well
- Movie-rating analogy is immediately intuitive
- Detailed written explanation per rating (not just a color)
- Honest, no-judgment tone — "we're providing information, not censoring"
- Volunteer reviewer model extends coverage

#### What It Does Poorly
- **Very limited catalog** — can't review at scale
- **Three categories only** (language, sex, violence) — no political/cultural flags
- **No community data** — purely editorial, no aggregation
- **Old-school website design**
- **Not searchable/filterable in a useful way**

---

### 6. Rated Books (ratedbooks.org)
**ratedbooks.org** | Conservative advocacy-adjacent

#### What It Does
Provides MPA-style ratings for books (G/PG/PG-13/R/NC-17 equivalents) with a specific focus on identifying books in school libraries that parents may find inappropriate. Partnered with local school board advocacy groups across multiple states. Maintains local pages for specific school districts.

#### What It Does Well
- Clear, universally understood rating system
- School library focus creates a specific, actionable use case
- Detailed reports for rated books

#### What It Does Poorly
- **Explicitly advocacy-positioned** — partnered with organizations like "No Left Turn in Education," "stopschoolporn," etc. This limits its utility as an objective information tool.
- **Very limited catalog** (focused on contested/challenged books, not general readership)
- **No discovery features** — it's a database of "problematic" books, not a general reading tool

#### tbr(a) Distinction
We are NOT this. We're descriptive, not prescriptive. "Contains progressive gender themes" is a data point we provide neutrally — the reader decides what to do with it. We are not a list of banned books or books to avoid.

---

### 7. Fable
**fable.co** | VC-backed | Founded 2019

#### What It Does
Social reading platform centered around book clubs. Read ebooks inside the app, discuss with a group in real-time, create or join book clubs. Think "book club + ebook reader + social layer." Recently pivoted toward more general social/tracking features.

#### Brand Vibe
Warm, social, community-first. "Reading is better together." Feels like a startup trying to make books feel as social as Instagram. Targeted at younger readers (18–35), BookTok-adjacent.

#### What It Does Well
- Book club UX is genuinely thoughtful — in-app reading + discussion is a cohesive experience
- "Social mode" reading with highlights/notes visible to your book club
- Reading progress tracking
- Clean, modern design

#### What It Does Poorly
- **Requires ebook purchase** for full social features — paywall friction
- **No content information** of any kind
- **Content is ephemeral-social** — focused on discussion, not reference
- **Technical instability** reported by users (crashes)
- **Narrow focus** — if you don't want to read ebooks in-app, the value drops

---

### 8. Hardcover
**hardcover.app** | Independent | Founded ~2021

#### What It Does
Modern Goodreads alternative focused on tracking, discovery, and social reading. Strong focus on data quality (better book editions tracking than Goodreads), reading lists, and a cleaner UI. API-first — they explicitly support developers building on their data.

#### Brand Vibe
Developer-friendly, clean, modern, reader-focused. Less mission-driven than StoryGraph, more tool-focused. "Just a really good book tracker."

#### What It Does Well
- **Best editions tracking** of any platform — crucial for people who care about specific printings
- **Reading lists and series tracking** are excellent
- **Open API** — community-friendly, extensible
- **Clean UI** — feels modern
- **Active development** — features ship regularly

#### What It Does Poorly
- **No content information** — same gap as Goodreads
- **Smaller community** means less review/rating data
- **Less discovery infrastructure** than Goodreads or StoryGraph

---

### 9. Literal.club
**literal.club** | Independent

#### What It Does
Minimalist book tracking with a focus on clean UX and "reading taste" profiles. Lets you build a public reading profile that shows your taste through what you've read. More of a "share your reading identity" tool than a research tool.

#### Brand Vibe
Aesthetic, minimal, design-forward. "Your books say something about you." Positioned as the tasteful/premium alternative to Goodreads' clutter.

#### What It Does Well
- Beautiful design
- Public taste profiles
- Simple, fast book adding

#### What It Does Poorly
- Very thin feature set
- No content information
- Small catalog
- Niche audience

---

## Landscape Summary

| Platform | Tracking | Reviews | Content Warnings | Intensity Levels | Cultural/Political Flags | Editorial Authority | Catalog Scale |
|---|---|---|---|---|---|---|---|
| **Goodreads** | ✅ Excellent | ✅ Massive | ❌ None | ❌ None | ❌ None | ❌ User-generated | ✅ Best |
| **StoryGraph** | ✅ Excellent | ✅ Good | ⚠️ Binary only | ❌ None | ❌ None | ❌ User-generated | ⚠️ Good |
| **DoesTheDogDie** | ❌ None | ❌ None | ✅ Best binary | ❌ None | ❌ None | ❌ Community vote | ⚠️ Medium |
| **Common Sense Media** | ❌ None | ⚠️ For kids | ✅ Good (age-framed) | ✅ 1–5 scales | ❌ None | ✅ Editorial staff | ⚠️ Medium |
| **Rated Reads** | ❌ None | ⚠️ Limited | ⚠️ 4-tier only | ⚠️ Partial | ❌ None | ✅ Editorial | ❌ Small |
| **Fable** | ✅ Good | ✅ Good | ❌ None | ❌ None | ❌ None | ❌ User-generated | ⚠️ Medium |
| **Hardcover** | ✅ Good | ⚠️ Limited | ❌ None | ❌ None | ❌ None | ❌ User-generated | ⚠️ Good |
| **tbr(a) target** | 🔜 Later | 🔜 Later | ✅ Structured | ✅ Intensity scales | ✅ Core feature | ✅ AI + Human | ✅ Scale up |

---

## Key Takeaways for tbr(a)

### The Gap Nobody Is Filling
Every single competitor fails in exactly the same place: **no political, cultural, or values-based content classification.** Not one platform will tell you "this book has progressive gender themes" or "this book portrays traditional religious values favorably." This is simultaneously:
- The most commercially underserved audience in the reading market
- The most politically charged category to build (requires careful, neutral framing)
- The clearest competitive differentiation we have

### What We Should Borrow
1. **StoryGraph's mood/pace/focus metadata** — these are genuinely useful for discovery beyond just content warnings
2. **DoesTheDogDie's specific question framing** — "does X happen" is more useful than "violence: moderate"
3. **Common Sense Media's intensity scales** — 1–5 per category is the right model
4. **Common Sense Media's editorial structure** — the "here's what's in it, here's the full picture" approach
5. **Rated Reads' movie-rating analogy** — immediately intuitive, no explanation needed

### What We Should Avoid
1. **Goodreads' scale-without-quality problem** — a million reviews is not useful if they're noise
2. **StoryGraph's ideological framing** — the diversity tracking bakes in a viewpoint; we stay neutral
3. **RatedBooks.org's advocacy positioning** — we are not a banned books list, ever
4. **DoesTheDogDie's binary-only system** — yes/no is the floor, not the ceiling
5. **CSM's child-centric framing** — we serve adult readers making adult reading choices

### Brand Positioning Opportunity
tbr(a) should feel like: *the information tool that respects your intelligence and your values — whatever they are.* We don't tell you what to think about the content. We tell you what's in the book. You decide.

The "based" angle is subtle in the brand but structural in the taxonomy: we include the categories everyone else omits. That's the differentiation.

---

*Research by Spine 📖 | Sources: live web research, internal knowledge base*
