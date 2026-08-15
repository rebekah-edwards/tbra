/**
 * The CLOSED vocabularies a screenshot import is allowed to emit.
 *
 * These mirror the review wizard's own constants (native-ios
 * ReviewWizardView.swift + src/components/review/*). The model is given these
 * lists and told it may only choose from them — free-text tags would be
 * silently dropped by the wizard, which is worse than not mapping at all
 * because the user sees a tag land and then vanish on save.
 *
 * Keep in sync with the wizard. A tag that exists here but not there is a
 * value the user can never remove; one that exists there but not here is
 * simply never auto-filled, which is harmless.
 */

export const MOOD_KEYS = [
  "inspired", "romantic", "emotional", "contemplative", "mind-blown", "devastated",
  "frightened", "angry", "nostalgic", "empty", "curious", "happy", "silly",
  "shaken", "surprised", "informed", "confused", "grateful",
] as const;

export const FICTION_DIMENSIONS = ["characters", "plot", "setting", "prose"] as const;
export const NONFICTION_DIMENSIONS = ["substance", "evidence", "clarity", "voice"] as const;

export const PACING = ["slow", "medium", "fast"] as const;

export const DIMENSION_TAGS: Record<string, string[]> = {
  characters: ["Relatable", "Lovable", "Morally grey", "Predictable", "Inconsistent", "Well-developed",
    "Compelling", "Complex", "Simple", "Realistic", "Flawed", "Annoying", "Memorable",
    "Forgettable", "Flat", "Unlikable", "Under-developed", "Diverse", "Swoon-worthy"],
  plot: ["Nonlinear", "Epic", "Intimate", "Cozy", "Predictable", "Satisfying", "Unrealistic",
    "Frustrating", "Confusing", "Poorly structured", "Shocking", "Slow-burn", "Gripping",
    "Twisty", "Emotional", "Immersive", "Layered", "Suspenseful", "Boring", "Rushed",
    "Repetitive", "Formulaic", "Original", "Dark", "Tropey"],
  setting: ["Contemporary/modern", "Historical", "Fantastical", "Urban", "Rural", "Futuristic",
    "Utopian", "Dystopian", "Familiar", "Sparse", "Generic", "Under-developed", "Confined",
    "Expansive", "Vivid", "Haunting", "Magical", "Extraterrestrial", "Alternate Earth",
    "Gritty", "Inconsistent", "Atmospheric", "Immersive", "Richly detailed", "Small-town",
    "Cozy", "Bleak"],
  prose: ["Complex", "Simple", "Lyrical / Poetic", "Dense", "Clunky", "Whimsical", "Humorous",
    "Flowery", "Poorly written", "Elegant", "Witty", "Flat", "Boring", "Dry", "Accessible",
    "Beautiful", "Choppy", "Over-written", "Punchy", "Repetitive"],
  substance: ["Illuminating", "Surface-level", "Paradigm-shifting", "Repetitive", "Actionable",
    "Dense", "Hand-wavy", "Thought-provoking", "Quotable", "Forgettable", "Life-changing",
    "Boring", "Practical", "Inspiring", "Overhyped", "Well-argued", "Rambling"],
  evidence: ["Well-sourced", "Cherry-picked", "Peer-reviewed", "Lived-experience", "Opinion-heavy",
    "Balanced", "Inflammatory", "Data-driven", "Under-researched", "Primary sources",
    "Credible", "Anecdotal", "Outdated", "Rigorous", "Transparent", "One-sided"],
  clarity: ["Jargon-heavy", "Beginner-friendly", "Over-simplified", "Technical", "Plain-spoken",
    "Meandering", "Well-organized", "Circuitous", "Crystal clear", "Dense", "Confusing",
    "Repetitive", "Concise", "Bloated", "Easy to follow"],
  voice: ["Academic", "Warm", "Urgent", "Dry", "Memoir-like", "Sermonizing", "Witty", "Self-indulgent",
    "Humble", "Confrontational", "Conversational", "Detached", "Boring", "Authoritative",
    "Compassionate", "Snarky", "Inspiring", "Preachy"],
};

export type ImportSource = "goodreads" | "fable" | "storygraph" | "unknown";

export interface ParsedImport {
  source: ImportSource;
  /** 0.25–5 in quarter steps, or null when the screenshot showed no number. */
  overallRating: number | null;
  /**
   * How the rating was obtained:
   *  - "explicit": a number appeared in the text (StoryGraph "4.25", Fable "5.00")
   *  - "glyph":    only star shapes were present, so it needs the image pass
   *  - "missing":  no rating visible at all
   * The client uses "glyph" to decide whether to send the cropped star row.
   */
  ratingSource: "explicit" | "glyph" | "missing";
  reviewText: string | null;
  /** True when the source clearly marked the review as truncated ("…more"). */
  reviewTextTruncated: boolean;
  mood: string | null;
  plotPacing: "slow" | "medium" | "fast" | null;
  dimensionRatings: Record<string, number>;
  dimensionTags: Record<string, string[]>;
  /** Source pills we could not map — surfaced so nothing disappears silently. */
  unmapped: string[];
}
