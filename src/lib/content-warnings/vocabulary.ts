/**
 * Canonical content warning vocabulary.
 *
 * Static map of canonical warning IDs (snake_case) to their synonyms.
 * Both a reader's "topics to avoid" preferences AND a reviewer's free-text
 * custom warnings get run through `canonicalizeWarning()` on save so we can
 * compare them with an exact string match at query time — no fuzzy matching
 * in the hot path.
 *
 * Stored in code, not the database:
 *   1. It's small (~50 entries) and never changes per-request
 *   2. Zero DB round-trips on canonicalize
 *   3. Available to the recommendations scorer with no extra fetch
 *   4. No Turso migration required to ship
 *
 * Add new canonicals here over time based on user reports and review tags.
 * When you add aliases, keep them lowercase and singular where it makes sense.
 */

export interface CanonicalWarning {
  /** Snake-case ID stored in the DB: e.g. "infidelity" */
  id: string;
  /** Display label shown in the UI: "Infidelity / cheating" */
  label: string;
  /** Category for grouping in autocomplete (optional) */
  category:
    | "relationships"
    | "violence"
    | "death_loss"
    | "mental_health"
    | "identity"
    | "body"
    | "religion"
    | "other";
  /** Lowercase synonyms a user might type. Match is substring-based. */
  aliases: string[];
}

export const CANONICAL_WARNINGS: CanonicalWarning[] = [
  // ─── Relationships ───
  {
    id: "infidelity",
    label: "Infidelity / cheating",
    category: "relationships",
    aliases: ["infidelity", "cheating", "affair", "adultery", "unfaithful", "cheat"],
  },
  {
    id: "love_triangle",
    label: "Love triangle",
    category: "relationships",
    aliases: ["love triangle", "triangle"],
  },
  {
    id: "age_gap",
    label: "Age gap romance",
    category: "relationships",
    aliases: ["age gap", "age difference", "older love interest"],
  },
  {
    id: "toxic_relationship",
    label: "Toxic / abusive relationship",
    category: "relationships",
    aliases: ["toxic relationship", "abusive relationship", "domestic abuse", "dv"],
  },
  {
    id: "forced_proximity",
    label: "Forced proximity / captivity romance",
    category: "relationships",
    aliases: ["forced proximity", "captivity romance", "kidnapped by love interest"],
  },

  // ─── Violence ───
  {
    id: "graphic_violence",
    label: "Graphic violence / gore",
    category: "violence",
    aliases: ["graphic violence", "gore", "graphic death", "brutal", "brutal violence", "excessive violence"],
  },
  {
    id: "sexual_assault",
    label: "Sexual assault",
    category: "violence",
    aliases: ["sexual assault", "sa", "rape", "rape scene", "assault"],
  },
  {
    id: "torture",
    label: "Torture",
    category: "violence",
    aliases: ["torture", "torture scene"],
  },
  {
    id: "child_harm",
    label: "Violence toward children",
    category: "violence",
    aliases: ["child harm", "child abuse", "child death", "hurt kids", "violence against children", "harm to kids"],
  },
  {
    id: "animal_harm",
    label: "Animal harm / death",
    category: "violence",
    aliases: ["animal harm", "animal death", "pet death", "dog dies", "cat dies", "animal abuse", "dogs die"],
  },
  {
    id: "war_combat",
    label: "War / graphic combat",
    category: "violence",
    aliases: ["war", "combat", "battlefield", "war violence"],
  },

  // ─── Death & loss ───
  {
    id: "suicide",
    label: "Suicide",
    category: "death_loss",
    aliases: ["suicide", "sui", "suicidal", "suicide ideation"],
  },
  {
    id: "self_harm",
    label: "Self-harm",
    category: "death_loss",
    aliases: ["self harm", "self-harm", "cutting", "sh"],
  },
  {
    id: "pregnancy_loss",
    label: "Pregnancy loss",
    category: "death_loss",
    aliases: ["pregnancy loss", "miscarriage", "stillbirth", "baby loss", "infant loss"],
  },
  {
    id: "parent_death",
    label: "Death of a parent",
    category: "death_loss",
    aliases: ["parent death", "dead parents", "orphan", "mom dies", "dad dies"],
  },
  {
    id: "terminal_illness",
    label: "Terminal illness",
    category: "death_loss",
    aliases: ["terminal illness", "cancer", "dying of cancer", "deathbed"],
  },

  // ─── Mental health ───
  {
    id: "eating_disorders",
    label: "Eating disorders",
    category: "mental_health",
    aliases: ["eating disorder", "eating disorders", "anorexia", "bulimia", "ed"],
  },
  {
    id: "substance_abuse",
    label: "Substance abuse",
    category: "mental_health",
    aliases: ["substance abuse", "addiction", "drug abuse", "alcoholism", "drugs"],
  },
  {
    id: "depression",
    label: "Depression (graphic depiction)",
    category: "mental_health",
    aliases: ["depression", "depressive episode", "depressive"],
  },
  {
    id: "panic_anxiety",
    label: "Panic attacks / anxiety",
    category: "mental_health",
    aliases: ["panic attacks", "anxiety attacks", "panic attack"],
  },

  // ─── Identity ───
  {
    id: "transphobia",
    label: "Transphobia",
    category: "identity",
    aliases: ["transphobia", "transphobic"],
  },
  {
    id: "homophobia",
    label: "Homophobia",
    category: "identity",
    aliases: ["homophobia", "homophobic"],
  },
  {
    id: "racism",
    label: "Racism",
    category: "identity",
    aliases: ["racism", "racist", "racial slurs"],
  },
  {
    id: "misogyny",
    label: "Misogyny",
    category: "identity",
    aliases: ["misogyny", "misogynistic", "sexism"],
  },
  {
    id: "ableism",
    label: "Ableism",
    category: "identity",
    aliases: ["ableism", "ableist"],
  },

  // ─── Body ───
  {
    id: "body_shaming",
    label: "Body shaming",
    category: "body",
    aliases: ["body shaming", "fat shaming", "weight shaming"],
  },
  {
    id: "medical_content",
    label: "Graphic medical content",
    category: "body",
    aliases: ["medical content", "surgery", "graphic medical", "hospital scenes"],
  },

  // ─── Religion ───
  {
    id: "religious_trauma",
    label: "Religious trauma / abuse",
    category: "religion",
    aliases: ["religious trauma", "religious abuse", "cult", "church hurt", "religious cult"],
  },
  {
    id: "blasphemy",
    label: "Blasphemy / anti-religious content",
    category: "religion",
    aliases: ["blasphemy", "anti-christian", "anti-religious", "mocking faith"],
  },

  // ─── Other common ones ───
  {
    id: "cliffhanger",
    label: "Cliffhanger ending",
    category: "other",
    aliases: ["cliffhanger", "unresolved ending"],
  },
  {
    id: "open_door_romance",
    label: "Explicit / open-door romance",
    category: "other",
    aliases: ["open door", "open-door", "explicit sex", "spicy", "steamy", "graphic sex"],
  },
  {
    id: "unreliable_narrator",
    label: "Unreliable narrator",
    category: "other",
    aliases: ["unreliable narrator"],
  },
];

// ─── Derived lookup index (built once at module load) ───

const ALIAS_TO_CANONICAL = new Map<string, string>();
for (const w of CANONICAL_WARNINGS) {
  ALIAS_TO_CANONICAL.set(w.id, w.id);
  for (const alias of w.aliases) {
    ALIAS_TO_CANONICAL.set(alias.toLowerCase().trim(), w.id);
  }
}

const CANONICAL_BY_ID = new Map<string, CanonicalWarning>();
for (const w of CANONICAL_WARNINGS) CANONICAL_BY_ID.set(w.id, w);

/**
 * Try to map free-text user input to a canonical warning ID.
 *
 * Returns the canonical ID (e.g. "infidelity") if the input exactly or
 * substring-matches a known alias, otherwise null. Callers can fall back
 * to storing the raw text when no match is found.
 *
 * Fast path: O(1) map lookup on exact match. If that misses, falls through
 * to a single sequential scan of aliases for substring match — still cheap
 * since the vocabulary is ~50 entries total and this only runs on save.
 */
export function canonicalizeWarning(raw: string): string | null {
  const normalized = raw.toLowerCase().trim();
  if (!normalized) return null;

  // Exact match on canonical ID or any alias
  const exact = ALIAS_TO_CANONICAL.get(normalized);
  if (exact) return exact;

  // Substring match — pick the alias with the longest overlap so "graphic sex"
  // maps to "open_door_romance" rather than random "sex" alias if one exists.
  let best: { id: string; matchLen: number } | null = null;
  for (const [alias, canonicalId] of ALIAS_TO_CANONICAL) {
    if (alias.length < 4) continue; // avoid matching "sh", "sa", "ed" too aggressively
    if (normalized.includes(alias) || alias.includes(normalized)) {
      if (!best || alias.length > best.matchLen) {
        best = { id: canonicalId, matchLen: alias.length };
      }
    }
  }
  return best?.id ?? null;
}

/** Fetch display metadata for a canonical ID. */
export function getCanonicalWarning(id: string): CanonicalWarning | null {
  return CANONICAL_BY_ID.get(id) ?? null;
}

/** Return a label for display — canonical label if known, otherwise the raw text. */
export function getWarningLabel(idOrRaw: string): string {
  return CANONICAL_BY_ID.get(idOrRaw)?.label ?? idOrRaw;
}

/**
 * Scan a free-text string (e.g. an admin-curated bookCategoryRatings.notes
 * description) for any alias of the given canonical warning IDs.
 *
 * Returns the set of canonical IDs whose aliases appear as word-level
 * substrings in the text. Used to surface "X mentioned in content notes"
 * on book pages — no DB work, no regex compilation per call.
 *
 * Match rule: alias must be >= 4 chars AND appear as an isolated token or
 * substring (bounded by non-letter chars) so "war" doesn't match "toward".
 */
export function scanTextForCanonicals(
  text: string | null | undefined,
  wantedCanonicalIds: string[],
): Set<string> {
  const hits = new Set<string>();
  if (!text || wantedCanonicalIds.length === 0) return hits;
  const lower = text.toLowerCase();

  for (const canonicalId of wantedCanonicalIds) {
    const w = CANONICAL_BY_ID.get(canonicalId);
    if (!w) continue;
    // Match any alias with reasonable specificity
    const candidates = [w.id, ...w.aliases];
    for (const alias of candidates) {
      if (alias.length < 4) continue;
      const idx = lower.indexOf(alias);
      if (idx === -1) continue;
      // Boundary check: character before must be non-letter or start,
      // character after must be non-letter or end. Prevents "war" matching
      // "toward" or "forward" and "sui" matching random Asian place names.
      const before = idx === 0 ? "" : lower[idx - 1];
      const after = idx + alias.length >= lower.length ? "" : lower[idx + alias.length];
      const isLetter = (c: string) => /[a-z]/.test(c);
      if (isLetter(before) || isLetter(after)) continue;
      hits.add(canonicalId);
      break; // one hit per canonical is enough
    }
  }
  return hits;
}
