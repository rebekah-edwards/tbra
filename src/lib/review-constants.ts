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

export type ReviewDimension = "characters" | "plot" | "setting" | "prose";

export const DIMENSION_SECTIONS: { key: ReviewDimension; label: string }[] = [
  { key: "characters", label: "Characters" },
  { key: "plot", label: "Plot" },
  { key: "setting", label: "Setting" },
  { key: "prose", label: "Prose" },
];

// ─── Descriptor tags per dimension ───

export const DIMENSION_TAGS: Record<ReviewDimension, string[]> = {
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
};

// ─── Content Details tags (separate step) ───

export const CONTENT_DETAILS_TAGS = [
  "Domestic violence",
  "Animal abuse",
  "Child abuse",
  "Child loss",
  "Parent loss",
  "Death",
  "Explicit sexual content",
  "Eating disorders",
  "Grief",
  "Murder",
  "Self-harm",
  "Substance abuse",
  "Violence/gore",
  "War",
  "Strong political ideology",
  "Religious themes",
  "Witchcraft/occult themes",
  "LGBTQ+ representation",
  "Feminism",
];

// ─── Blocked keywords for custom content warnings ───

export const BLOCKED_CW_KEYWORDS = [
  "slur",
  "n-word",
  "f-word",
  "kys",
  "kill yourself",
];

// ─── Content Details → What's Inside taxonomy mapping ───

export const CW_TO_TAXONOMY: Record<string, string> = {
  "Violence/gore": "violence_gore",
  "War": "violence_gore",
  "Murder": "violence_gore",
  "Death": "violence_gore",
  "Explicit sexual content": "sexual_content",
  "Domestic violence": "abuse_suffering",
  "Child abuse": "abuse_suffering",
  "Animal abuse": "abuse_suffering",
  "Child loss": "abuse_suffering",
  "Parent loss": "abuse_suffering",
  "Grief": "abuse_suffering",
  "Self-harm": "self_harm_suicide",
  "Eating disorders": "self_harm_suicide",
  "Substance abuse": "substance_use",
  "LGBTQ+ representation": "lgbtqia_representation",
  "Strong political ideology": "political_ideological",
  "Feminism": "political_ideological",
  "Religious themes": "religious_content",
  "Witchcraft/occult themes": "witchcraft_occult",
};
