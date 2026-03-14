// ─── Mood definitions ───

export const MOODS = [
  { key: "lighthearted", label: "Lighthearted", emoji: "\u{1F60A}" },
  { key: "inspired", label: "Inspired", emoji: "\u{2728}" },
  { key: "delighted", label: "Delighted", emoji: "\u{1F60D}" },
  { key: "silly", label: "Silly", emoji: "\u{1F92A}" },
  { key: "romantic", label: "Romantic", emoji: "\u{1F970}" },
  { key: "emotional", label: "Emotional", emoji: "\u{1F622}" },
  { key: "contemplative", label: "Contemplative", emoji: "\u{1F914}" },
  { key: "mind-blown", label: "Mind-blown", emoji: "\u{1F92F}" },
  { key: "devastated", label: "Devastated", emoji: "\u{1F62D}" },
  { key: "frightened", label: "Frightened", emoji: "\u{1F628}" },
  { key: "angry", label: "Angry", emoji: "\u{1F621}" },
  { key: "nostalgic", label: "Nostalgic", emoji: "\u{1F343}" },
] as const;

export function getMoodLabel(key: string): string {
  return MOODS.find((m) => m.key === key)?.label ?? key;
}

// ─── Dimension definitions ───

export type ReviewDimension = "characters" | "plot" | "setting" | "prose" | "content_details";

export const DIMENSION_SECTIONS: { key: ReviewDimension; label: string }[] = [
  { key: "characters", label: "Characters" },
  { key: "plot", label: "Plot" },
  { key: "setting", label: "Setting" },
  { key: "prose", label: "Prose" },
  { key: "content_details", label: "Content Details" },
];

// ─── Descriptor tags per dimension ───

export const DIMENSION_TAGS: Record<ReviewDimension, string[]> = {
  characters: [
    "Lovable",
    "Relatable",
    "Morally grey",
    "Predictable",
    "Inconsistent",
    "Well-developed",
  ],
  plot: [
    "Slow-paced",
    "Medium-paced",
    "Fast-paced",
    "Page turner",
    "Nonlinear",
    "Epic",
    "Intimate",
    "Cozy",
    "Predictable",
    "Satisfying",
    "Unrealistic",
    "Unsatisfying",
    "Confusing",
    "Poorly structured",
    "Shocking",
  ],
  setting: [
    "Contemporary/modern",
    "Historical",
    "Fantastical",
    "Urban",
    "Futuristic",
    "Utopian",
    "Dystopian",
    "Familiar",
    "Sparse",
    "Generic",
    "Under-developed",
    "Confined",
    "Expansive",
  ],
  prose: [
    "Complex",
    "Simple",
    "Dense",
    "Clunky",
    "Whimsical",
    "Humorous",
    "Flowery",
    "Descriptive",
    "Poorly written",
  ],
  content_details: [
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
  ],
};

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
