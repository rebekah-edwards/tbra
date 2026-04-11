/**
 * Levenshtein edit distance between two strings.
 * Used by series and author search for fuzzy matching.
 */
export function editDistance(a: string, b: string): number {
  const la = a.length;
  const lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;

  let prev = Array.from({ length: lb + 1 }, (_, i) => i);
  let curr = new Array(lb + 1);

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[lb];
}

/**
 * Score candidates against a query using substring matching + fuzzy word-level matching.
 * Returns scored candidates sorted by match quality then bookCount.
 */
export function scoreFuzzyMatches<T extends { name: string; bookCount: number }>(
  candidates: T[],
  query: string,
  maxResults: number,
): (T & { matchScore: number })[] {
  const queryLower = query.toLowerCase();
  const useFuzzy = queryLower.length >= 4;

  type Scored = T & { matchScore: number };
  const scored: Scored[] = [];

  for (const item of candidates) {
    const nameLower = item.name.toLowerCase();
    const isSubstring = nameLower.includes(queryLower);

    if (useFuzzy && !isSubstring) {
      const nameWords = nameLower.split(/\s+/);
      const queryWords = queryLower.split(/\s+/);

      let matchedWords = 0;
      let totalDistance = 0;

      for (const qWord of queryWords) {
        let bestDist = qWord.length;
        for (const nWord of nameWords) {
          const dist = editDistance(qWord, nWord.slice(0, qWord.length + 2));
          bestDist = Math.min(bestDist, dist);
        }
        const threshold = Math.max(1, Math.floor(qWord.length * 0.35));
        if (bestDist <= threshold) {
          matchedWords++;
          totalDistance += bestDist;
        }
      }

      if (matchedWords < Math.ceil(queryWords.length * 0.7)) continue;
      scored.push({ ...item, matchScore: totalDistance + 10 });
    } else if (isSubstring) {
      const startsWithBonus = nameLower.startsWith(queryLower) ? -5 : 0;
      scored.push({ ...item, matchScore: startsWithBonus });
    }
  }

  scored.sort((a, b) => {
    if (a.matchScore !== b.matchScore) return a.matchScore - b.matchScore;
    return b.bookCount - a.bookCount;
  });

  return scored.slice(0, maxResults);
}
