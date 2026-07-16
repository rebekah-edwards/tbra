/**
 * Maps user-facing "mood" selections to genre keyword patterns and content profile hints.
 * Used by the Discover feature to translate mood → scoring overrides.
 *
 * Genre matching is keyword-based (case-insensitive substring match against genre names)
 * because the genre table has thousands of granular entries from Open Library.
 */

export interface MoodDefinition {
  key: string;
  label: string;
  emoji: string;
  /** Genre name keywords that positively correlate with this mood */
  genreKeywords: string[];
  /** Genre name keywords to penalize (anti-correlate) */
  antiKeywords: string[];
  /** Content categories that should be low for this mood (key → max intensity) */
  contentHints?: Record<string, number>;
  /** Prefer fiction, nonfiction, or either */
  fictionBias?: "fiction" | "nonfiction" | null;
}

export const DISCOVER_MOODS: MoodDefinition[] = [
  {
    key: "cozy",
    label: "Cozy",
    emoji: "☕",
    genreKeywords: ["cozy", "comfort", "heartwarming", "wholesome", "feel-good", "light", "clean", "sweet", "gentle"],
    antiKeywords: ["horror", "thriller", "dark", "grim", "dystop", "war", "crime", "gore"],
    contentHints: { violence_gore: 1, abuse_suffering: 0, self_harm_suicide: 0 },
    fictionBias: "fiction",
  },
  {
    key: "dark",
    label: "Dark & Gritty",
    emoji: "🌑",
    genreKeywords: ["dark", "grim", "noir", "gothic", "dystop", "grimdark", "psychological", "bleak", "twisted"],
    antiKeywords: ["cozy", "wholesome", "clean", "sweet", "children", "light"],
    fictionBias: "fiction",
  },
  {
    key: "thrilling",
    label: "Thrilling",
    emoji: "⚡",
    genreKeywords: ["thriller", "suspense", "mystery", "crime", "detective", "spy", "espionage", "action", "heist", "conspiracy"],
    antiKeywords: ["cozy", "romance", "poetry", "self-help", "devotional"],
    fictionBias: "fiction",
  },
  {
    key: "romantic",
    label: "Romantic",
    emoji: "💕",
    genreKeywords: ["romance", "love", "romantic", "relationship", "wedding", "heartwarming"],
    antiKeywords: ["horror", "war", "military", "true crime"],
    fictionBias: "fiction",
  },
  {
    key: "funny",
    label: "Funny",
    emoji: "😂",
    genreKeywords: ["humor", "comedy", "comic", "satire", "funny", "absurd", "witty", "parody", "whimsical"],
    antiKeywords: ["grief", "war", "horror", "tragedy"],
    fictionBias: null,
  },
  {
    key: "emotional",
    label: "Emotional",
    emoji: "😢",
    genreKeywords: ["literary", "contemporary", "family", "grief", "coming-of-age", "memoir", "drama", "emotional", "character-driven"],
    antiKeywords: ["action", "spy", "military"],
    fictionBias: null,
  },
  {
    key: "adventurous",
    label: "Adventurous",
    emoji: "🗺️",
    genreKeywords: ["adventure", "quest", "epic", "exploration", "travel", "survival", "journey", "expedition", "pirate"],
    antiKeywords: ["self-help", "academic", "devotional", "business"],
    fictionBias: "fiction",
  },
  {
    key: "mindblowing",
    label: "Mind-bending",
    emoji: "🤯",
    genreKeywords: ["sci-fi", "science fiction", "philosophy", "speculative", "time travel", "multiverse", "quantum", "simulation", "cyberpunk", "metaphysical"],
    antiKeywords: ["romance", "cozy", "children"],
    fictionBias: null,
  },
  {
    key: "spooky",
    label: "Spooky",
    emoji: "👻",
    genreKeywords: ["horror", "ghost", "haunted", "supernatural", "occult", "paranormal", "gothic", "creepy", "witch"],
    antiKeywords: ["romance", "self-help", "business", "children"],
    fictionBias: "fiction",
  },
  {
    key: "inspiring",
    label: "Inspiring",
    emoji: "✨",
    genreKeywords: ["inspirational", "motivational", "self-help", "biography", "memoir", "personal development", "success", "leadership"],
    antiKeywords: ["horror", "crime", "dystop"],
    fictionBias: "nonfiction",
  },
  {
    key: "informative",
    label: "Informative",
    emoji: "🧠",
    genreKeywords: ["nonfiction", "history", "science", "psychology", "economics", "sociology", "technology", "academic", "essay", "journalism"],
    antiKeywords: ["romance", "fantasy", "fairy tale"],
    fictionBias: "nonfiction",
  },
  {
    key: "fantastical",
    label: "Fantastical",
    emoji: "🐉",
    genreKeywords: ["fantasy", "magic", "fairy", "mytholog", "dragon", "wizard", "enchant", "fae", "sword", "quest"],
    antiKeywords: ["true crime", "business", "self-help", "academic"],
    fictionBias: "fiction",
  },
  {
    key: "historical",
    label: "Historical",
    emoji: "🏛️",
    genreKeywords: ["history", "historical", "ancient", "medieval", "renaissance", "colonial", "civil war", "world war", "victorian", "regency", "period", "dynasty"],
    antiKeywords: ["cyberpunk", "futuristic", "space opera"],
    fictionBias: null,
  },
  {
    key: "sciencey",
    label: "Science-y",
    emoji: "🔬",
    genreKeywords: ["science", "physics", "biology", "chemistry", "astronomy", "neuroscience", "evolution", "genetics", "ecology", "medical", "engineering", "technology", "popular science"],
    antiKeywords: ["romance", "fairy", "devotional"],
    fictionBias: "nonfiction",
  },
  {
    key: "dystopian",
    label: "Dystopian",
    emoji: "🌆",
    genreKeywords: ["dystopia", "dystopian", "post-apocalyptic", "apocalyp", "totalitarian", "survival", "rebellion", "speculative"],
    antiKeywords: ["cozy", "feel-good", "devotional", "cookbook"],
    fictionBias: "fiction",
  },
];

/**
 * Given selected mood keys, compute genre keyword boost/penalty lists
 * and content filter overrides.
 */
export function getMoodFilters(moodKeys: string[]) {
  const selected = DISCOVER_MOODS.filter((m) => moodKeys.includes(m.key));
  if (selected.length === 0) return null;

  const boostKeywords = new Set<string>();
  const penaltyKeywords = new Set<string>();
  const contentMaxima: Record<string, number> = {};
  let fictionVotes = 0;
  let nonfictionVotes = 0;

  for (const mood of selected) {
    for (const kw of mood.genreKeywords) boostKeywords.add(kw.toLowerCase());
    for (const kw of mood.antiKeywords) penaltyKeywords.add(kw.toLowerCase());
    if (mood.contentHints) {
      for (const [cat, max] of Object.entries(mood.contentHints)) {
        if (contentMaxima[cat] === undefined || max < contentMaxima[cat]) {
          contentMaxima[cat] = max;
        }
      }
    }
    if (mood.fictionBias === "fiction") fictionVotes++;
    else if (mood.fictionBias === "nonfiction") nonfictionVotes++;
  }

  // Remove keywords that appear in both boost and penalty (conflicting moods)
  for (const kw of boostKeywords) {
    if (penaltyKeywords.has(kw)) {
      boostKeywords.delete(kw);
      penaltyKeywords.delete(kw);
    }
  }

  return {
    boostKeywords: [...boostKeywords],
    penaltyKeywords: [...penaltyKeywords],
    contentMaxima,
    fictionBias: fictionVotes > nonfictionVotes ? "fiction" as const
      : nonfictionVotes > fictionVotes ? "nonfiction" as const
      : null,
  };
}

// ─── Discover scoring v2 signals (2026-07-15) ───
// Beyond genre names: each mood maps to the review DESCRIPTOR TAGS readers
// actually apply (review_descriptor_tags vocabulary), a preferred PACING,
// and keywords matched against What's-Inside note text. All matching is
// lowercase-substring, so "Twisty" and "twisty" both hit.

export interface MoodSignals {
  tags: string[];
  pacing?: Array<"fast" | "medium" | "slow">;
  noteTerms?: string[];
}

const MOOD_SIGNALS: Record<string, MoodSignals> = {
  cozy:        { tags: ["heartwarming", "gentle", "charming", "comforting", "wholesome", "sweet", "feel-good"], pacing: ["slow", "medium"] },
  dark:        { tags: ["grim", "brutal", "bleak", "haunting", "disturbing", "gritty", "devastating"], noteTerms: ["grim", "brutal", "violence", "bleak", "horror"] },
  thrilling:   { tags: ["gripping", "suspenseful", "twisty", "tense", "action-packed", "page-turner", "unputdownable"], pacing: ["fast"] },
  romantic:    { tags: ["swoony", "steamy", "tender", "slow-burn", "chemistry", "heartfelt"] },
  funny:       { tags: ["hilarious", "witty", "laugh-out-loud", "quirky", "satirical", "irreverent"] },
  emotional:   { tags: ["moving", "devastating", "heartbreaking", "poignant", "tear-jerker", "cathartic", "bittersweet"] },
  adventurous: { tags: ["epic", "sweeping", "action-packed", "immersive", "quest"], pacing: ["fast", "medium"] },
  mindblowing: { tags: ["twisty", "layered", "complex", "thought-provoking", "mind-bending", "clever", "original"] },
  spooky:      { tags: ["creepy", "eerie", "atmospheric", "chilling", "haunting", "unsettling"], noteTerms: ["supernatural", "ghost", "haunt", "demonic", "occult"] },
  inspiring:   { tags: ["uplifting", "hopeful", "empowering", "life-changing", "motivating"] },
  informative: { tags: ["insightful", "well-researched", "eye-opening", "accessible", "thorough"], pacing: ["medium", "slow"] },
  fantastical: { tags: ["immersive", "epic", "magical", "imaginative", "worldbuilding", "enchanting"] },
  historical:  { tags: ["evocative", "richly detailed", "atmospheric", "well-researched", "transporting"] },
  sciencey:    { tags: ["futuristic", "extraterrestrial", "thought-provoking", "speculative", "hard sci-fi"] },
  dystopian:   { tags: ["dystopian", "bleak", "gripping", "unsettling", "rebellious", "speculative"], noteTerms: ["totalitarian", "oppress", "surveillance", "collapse", "apocalyp"] },
};

/** Merged signals for the selected moods (dedup'd, lowercased). */
export function getMoodSignals(moodKeys: string[]): MoodSignals {
  const tags = new Set<string>();
  const pacing = new Set<"fast" | "medium" | "slow">();
  const noteTerms = new Set<string>();
  for (const key of moodKeys) {
    const s = MOOD_SIGNALS[key];
    if (!s) continue;
    s.tags.forEach((t) => tags.add(t.toLowerCase()));
    s.pacing?.forEach((p) => pacing.add(p));
    s.noteTerms?.forEach((n) => noteTerms.add(n.toLowerCase()));
  }
  return {
    tags: [...tags],
    pacing: pacing.size > 0 ? [...pacing] : undefined,
    noteTerms: noteTerms.size > 0 ? [...noteTerms] : undefined,
  };
}
