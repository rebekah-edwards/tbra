export interface BraveResult {
  title: string;
  url: string;
  description: string;
}

export interface BookContext {
  title: string;
  authors: string[];
  description: string | null;
  genres: string[];
  isFiction: boolean;
  searchResults: BraveResult[];
}

export interface EnrichmentResult {
  summary: string;
  isFiction: boolean;
  supplementalTags: string[];
  ratings: Array<{
    categoryKey: string;
    intensity: number;
    notes: string;
  }>;
}

export const TAXONOMY_KEYS = [
  "sexual_content",
  "violence_gore",
  "profanity_language",
  "substance_use",
  "lgbtqia_representation",
  "religious_content",
  "witchcraft_occult",
  "political_ideological",
  "self_harm_suicide",
  "sexual_assault_coercion",
  "abuse_suffering",
  "user_added",
] as const;
