/**
 * Identity verification for Open Library results.
 * Requires at least 2 of 3 signals (ISBN, title, author) to match
 * before accepting an OL result as the correct book.
 */

interface IdentityCandidate {
  isbn?: string[];  // ISBNs from OL result
  title: string;
  authors: string[];
}

interface IdentityKnown {
  isbn10?: string | null;
  isbn13?: string | null;
  title: string;
  authors: string[];
}

export function verifyIdentity(known: IdentityKnown, candidate: IdentityCandidate): { score: number; pass: boolean } {
  let score = 0;

  // ISBN match
  if (candidate.isbn && candidate.isbn.length > 0) {
    const candidateIsbns = new Set(candidate.isbn.map(i => i.replace(/[-\s]/g, '')));
    if ((known.isbn13 && candidateIsbns.has(known.isbn13.replace(/[-\s]/g, ''))) ||
        (known.isbn10 && candidateIsbns.has(known.isbn10.replace(/[-\s]/g, '')))) {
      score++;
    }
  }

  // Title match (normalized)
  const normKnown = normalizeForMatch(known.title);
  const normCandidate = normalizeForMatch(candidate.title);
  if (normKnown === normCandidate ||
      (normKnown.length >= 4 && normCandidate.includes(normKnown)) ||
      (normCandidate.length >= 4 && normKnown.includes(normCandidate)) ||
      levenshteinDistance(normKnown, normCandidate) <= 3) {
    score++;
  }

  // Author match (any author last name)
  const knownLastNames = known.authors.map(a => a.split(/\s+/).pop()?.toLowerCase() ?? '');
  const candidateLastNames = candidate.authors.map(a => a.split(/\s+/).pop()?.toLowerCase() ?? '');
  if (knownLastNames.some(kn => candidateLastNames.some(cn => kn === cn && kn.length > 1))) {
    score++;
  }

  return { score, pass: score >= 2 };
}

function normalizeForMatch(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\(\[].*?[\)\]]/g, '') // strip parentheticals
    .replace(/[^a-z0-9\s]/g, '')    // strip punctuation
    .replace(/^(the|a|an)\s+/, '')   // strip leading articles
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[b.length][a.length];
}
