import { cache } from "react";
import { unstable_cache } from "next/cache";
import { db } from "@/db";
import {
  books,
  bookGenres,
  genres,
  bookAuthors,
  authors,
  bookSeries,
  bookCategoryRatings,
  userBookState,
  userBookRatings,
  userFavoriteBooks,
  upNext,
  userReadingPreferences,
  userGenrePreferences,
  userContentPreferences,
  userHiddenBooks,
  taxonomyCategories,
} from "@/db/schema";
import { eq, sql, and, isNotNull, inArray } from "drizzle-orm";
import { isEnglishTitle, looksLikeMidSeriesTitle } from "@/lib/queries/books";
import { batchFetchBookAuthors } from "@/lib/queries/batch-helpers";

// ─── Anthology / collection title patterns ───

const ANTHOLOGY_TITLE_PATTERNS = [
  /\bantholog/i,
  /\bcollected\s+(stories|tales|works|fiction|short)/i,
  /\bcomplete\s+(stories|tales|short\s+stories)/i,
  /\bselected\s+(stories|tales|short\s+stories)/i,
  /\bshort\s+stor(y|ies)\b/i,
  /\bshort\s+fiction\b/i,
];

/** Check if a book title suggests it is an anthology or short story collection. */
function looksLikeAnthologyTitle(title: string): boolean {
  return ANTHOLOGY_TITLE_PATTERNS.some((p) => p.test(title));
}

/** Genre names that mark a book as anthology/short stories (case-insensitive match). */
const ANTHOLOGY_GENRE_NAMES = new Set([
  "anthology", "short stories", "short story", "short story collection",
  "short fiction collection", "novella collection", "short stories anthology",
  "multi-author anthology", "classic anthology", "literary anthology",
  "horror anthology", "fantasy anthology", "sci-fi anthology",
  "science fiction anthology", "comic book anthology", "comic anthology",
  "charity anthology", "historical anthology", "adventure anthology",
  "collaborative anthology", "superhero anthology", "anthology collection",
  "anthology story", "poetry anthology", "poetry collection",
  "war poetry collection", "short fiction", "short story cycle",
  "literary short stories", "french short stories", "hard sci-fi short fiction",
  "humorous short fiction", "space exploration anthology",
]);

// ─── Types ───

export interface RecommendedBook {
  id: string;
  slug: string | null;
  title: string;
  coverImageUrl: string | null;
  authors: string[];
  score: number;
  reason?: string;
  aggregateRating?: number | null;
  contentWarnings?: { categoryName: string; bookIntensity: number; userMax: number }[];
}

interface UserPreferenceProfile {
  /** Genre IDs → affinity score (higher = more liked) */
  genreAffinities: Map<string, number>;
  /** Parent genre IDs → affinity score */
  parentGenreAffinities: Map<string, number>;
  /** Fraction of liked books that are fiction (0-1) */
  fictionRatio: number;
  /** Average content intensity per category for liked books (0-4 scale) */
  contentTolerances: Map<string, number>;
  /** Author IDs the user has rated highly */
  likedAuthorIds: Set<string>;
  /** Total liked books used to build profile */
  sampleSize: number;
}

/** Explicit preferences from onboarding/settings (as opposed to implicit signals) */
interface ExplicitPreferences {
  /** Genre name → 'love' | 'dislike' */
  genrePreferences: Map<string, "love" | "dislike">;
  /** 'fiction' | 'nonfiction' | 'both' | null */
  fictionPreference: string | null;
  /** Content category ID → max tolerance (0-4, where 4 = no limit) */
  contentTolerances: Map<string, number>;
  /** Preferred page range */
  pageLengthMin: number | null;
  pageLengthMax: number | null;
  /** 'slow' | 'medium' | 'fast' | null — may be JSON array string for multi-select */
  pacePreference: string | null;
  /** 'worldbuilding' | 'plot' | 'characters' | 'mix' | null */
  storyFocus: string | null;
  /** e.g. ['morally-grey', 'found-family'] */
  characterTropes: string[];
  /** User-typed content warnings to avoid */
  customContentWarnings: string[];
}

interface CandidateBook {
  id: string;
  title: string;
  coverImageUrl: string | null;
  isFiction: boolean;
  hasDescription: boolean;
  pages: number | null;
  genreIds: string[];
  parentGenreIds: string[];
  authorIds: string[];
  seriesIds: string[];
  /** Position in series (null if standalone or no position) */
  seriesPosition: number | null;
}

// ─── Cached genre lookup (genres rarely change, no need to query every request) ───

const getAllGenresCached = unstable_cache(
  async () => {
    return db
      .select({ id: genres.id, name: genres.name })
      .from(genres)
      .all();
  },
  ["all-genres"],
  { revalidate: 3600 } // 1 hour
);

// ─── Scoring weights ───

const WEIGHTS = {
  genreOverlap: 0.35,
  parentGenreMatch: 0.12,
  seriesContinuation: 0.15,
  fictionAlignment: 0.08,
  contentCompatibility: 0.20,  // Doubled from 0.10 — content comfort is critical for user trust
  lengthFit: 0.07,
  dataQuality: 0.03,
};

// ─── Preference profile ───

/**
 * Build a preference profile from books the user rated 4.0+ or favorited,
 * then merge with explicit preferences from onboarding/settings.
 * Cached per request so multiple recommendation calls share the same profile.
 */
export const getUserPreferenceProfile = cache(
  async (userId: string): Promise<UserPreferenceProfile | null> => {
    // Fetch explicit preferences alongside implicit signals
    const explicit = await getExplicitPreferences(userId);

    // Get highly-rated + favorited book IDs in parallel
    const [highRatedRows, favRows] = await Promise.all([
      db
        .select({ bookId: userBookRatings.bookId })
        .from(userBookRatings)
        .where(
          and(
            eq(userBookRatings.userId, userId),
            sql`${userBookRatings.rating} >= 4.0`
          )
        )
        .all(),
      db
        .select({ bookId: userFavoriteBooks.bookId })
        .from(userFavoriteBooks)
        .where(eq(userFavoriteBooks.userId, userId))
        .all(),
    ]);

    // Merge unique book IDs (favorites get extra weight)
    const favBookIds = new Set(favRows.map((r) => r.bookId));
    const likedBookIds = new Set([
      ...highRatedRows.map((r) => r.bookId),
      ...favBookIds,
    ]);

    // If no implicit data AND no explicit data → null (true cold start)
    if (likedBookIds.size === 0 && !explicit) return null;

    // If we only have explicit prefs (no ratings yet), build a profile from those alone
    if (likedBookIds.size === 0 && explicit) {
      return buildExplicitOnlyProfile(explicit);
    }

    const likedIds = [...likedBookIds];

    // Run all 4 independent queries in parallel
    const idFilter = sql`IN (${sql.join(likedIds.map((id) => sql`${id}`), sql`, `)})`;
    const [bookInfoRows, genreRows, authorRows, contentRows] = await Promise.all([
      db
        .select({ id: books.id, isFiction: books.isFiction })
        .from(books)
        .where(sql`${books.id} ${idFilter}`)
        .all(),
      db
        .select({ genreId: bookGenres.genreId, bookId: bookGenres.bookId })
        .from(bookGenres)
        .where(sql`${bookGenres.bookId} ${idFilter}`)
        .all(),
      db
        .select({ authorId: bookAuthors.authorId })
        .from(bookAuthors)
        .where(sql`${bookAuthors.bookId} ${idFilter}`)
        .all(),
      db
        .select({
          categoryId: bookCategoryRatings.categoryId,
          intensity: bookCategoryRatings.intensity,
        })
        .from(bookCategoryRatings)
        .where(sql`${bookCategoryRatings.bookId} ${idFilter}`)
        .all(),
    ]);

    // Fiction ratio
    const fictionCount = bookInfoRows.filter((b) => b.isFiction).length;
    let fictionRatio =
      bookInfoRows.length > 0 ? fictionCount / bookInfoRows.length : 0.5;

    // [INTEGRATION #2] Override fiction ratio with explicit preference
    if (explicit?.fictionPreference) {
      if (explicit.fictionPreference === "fiction") {
        fictionRatio = likedBookIds.size >= 5
          ? fictionRatio * 0.4 + 0.9 * 0.6
          : 0.9;
      } else if (explicit.fictionPreference === "nonfiction") {
        fictionRatio = likedBookIds.size >= 5
          ? fictionRatio * 0.4 + 0.1 * 0.6
          : 0.1;
      }
    }

    // Genre affinities
    const genreAffinities = new Map<string, number>();
    for (const row of genreRows) {
      const weight = favBookIds.has(row.bookId) ? 2 : 1;
      genreAffinities.set(
        row.genreId,
        (genreAffinities.get(row.genreId) ?? 0) + weight
      );
    }

    // [INTEGRATION #1] Merge explicit genre love/dislike into affinities
    if (explicit && explicit.genrePreferences.size > 0) {
      await mergeExplicitGenrePreferences(explicit.genrePreferences, genreAffinities);
    }

    // Resolve parent genres for affinity
    const allGenreIds = [...genreAffinities.keys()];
    const parentGenreAffinities = new Map<string, number>();
    if (allGenreIds.length > 0) {
      const genreParentRows = await db
        .select({
          id: genres.id,
          parentGenreId: genres.parentGenreId,
        })
        .from(genres)
        .where(sql`${genres.id} IN (${sql.join(allGenreIds.map((id) => sql`${id}`), sql`, `)})`)
        .all();

      for (const row of genreParentRows) {
        if (row.parentGenreId) {
          const childAffinity = genreAffinities.get(row.id) ?? 0;
          parentGenreAffinities.set(
            row.parentGenreId,
            (parentGenreAffinities.get(row.parentGenreId) ?? 0) + childAffinity
          );
        }
      }
    }

    const likedAuthorIds = new Set(authorRows.map((r) => r.authorId));

    // Content tolerances
    const contentSums = new Map<string, { sum: number; count: number }>();
    for (const row of contentRows) {
      const entry = contentSums.get(row.categoryId) ?? { sum: 0, count: 0 };
      entry.sum += row.intensity;
      entry.count += 1;
      contentSums.set(row.categoryId, entry);
    }
    const contentTolerances = new Map<string, number>();
    for (const [catId, { sum, count }] of contentSums) {
      contentTolerances.set(catId, sum / count);
    }

    return {
      genreAffinities,
      parentGenreAffinities,
      fictionRatio,
      contentTolerances,
      likedAuthorIds,
      sampleSize: likedBookIds.size,
    };
  }
);

/**
 * Build a profile entirely from explicit onboarding preferences (cold-start users
 * who completed onboarding but haven't rated any books yet).
 */
async function buildExplicitOnlyProfile(
  explicit: ExplicitPreferences
): Promise<UserPreferenceProfile> {
  const genreAffinities = new Map<string, number>();
  const parentGenreAffinities = new Map<string, number>();

  // Resolve genre names → IDs and set affinity scores
  if (explicit.genrePreferences.size > 0) {
    await mergeExplicitGenrePreferences(explicit.genrePreferences, genreAffinities);

    // Build parent affinities from the genre affinities we just created
    const allGenreIds = [...genreAffinities.keys()].filter((id) => genreAffinities.get(id)! > 0);
    if (allGenreIds.length > 0) {
      const parentRows = await db
        .select({ id: genres.id, parentGenreId: genres.parentGenreId })
        .from(genres)
        .where(sql`${genres.id} IN (${sql.join(allGenreIds.map((id) => sql`${id}`), sql`, `)})`)
        .all();

      for (const row of parentRows) {
        if (row.parentGenreId) {
          const childAffinity = genreAffinities.get(row.id) ?? 0;
          if (childAffinity > 0) {
            parentGenreAffinities.set(
              row.parentGenreId,
              (parentGenreAffinities.get(row.parentGenreId) ?? 0) + childAffinity
            );
          }
        }
      }
    }
  }

  // Fiction ratio from explicit preference
  let fictionRatio = 0.5;
  if (explicit.fictionPreference === "fiction") fictionRatio = 0.9;
  else if (explicit.fictionPreference === "nonfiction") fictionRatio = 0.1;

  return {
    genreAffinities,
    parentGenreAffinities,
    fictionRatio,
    contentTolerances: new Map(), // no implicit content data yet
    likedAuthorIds: new Set(),
    sampleSize: 0,
  };
}

/**
 * Resolve explicit genre name preferences to genre IDs and merge into affinity map.
 * "love" genres get a strong positive boost; "dislike" genres get negative affinity.
 */
async function mergeExplicitGenrePreferences(
  genrePreferences: Map<string, "love" | "dislike">,
  genreAffinities: Map<string, number>
): Promise<void> {
  const genreNames = [...genrePreferences.keys()];
  if (genreNames.length === 0) return;

  // Resolve genre names → IDs (genres table stores name, we need the ID for scoring)
  const genreIdRows = await db
    .select({ id: genres.id, name: genres.name })
    .from(genres)
    .where(sql`${genres.name} IN (${sql.join(genreNames.map((n) => sql`${n}`), sql`, `)})`)
    .all();

  const nameToId = new Map(genreIdRows.map((r) => [r.name, r.id]));

  // Determine boost magnitude: scale with existing data so explicit prefs
  // meaningfully influence but don't completely overpower rich implicit history
  const maxImplicit = genreAffinities.size > 0
    ? Math.max(...genreAffinities.values(), 1)
    : 3; // default boost for cold-start

  const loveBoost = Math.max(maxImplicit * 1.5, 3); // at least 3, up to 1.5x max implicit
  const dislikePenalty = -Math.max(maxImplicit * 0.8, 2); // strong negative

  for (const [name, pref] of genrePreferences) {
    const genreId = nameToId.get(name);
    if (!genreId) continue;

    const current = genreAffinities.get(genreId) ?? 0;
    if (pref === "love") {
      genreAffinities.set(genreId, current + loveBoost);
    } else {
      genreAffinities.set(genreId, current + dislikePenalty);
    }
  }
}

// ─── Explicit preferences (from onboarding / settings) ───

const getExplicitPreferences = cache(
  async (userId: string): Promise<ExplicitPreferences | null> => {
    const prefs = await db
      .select()
      .from(userReadingPreferences)
      .where(eq(userReadingPreferences.userId, userId))
      .get();

    if (!prefs) return null;

    // Genre preferences (name → love/dislike)
    const genreRows = await db
      .select({
        genreName: userGenrePreferences.genreName,
        preference: userGenrePreferences.preference,
      })
      .from(userGenrePreferences)
      .where(eq(userGenrePreferences.userId, userId))
      .all();

    const genrePreferences = new Map<string, "love" | "dislike">();
    for (const row of genreRows) {
      genrePreferences.set(row.genreName, row.preference as "love" | "dislike");
    }

    // Content tolerance preferences
    const contentRows = await db
      .select({
        categoryId: userContentPreferences.categoryId,
        maxTolerance: userContentPreferences.maxTolerance,
      })
      .from(userContentPreferences)
      .where(eq(userContentPreferences.userId, userId))
      .all();

    const contentTolerances = new Map<string, number>();
    for (const row of contentRows) {
      contentTolerances.set(row.categoryId, row.maxTolerance);
    }

    return {
      genrePreferences,
      fictionPreference: prefs.fictionPreference,
      contentTolerances,
      pageLengthMin: prefs.pageLengthMin,
      pageLengthMax: prefs.pageLengthMax,
      pacePreference: prefs.pacePreference,
      storyFocus: prefs.storyFocus ?? null,
      characterTropes: prefs.characterTropes
        ? JSON.parse(prefs.characterTropes)
        : [],
      customContentWarnings: prefs.customContentWarnings
        ? JSON.parse(prefs.customContentWarnings)
        : [],
    };
  }
);

// ─── Excluded books (already in user's library) ───

const getUserExcludedBookIds = cache(
  async (userId: string): Promise<Set<string>> => {
    const stateRows = await db
      .select({ bookId: userBookState.bookId })
      .from(userBookState)
      .where(eq(userBookState.userId, userId))
      .all();

    const upNextRows = await db
      .select({ bookId: upNext.bookId })
      .from(upNext)
      .where(eq(upNext.userId, userId))
      .all();

    const hiddenRows = await db
      .select({ bookId: userHiddenBooks.bookId })
      .from(userHiddenBooks)
      .where(eq(userHiddenBooks.userId, userId))
      .all();

    return new Set([
      ...stateRows.map((r) => r.bookId),
      ...upNextRows.map((r) => r.bookId),
      ...hiddenRows.map((r) => r.bookId),
    ]);
  }
);

// ─── Scoring ───

function scoreCandidateBook(
  candidate: CandidateBook,
  profile: UserPreferenceProfile,
  seriesProgress?: UserSeriesProgress,
  explicit?: ExplicitPreferences | null,
  candidateContentRatings?: Map<string, number>
): number {
  let score = 0;

  // 1. Genre overlap (35%) — how many of the candidate's genres match user affinity
  // Now incorporates explicit love/dislike via the merged genreAffinities map
  if (candidate.genreIds.length > 0) {
    let genreScore = 0;
    let maxPossible = 0;
    let hasDislikedGenre = false;
    for (const gid of candidate.genreIds) {
      const affinity = profile.genreAffinities.get(gid) ?? 0;
      genreScore += affinity;
      maxPossible += 1;
      if (affinity < 0) hasDislikedGenre = true;
    }
    // Normalize: affinity can be high for popular genres, so use relative scoring
    const positiveAffinities = [...profile.genreAffinities.values()].filter((v) => v > 0);
    const maxAffinity = positiveAffinities.length > 0 ? Math.max(...positiveAffinities) : 1;
    const normalizedGenre = maxPossible > 0
      ? Math.min(Math.max(genreScore / (maxPossible * maxAffinity) * 2, -0.5), 1)
      : 0;
    score += normalizedGenre * WEIGHTS.genreOverlap * 100;

    // Extra penalty if book has an explicitly disliked genre
    if (hasDislikedGenre) {
      score -= 8; // additional flat penalty beyond the negative affinity score
    }
  }

  // 2. Parent genre match (12%) — broader genre alignment via parent genres
  if (candidate.parentGenreIds.length > 0 && profile.parentGenreAffinities.size > 0) {
    let parentScore = 0;
    for (const pid of candidate.parentGenreIds) {
      if (profile.parentGenreAffinities.has(pid)) {
        parentScore += 1;
      }
    }
    const normalizedParent = Math.min(
      parentScore / Math.max(candidate.parentGenreIds.length, 1),
      1
    );
    score += normalizedParent * WEIGHTS.parentGenreMatch * 100;
  } else {
    // Also check direct genre overlap for top-level genres (since most genres are top-level)
    const topGenreOverlap = candidate.genreIds.filter(
      (gid) => profile.genreAffinities.has(gid) && (profile.genreAffinities.get(gid) ?? 0) > 0
    ).length;
    const normalizedTop = Math.min(
      topGenreOverlap / Math.max(candidate.genreIds.length, 1),
      1
    );
    score += normalizedTop * WEIGHTS.parentGenreMatch * 100;
  }

  // 3. Series continuation (15%) — only suggest next-unread book in started series
  if (candidate.seriesIds.length > 0 && seriesProgress) {
    let bestSeriesScore = -Infinity;

    for (const sid of candidate.seriesIds) {
      if (seriesProgress.startedSeriesIds.has(sid)) {
        // User has started this series — check if this is the NEXT unread book
        const highestRead = seriesProgress.highestReadPosition.get(sid) ?? 0;
        const candidatePos = candidate.seriesPosition;

        if (candidatePos != null && highestRead > 0) {
          if (candidatePos === highestRead + 1) {
            // This IS the next book in sequence — maximum boost
            bestSeriesScore = Math.max(bestSeriesScore, WEIGHTS.seriesContinuation * 100);
          } else if (candidatePos <= highestRead) {
            // User already read past this position — heavy penalty
            bestSeriesScore = Math.max(bestSeriesScore, -30);
          } else {
            // Candidate is further ahead than next-unread (e.g. user read #2, this is #5)
            // Mild penalty — they'd need to read books in between
            bestSeriesScore = Math.max(bestSeriesScore, -10);
          }
        } else {
          // No position data — mild boost for being in a started series
          bestSeriesScore = Math.max(bestSeriesScore, WEIGHTS.seriesContinuation * 50);
        }
      } else if (candidate.seriesPosition != null && candidate.seriesPosition > 1) {
        // Series NOT started by user and this is book #2+ — heavy penalty
        bestSeriesScore = Math.max(bestSeriesScore, -20);
      }
      // Book #1 in an unstarted series = neutral (fine to suggest)
    }

    if (bestSeriesScore > -Infinity) {
      score += bestSeriesScore;
    }
  } else if (candidate.seriesIds.length > 0 && candidate.seriesPosition != null && candidate.seriesPosition > 1) {
    // No series progress data but this is a non-first book — penalize
    score -= 20;
  }

  // 4. Fiction/nonfiction alignment (10%)
  const bookIsFiction = candidate.isFiction;
  const fictionAlignment = bookIsFiction
    ? profile.fictionRatio
    : 1 - profile.fictionRatio;
  score += fictionAlignment * WEIGHTS.fictionAlignment * 100;

  // 5. Content compatibility (10%) — penalize if book exceeds user's explicit tolerance
  // [INTEGRATION #3] Real content tolerance scoring
  if (explicit && explicit.contentTolerances.size > 0 && candidateContentRatings && candidateContentRatings.size > 0) {
    let violations = 0;
    let totalCategories = 0;
    let worstViolation = 0;

    for (const [categoryId, bookIntensity] of candidateContentRatings) {
      const userMax = explicit.contentTolerances.get(categoryId);
      if (userMax === undefined || userMax >= 4) continue; // no limit set or "show all"

      totalCategories++;
      if (bookIntensity > userMax) {
        violations++;
        const severity = bookIntensity - userMax; // 1-4 scale of how much it exceeds
        worstViolation = Math.max(worstViolation, severity);
      }
    }

    if (violations === 0) {
      // Book is within all user tolerances — full score
      score += WEIGHTS.contentCompatibility * 100;
    } else {
      // Penalize proportionally: more violations = worse score
      // worstViolation of 1 = mild exceed, 3+ = severe exceed
      const penaltyFactor = Math.min(worstViolation * 0.3 + violations * 0.15, 1);
      score -= WEIGHTS.contentCompatibility * 100 * penaltyFactor;
    }
  } else if (profile.contentTolerances.size > 0 && candidateContentRatings && candidateContentRatings.size > 0) {
    // Fallback: implicit tolerance comparison (average intensity from liked books)
    let compatScore = 0;
    let comparisons = 0;
    for (const [catId, bookIntensity] of candidateContentRatings) {
      const userAvg = profile.contentTolerances.get(catId);
      if (userAvg === undefined) continue;
      comparisons++;
      // Score higher when book intensity is at or below user's average
      const diff = bookIntensity - userAvg;
      compatScore += diff <= 0 ? 1.0 : Math.max(1.0 - diff * 0.25, 0);
    }
    const normalized = comparisons > 0 ? compatScore / comparisons : 0.5;
    score += normalized * WEIGHTS.contentCompatibility * 100;
  } else {
    // No content data available — neutral
    score += WEIGHTS.contentCompatibility * 100 * 0.5;
  }

  // 5b. Absolute penalty for severe content violations (on top of weighted score)
  // This ensures books with extreme violations drop significantly even with high genre match
  if (explicit && explicit.contentTolerances.size > 0 && candidateContentRatings) {
    for (const [categoryId, bookIntensity] of candidateContentRatings) {
      const userMax = explicit.contentTolerances.get(categoryId);
      if (userMax !== undefined && userMax < 4 && bookIntensity > userMax) {
        const severity = bookIntensity - userMax;
        if (severity >= 3) score -= 20;       // extreme violation (e.g. user: none, book: significant+)
        else if (severity >= 2) score -= 12;  // moderate violation
        else score -= 6;                      // mild violation
      }
    }
  }

  // 6. Length/pace fit (8%) — penalize books outside preferred page range
  // [INTEGRATION #4 & #5] Page length and pace preference
  if (explicit && candidate.pages) {
    let lengthScore = 1.0; // default: perfect fit

    // Length preference from min/max page range
    if (explicit.pageLengthMin != null || explicit.pageLengthMax != null) {
      const min = explicit.pageLengthMin ?? 0;
      const max = explicit.pageLengthMax ?? Infinity;

      if (candidate.pages >= min && candidate.pages <= max) {
        lengthScore = 1.0; // within preferred range
      } else if (candidate.pages < min) {
        // Below minimum — soft penalty based on how far under
        const shortfall = (min - candidate.pages) / min;
        lengthScore = Math.max(1.0 - shortfall * 1.5, 0);
      } else {
        // Above maximum — soft penalty based on how far over
        const excess = (candidate.pages - max) / max;
        lengthScore = Math.max(1.0 - excess * 1.5, 0);
      }
    }

    // Pace preference as a secondary signal on page count
    // Supports both legacy single string and new JSON array format
    if (explicit.pacePreference && explicit.pacePreference !== "any") {
      let paceValues: string[] = [];
      try {
        const parsed = JSON.parse(explicit.pacePreference);
        if (Array.isArray(parsed)) paceValues = parsed;
      } catch {
        paceValues = [explicit.pacePreference];
      }
      // "fast" readers tend to prefer shorter books or don't mind long ones
      // "slow" readers may prefer shorter/medium books
      // This is a very soft signal — only apply if NOT multi-selecting conflicting paces
      const hasSlow = paceValues.includes("slow");
      const hasFast = paceValues.includes("fast");
      if (hasSlow && !hasFast && candidate.pages > 500) {
        lengthScore *= 0.85; // slight penalty for very long books for slow readers
      } else if (hasFast && !hasSlow && candidate.pages < 150) {
        lengthScore *= 0.9; // fast readers may find very short books less satisfying
      }
    }

    score += lengthScore * WEIGHTS.lengthFit * 100;
  } else {
    score += WEIGHTS.lengthFit * 100 * 0.5; // neutral when no data
  }

  // [SCAFFOLD #6] Story focus & character tropes
  // Once books have story_focus and character_tropes metadata, score like:
  //   if (explicit?.storyFocus && candidate.storyFocus === explicit.storyFocus) score += bonus;
  //   if (explicit?.characterTropes.length && candidate has matching tropes) score += bonus;
  // These fields exist on ExplicitPreferences but need book-level equivalents to compare.

  // [SCAFFOLD #7] Custom content warnings
  // Once books have free-text content tags, compare against explicit.customContentWarnings.
  // e.g. if book has tag "infidelity" and user listed "infidelity" as a warning → penalize.
  // Requires a text-matching or tagging system on the book content profile.

  // 7. Data quality (10%) — prefer books with covers and descriptions
  let qualityScore = 0;
  if (candidate.coverImageUrl) qualityScore += 0.6;
  if (candidate.hasDescription) qualityScore += 0.4;
  score += qualityScore * WEIGHTS.dataQuality * 100;

  return Math.round(score * 10) / 10;
}

// ─── Candidate fetching ───

async function fetchCandidateBooks(
  excludedIds: Set<string>,
  preferredGenreIds: string[],
  limit: number
): Promise<CandidateBook[]> {
  // Phase 1: SQL pulls candidates biased toward preferred genres
  // QUALITY FILTERS: require cover, prefer English (language IS NULL or 'English'),
  // for series books only suggest #1 or next-in-series (handled in scoring)
  const currentYear = new Date().getFullYear();
  const qualityFilter = sql`${books.coverImageUrl} IS NOT NULL AND (${books.language} IS NULL OR ${books.language} = 'English') AND (${books.publicationYear} IS NULL OR ${books.publicationYear} <= ${currentYear}) AND ${books.isBoxSet} = 0 AND ${books.id} NOT IN (
    SELECT bg.book_id FROM book_genres bg
    INNER JOIN genres g ON bg.genre_id = g.id
    WHERE g.name IN ('Anthology', 'Short Stories', 'Short Story', 'Short Story Collection', 'Short Fiction Collection', 'Novella Collection', 'Short Stories Anthology', 'Multi-Author Anthology', 'Classic Anthology', 'Literary Anthology', 'Horror Anthology', 'Fantasy Anthology', 'Sci-Fi Anthology', 'Science Fiction Anthology', 'Comic Book Anthology', 'Comic Anthology', 'Charity Anthology', 'Historical Anthology', 'Adventure Anthology', 'Collaborative Anthology', 'Superhero Anthology', 'Anthology Collection', 'Anthology Story', 'Poetry Anthology', 'Poetry Collection')
  )`;
  let candidateBookIds: string[];

  if (preferredGenreIds.length > 0) {
    // Get books in preferred genres first (more likely to be relevant)
    const genreMatchRows = await db
      .select({ bookId: bookGenres.bookId })
      .from(bookGenres)
      .innerJoin(books, eq(bookGenres.bookId, books.id))
      .where(
        sql`${bookGenres.genreId} IN (${sql.join(
          preferredGenreIds.slice(0, 30).map((id) => sql`${id}`),
          sql`, `
        )}) AND ${qualityFilter}`
      )
      .groupBy(bookGenres.bookId)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(limit * 3)
      .all();

    candidateBookIds = genreMatchRows
      .map((r) => r.bookId)
      .filter((id) => !excludedIds.has(id));

    // Fill with random books if we didn't get enough
    if (candidateBookIds.length < limit) {
      const randomFill = await db
        .select({ id: books.id })
        .from(books)
        .where(sql`${qualityFilter}`)
        .orderBy(sql`RANDOM()`)
        .limit(limit)
        .all();

      const randomIds = randomFill
        .map((r) => r.id)
        .filter((id) => !excludedIds.has(id) && !new Set(candidateBookIds).has(id));

      candidateBookIds = [...candidateBookIds, ...randomIds].slice(0, limit);
    }
  } else {
    // Cold start: random books with covers and English
    const randomRows = await db
      .select({ id: books.id })
      .from(books)
      .where(sql`${qualityFilter}`)
      .orderBy(sql`RANDOM()`)
      .limit(limit)
      .all();

    candidateBookIds = randomRows
      .map((r) => r.id)
      .filter((id) => !excludedIds.has(id));
  }

  if (candidateBookIds.length === 0) return [];

  // Phase 2: hydrate candidates with metadata
  const bookRows = await db
    .select({
      id: books.id,
      slug: books.slug,
      title: books.title,
      coverImageUrl: books.coverImageUrl,
      isFiction: books.isFiction,
      description: books.description,
      pages: books.pages,
    })
    .from(books)
    .where(sql`${books.id} IN (${sql.join(candidateBookIds.map((id) => sql`${id}`), sql`, `)})`)
    .all();

  // Batch-fetch genres for all candidates
  const allGenreRows = await db
    .select({
      bookId: bookGenres.bookId,
      genreId: bookGenres.genreId,
    })
    .from(bookGenres)
    .where(sql`${bookGenres.bookId} IN (${sql.join(candidateBookIds.map((id) => sql`${id}`), sql`, `)})`)
    .all();

  const genresByBook = new Map<string, string[]>();
  for (const row of allGenreRows) {
    const arr = genresByBook.get(row.bookId) ?? [];
    arr.push(row.genreId);
    genresByBook.set(row.bookId, arr);
  }

  // Batch-fetch parent genre IDs
  const allCandidateGenreIds = [...new Set(allGenreRows.map((r) => r.genreId))];
  const parentMap = new Map<string, string>();
  if (allCandidateGenreIds.length > 0) {
    const parentRows = await db
      .select({ id: genres.id, parentGenreId: genres.parentGenreId })
      .from(genres)
      .where(sql`${genres.id} IN (${sql.join(allCandidateGenreIds.map((id) => sql`${id}`), sql`, `)})`)
      .all();

    for (const row of parentRows) {
      if (row.parentGenreId) {
        parentMap.set(row.id, row.parentGenreId);
      }
    }
  }

  // Batch-fetch authors
  const allAuthorRows = await db
    .select({
      bookId: bookAuthors.bookId,
      authorId: bookAuthors.authorId,
    })
    .from(bookAuthors)
    .where(sql`${bookAuthors.bookId} IN (${sql.join(candidateBookIds.map((id) => sql`${id}`), sql`, `)})`)
    .all();

  const authorsByBook = new Map<string, string[]>();
  for (const row of allAuthorRows) {
    const arr = authorsByBook.get(row.bookId) ?? [];
    arr.push(row.authorId);
    authorsByBook.set(row.bookId, arr);
  }

  // Batch-fetch series (including position for series-order filtering)
  const allSeriesRows = await db
    .select({
      bookId: bookSeries.bookId,
      seriesId: bookSeries.seriesId,
      positionInSeries: bookSeries.positionInSeries,
    })
    .from(bookSeries)
    .where(sql`${bookSeries.bookId} IN (${sql.join(candidateBookIds.map((id) => sql`${id}`), sql`, `)})`)
    .all();

  const seriesByBook = new Map<string, string[]>();
  const seriesPositionByBook = new Map<string, number | null>();
  for (const row of allSeriesRows) {
    const arr = seriesByBook.get(row.bookId) ?? [];
    arr.push(row.seriesId);
    seriesByBook.set(row.bookId, arr);
    // Store the first (usually only) series position
    if (!seriesPositionByBook.has(row.bookId)) {
      seriesPositionByBook.set(row.bookId, (row as { positionInSeries?: number }).positionInSeries ?? null);
    }
  }

  return bookRows
    .filter((book) => isEnglishTitle(book.title) && !looksLikeAnthologyTitle(book.title)) // Exclude non-English titles and anthology-like titles
    .map((book) => {
      const gids = genresByBook.get(book.id) ?? [];
      const pids = [...new Set(gids.map((gid) => parentMap.get(gid)).filter(Boolean))] as string[];

      return {
        id: book.id,
        title: book.title,
        coverImageUrl: book.coverImageUrl,
        isFiction: book.isFiction ?? true,
        hasDescription: !!book.description,
        pages: book.pages ?? null,
        genreIds: gids,
        parentGenreIds: pids,
        authorIds: authorsByBook.get(book.id) ?? [],
        seriesIds: seriesByBook.get(book.id) ?? [],
        seriesPosition: seriesPositionByBook.get(book.id) ?? null,
      };
    });
}

/**
 * Batch-fetch content category ratings (max intensity per category) for a set of books.
 * Returns Map<bookId, Map<categoryId, intensity>>
 */
async function batchFetchContentRatings(
  bookIds: string[]
): Promise<Map<string, Map<string, number>>> {
  if (bookIds.length === 0) return new Map();

  const rows = await db
    .select({
      bookId: bookCategoryRatings.bookId,
      categoryId: bookCategoryRatings.categoryId,
      intensity: bookCategoryRatings.intensity,
    })
    .from(bookCategoryRatings)
    .where(sql`${bookCategoryRatings.bookId} IN (${sql.join(bookIds.map((id) => sql`${id}`), sql`, `)})`)
    .all();

  const result = new Map<string, Map<string, number>>();
  for (const row of rows) {
    let bookMap = result.get(row.bookId);
    if (!bookMap) {
      bookMap = new Map();
      result.set(row.bookId, bookMap);
    }
    // Use max intensity if there are multiple ratings for the same category
    const current = bookMap.get(row.categoryId) ?? 0;
    if (row.intensity > current) {
      bookMap.set(row.categoryId, row.intensity);
    }
  }
  return result;
}

async function getAuthorNames(bookId: string): Promise<string[]> {
  const rows = await db
    .select({ name: authors.name })
    .from(bookAuthors)
    .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
    .where(eq(bookAuthors.bookId, bookId))
    .all();
  return rows.map((r) => r.name);
}

// ─── User's series progress (for next-unread logic) ───

interface UserSeriesProgress {
  /** Series IDs the user has at least one book from */
  startedSeriesIds: Set<string>;
  /** For each started series, the highest position the user has read */
  highestReadPosition: Map<string, number>;
  /** All book IDs the user has in their library, keyed by series */
  readBookIdsBySeries: Map<string, Set<string>>;
}

const getUserSeriesProgress = cache(
  async (userId: string): Promise<UserSeriesProgress> => {
    // Get books the user has ACTUALLY READ (completed or currently reading) in series.
    // TBR, DNF, and paused do NOT count as "read" for determining series position.
    const rows = await db
      .select({
        seriesId: bookSeries.seriesId,
        bookId: bookSeries.bookId,
        positionInSeries: bookSeries.positionInSeries,
      })
      .from(bookSeries)
      .innerJoin(userBookState, eq(userBookState.bookId, bookSeries.bookId))
      .where(
        and(
          eq(userBookState.userId, userId),
          inArray(userBookState.state, ["completed", "currently_reading"])
        )
      )
      .all();

    const startedSeriesIds = new Set<string>();
    const highestReadPosition = new Map<string, number>();
    const readBookIdsBySeries = new Map<string, Set<string>>();

    for (const row of rows) {
      startedSeriesIds.add(row.seriesId);

      // Track highest position read
      const pos = row.positionInSeries;
      if (pos != null) {
        const current = highestReadPosition.get(row.seriesId) ?? 0;
        if (pos > current) highestReadPosition.set(row.seriesId, pos);
      }

      // Track all read book IDs per series
      const bookIds = readBookIdsBySeries.get(row.seriesId) ?? new Set();
      bookIds.add(row.bookId);
      readBookIdsBySeries.set(row.seriesId, bookIds);
    }

    return { startedSeriesIds, highestReadPosition, readBookIdsBySeries };
  }
);

// ─── Hard-filter helpers (shared across all recommendation functions) ───

/**
 * Resolve user's disliked genre names to genre IDs for hard-filtering.
 */
const resolveDislikedGenreIds = cache(
  async (explicit: ExplicitPreferences | null): Promise<Set<string>> => {
    if (!explicit) return new Set();

    const dislikedNames: string[] = [];
    for (const [name, pref] of explicit.genrePreferences) {
      if (pref === "dislike") dislikedNames.push(name);
    }
    if (dislikedNames.length === 0) return new Set();

    const genreIdRows = await db
      .select({ id: genres.id, name: genres.name })
      .from(genres)
      .where(sql`${genres.name} IN (${sql.join(dislikedNames.map((n) => sql`${n}`), sql`, `)})`)
      .all();

    return new Set(genreIdRows.map((r) => r.id));
  }
);

/**
 * Check if a series book should be allowed in recommendations.
 * Strict rule: only the immediate next-unread book is allowed.
 * Book #1 (or ≤1, e.g. 0.5 novellas) of unstarted series is allowed (discovery entry point).
 *
 * Books with null position in a series are SKIPPED — they're likely mid-series
 * entries with missing position data and could spoil reading order.
 */
function isSeriesBookAllowed(
  seriesIds: string[],
  position: number | null,
  seriesProgress: UserSeriesProgress,
  title?: string
): boolean {
  // Non-series book → allow, but check title heuristic as safety net
  // (catches books that are mid-series but lack a book_series entry)
  if (seriesIds.length === 0) {
    if (title && looksLikeMidSeriesTitle(title)) return false;
    return true;
  }

  // Series book with unknown position → skip (likely mid-series with missing data)
  if (position == null) return false;

  for (const sid of seriesIds) {
    if (seriesProgress.startedSeriesIds.has(sid)) {
      // User has started this series — only allow the next unread position
      // Use > highestRead to handle novellas (1.5, 2.5) and gaps
      // Combined with <= highestRead + 1 to avoid jumping too far ahead
      const highestRead = seriesProgress.highestReadPosition.get(sid) ?? 0;
      if (position > highestRead && position <= highestRead + 1) return true;
    } else {
      // Series not started — only allow book #1 (or prequel ≤1)
      if (position <= 1) return true;
    }
  }

  // No series passed the check → filter out
  return false;
}

/**
 * Check if a book exceeds user's content tolerances.
 * Returns true if ANY category exceeds the user's max tolerance.
 */
function exceedsContentTolerance(
  bookRatings: Map<string, number> | undefined,
  contentTolerances: Map<string, number>
): boolean {
  if (!bookRatings || contentTolerances.size === 0) return false;
  for (const [catId, intensity] of bookRatings) {
    const userMax = contentTolerances.get(catId);
    if (userMax !== undefined && userMax < 4 && intensity > userMax) {
      return true;
    }
  }
  return false;
}

// ─── Content warning utilities ───

/**
 * Cached category ID → display name map.
 */
const getCategoryNameMap = unstable_cache(
  async (): Promise<Map<string, string>> => {
    const rows = await db
      .select({ id: taxonomyCategories.id, name: taxonomyCategories.name })
      .from(taxonomyCategories)
      .all();
    return new Map(rows.map((r) => [r.id, r.name]));
  },
  ["category-name-map"],
  { revalidate: 3600 }
);

/**
 * Compute content warnings for a book given its ratings and the user's tolerances.
 * Returns the same shape as contentConflicts on the book detail page.
 */
function computeContentWarnings(
  bookRatings: Map<string, number> | undefined,
  contentTolerances: Map<string, number>,
  categoryNames: Map<string, string>
): { categoryName: string; bookIntensity: number; userMax: number }[] {
  if (!bookRatings || contentTolerances.size === 0) return [];
  const warnings: { categoryName: string; bookIntensity: number; userMax: number }[] = [];
  for (const [catId, intensity] of bookRatings) {
    const userMax = contentTolerances.get(catId);
    if (userMax !== undefined && userMax < 4 && intensity > userMax) {
      warnings.push({
        categoryName: categoryNames.get(catId) ?? catId,
        bookIntensity: intensity,
        userMax,
      });
    }
  }
  return warnings;
}

// ─── Anthology genre ID resolution (cached per request) ───

const getAnthologyGenreIds = cache(async (): Promise<Set<string>> => {
  const allGenres = await db
    .select({ id: genres.id, name: genres.name })
    .from(genres)
    .all();

  const ids = new Set<string>();
  for (const g of allGenres) {
    if (ANTHOLOGY_GENRE_NAMES.has(g.name.toLowerCase())) {
      ids.add(g.id);
    }
  }
  return ids;
});

/**
 * Check if a book's genres include any anthology/short-story genre.
 */
function hasAnthologyGenre(bookGenreIds: string[], anthologyGenreIds: Set<string>): boolean {
  if (anthologyGenreIds.size === 0) return false;
  return bookGenreIds.some((gid) => anthologyGenreIds.has(gid));
}

/**
 * Check if a book has any genre the user explicitly dislikes.
 */
function hasDislikedGenre(
  bookGenreIds: string[],
  dislikedGenreIds: Set<string>
): boolean {
  if (dislikedGenreIds.size === 0) return false;
  return bookGenreIds.some((gid) => dislikedGenreIds.has(gid));
}

// ─── Public API ───

/**
 * Smart discovery: personalized book recommendations for the homepage carousel.
 * Falls back to random for cold-start users.
 */
async function getSmartDiscoveryBooksInternal(
  userId: string,
  limit = 10
): Promise<RecommendedBook[]> {
  const [profile, excludedIds, seriesProgress, explicit] = await Promise.all([
    getUserPreferenceProfile(userId),
    getUserExcludedBookIds(userId),
    getUserSeriesProgress(userId),
    getExplicitPreferences(userId),
  ]);

  // Cold start: no preference data at all → random discovery
  if (!profile) {
    const { getDiscoveryBooks } = await import("./discovery");
    return (await getDiscoveryBooks(limit)).map((b) => ({
      ...b,
      score: 0,
    }));
  }

  // Get top preferred genre IDs (sorted by affinity, only positive ones)
  const sortedGenres = [...profile.genreAffinities.entries()]
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  const candidates = await fetchCandidateBooks(
    excludedIds,
    sortedGenres,
    200
  );

  // Batch-fetch content ratings for all candidates (for content tolerance scoring)
  const candidateIds = candidates.map((c) => c.id);
  const contentRatingsByBook = await batchFetchContentRatings(candidateIds);

  // Resolve disliked genre IDs for hard-filtering
  const dislikedGenreIds = await resolveDislikedGenreIds(explicit);

  // Hard filter: content tolerance, disliked genres, series order
  const filteredCandidates = candidates.filter((c) => {
    // Content tolerance: no longer hard-filtered — deprioritized via scoring instead
    // (see scoreCandidateBook absolute penalty + contentCompatibility weight 0.20)
    // Disliked genres: reject books with any explicitly disliked genre
    if (hasDislikedGenre(c.genreIds, dislikedGenreIds)) {
      return false;
    }
    // Series order: only allow strict next-unread or book #1 of unstarted series
    if (!isSeriesBookAllowed(c.seriesIds, c.seriesPosition, seriesProgress, c.title)) {
      return false;
    }
    return true;
  });

  // Score and rank — add small random jitter so recommendations rotate across page loads
  // Jitter is ±8 points (scores typically range 0-60), enough to shuffle similarly-scored
  // books while keeping strong matches near the top
  const scored = filteredCandidates.map((c) => ({
    ...c,
    score: scoreCandidateBook(
      c,
      profile,
      seriesProgress,
      explicit,
      contentRatingsByBook.get(c.id)
    ) + (Math.random() * 16 - 8),
  }));

  scored.sort((a, b) => b.score - a.score);

  // Add some variety: don't let top results all be from same author
  const diversified = diversifyResults(scored, limit);

  // Hydrate with author names — batch fetch instead of N+1
  const [authorNamesMap, categoryNames] = await Promise.all([
    batchFetchBookAuthors(diversified.map((b) => b.id)),
    getCategoryNameMap(),
  ]);

  return diversified.map((book) => ({
    id: book.id,
    slug: book.slug ?? null,
    title: book.title,
    coverImageUrl: book.coverImageUrl,
    authors: authorNamesMap.get(book.id) ?? [],
    score: book.score,
    contentWarnings: explicit
      ? computeContentWarnings(contentRatingsByBook.get(book.id), explicit.contentTolerances, categoryNames)
      : [],
  }));
}

/**
 * Smart discovery: personalized book recommendations for the homepage carousel.
 * Cached across requests for 5 minutes per user.
 */
export const getSmartDiscoveryBooks = (
  userId: string,
  limit = 10
): Promise<RecommendedBook[]> =>
  unstable_cache(
    () => getSmartDiscoveryBooksInternal(userId, limit),
    [`smart-discovery-${userId}-${limit}`],
    { revalidate: 3600, tags: [`user-${userId}-recommendations`] }
  )();

/**
 * Discover recommendations: mood-filtered, content-aware personalized results.
 * Used by the unified Search/Discover page.
 *
 * Accepts mood-based genre keyword boosts/penalties, optional content overrides,
 * fiction bias, and length preferences. Combines these with the user's existing
 * preference profile for scoring.
 */
export interface DiscoverFilters {
  /** Mood-derived genre keyword boosts (matched against genre names) */
  boostKeywords?: string[];
  /** Mood-derived genre keyword penalties */
  penaltyKeywords?: string[];
  /** Content category max overrides (tighter than user's defaults for this search) */
  contentMaxima?: Record<string, number>;
  /** Fiction/nonfiction bias from mood selection */
  fictionBias?: "fiction" | "nonfiction" | null;
  /** Page count preferences */
  lengthPreference?: "short" | "medium" | "long" | null;
  /** Target audience */
  audience?: "adult" | "ya" | "teen" | "mg" | null;
  /** Library scope: "tbr" = user's TBR only, "owned" = owned but unfinished, null = all books */
  libraryFilter?: "tbr" | "owned" | null;
  /** Ignore user's content/genre preferences for this search */
  ignorePreferences?: boolean;
  /** Only show series starters (#1) or standalone books */
  seriesStartersOnly?: boolean;
}

export async function getDiscoverRecommendations(
  userId: string | null,
  filters: DiscoverFilters,
  limit = 12
): Promise<RecommendedBook[]> {
  // Load user profile if logged in
  const [profile, seriesProgress, explicit] = userId
    ? await Promise.all([
        getUserPreferenceProfile(userId),
        getUserSeriesProgress(userId),
        getExplicitPreferences(userId),
      ])
    : [null, { startedSeriesIds: new Set<string>(), highestReadPosition: new Map<string, number>(), readBookIdsBySeries: new Map<string, Set<string>>() } as UserSeriesProgress, null];

  // Build excluded IDs: always exclude finished/DNF books
  // For library filters (tbr/owned), we use a scoped candidate set instead
  let excludedIds = new Set<string>();
  if (userId) {
    if (filters.libraryFilter) {
      // Library-scoped: only exclude completed and DNF
      const finishedRows = await db
        .select({ bookId: userBookState.bookId })
        .from(userBookState)
        .where(and(
          eq(userBookState.userId, userId),
          sql`${userBookState.state} IN ('completed', 'dnf', 'paused')`
        ))
        .all();
      excludedIds = new Set(finishedRows.map((r) => r.bookId));
    } else {
      // Default: exclude all books user has interacted with (discover new books)
      excludedIds = await getUserExcludedBookIds(userId);
    }
  }

  // Build genre name → ID mapping for keyword matching (cached — genres rarely change)
  const allGenres = await getAllGenresCached();

  const boostGenreIds = new Set<string>();
  const penaltyGenreIds = new Set<string>();

  // Pre-lowercase all genre names once (not per-keyword)
  const genresWithLower = allGenres.map((g) => ({ id: g.id, nameLower: g.name.toLowerCase() }));

  if (filters.boostKeywords?.length) {
    for (const genre of genresWithLower) {
      if (filters.boostKeywords.some((kw) => genre.nameLower.includes(kw))) {
        boostGenreIds.add(genre.id);
      }
    }
  }
  if (filters.penaltyKeywords?.length) {
    for (const genre of genresWithLower) {
      if (filters.penaltyKeywords.some((kw) => genre.nameLower.includes(kw))) {
        penaltyGenreIds.add(genre.id);
      }
    }
  }

  // Use boost genres as preferred for candidate fetching
  const preferredGenreIds = [...boostGenreIds];

  // If we have a user profile and aren't ignoring preferences, merge their genre affinities in
  if (profile && !filters.ignorePreferences) {
    const sortedUserGenres = [...profile.genreAffinities.entries()]
      .filter(([, score]) => score > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
    for (const gid of sortedUserGenres) {
      if (!boostGenreIds.has(gid)) preferredGenreIds.push(gid);
    }
  }

  let candidates: CandidateBook[];

  if (filters.libraryFilter && userId) {
    // Library-scoped: pull from user's TBR or owned books
    const libraryCondition = filters.libraryFilter === "tbr"
      ? sql`${userBookState.state} = 'tbr'`
      : sql`${userBookState.ownedFormats} IS NOT NULL AND ${userBookState.ownedFormats} != '[]'`;

    const libraryBookIds = (await db
      .select({ bookId: userBookState.bookId })
      .from(userBookState)
      .where(and(
        eq(userBookState.userId, userId),
        libraryCondition,
      ))
      .all())
      .map((r) => r.bookId)
      .filter((id) => !excludedIds.has(id));

    if (libraryBookIds.length === 0) {
      candidates = [];
    } else {
      // Use fetchCandidateBooks infrastructure but with our scoped IDs
      // We pass empty excludedIds since we've already filtered, and no preferred genres
      // since we want to score all library books
      candidates = await fetchCandidateBooks(
        new Set<string>(),
        preferredGenreIds.slice(0, 40),
        500
      );
      // Intersect with library books
      const librarySet = new Set(libraryBookIds);
      candidates = candidates.filter((c) => librarySet.has(c.id));
    }
  } else {
    // Default: discover new books from the full catalog
    candidates = await fetchCandidateBooks(
      excludedIds,
      preferredGenreIds.slice(0, 40),
      300
    );
  }

  const candidateIds = candidates.map((c) => c.id);
  const contentRatingsByBook = await batchFetchContentRatings(candidateIds);
  const dislikedGenreIds = await resolveDislikedGenreIds(explicit);

  // Merge mood content maxima with user's explicit content tolerances
  const mergedContentTolerances = new Map<string, number>(
    explicit?.contentTolerances ?? []
  );
  if (filters.contentMaxima) {
    // Resolve category keys → IDs for mood content hints
    const catKeyRows = await db
      .select({ id: sql<string>`id`, key: sql<string>`key` })
      .from(sql`taxonomy_categories`)
      .all();
    const catKeyToId = new Map(catKeyRows.map((r) => [r.key, r.id]));

    for (const [catKey, maxVal] of Object.entries(filters.contentMaxima)) {
      const catId = catKeyToId.get(catKey);
      if (catId) {
        const existing = mergedContentTolerances.get(catId);
        if (existing === undefined || maxVal < existing) {
          mergedContentTolerances.set(catId, maxVal);
        }
      }
    }
  }

  // Hard filter (skipped when ignorePreferences is set)
  const filteredCandidates = candidates.filter((c) => {
    if (!filters.ignorePreferences) {
      // Content tolerance: deprioritized via scoring, not hard-filtered
      if (hasDislikedGenre(c.genreIds, dislikedGenreIds)) {
        return false;
      }
    }
    // Series filtering: use same logic as homepage recommendations
    if (userId && !filters.libraryFilter && !isSeriesBookAllowed(c.seriesIds, c.seriesPosition, seriesProgress, c.title)) {
      return false;
    }
    // Series starters only: standalone books or #1 in series
    if (filters.seriesStartersOnly) {
      if (c.seriesIds.length > 0 && c.seriesPosition !== null && c.seriesPosition > 1) {
        return false;
      }
    }
    return true;
  });

  // Build genre name lookup map once (not per-book)
  const genreNameMap = new Map(allGenres.map((g) => [g.id, g.name?.toLowerCase() ?? ""]));

  // Count how many moods were selected (for intersection-lite logic)
  const totalMoodKeywords = (filters.boostKeywords?.length ?? 0);
  const multipleMoodsSelected = totalMoodKeywords > 5; // >5 keywords ≈ 2+ moods selected

  // Score with mood-aware adjustments
  const scored = filteredCandidates.map((c) => {
    // Base score from user preference profile (0-100 range)
    let score = (profile && !filters.ignorePreferences)
      ? scoreCandidateBook(c, profile, seriesProgress, explicit, contentRatingsByBook.get(c.id))
      : 50; // Base score for anonymous users or when ignoring preferences

    // ── Mood genre scoring ──
    // Count mood keyword matches for this book
    let moodMatchCount = 0;
    let penaltyCount = 0;
    for (const gid of c.genreIds) {
      if (boostGenreIds.has(gid)) moodMatchCount++;
      if (penaltyGenreIds.has(gid)) penaltyCount++;
    }

    if (boostGenreIds.size > 0) {
      if (moodMatchCount === 0) {
        // No mood match — mild penalty (was -30, now -8)
        score -= 8;
      } else if (multipleMoodsSelected && moodMatchCount === 1) {
        // Multiple moods selected but only 1 keyword matched — partial credit
        score += 4;
      } else {
        // Good mood match: +6 per match, capped at +24
        score += Math.min(moodMatchCount * 6, 24);
      }
    }

    // Penalty genres still reduce score
    score -= penaltyCount * 5;

    // Fiction bias adjustment
    if (filters.fictionBias === "fiction" && !c.isFiction) score -= 15;
    if (filters.fictionBias === "nonfiction" && c.isFiction) score -= 15;

    // Audience adjustment using pre-built genre name map (not per-book .find())
    if (filters.audience) {
      const genreNamesLower = c.genreIds
        .map((gid) => genreNameMap.get(gid) ?? "")
        .filter(Boolean);
      const isYA = genreNamesLower.some((n) =>
        n.includes("young adult") || n.includes("ya ") || n === "ya"
      );
      const isTeen = isYA || genreNamesLower.some((n) =>
        n.includes("teen") || n.includes("adolescent")
      );
      const isMG = genreNamesLower.some((n) =>
        n.includes("middle grade") || n.includes("middle-grade") || n.includes("children") ||
        n.includes("juvenile") || n.includes("ages 8") || n.includes("ages 9") ||
        n.includes("ages 10") || n.includes("ages 11") || n.includes("ages 12")
      );
      const isKidsOrYoung = isYA || isTeen || isMG;

      if (filters.audience === "adult" && isKidsOrYoung) score -= 20;
      if (filters.audience === "ya" && !isYA) score -= 15;
      if (filters.audience === "teen" && !isTeen) score -= 15;
      if (filters.audience === "mg") {
        if (isMG) score += 5;
        else if (!isKidsOrYoung) score -= 20;
      }
    }

    // Length preference adjustment
    if (filters.lengthPreference && c.pages) {
      if (filters.lengthPreference === "short" && c.pages > 250) {
        score -= Math.min(10, (c.pages - 250) / 50);
      } else if (filters.lengthPreference === "long" && c.pages < 350) {
        score -= Math.min(10, (350 - c.pages) / 50);
      }
      if (filters.lengthPreference === "medium" && (c.pages < 200 || c.pages > 400)) {
        score -= 5;
      }
    }

    // Jitter for variety: ±15 so refreshes feel genuinely different (was ±5)
    score += Math.random() * 30 - 15;

    return { ...c, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const diversified = diversifyResults(scored, limit);

  // Batch fetch authors + category names in parallel
  const [diversifiedAuthorMap, categoryNames] = await Promise.all([
    batchFetchBookAuthors(diversified.map((b) => b.id)),
    getCategoryNameMap(),
  ]);

  const results: RecommendedBook[] = [];
  for (const book of diversified) {
    const authorNames = diversifiedAuthorMap.get(book.id) ?? [];
    // Generate a reason based on what matched
    const matchedMoods = filters.boostKeywords?.filter((kw) =>
      book.genreIds.some((gid) => {
        const genre = allGenres.find((g) => g.id === gid);
        return genre && genre.name.toLowerCase().includes(kw);
      })
    ) ?? [];

    results.push({
      id: book.id,
      slug: book.slug ?? null,
      title: book.title,
      coverImageUrl: book.coverImageUrl,
      authors: authorNames,
      score: book.score,
      reason: matchedMoods.length > 0
        ? `Matches: ${matchedMoods.slice(0, 3).join(", ")}`
        : undefined,
      contentWarnings: computeContentWarnings(contentRatingsByBook.get(book.id), mergedContentTolerances, categoryNames),
    });
  }

  return results;
}

/**
 * Get books similar to a specific book (for "Books Like This" sections).
 * Uses genre overlap, same-author boost, content profile similarity.
 */
async function getSimilarBooksInner(
  bookId: string,
  userId: string | null,
  limit = 8
): Promise<RecommendedBook[]> {
  // Get the seed book's genres
  const seedGenreRows = await db
    .select({ genreId: bookGenres.genreId })
    .from(bookGenres)
    .where(eq(bookGenres.bookId, bookId))
    .all();

  const seedGenreIds = seedGenreRows.map((r) => r.genreId);
  if (seedGenreIds.length === 0) return [];

  // Get the seed book's authors
  const seedAuthorRows = await db
    .select({ authorId: bookAuthors.authorId })
    .from(bookAuthors)
    .where(eq(bookAuthors.bookId, bookId))
    .all();
  const seedAuthorIds = new Set(seedAuthorRows.map((r) => r.authorId));

  // Get seed book's content ratings
  const seedContentRatings = await batchFetchContentRatings([bookId]);
  const seedContent = seedContentRatings.get(bookId);

  // Get seed book's series so we can exclude same-series books
  const seedSeriesRows = await db
    .select({ seriesId: bookSeries.seriesId })
    .from(bookSeries)
    .where(eq(bookSeries.bookId, bookId))
    .all();
  const seedSeriesIds = new Set(seedSeriesRows.map((r) => r.seriesId));

  // Exclude the seed book + user's read books
  const excludedIds = new Set<string>([bookId]);
  let seriesProgress: UserSeriesProgress | null = null;
  if (userId) {
    const [userExcluded, sp] = await Promise.all([
      getUserExcludedBookIds(userId),
      getUserSeriesProgress(userId),
    ]);
    for (const id of userExcluded) excludedIds.add(id);
    seriesProgress = sp;
  }

  // Fetch candidates biased toward seed genres
  const candidates = await fetchCandidateBooks(excludedIds, seedGenreIds, 150);
  const candidateIds = candidates.map((c) => c.id);
  const contentRatingsByBook = await batchFetchContentRatings(candidateIds);

  // User content filters
  let explicit: ExplicitPreferences | null = null;
  if (userId) {
    explicit = await getExplicitPreferences(userId);
  }

  // Get genre names for building reason strings
  const allGenreIds = new Set<string>([...seedGenreIds]);
  for (const c of candidates) {
    for (const gid of c.genreIds) allGenreIds.add(gid);
  }
  const genreNameMap = new Map<string, string>();
  if (allGenreIds.size > 0) {
    const genreRows = await db
      .select({ id: genres.id, name: genres.name })
      .from(genres)
      .where(sql`${genres.id} IN (${sql.join([...allGenreIds].map((id) => sql`${id}`), sql`, `)})`)
      .all();
    for (const r of genreRows) genreNameMap.set(r.id, r.name);
  }

  // Score by similarity to the seed book
  const scored = candidates
    .filter((c) => {
      // Exclude books from the same series as the seed book
      if (c.seriesIds.some((sid) => seedSeriesIds.has(sid))) {
        return false;
      }
      // Series order: filter out-of-order books from user's TBR
      if (seriesProgress && c.seriesIds.length > 0) {
        if (!isSeriesBookAllowed(c.seriesIds, c.seriesPosition, seriesProgress, c.title)) {
          return false;
        }
      }
      // Content tolerance: deprioritized via scoring, not hard-filtered
      return true;
    })
    .map((c) => {
      let score = 0;

      // Genre overlap: count shared genres
      const sharedGenreIds = c.genreIds.filter((gid) => seedGenreIds.includes(gid));
      const shared = sharedGenreIds.length;
      score += (shared / Math.max(seedGenreIds.length, 1)) * 40;

      // Same author boost
      const sameAuthor = c.authorIds.some((aid) => seedAuthorIds.has(aid));
      if (sameAuthor) {
        score += 10;
      }

      // Content profile similarity (close intensity = good)
      let contentSimilarityPct = 0;
      if (seedContent && contentRatingsByBook.has(c.id)) {
        const candidateContent = contentRatingsByBook.get(c.id)!;
        let similarity = 0;
        let compared = 0;
        for (const [catId, seedIntensity] of seedContent) {
          const candIntensity = candidateContent.get(catId) ?? 0;
          similarity += 1 - Math.abs(seedIntensity - candIntensity) / 4;
          compared++;
        }
        if (compared > 0) {
          contentSimilarityPct = similarity / compared;
          score += contentSimilarityPct * 20;
        }
      }

      // Data quality
      if (c.coverImageUrl) score += 5;
      if (c.hasDescription) score += 3;

      // Jitter
      score += Math.random() * 6 - 3;

      // Build reason string
      const reasonParts: string[] = [];
      if (sameAuthor) reasonParts.push("Same author");
      const sharedGenreNames = [...new Set(
        sharedGenreIds
          .map((gid) => genreNameMap.get(gid))
          .filter(Boolean) as string[]
      )];
      if (sharedGenreNames.length > 0) {
        if (sharedGenreNames.length <= 3) {
          reasonParts.push(sharedGenreNames.join(", "));
        } else {
          reasonParts.push(`${sharedGenreNames.slice(0, 2).join(", ")} +${sharedGenreNames.length - 2} more`);
        }
      }
      if (contentSimilarityPct > 0.75) reasonParts.push("Similar tone");

      return { ...c, score, reason: reasonParts.join(" · ") || "Similar genre" };
    });

  scored.sort((a, b) => b.score - a.score);
  const diversified = diversifyResults(scored, limit);

  // Batch fetch authors instead of N+1
  const pcAuthorMap = await batchFetchBookAuthors(diversified.map((b) => b.id));

  const results: RecommendedBook[] = [];
  for (const book of diversified) {
    results.push({
      id: book.id,
      slug: book.slug ?? null,
      title: book.title,
      coverImageUrl: book.coverImageUrl,
      authors: pcAuthorMap.get(book.id) ?? [],
      score: book.score,
      reason: (book as typeof book & { reason: string }).reason,
    });
  }

  return results;
}

/**
 * Cached version of getSimilarBooksInner. Cache key includes userId
 * since results vary per user (content tolerance filtering, excluded books).
 */
export const getSimilarBooks = async (
  bookId: string,
  userId: string | null,
  limit = 8
): Promise<RecommendedBook[]> => {
  const cached = unstable_cache(
    async () => getSimilarBooksInner(bookId, userId, limit),
    ["similar-books", bookId, userId ?? "anon"],
    { revalidate: 300 }
  );
  return cached();
};

/**
 * "Because you liked X" — finds books sharing genres with a seed book.
 * Returns 2-3 seed books with their similar recommendations.
 *
 * Key behaviors:
 * - CAN include TBR books (only excludes up-next and currently reading)
 * - Filters out non-English, box sets, and content-violating books
 * - Respects series order (won't suggest book #3 if user hasn't read #2)
 * - Accepts globalExcludeIds to deduplicate across homepage sections
 */
export async function getBecauseYouLikedSuggestions(
  userId: string,
  maxSeeds = 3,
  booksPerSeed = 8,
  globalExcludeIds?: Set<string>
): Promise<{ seed: { id: string; title: string }; books: RecommendedBook[] }[]> {
  const cached = unstable_cache(
    () => getBecauseYouLikedInner(userId, maxSeeds, booksPerSeed),
    [`because-you-liked-${userId}`],
    { revalidate: 3600 }
  );
  const results = await cached();
  if (!globalExcludeIds || globalExcludeIds.size === 0) return results;
  // Filter out globally excluded books
  return results
    .map((r) => ({ ...r, books: r.books.filter((b) => !globalExcludeIds.has(b.id)) }))
    .filter((r) => r.books.length > 0);
}

async function getBecauseYouLikedInner(
  userId: string,
  maxSeeds: number,
  booksPerSeed: number,
): Promise<{ seed: { id: string; title: string }; books: RecommendedBook[] }[]> {
  // Fetch all setup data in parallel (was 6 sequential queries, now 1 round)
  const [seriesProgress, explicit, upNextRows, completedAndCurrentIds, hiddenRows, favSeed, ratedPool] = await Promise.all([
    getUserSeriesProgress(userId),
    getExplicitPreferences(userId),
    db.select({ bookId: upNext.bookId }).from(upNext).where(eq(upNext.userId, userId)).all(),
    db.select({ bookId: userBookState.bookId }).from(userBookState).where(
      and(eq(userBookState.userId, userId), sql`${userBookState.state} IN ('completed', 'currently_reading', 'dnf', 'paused')`)
    ).all(),
    db.select({ bookId: userHiddenBooks.bookId }).from(userHiddenBooks).where(eq(userHiddenBooks.userId, userId)).all(),
    db.select({ bookId: userFavoriteBooks.bookId, title: books.title })
      .from(userFavoriteBooks).innerJoin(books, eq(userFavoriteBooks.bookId, books.id))
      .where(eq(userFavoriteBooks.userId, userId)).orderBy(sql`RANDOM()`).limit(1).all(),
    db.select({ bookId: userBookRatings.bookId, title: books.title })
      .from(userBookRatings).innerJoin(books, eq(userBookRatings.bookId, books.id))
      .where(and(eq(userBookRatings.userId, userId), sql`${userBookRatings.rating} >= 4.0`, isNotNull(books.coverImageUrl)))
      .orderBy(sql`RANDOM()`).limit(maxSeeds * 3).all(),
  ]);

  const excludeFromRecs = new Set([
    ...upNextRows.map((r) => r.bookId),
    ...completedAndCurrentIds.map((r) => r.bookId),
  ]);

  // Build seeds: favorite first, then highly-rated
  let seeds = favSeed.map((r) => ({ id: r.bookId, title: r.title }));
  const seedIds = new Set(seeds.map((s) => s.id));
  for (const r of ratedPool) {
    if (seeds.length >= maxSeeds) break;
    if (!seedIds.has(r.bookId)) {
      seeds.push({ id: r.bookId, title: r.title });
      seedIds.add(r.bookId);
    }
  }

  if (seeds.length === 0) return [];

  // Precompute genre filter sets once (saves 2 queries per seed)
  const [dislikedGenreIds, anthologyGenreIds] = await Promise.all([
    resolveDislikedGenreIds(explicit),
    getAnthologyGenreIds(),
  ]);

  // Track all recommended IDs across seeds to prevent duplication within this section
  // Also exclude hidden books from recommendations
  const hiddenIds = new Set(hiddenRows.map((r) => r.bookId));
  const recommendedAcrossSeeds = new Set<string>(hiddenIds);
  const triedSeedIds = new Set<string>();
  const minRows = 2; // Minimum "because you liked" rows to show
  const minBooksPerRow = 4; // Minimum books to qualify a row

  const results: { seed: { id: string; title: string }; books: RecommendedBook[] }[] = [];

  // Try initial seeds, then backfill if we don't have enough rows
  const maxAttempts = 3; // Up to 3 rounds of trying new seeds
  for (let attempt = 0; attempt < maxAttempts && results.length < maxSeeds; attempt++) {
    const currentSeeds = attempt === 0 ? seeds : await fetchBackfillSeeds(userId, triedSeedIds, maxSeeds - results.length);
    if (currentSeeds.length === 0) break;

    for (const seed of currentSeeds) {
      if (results.length >= maxSeeds) break;
      if (triedSeedIds.has(seed.id)) continue;
      triedSeedIds.add(seed.id);

      const recBooks = await findRecsForSeed(
        seed, excludeFromRecs, recommendedAcrossSeeds, seriesProgress, explicit, booksPerSeed,
        dislikedGenreIds, anthologyGenreIds
      );

      if (recBooks.length >= minBooksPerRow) {
        for (const b of recBooks) recommendedAcrossSeeds.add(b.id);
        results.push({ seed, books: recBooks });
      }
    }

    // If we have enough rows, stop early
    if (results.length >= minRows) break;
  }

  return results;
}

/** Fetch additional seed candidates that haven't been tried yet. */
async function fetchBackfillSeeds(
  userId: string,
  triedIds: Set<string>,
  needed: number
): Promise<{ id: string; title: string }[]> {
  // Try rated 4+ books first, then any completed book
  const ratedRows = await db
    .select({ bookId: userBookRatings.bookId, title: books.title })
    .from(userBookRatings)
    .innerJoin(books, eq(userBookRatings.bookId, books.id))
    .where(
      and(
        eq(userBookRatings.userId, userId),
        sql`${userBookRatings.rating} >= 3.5`,
        isNotNull(books.coverImageUrl)
      )
    )
    .orderBy(sql`RANDOM()`)
    .limit(needed * 4)
    .all();

  const results: { id: string; title: string }[] = [];
  for (const r of ratedRows) {
    if (results.length >= needed) break;
    if (!triedIds.has(r.bookId)) {
      results.push({ id: r.bookId, title: r.title });
    }
  }

  // If still not enough, pull from completed books
  if (results.length < needed) {
    const completedRows = await db
      .select({ bookId: userBookState.bookId, title: books.title })
      .from(userBookState)
      .innerJoin(books, eq(userBookState.bookId, books.id))
      .where(
        and(
          eq(userBookState.userId, userId),
          eq(userBookState.state, "completed"),
          isNotNull(books.coverImageUrl)
        )
      )
      .orderBy(sql`RANDOM()`)
      .limit(needed * 4)
      .all();

    for (const r of completedRows) {
      if (results.length >= needed) break;
      if (!triedIds.has(r.bookId)) {
        results.push({ id: r.bookId, title: r.title });
      }
    }
  }

  return results;
}

/** Find recommendations for a single seed book. Returns [] if none pass filters. */
async function findRecsForSeed(
  seed: { id: string; title: string },
  excludeFromRecs: Set<string>,
  recommendedAcrossSeeds: Set<string>,
  seriesProgress: UserSeriesProgress,
  explicit: Awaited<ReturnType<typeof getExplicitPreferences>>,
  booksPerSeed: number,
  precomputedDislikedGenreIds?: Set<string>,
  precomputedAnthologyGenreIds?: Set<string>,
): Promise<RecommendedBook[]> {
  // Get the seed book's genres
  const seedGenres = await db
    .select({ genreId: bookGenres.genreId })
    .from(bookGenres)
    .where(eq(bookGenres.bookId, seed.id))
    .all();

  if (seedGenres.length === 0) return [];

  const seedGenreIds = seedGenres.map((r) => r.genreId);

  // Find books sharing genres — larger pool for better filtering
  const minOverlap = seedGenreIds.length >= 3 ? 2 : 1;

  const similarRows = await db
    .select({
      bookId: bookGenres.bookId,
      overlapCount: sql<number>`COUNT(*)`.as("overlap_count"),
    })
    .from(bookGenres)
    .where(
      sql`${bookGenres.genreId} IN (${sql.join(
        seedGenreIds.map((id) => sql`${id}`),
        sql`, `
      )})`
    )
    .groupBy(bookGenres.bookId)
    .having(sql`COUNT(*) >= ${minOverlap}`)
    .orderBy(sql`COUNT(*) DESC`)
    .limit(booksPerSeed * 8) // Larger pool to survive filtering
    .all();

  const candidateIds = similarRows
    .map((r) => r.bookId)
    .filter((id) =>
      id !== seed.id &&
      !excludeFromRecs.has(id) &&
      !recommendedAcrossSeeds.has(id)
    );

  if (candidateIds.length === 0) return [];

  // Hydrate with full book info for filtering
  const currentYear = new Date().getFullYear();
  const bookRows = await db
    .select({
      id: books.id,
      title: books.title,
      coverImageUrl: books.coverImageUrl,
      language: books.language,
      publicationYear: books.publicationYear,
      isBoxSet: books.isBoxSet,
    })
    .from(books)
    .where(sql`${books.id} IN (${sql.join(candidateIds.slice(0, booksPerSeed * 6).map((id) => sql`${id}`), sql`, `)})`)
    .all();

  // Batch-fetch series info AND genre info in parallel (was sequential)
  const candidateBookIds = bookRows.map((b) => b.id);
  const inClause = candidateBookIds.length > 0
    ? sql.join(candidateBookIds.map((id) => sql`${id}`), sql`, `)
    : null;

  const [seriesRows, candidateGenreRows] = inClause
    ? await Promise.all([
        db.select({
          bookId: bookSeries.bookId,
          seriesId: bookSeries.seriesId,
          positionInSeries: bookSeries.positionInSeries,
        }).from(bookSeries).where(sql`${bookSeries.bookId} IN (${inClause})`).all(),
        db.select({ bookId: bookGenres.bookId, genreId: bookGenres.genreId })
          .from(bookGenres).where(sql`${bookGenres.bookId} IN (${inClause})`).all(),
      ])
    : [[], []];

  // Use precomputed genre IDs if available, otherwise fetch
  const [dislikedGenreIds, anthologyGenreIds] = precomputedDislikedGenreIds && precomputedAnthologyGenreIds
    ? [precomputedDislikedGenreIds, precomputedAnthologyGenreIds]
    : await Promise.all([resolveDislikedGenreIds(explicit), getAnthologyGenreIds()]);

  // Build series info maps
  const seriesIdsByBook = new Map<string, string[]>();
  const seriesPositionByBook = new Map<string, number | null>();
  for (const row of seriesRows) {
    const ids = seriesIdsByBook.get(row.bookId) ?? [];
    ids.push(row.seriesId);
    seriesIdsByBook.set(row.bookId, ids);
    if (!seriesPositionByBook.has(row.bookId)) {
      seriesPositionByBook.set(row.bookId, row.positionInSeries ?? null);
    }
  }
  const genreIdsByBook = new Map<string, string[]>();
  for (const row of candidateGenreRows) {
    const ids = genreIdsByBook.get(row.bookId) ?? [];
    ids.push(row.genreId);
    genreIdsByBook.set(row.bookId, ids);
  }

  // Apply all quality filters
  const filtered = bookRows.filter((b) => {
    if (!b.coverImageUrl) return false;
    if (b.language && b.language !== "English") return false;
    if (!isEnglishTitle(b.title)) return false;
    if (b.isBoxSet) return false;
    if (b.publicationYear && b.publicationYear > currentYear) return false;
    if (looksLikeAnthologyTitle(b.title)) return false;
    if (hasAnthologyGenre(genreIdsByBook.get(b.id) ?? [], anthologyGenreIds)) return false;
    if (hasDislikedGenre(genreIdsByBook.get(b.id) ?? [], dislikedGenreIds)) return false;
    if (!isSeriesBookAllowed(seriesIdsByBook.get(b.id) ?? [], seriesPositionByBook.get(b.id) ?? null, seriesProgress, b.title)) return false;
    return true;
  });

  // Content tolerance filtering (if user has explicit prefs)
  let finalCandidates = filtered;
  // Content tolerance: no longer hard-filtered — deprioritized via scoring
  // (finalCandidates keeps all filtered books; scoring handles deprioritization)
  finalCandidates = filtered;

  // Shuffle candidates so recommendations rotate across page loads
  for (let i = finalCandidates.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [finalCandidates[i], finalCandidates[j]] = [finalCandidates[j], finalCandidates[i]];
  }

  const topCandidates = finalCandidates.slice(0, booksPerSeed);
  const [authorNamesMap, contentRatingsByBook, categoryNames] = await Promise.all([
    batchFetchBookAuthors(topCandidates.map((b) => b.id)),
    batchFetchContentRatings(topCandidates.map((b) => b.id)),
    getCategoryNameMap(),
  ]);

  return topCandidates.map((book) => ({
    id: book.id,
    title: book.title,
    coverImageUrl: book.coverImageUrl,
    authors: authorNamesMap.get(book.id) ?? [],
    score: 0,
    contentWarnings: explicit
      ? computeContentWarnings(contentRatingsByBook.get(book.id), explicit.contentTolerances, categoryNames)
      : [],
  }));
}

/**
 * Post-completion suggestions: similar books + series continuation after finishing a book.
 */
async function getPostCompletionSuggestionsInternal(
  userId: string,
  completedBookId: string,
  limit = 8
): Promise<{
  seriesNext: RecommendedBook | null;
  similarBooks: RecommendedBook[];
}> {
  const [excludedIds, explicit, seriesProgress] = await Promise.all([
    getUserExcludedBookIds(userId),
    getExplicitPreferences(userId),
    getUserSeriesProgress(userId),
  ]);
  const dislikedGenreIds = await resolveDislikedGenreIds(explicit);

  // 1. Series continuation: find next book in series
  let seriesNext: RecommendedBook | null = null;

  const completedSeriesInfo = await db
    .select({
      seriesId: bookSeries.seriesId,
      position: bookSeries.positionInSeries,
    })
    .from(bookSeries)
    .where(eq(bookSeries.bookId, completedBookId))
    .all();

  for (const { seriesId, position } of completedSeriesInfo) {
    if (position == null) continue;

    const nextBook = await db
      .select({
        bookId: bookSeries.bookId,
        title: books.title,
        coverImageUrl: books.coverImageUrl,
      })
      .from(bookSeries)
      .innerJoin(books, eq(bookSeries.bookId, books.id))
      .where(
        and(
          eq(bookSeries.seriesId, seriesId),
          eq(bookSeries.positionInSeries, position + 1)
        )
      )
      .get();

    if (nextBook && !excludedIds.has(nextBook.bookId)) {
      // Content tolerance check on series-next (still show it — it's the next book — but skip if violating)
      if (explicit && explicit.contentTolerances.size > 0) {
        const nextRatings = await batchFetchContentRatings([nextBook.bookId]);
        if (exceedsContentTolerance(nextRatings.get(nextBook.bookId), explicit.contentTolerances)) {
          continue; // Skip this series' next book if it violates content prefs
        }
      }

      const authorNames = await getAuthorNames(nextBook.bookId);
      seriesNext = {
        id: nextBook.bookId,
        title: nextBook.title,
        coverImageUrl: nextBook.coverImageUrl,
        authors: authorNames,
        score: 100,
        reason: "Next in series",
      };
      break;
    }
  }

  // 2. Similar books based on genre overlap
  const completedGenres = await db
    .select({ genreId: bookGenres.genreId })
    .from(bookGenres)
    .where(eq(bookGenres.bookId, completedBookId))
    .all();

  const genreIds = completedGenres.map((r) => r.genreId);
  const similarBooks: RecommendedBook[] = [];

  if (genreIds.length > 0) {
    const minOverlap = genreIds.length >= 3 ? 2 : 1;

    const similarRows = await db
      .select({
        bookId: bookGenres.bookId,
        overlapCount: sql<number>`COUNT(*)`.as("overlap_count"),
      })
      .from(bookGenres)
      .where(
        sql`${bookGenres.genreId} IN (${sql.join(
          genreIds.map((id) => sql`${id}`),
          sql`, `
        )})`
      )
      .groupBy(bookGenres.bookId)
      .having(sql`COUNT(*) >= ${minOverlap}`)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(limit * 6) // Larger pool to survive hard-filtering
      .all();

    const candidateIds = similarRows
      .map((r) => r.bookId)
      .filter(
        (id) =>
          id !== completedBookId &&
          !excludedIds.has(id) &&
          id !== seriesNext?.id
      );

    // Hydrate with full book info + language for filtering
    if (candidateIds.length > 0) {
      const currentYear = new Date().getFullYear();
      const bookRows = await db
        .select({
          id: books.id,
          title: books.title,
          coverImageUrl: books.coverImageUrl,
          language: books.language,
          publicationYear: books.publicationYear,
          isBoxSet: books.isBoxSet,
        })
        .from(books)
        .where(sql`${books.id} IN (${sql.join(candidateIds.slice(0, limit * 4).map((id) => sql`${id}`), sql`, `)})`)
        .all();

      const candidateBookIds = bookRows.map((b) => b.id);

      // Batch-fetch series info for series-order filtering
      const seriesRows = candidateBookIds.length > 0 ? await db
        .select({
          bookId: bookSeries.bookId,
          seriesId: bookSeries.seriesId,
          positionInSeries: bookSeries.positionInSeries,
        })
        .from(bookSeries)
        .where(sql`${bookSeries.bookId} IN (${sql.join(candidateBookIds.map((id) => sql`${id}`), sql`, `)})`)
        .all() : [];

      const seriesIdsByBook = new Map<string, string[]>();
      const seriesPositionByBook = new Map<string, number | null>();
      for (const row of seriesRows) {
        const ids = seriesIdsByBook.get(row.bookId) ?? [];
        ids.push(row.seriesId);
        seriesIdsByBook.set(row.bookId, ids);
        if (!seriesPositionByBook.has(row.bookId)) {
          seriesPositionByBook.set(row.bookId, row.positionInSeries ?? null);
        }
      }

      // Batch-fetch genre IDs for dislike + anthology filtering
      const anthologyGenreIds = await getAnthologyGenreIds();
      const candidateGenreRows = candidateBookIds.length > 0
        ? await db
            .select({ bookId: bookGenres.bookId, genreId: bookGenres.genreId })
            .from(bookGenres)
            .where(sql`${bookGenres.bookId} IN (${sql.join(candidateBookIds.map((id) => sql`${id}`), sql`, `)})`)
            .all()
        : [];
      const genreIdsByBook = new Map<string, string[]>();
      for (const row of candidateGenreRows) {
        const ids = genreIdsByBook.get(row.bookId) ?? [];
        ids.push(row.genreId);
        genreIdsByBook.set(row.bookId, ids);
      }

      // Batch-fetch content ratings
      const contentRatings = explicit && explicit.contentTolerances.size > 0
        ? await batchFetchContentRatings(candidateBookIds)
        : new Map<string, Map<string, number>>();

      // Apply all quality + preference hard-filters
      const filtered = bookRows.filter((b) => {
        if (!b.coverImageUrl) return false;
        if (b.language && b.language !== "English") return false;
        if (!isEnglishTitle(b.title)) return false;
        if (b.isBoxSet) return false;
        // Exclude unreleased books
        if (b.publicationYear && b.publicationYear > currentYear) return false;
        // Exclude anthologies / short story collections (by title and genre)
        if (looksLikeAnthologyTitle(b.title)) return false;
        if (hasAnthologyGenre(genreIdsByBook.get(b.id) ?? [], anthologyGenreIds)) return false;
        // Disliked genres
        if (hasDislikedGenre(genreIdsByBook.get(b.id) ?? [], dislikedGenreIds)) return false;
        // Series order
        if (!isSeriesBookAllowed(seriesIdsByBook.get(b.id) ?? [], seriesPositionByBook.get(b.id) ?? null, seriesProgress, b.title)) return false;
        // Content tolerance: deprioritized via scoring, not hard-filtered
        return true;
      });

      const sorted = filtered.sort((a, b) => {
        if (a.coverImageUrl && !b.coverImageUrl) return -1;
        if (!a.coverImageUrl && b.coverImageUrl) return 1;
        return 0;
      });

      const topSimilar = sorted.slice(0, limit);
      const similarAuthorMap = await batchFetchBookAuthors(topSimilar.map((b) => b.id));
      for (const book of topSimilar) {
        similarBooks.push({
          id: book.id,
          title: book.title,
          coverImageUrl: book.coverImageUrl,
          authors: similarAuthorMap.get(book.id) ?? [],
          score: 0,
        });
      }
    }
  }

  return { seriesNext, similarBooks };
}

/**
 * Post-completion suggestions: similar books + series continuation after finishing a book.
 * Cached across requests for 5 minutes per user + book.
 */
export const getPostCompletionSuggestions = (
  userId: string,
  completedBookId: string,
  limit = 8
): Promise<{
  seriesNext: RecommendedBook | null;
  similarBooks: RecommendedBook[];
}> =>
  unstable_cache(
    () => getPostCompletionSuggestionsInternal(userId, completedBookId, limit),
    [`post-completion-${userId}-${completedBookId}-${limit}`],
    { revalidate: 300, tags: [`user-${userId}-recommendations`] }
  )();

// ─── Helpers ───

/** Ensure results have author diversity — no more than 2 books by same author */
function diversifyResults(
  scored: (CandidateBook & { score: number })[],
  limit: number
): (CandidateBook & { score: number })[] {
  const result: (CandidateBook & { score: number })[] = [];
  const authorCounts = new Map<string, number>();

  for (const book of scored) {
    if (result.length >= limit) break;

    const primaryAuthor = book.authorIds[0];
    if (primaryAuthor) {
      const count = authorCounts.get(primaryAuthor) ?? 0;
      if (count >= 2) continue; // skip if author already has 2 books
      authorCounts.set(primaryAuthor, count + 1);
    }

    result.push(book);
  }

  return result;
}
