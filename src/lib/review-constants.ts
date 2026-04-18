// ─── Mood definitions ───

export const MOODS = [
  { key: "inspired", label: "Inspired", emoji: "\u{2728}" },
  { key: "romantic", label: "Romantic", emoji: "\u{1F970}" },
  { key: "emotional", label: "Emotional", emoji: "\u{1F622}" },
  { key: "contemplative", label: "Contemplative", emoji: "\u{1F914}" },
  { key: "mind-blown", label: "Mind-blown", emoji: "\u{1F92F}" },
  { key: "devastated", label: "Devastated", emoji: "\u{1F62D}" },
  { key: "frightened", label: "Frightened", emoji: "\u{1F628}" },
  { key: "angry", label: "Angry", emoji: "\u{1F621}" },
  { key: "nostalgic", label: "Nostalgic", emoji: "\u{1F343}" },
  { key: "empty", label: "Empty", emoji: "\u{1FAE5}" },
  { key: "curious", label: "Curious", emoji: "\u{1F9D0}" },
  { key: "happy", label: "Happy", emoji: "\u{1F60A}" },
  { key: "silly", label: "Silly", emoji: "\u{1F92A}" },
  { key: "shaken", label: "Shaken", emoji: "\u{1F633}" },
  { key: "surprised", label: "Surprised", emoji: "\u{1F632}" },
  { key: "informed", label: "Informed", emoji: "\u{1F913}" },
  { key: "confused", label: "Confused", emoji: "\u{1F615}" },
  { key: "grateful", label: "Grateful", emoji: "\u{1F64F}" },
] as const;

export function getMoodLabel(key: string): string {
  return MOODS.find((m) => m.key === key)?.label ?? key;
}

// ─── Dimension definitions (excludes content_details — now a separate step) ───

export type FictionDimension = "characters" | "plot" | "setting" | "prose";
export type NonfictionDimension = "substance" | "evidence" | "clarity" | "voice";
export type ReviewDimension = FictionDimension | NonfictionDimension;

export const FICTION_DIMENSIONS: { key: FictionDimension; label: string }[] = [
  { key: "characters", label: "Characters" },
  { key: "plot", label: "Plot" },
  { key: "setting", label: "Setting" },
  { key: "prose", label: "Prose" },
];

export const NONFICTION_DIMENSIONS: { key: NonfictionDimension; label: string }[] = [
  { key: "substance", label: "Substance" },
  { key: "evidence", label: "Evidence" },
  { key: "clarity", label: "Clarity" },
  { key: "voice", label: "Voice" },
];

/** Returns the dimension set for the given book category. */
export function dimensionsFor(isFiction: boolean | null): { key: ReviewDimension; label: string }[] {
  // Default to fiction when we genuinely don't know, since fiction is the
  // far more common catalogue shape on tbr*a.
  return isFiction === false ? NONFICTION_DIMENSIONS : FICTION_DIMENSIONS;
}

/**
 * Combined list of every dimension across fiction + nonfiction — useful
 * for rendering a saved review where we don't branch on isFiction but
 * still want to show only the dimensions that actually have data.
 */
export const ALL_DIMENSIONS: { key: ReviewDimension; label: string }[] = [
  ...FICTION_DIMENSIONS,
  ...NONFICTION_DIMENSIONS,
];

// ─── Descriptor tags per dimension ───

export const DIMENSION_TAGS: Record<ReviewDimension, string[]> = {
  // Fiction
  characters: [
    "Relatable",
    "Lovable",
    "Morally grey",
    "Predictable",
    "Inconsistent",
    "Well-developed",
    "Compelling",
    "Complex",
    "Simple",
    "Realistic",
    "Flawed",
    "Annoying",
    "Memorable",
  ],
  plot: [
    "Nonlinear",
    "Epic",
    "Intimate",
    "Cozy",
    "Predictable",
    "Satisfying",
    "Unrealistic",
    "Frustrating",
    "Confusing",
    "Poorly structured",
    "Shocking",
    "Slow-burn",
    "Gripping",
    "Twisty",
    "Emotional",
    "Immersive",
    "Layered",
    "Suspenseful",
  ],
  setting: [
    "Contemporary/modern",
    "Historical",
    "Fantastical",
    "Urban",
    "Rural",
    "Futuristic",
    "Utopian",
    "Dystopian",
    "Familiar",
    "Sparse",
    "Generic",
    "Under-developed",
    "Confined",
    "Expansive",
    "Vivid",
    "Haunting",
    "Magical",
    "Extraterrestrial",
    "Alternate Earth",
    "Gritty",
    "Inconsistent",
  ],
  prose: [
    "Complex",
    "Simple",
    "Lyrical / Poetic",
    "Dense",
    "Clunky",
    "Whimsical",
    "Humorous",
    "Flowery",
    "Poorly written",
    "Elegant",
    "Witty",
    "Flat",
  ],

  // Nonfiction — Substance: how much the reader came away with.
  substance: [
    "Illuminating",
    "Surface-level",
    "Paradigm-shifting",
    "Repetitive",
    "Actionable",
    "Dense",
    "Hand-wavy",
    "Thought-provoking",
    "Quotable",
    "Forgettable",
    "Life-changing",
  ],
  // Nonfiction — Evidence: how claims are supported.
  evidence: [
    "Well-sourced",
    "Cherry-picked",
    "Peer-reviewed",
    "Lived-experience",
    "Opinion-heavy",
    "Balanced",
    "Inflammatory",
    "Data-driven",
    "Under-researched",
    "Primary sources",
    "Credible",
  ],
  // Nonfiction — Clarity: how accessible for the target reader.
  clarity: [
    "Jargon-heavy",
    "Beginner-friendly",
    "Over-simplified",
    "Technical",
    "Plain-spoken",
    "Meandering",
    "Well-organized",
    "Circuitous",
    "Crystal clear",
    "Dense",
  ],
  // Nonfiction — Voice: the author's presence on the page.
  voice: [
    "Academic",
    "Warm",
    "Urgent",
    "Dry",
    "Memoir-like",
    "Sermonizing",
    "Witty",
    "Self-indulgent",
    "Humble",
    "Confrontational",
    "Conversational",
    "Detached",
  ],
};

// ─── Blocked keywords for user-added trigger warnings ───

export const BLOCKED_CW_KEYWORDS = [
  "slur",
  "n-word",
  "f-word",
  "kys",
  "kill yourself",
];

// ─── Legacy content-tag → taxonomy mapping ───
// Kept for the aggregator that still processes historical reviews with
// the old 18 content_details tags. New reviews no longer populate these.
export const CW_TO_TAXONOMY: Record<string, string> = {
  "Violence/gore": "violence_gore",
  "War": "violence_gore",
  "Murder": "violence_gore",
  "Death": "violence_gore",
  "Explicit sexual content": "romance_sex",
  "Domestic violence": "abuse_suffering",
  "Child abuse": "abuse_suffering",
  "Animal abuse": "abuse_suffering",
  "Child loss": "abuse_suffering",
  "Parent loss": "abuse_suffering",
  "Grief": "abuse_suffering",
  "Self-harm": "self_harm_suicide",
  "Eating disorders": "other",
  "Substance abuse": "substance_use",
  "LGBTQ+ representation": "lgbtqia_representation",
  "Strong political ideology": "political_ideological",
  "Feminism": "political_ideological",
  "Religious themes": "religious_content",
  "Witchcraft/occult themes": "magic_witchcraft",
};
