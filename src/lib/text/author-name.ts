/**
 * Author-name normalisation — the ONE place that turns a source's author
 * string into the form we store ("First Last").
 *
 * Why this exists: library-catalogue sources (ISBNdb, Library of Congress,
 * many OpenLibrary author records) file people under "Last, First", often
 * with life dates or a role bolted on ("Tolkien, J. R. R., 1892-1973",
 * "Smith, John (Editor)"). Nothing normalised those before 2026-11-16, so
 * every import path wrote the raw string and the catalogue grew rows like
 * "Yarros, Rebecca" next to "Rebecca Yarros".
 *
 * Every path that creates or matches an `authors` row must go through
 * `normalizeAuthorName()` (or `splitAuthorList()` for a multi-author field).
 *
 * The rules are deliberately conservative: when a comma could mean something
 * other than an inverted personal name, the string is returned untouched and
 * `analyzeAuthorName()` says why, so a sweep can list it for a human.
 *
 * Pure module — no imports, safe from scripts, server code and tests alike.
 */

export type AuthorNameAction =
  /** Returned exactly as given (after whitespace collapse). */
  | "unchanged"
  /** "Last, First" → "First Last". */
  | "flipped"
  /** Not inverted, but dates / role label / credentials / a repeat were removed. */
  | "cleaned"
  /** Has a comma we could not safely interpret — returned untouched. */
  | "declined";

export interface AuthorNameResult {
  name: string;
  action: AuthorNameAction;
  /** Short machine-ish reason, set for `declined` and some `unchanged`. */
  reason?: string;
}

// ── vocabularies ───────────────────────────────────────────────────────────

/** Generational suffixes. Value = canonical spelling. */
const SUFFIXES: Record<string, string> = {
  jr: "Jr.",
  junior: "Jr.",
  sr: "Sr.",
  senior: "Sr.",
  ii: "II",
  iii: "III",
  iv: "IV",
};

/** Post-nominal credentials, compared with periods removed, case-sensitive. */
const CREDENTIALS = new Set([
  "MD", "DO", "PhD", "PHD", "PsyD", "PSYD", "EdD", "EDD", "DDS", "DMD", "DVM",
  "RN", "NP", "DNP", "BSN", "MSN", "RD", "RDN", "MSW", "LCSW", "LMFT", "LPC",
  "LMHC", "MCC", "MBA", "MFA", "MPH", "MA", "MS", "MDiv", "DMin", "ThD", "ThM",
  "JD", "Esq", "CPA", "CFP", "PMP", "FACS", "SJ", "OP", "OSB", "OBE", "MBE", "CBE",
]);

/** Surname particles — a surname may START with one ("de la Cruz", "Le Guin"). */
const PARTICLES = new Set([
  "de", "del", "della", "der", "den", "di", "da", "dos", "das", "du", "la", "le",
  "van", "von", "vom", "zu", "ter", "ten", "st", "st.", "saint", "san", "santa",
  "mac", "mc", "o", "al", "el", "bin", "ibn", "ben", "bat", "af", "av", "y",
]);

/** A trailing one of these after the given names means a title, not a name. */
const TRAILING_TITLES = new Set([
  "lady", "lord", "sir", "dame", "saint", "baron", "baroness", "count", "countess",
  "earl", "duke", "duchess", "bishop", "archbishop", "pope", "cardinal", "rabbi",
  "rev", "reverend", "father", "brother", "sister", "mother", "captain", "capt",
  "colonel", "col", "general", "gen", "major", "lieut", "lt", "sgt", "mrs", "mr",
  "ms", "miss", "dr", "prof", "professor", "monk", "abbot",
]);

/** Any of these as a whole word means an organisation, not a person. */
const CORPORATE = new Set([
  "inc", "llc", "ltd", "limited", "incorporated", "co", "corp", "corporation",
  "company", "group", "press", "publishing", "publishers", "publications", "books",
  "staff", "editors", "university", "college", "school", "society", "association",
  "institute", "museum", "library", "galleries", "gallery", "foundation",
  "committee", "council", "department", "church", "ministries", "ministry",
  "studio", "studios", "entertainment", "media", "team", "magazine", "review",
  "bros", "brothers", "sons", "international", "productions", "comics", "club",
  "center", "centre", "organization", "organisation", "conference", "symposium",
  "network", "agency", "bureau", "office", "collective", "project",
]);

/** Lowercase function words that never appear inside an inverted personal name. */
const FUNCTION_WORDS = new Set(["of", "the", "and", "for", "at", "in", "with", "by"]);

/** Name abbreviations whose trailing period is part of the abbreviation. */
const KEEP_PERIOD = new Set([
  "jr", "sr", "dr", "mr", "mrs", "ms", "st", "rev", "prof", "capt", "col", "gen",
  "wm", "geo", "chas", "thos", "jas", "jno", "edw", "benj", "robt", "saml",
]);

const ROLE_WORDS =
  "editor|editors|ed|eds|illustrator|illus|ill|translator|trans|trn|tr|narrator|" +
  "author|writer|artist|letterer|colorist|colourist|photographer|contributor|" +
  "foreword|introduction|afterword|adapter|adaptor|compiler|novelist|journalist|" +
  "poet|creator|inker|penciller|penciler|reader|performer";

// ── small helpers ──────────────────────────────────────────────────────────

const NAME_TOKEN = /^\p{L}[\p{L}\p{M}'’.\-]*$/u;
const INITIAL = /^(?:\p{Lu}\.?|(?:\p{Lu}\.){2,}|\p{Lu}{2})$/u;

function bare(tok: string): string {
  return tok.replace(/\./g, "").toLowerCase();
}

function isSuffix(tok: string): boolean {
  return Object.prototype.hasOwnProperty.call(SUFFIXES, bare(tok));
}

function isCredentialPart(part: string): boolean {
  const toks = part.split(" ").filter(Boolean);
  return toks.length > 0 && toks.every((t) => CREDENTIALS.has(t.replace(/\./g, "")));
}

function isParticle(tok: string): boolean {
  return PARTICLES.has(tok.toLowerCase());
}

function startsUpper(tok: string): boolean {
  return /^\p{Lu}/u.test(tok);
}

function isAllCaps(tok: string): boolean {
  const letters = tok.replace(/[^\p{L}]/gu, "");
  return letters.length > 2 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
}

/** "MCDONALD-SMITH" → "Mcdonald-Smith". Only called on all-caps tokens. */
function titleCase(tok: string): string {
  return tok
    .toLowerCase()
    .replace(/(^|[-'’])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Strip trailing life dates: ", 1892-1973", " 1950-", "(b. 1961)", ", d. 1400". */
function stripDates(s: string): string {
  const q = String.raw`(?:(?:b|d|fl|ca|c)\.\s*|born\s+|died\s+|circa\s+|approximately\s+|active\s+)?`;
  const yr = String.raw`\d{3,4}\??`;
  const patterns = [
    // after a comma — the catalogue form
    new RegExp(String.raw`\s*,\s*${q}${yr}(?:\s*[-–—]\s*(?:${q}${yr})?)?\.?\s*$`, "i"),
    // a bare range with no comma
    new RegExp(String.raw`\s+${q}${yr}\s*[-–—]\s*(?:${q}${yr})?\.?\s*$`, "i"),
    // parenthesised
    new RegExp(String.raw`\s*\(\s*${q}${yr}(?:\s*[-–—]\s*(?:${q}${yr})?)?\s*\)\.?\s*$`, "i"),
  ];
  let out = s;
  for (let i = 0; i < 3; i++) {
    const before = out;
    for (const re of patterns) {
      const next = out.replace(re, "");
      if (next.trim()) out = next;
    }
    if (out === before) break;
  }
  return out.trim();
}

/** Strip a trailing role label: "(Editor)", "[illustrator]", ", ed.", ", translator". */
function stripRole(s: string): string {
  const paren = new RegExp(
    String.raw`\s*[(\[][^)\]]*\b(?:${ROLE_WORDS})\b[^)\]]*[)\]]\.?\s*$`,
    "i",
  );
  const tail = new RegExp(String.raw`\s*,\s*(?:${ROLE_WORDS})\.?\s*$`, "i");
  let out = s;
  for (let i = 0; i < 3; i++) {
    const next = out.replace(paren, "").replace(tail, "");
    if (!next.trim() || next === out) break;
    out = next;
  }
  return out.trim();
}

/** Remove every (...) / [...] group — used to see whether a comma sits outside them. */
function withoutBrackets(s: string): string {
  return s.replace(/\([^)]*\)/g, " ").replace(/\[[^\]]*\]/g, " ");
}

function dropTrailingPeriod(tok: string): string {
  if (!tok.endsWith(".")) return tok;
  const core = tok.slice(0, -1);
  if (core.includes(".")) return tok; // "J.R.R."
  if ([...core].length < 3) return tok; // initials, "Jr."
  if (KEEP_PERIOD.has(core.toLowerCase())) return tok;
  return core;
}

// ── the normaliser ─────────────────────────────────────────────────────────

export function analyzeAuthorName(raw: string): AuthorNameResult {
  const original = collapse(raw ?? "");
  if (!original) return { name: "", action: "unchanged" };

  const cleaned = stripRole(stripDates(stripRole(original)));
  const done = (name: string, action: AuthorNameAction, reason?: string): AuthorNameResult => ({
    name,
    action,
    ...(reason ? { reason } : {}),
  });
  const decline = (reason: string) => done(original, "declined", reason);

  // No comma outside brackets → not an inverted name. Keep any date/role strip.
  if (!withoutBrackets(cleaned).includes(",")) {
    return cleaned === original ? done(original, "unchanged") : done(cleaned, "cleaned");
  }

  // From here the string has a real comma. In the catalogue form any trailing
  // parenthetical is a qualifier ("Stevenson, D. E. (Dorothy Emily)").
  let s = cleaned;
  for (let i = 0; i < 3; i++) {
    const next = s.replace(/\s*\([^)]*\)\.?\s*$/, "").trim();
    if (!next || next === s) break;
    s = next;
  }

  if (/[;/&\[\]()\d|]/.test(s)) return decline("separator-or-non-name-characters");
  if (/(^|\s)(and|with)(\s|$)/i.test(s)) return decline("multiple-authors");

  let parts = s.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return done(parts[0] ?? original, parts[0] === original ? "unchanged" : "cleaned");

  // "Leila Russo, Leila Russo" — the same name twice.
  if (parts.every((p) => p.toLowerCase() === parts[0].toLowerCase())) {
    return done(parts[0], "cleaned", "repeated-name");
  }

  // Trailing credentials: "Daniel J. Siegel, MD", "Terri Cole, MSW, LCSW".
  let strippedCreds = false;
  while (parts.length > 1 && isCredentialPart(parts[parts.length - 1])) {
    parts = parts.slice(0, -1);
    strippedCreds = true;
  }
  if (parts.length === 1) return done(parts[0], "cleaned", "credentials");

  // Generational suffix as its own trailing part.
  let suffix = "";
  const last = parts[parts.length - 1];
  if (!last.includes(" ") && isSuffix(last)) {
    if (parts.length === 2) {
      // "Horatio Alger, Jr." — already in natural order; the comma is legitimate.
      return strippedCreds
        ? done(parts.join(", "), "cleaned", "credentials")
        : done(original === cleaned ? original : cleaned, original === cleaned ? "unchanged" : "cleaned", "suffix");
    }
    suffix = SUFFIXES[bare(last)];
    parts = parts.slice(0, -1);
  }

  if (parts.length !== 2) return decline("multiple-authors");

  let sTok = parts[0].split(" ").filter(Boolean);
  let gTok = parts[1].split(" ").filter(Boolean);

  // OpenLibrary's mangled "First M., Jr. Last" / "First M., MD Last".
  if (gTok.length >= 2 && (isSuffix(gTok[0]) || CREDENTIALS.has(gTok[0].replace(/\./g, "")))) {
    const lead = gTok[0];
    const rest = gTok.slice(1);
    if ([...sTok, ...rest].every((t) => NAME_TOKEN.test(t) && startsUpper(t)) && !suffix) {
      const tail = isSuffix(lead) ? ` ${SUFFIXES[bare(lead)]}` : "";
      return done(`${sTok.join(" ")} ${rest.join(" ")}${tail}`, "cleaned", "misplaced-suffix");
    }
    return decline("unrecognised-shape");
  }

  // Suffix riding on either half: "King, Martin Luther Jr." / "King Jr., Martin Luther".
  if (!suffix && gTok.length >= 2 && isSuffix(gTok[gTok.length - 1])) {
    suffix = SUFFIXES[bare(gTok[gTok.length - 1])];
    gTok = gTok.slice(0, -1);
  }
  if (!suffix && sTok.length >= 2 && isSuffix(sTok[sTok.length - 1])) {
    suffix = SUFFIXES[bare(sTok[sTok.length - 1])];
    sTok = sTok.slice(0, -1);
  }

  const all = [...sTok, ...gTok];
  if (!all.every((t) => NAME_TOKEN.test(t))) return decline("non-name-characters");
  if (all.some((t) => CORPORATE.has(bare(t)))) return decline("organisation");
  if (all.some((t) => FUNCTION_WORDS.has(t))) return decline("title-or-phrase");
  if (sTok.length > 3 || gTok.length > 4) return decline("too-many-words");

  // The same word on both sides ("Lecrae, Lecrae Moore") is not Last, First.
  const sKeys = new Set(sTok.map(bare));
  if (gTok.some((t) => sKeys.has(bare(t)))) return decline("repeated-word");

  // A "surname" containing an initial is really given names: OL's "First M., Last".
  if (sTok.some((t) => INITIAL.test(t))) {
    if (gTok.length === 1 && !INITIAL.test(gTok[0]) && startsUpper(gTok[0]) && sTok.length <= 3 && !suffix) {
      return done(`${sTok.join(" ")} ${gTok[0]}`, "cleaned", "misplaced-comma");
    }
    return decline("unrecognised-shape");
  }

  // Surname shape: one word, a particle-led phrase, or a two-word surname
  // followed by a single given name ("Conan Doyle, Arthur"). Two full names
  // ("Agatha Christie, Sophie Hannah") fail this and are left alone.
  const surnameOk =
    sTok.length === 1 ||
    isParticle(sTok[0]) ||
    (sTok.length === 2 && gTok.length === 1);
  if (!surnameOk) return decline("multiple-authors");

  if (!sTok.every((t) => startsUpper(t) || isParticle(t))) return decline("lowercase-word");
  if (!gTok.every((t) => startsUpper(t) || isParticle(t))) return decline("lowercase-word");

  // "Fullerton, Georgiana Lady" — a title after the given names.
  if (gTok.length >= 2 && TRAILING_TITLES.has(bare(gTok[gTok.length - 1]))) {
    return decline("trailing-title");
  }

  // Tidy: shouted surnames, and the catalogue's full stop ("Coburn, Andrew.").
  gTok[gTok.length - 1] = dropTrailingPeriod(gTok[gTok.length - 1]);
  if (sTok.every(isAllCaps)) {
    sTok = sTok.map(titleCase);
    if (gTok.every((t) => isAllCaps(t) || INITIAL.test(t))) gTok = gTok.map((t) => (isAllCaps(t) ? titleCase(t) : t));
  }

  const name = `${gTok.join(" ")} ${sTok.join(" ")}${suffix ? ` ${suffix}` : ""}`;
  return done(name, "flipped");
}

/** Normalise one author name to "First Last". Never throws; never returns junk. */
export function normalizeAuthorName(raw: string): string {
  return analyzeAuthorName(raw).name;
}

/**
 * Split a multi-author field into individual, normalised names.
 *
 * `commaSeparated: true` is for sources that list people in natural order
 * joined by commas — StoryGraph's "Authors" column, Goodreads' "Additional
 * Authors", Libby's author cell. There every comma is a separator, except
 * before a generational suffix ("Pascal Covici, Jr.") or a credential
 * (dropped). Names from those sources are never inverted, so nothing is
 * flipped.
 *
 * Without it, only `;` separates and each piece goes through
 * `normalizeAuthorName()` (catalogue sources: "Smith, John; Doe, Jane").
 */
export function splitAuthorList(raw: string, opts: { commaSeparated?: boolean } = {}): string[] {
  const text = collapse(raw ?? "");
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (n: string) => {
    const name = collapse(n);
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };

  for (const chunk of text.split(";")) {
    const piece = collapse(chunk);
    if (!piece) continue;
    if (!opts.commaSeparated) {
      push(normalizeAuthorName(piece));
      continue;
    }
    const role = stripRole(stripDates(stripRole(piece)));
    let current = "";
    for (const part of role.split(",").map((p) => p.trim()).filter(Boolean)) {
      if (current && !part.includes(" ") && isSuffix(part)) {
        current = `${current}, ${SUFFIXES[bare(part)]}`;
      } else if (current && isCredentialPart(part)) {
        // drop the credential
      } else {
        if (current) push(stripRole(current));
        current = part;
      }
    }
    if (current) push(stripRole(current));
  }
  return out;
}

/**
 * Loose comparison key for "is this the same person's name": letters only,
 * de-accented, lowercased. "J.R.R. Tolkien" === "JRR Tolkien" === "J R R Tolkien".
 */
export function authorNameKey(name: string): string {
  return (name ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}]/gu, "");
}
