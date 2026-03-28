/**
 * Curated top-level genre taxonomy for tbr*a.
 *
 * The green "primary pill" on book pages only shows genres from this whitelist.
 * A second pill may appear for children's age categories.
 *
 * Any genre not in this list (e.g. "Grimdark", "Post-Apocalyptic", "Survival")
 * appears as a grey secondary pill instead.
 */

// ─── Fiction categories ───

export const FICTION_GENRES = new Set([
  "Literary Fiction",
  "Contemporary Fiction",
  "Mystery",
  "Thriller",
  "Suspense",
  "Crime",
  "Crime Fiction",
  "Horror",
  "Romance",
  "Fantasy",
  "Sci-Fi",
  "LitRPG",
  "Historical Fiction",
  "Speculative Fiction",
  "Dystopian",
  "Dystopia", // common variant in DB, displayed as "Dystopian"
  "Action/Adventure",
  "Adventure",
  "Western",
  "Humor",
  "Satire",
  "Christian Fiction",
  "Amish Fiction",
  "Graphic Novel",
  "Short Stories",
  "Anthology",
  "Drama",
  "Poetry",
  "Classics",
  "Magical Realism",
]);

// ─── Non-Fiction categories ───

export const NONFICTION_GENRES = new Set([
  "Biography",
  "Autobiography",
  "Memoir",
  "History",
  "Politics",
  "Religion",
  "Spirituality",
  "Christianity",
  "Islam",
  "Judaism",
  "Buddhism",
  "Hinduism",
  "Philosophy",
  "Psychology",
  "Mental Health",
  "Self-Help",
  "Personal Development",
  "Business",
  "Leadership",
  "Economics",
  "Finance",
  "Science",
  "Technology",
  "Nature",
  "Environment",
  "Health",
  "Fitness",
  "Wellness",
  "Cookbooks",
  "Food & Wine",
  "Travel",
  "True Crime",
  "Essays",
  "Arts",
  "Music",
  "Film",
  "Photography",
  "Crafts",
  "Hobbies",
  "How-To",
  "Education",
  "Reference",
  "Parenting",
  "Family",
  "Society",
  "Culture",
  "Social Issues",
  "Nonfiction",
]);

// ─── Children's age categories (shown as a SECOND pill, not the primary) ───

export const CHILDRENS_AGE_CATEGORIES = new Set([
  "Picture Books",
  "Early Readers",
  "Chapter Books",
  "Middle Grade",
  "Young Adult",
  "Children's",
]);

// ─── Combined whitelist for quick lookup ───

export const TOP_LEVEL_WHITELIST = new Set([
  ...FICTION_GENRES,
  ...NONFICTION_GENRES,
]);

// ─── Display name normalization (for whitelisted genres with variant spellings) ───

export const DISPLAY_NAME: Record<string, string> = {
  "Dystopia": "Dystopian",
  "Crime Fiction": "Crime",
  "Science Fiction": "Sci-Fi",
  "science fiction": "Sci-Fi",
};

// ─── Mapping: existing DB genre names → curated top-level category ───
// Genres not in this map that ARE in TOP_LEVEL_WHITELIST pass through as-is.
// Genres not in this map and NOT in the whitelist stay as grey secondary pills.

export const GENRE_TO_TOP_LEVEL: Record<string, string> = {
  // Thriller variants
  "thriller": "Thriller",
  "Thriller/Suspense": "Thriller",
  "Psychological Thriller": "Thriller",
  "Political Thriller": "Thriller",
  "Supernatural Thriller": "Thriller",
  "Conspiracy Thriller": "Thriller",
  "Techno-Thriller": "Thriller",
  "Romantic Suspense": "Thriller",

  // Crime variants
  "Crime": "Crime",
  "Crime Fiction": "Crime",
  "Detective": "Mystery",

  // Sci-Fi variants
  "Science Fiction": "Sci-Fi",
  "science fiction": "Sci-Fi",
  "Military Sci-Fi": "Sci-Fi",
  "Hard Sci-Fi": "Sci-Fi",
  "Hard Science Fiction": "Sci-Fi",
  "Humorous Sci-Fi": "Sci-Fi",
  "Cli-Fi": "Sci-Fi",
  "Space Opera": "Sci-Fi",
  "Space Adventure": "Sci-Fi",
  "Space Western": "Sci-Fi",
  "Space Exploration": "Sci-Fi",
  "Space Survival": "Sci-Fi",
  "Cyberpunk": "Sci-Fi",
  "Alien Invasion": "Sci-Fi",
  "Technothriller": "Sci-Fi",
  "GameLit": "LitRPG",

  // Fantasy variants
  "Epic Fantasy": "Fantasy",
  "Dark Fantasy": "Fantasy",
  "Urban Fantasy": "Fantasy",
  "High Fantasy": "Fantasy",
  "Cozy Fantasy": "Fantasy",
  "Portal Fantasy": "Fantasy",
  "Gaslamp Fantasy": "Fantasy",
  "Military Fantasy": "Fantasy",
  "Humorous Fantasy": "Fantasy",
  "sword and sorcery": "Fantasy",
  "Grimdark": "Fantasy",
  "grimdark": "Fantasy",
  "Progression Fantasy": "Fantasy",
  "progression fantasy": "Fantasy",
  "Romantasy": "Fantasy",
  "Steampunk": "Fantasy",

  // Historical Fiction variants
  "Historical": "Historical Fiction",
  "Historical Adventure": "Historical Fiction",
  "Historical Fantasy": "Historical Fiction",
  "Historical Mystery": "Historical Fiction",
  "Historical Romance": "Historical Fiction",
  "historical horror": "Historical Fiction",

  // Horror variants
  "Cosmic Horror": "Horror",
  "Folk Horror": "Horror",
  "Gothic Horror": "Horror",
  "Psychological Horror": "Horror",
  "Gothic": "Horror",
  "body horror": "Horror",
  "slasher": "Horror",

  // Romance variants
  "Regency Romance": "Romance",
  "dark romance": "Romance",

  // Adventure variants
  "adventure": "Adventure",
  "Action/Adventure": "Adventure",
  "Epic Adventure": "Adventure",

  // Humor variants
  "Social Satire": "Humor",
  "Absurdist": "Humor",
  "dark humor": "Humor",

  // Literary Fiction variants
  "Contemporary": "Literary Fiction",
  "Philosophical Fiction": "Literary Fiction",
  "Domestic Fiction": "Literary Fiction",
  "Political Fiction": "Literary Fiction",
  "Allegory": "Literary Fiction",
  "Dark Academia": "Literary Fiction",
  "Coming-of-Age": "Literary Fiction",
  "Coming of Age": "Literary Fiction",
  "Family Saga": "Literary Fiction",
  "Social Commentary": "Literary Fiction",

  // Speculative Fiction / Dystopian
  "Post-Apocalyptic": "Dystopian",
  "Apocalyptic": "Dystopian",
  "Afrofuturism": "Speculative Fiction",
  "Hopepunk": "Speculative Fiction",
  "Time Travel": "Speculative Fiction",
  "Paranormal": "Speculative Fiction",
  "Supernatural": "Speculative Fiction",

  // Short stories
  "Novella": "Short Stories",

  // Classics
  "Classic Literature": "Classics",

  // Christian Fiction
  "Inspirational": "Christian Fiction",
  "Inspirational Fiction": "Christian Fiction",

  // Graphic Novels
  "Graphic Novels": "Graphic Novel",
  "Comics": "Graphic Novel",

  // Non-fiction mappings
  "Survival": "Adventure",
  "Survival Fiction": "Adventure",
  "Literary Criticism": "Essays",
  "Political Intrigue": "Thriller",
  "political intrigue": "Thriller",
  "Magic System": "Fantasy",

  // Children's normalization
  "Children's Literature": "Children's",
  "Young Adult Fantasy": "Young Adult",

  // Biography/Memoir
  "Autobiography": "Memoir",
};

/**
 * Given a list of genre names linked to a book, determine:
 * 1. primaryGenre — the curated top-level genre for the green pill
 * 2. ageCategory — children's age category for a second pill (if applicable)
 * 3. displayGenres — remaining genres for grey secondary pills
 *
 * Priority for primary genre:
 * 1. Direct whitelist match (genre name IS in TOP_LEVEL_WHITELIST)
 * 2. Mapped match (genre maps to a whitelist entry via GENRE_TO_TOP_LEVEL)
 */
export function classifyGenres(
  genreRows: { genreId: string; name: string; parentGenreId: string | null }[]
): {
  primaryGenre: string | null;
  ageCategory: string | null;
  displayGenres: string[];
} {
  const linkedIds = new Set(genreRows.map((g) => g.genreId));
  let ageCategory: string | null = null;

  // Pass 1: Extract age categories
  for (const g of genreRows) {
    if (CHILDRENS_AGE_CATEGORIES.has(g.name)) {
      // Prefer specific (YA, Middle Grade) over generic "Children's"
      if (!ageCategory || g.name !== "Children's") {
        ageCategory = g.name;
      }
    }
    const mapped = GENRE_TO_TOP_LEVEL[g.name];
    if (mapped && CHILDRENS_AGE_CATEGORIES.has(mapped)) {
      if (!ageCategory || mapped !== "Children's") {
        ageCategory = mapped;
      }
    }
  }

  // Pass 2: Find primary genre
  // Resolve each genre to its curated display name (direct or mapped).
  // Among resolved genres, prefer direct whitelist matches over mapped ones,
  // and within each tier, earlier insertion order wins.
  // Exception: LitRPG beats Sci-Fi and Fantasy when both are present.
  let primaryGenre: string | null = null;
  let fallbackPrimary: string | null = null;

  for (const g of genreRows) {
    if (CHILDRENS_AGE_CATEGORIES.has(g.name)) continue;
    const mapped = GENRE_TO_TOP_LEVEL[g.name];

    if (TOP_LEVEL_WHITELIST.has(g.name)) {
      // Direct match — take the first one
      if (!primaryGenre) {
        primaryGenre = g.name;
      }
      // LitRPG always wins over Sci-Fi and Fantasy (it's more specific)
      if (g.name === "LitRPG" && (primaryGenre === "Sci-Fi" || primaryGenre === "Fantasy")) {
        primaryGenre = "LitRPG";
      }
    } else if (mapped && TOP_LEVEL_WHITELIST.has(mapped) && !CHILDRENS_AGE_CATEGORIES.has(mapped)) {
      // Mapped match — lower priority, only used if no direct match found
      if (!fallbackPrimary) {
        fallbackPrimary = mapped;
      }
    }
  }

  if (!primaryGenre) {
    primaryGenre = fallbackPrimary;
  }

  // Normalize display name (e.g. "Dystopia" → "Dystopian")
  if (primaryGenre && DISPLAY_NAME[primaryGenre]) {
    primaryGenre = DISPLAY_NAME[primaryGenre];
  }

  // Pass 3: Build secondary genre list
  // Show specific sub-genres (e.g. "Space Opera", "Hard Science Fiction") even when
  // they map to the same top-level as the primary. Only suppress exact synonyms
  // (e.g. "Science Fiction" when primary is "Sci-Fi").
  const secondaryGenres: string[] = [];
  const seen = new Set<string>();
  if (primaryGenre) seen.add(primaryGenre);
  if (ageCategory) seen.add(ageCategory);

  for (const g of genreRows) {
    // Skip age categories — already shown as second pill
    if (CHILDRENS_AGE_CATEGORIES.has(g.name)) continue;

    // Hide parent genres when their children are also linked
    const hasLinkedChild = genreRows.some(
      (other) => other.parentGenreId === g.genreId && linkedIds.has(other.genreId)
    );
    if (hasLinkedChild) continue;

    // Get display name (e.g. "Science Fiction" → "Sci-Fi", "Dystopia" → "Dystopian")
    const displayName = DISPLAY_NAME[g.name] || g.name;

    // Skip if this genre's display name matches the primary (exact synonym)
    if (displayName === primaryGenre) continue;
    if (g.name === primaryGenre) continue;

    // Deduplicate by display name
    if (seen.has(displayName)) continue;
    seen.add(displayName);

    secondaryGenres.push(displayName);
  }

  return {
    primaryGenre,
    ageCategory,
    displayGenres: secondaryGenres.slice(0, 5),
  };
}
