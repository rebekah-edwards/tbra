export interface ImportOptions {
  /** Overwrite reading states (TBR/reading/completed/etc.) for existing books */
  updateReadingStates: boolean;
  /** Overwrite ratings and fill empty reviews for existing books */
  updateRatingsReviews: boolean;
  /** Merge owned formats and strip all "unknown" entries for existing books */
  updateOwnedFormats: boolean;
  /** Re-import mode: skip books the user already has entirely (no duplicate sessions) */
  isReimport: boolean;
}

export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  updateReadingStates: true,
  updateRatingsReviews: true,
  updateOwnedFormats: true,
  isReimport: false,
};

/** Parse import options from FormData (defaults to true if absent) */
export function parseImportOptions(formData: FormData): ImportOptions {
  return {
    updateReadingStates: formData.get("updateReadingStates") !== "false",
    updateRatingsReviews: formData.get("updateRatingsReviews") !== "false",
    updateOwnedFormats: formData.get("updateOwnedFormats") !== "false",
    isReimport: formData.get("isReimport") === "true",
  };
}

/**
 * State progression hierarchy — higher number = further along.
 * Import only moves a book forward, never backward.
 */
const STATE_RANK: Record<string, number> = {
  tbr: 1,
  currently_reading: 2,
  paused: 3,
  dnf: 4,
  completed: 5,
};

/**
 * Returns true if moving from `current` to `incoming` is a forward progression
 * (or the same state). Returns true if either state is unknown (safe fallback).
 */
export function isStateProgression(
  current: string | null,
  incoming: string | null
): boolean {
  if (!current || !incoming) return true;
  const currentRank = STATE_RANK[current];
  const incomingRank = STATE_RANK[incoming];
  // If we don't recognize either state, allow the update
  if (currentRank === undefined || incomingRank === undefined) return true;
  return incomingRank >= currentRank;
}

/**
 * Clean owned formats array:
 * - Remove all "unknown" entries
 * - Merge in new format if not already present
 * - Returns the cleaned array
 */
export function mergeOwnedFormats(
  currentFormats: string[],
  newFormat: string | null
): string[] {
  // Strip all "unknown"
  let formats = currentFormats.filter((f) => f !== "unknown");
  // Add new format if provided and not already present
  if (newFormat && !formats.includes(newFormat)) {
    formats.push(newFormat);
  }
  return formats;
}

/**
 * Convert raw technical error messages into user-friendly descriptions.
 */
export function formatImportError(rawError: string): string {
  if (rawError.includes("UNIQUE constraint failed: books.isbn_13")) {
    return "A different book with the same ISBN-13 already exists in the database";
  }
  if (rawError.includes("UNIQUE constraint failed: books.isbn_10")) {
    return "A different book with the same ISBN-10 already exists in the database";
  }
  if (rawError.includes("UNIQUE constraint failed")) {
    return "A duplicate record was found — this book may already exist under a different title";
  }
  if (rawError.includes("FOREIGN KEY constraint failed")) {
    return "A required linked record (author or series) was missing";
  }
  if (rawError.includes("fetch failed") || rawError.includes("ECONNREFUSED")) {
    return "Could not connect to the book metadata service — try again later";
  }
  if (rawError.includes("timeout") || rawError.includes("ETIMEDOUT")) {
    return "The metadata lookup timed out — try again later";
  }
  // Fallback: return the original but strip SQL-specific noise
  return rawError.replace(/^SqliteError:\s*/i, "").replace(/\s*\(code \w+\)/, "");
}
