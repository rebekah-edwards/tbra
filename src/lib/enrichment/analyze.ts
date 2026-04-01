import OpenAI from "openai";
import type { BookContext, EnrichmentResult } from "./types";
import { TAXONOMY_KEYS } from "./types";

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  sexual_content:
    "On-page vs fade-to-black sexual scenes, explicitness, and frequency.",
  violence_gore:
    "Body horror, torture, graphic depictions, and the intensity of violent scenes.",
  profanity_language:
    "Frequency and severity of profanity and strong language.",
  substance_use:
    "Alcohol and drug use — glamorized vs cautionary portrayal, addiction themes.",
  lgbtqia_representation:
    "Presence and centrality of LGBTQIA+ characters, relationships, and identity themes.",
  religious_content:
    "Overt religiosity, clergy/rituals, conversion themes, devotional framing.",
  witchcraft_occult:
    "Magic-as-occult framing vs fantasy spellcasting; rituals, summoning, demonology.",
  political_ideological:
    "Political, social, or cultural messaging — descriptive, not evaluative.",
  self_harm_suicide:
    "Ideation vs attempt, on-page depiction of self-harm or suicide.",
  sexual_assault_coercion:
    "Threat, coercion, assault, and aftermath.",
  abuse_suffering:
    "Child abuse, domestic violence, animal abuse, slavery, and other forms of cruelty or systemic suffering.",
  user_added:
    "Additional content warnings that don't fit neatly into other categories.",
};

function buildPrompt(context: BookContext): string {
  const searchSnippets = context.searchResults
    .map((r) => `[${r.title}]\n${r.description}`)
    .join("\n\n");

  const categoryList = TAXONOMY_KEYS.map(
    (key) => `- ${key}: ${CATEGORY_DESCRIPTIONS[key]}`
  ).join("\n");

  return `You are a book content analyst for a content advisory app. Your job is to analyze a book and produce structured content ratings.

BOOK: "${context.title}" by ${context.authors.join(", ")}
GENRES: ${context.genres.join(", ") || "Unknown"}
CURRENTLY CLASSIFIED AS: ${context.isFiction ? "Fiction" : "Nonfiction"}

BOOK DESCRIPTION (from publisher/Open Library):
${context.description || "No description available."}

WEB RESEARCH RESULTS:
${searchSnippets || "No search results found."}

TASK: Analyze this book across ALL of the following content categories. For each, assign an intensity rating (0-4) and a brief descriptive note.

CATEGORIES:
${categoryList}

INTENSITY SCALE:
0 = Not present
1 = Minor — brief, background, or fleeting
2 = Moderate — recurring but not dominant
3 = Major — frequent or central to the story
4 = Extreme — graphic, pervasive, or defining

RULES:
- ACCURACY IS CRITICAL. Readers rely on these ratings to make informed decisions. A false "not present" for content that IS in the book is worse than an over-rating. When in doubt, rate HIGHER rather than lower.
- CRITICAL: Do NOT rate a category as 0 ("Not present") unless you have POSITIVE EVIDENCE that it is truly absent. If you simply cannot find information about a category in the available search results, rate it 0 but write "No evidence found in available sources" rather than "Not present" or "None depicted". The distinction matters: "Not present" is a factual claim about the book's content; "No evidence found" honestly describes your knowledge. Only confidently say content is "not present" when the book's nature makes it clear (e.g., a children's picture book genuinely has no sexual content, or an adventure novel with no relationship subplot genuinely has no romance). For categories where reviews and descriptions simply don't mention the topic, default to "No evidence found in available sources."
- Be comprehensive: rate ALL 12 categories, no exceptions.
- Look carefully at the search results — content warnings sites, Goodreads reviews, and book discussion forums often mention specific scenes. Pay close attention to mentions of specific scenes, chapters, or plot points that indicate content presence.
- Be descriptive, not prescriptive: describe what's in the book without judging it as good or bad.
- LANGUAGE: NEVER use any "-phobia" or "-phobic" terms for social prejudice or bigotry (homophobia, transphobia, Islamophobia, xenophobia, fatphobia, biphobia, queerphobia, etc.). Use precise, descriptive alternatives instead:
  - homophobia/homophobic → "anti-gay sentiment", "anti-gay slurs"
  - transphobia → "anti-trans sentiment"
  - biphobia → "anti-bisexual sentiment"
  - Islamophobia → "anti-Muslim sentiment"
  - xenophobia → "prejudice against outsiders"
  - fatphobia → "anti-fat bias", "body shaming"
  - queerphobia → "anti-LGBTQ+ sentiment"
  Describe what actually happens in the book. Medical/literal phobias (claustrophobia, agoraphobia) are fine.
- Notes are USER-FACING content labels shown on a mobile app. They MUST be concise:
  - Target 70-90 characters. Maximum 190 characters. Never exceed this.
  - When content IS present: describe WHAT specifically happens (e.g., "Graphic battle scenes with dismemberment; one extended torture sequence", "One primary character mentioned to be gay in passing").
  - When content is ABSENT: use a short phrase ONLY (e.g., "No religious themes present", "No substance use depicted"). Do NOT explain why it is absent.
  - NEVER reference the research process, search results, sources, reviews, or how you found information. Write as if you read the book yourself.
  - NEVER say "sources confirm", "reviews mention", "no information found in research", "research consistently lacks", etc.
- For the "user_added" category, always rate 0 with notes "No information found" — this is reserved for user submissions.
- The summary MUST be 1-2 SHORT sentences, MAX 190 characters total. This is a hard limit — count your characters. Think tagline, not synopsis. NEVER include spoilers — focus on the premise and tone, not plot twists or endings. You may mention themes or how readers interpret the book. Example: "A rogue librarian opens an illegal spellshop on a remote island, juggling stolen magic, local woes, and an unexpected romance." Capture premise and tone in the tightest possible phrasing. Never exceed 190 characters.
- For supplementalTags, suggest UP TO 3 community genre labels not already in the existing genres (e.g., LitRPG, progression fantasy, cozy mystery, dark academia, romantasy, grimdark). Pick only the most distinctive tags — ones that help a reader decide if this book is for them. Avoid redundancy: do not add "Dark Humor" if "Humor" is already a genre, do not add "Adventure" if specific tags like "LitRPG" cover it. Total tags (existing + supplemental) should be 3-6. Return an empty array if existing genres suffice.
- Verify the fiction/nonfiction classification is correct.
- For language: identify the PRIMARY language this edition of the book is written in. Use the full English name (e.g. "English", "Spanish", "French", "German", "Russian", "Japanese", "Chinese"). Look at the title and any available description — if the title is in another language and this appears to be a non-English edition, report that language. If the title is in English and the book is an English-language work, report "English".
- For series: if this book is part of a named series, provide the MOST COMMON English series name and the book's position (number). Use the canonical/official name (e.g. "Harry Potter" not "Harry Potter and the Wizarding World", "The Expanse" not "Expanse"). Position should be the book's number in the main series (e.g. 1 for the first book). Use null if standalone.
- Cross-reference multiple search results to ensure accuracy. If search results disagree, note the discrepancy in relevant category notes.
- For description: If NO book description is provided above (it says "No description available"), look for the publisher's description in the search results. This is typically found in Amazon "About this book" sections, Goodreads book descriptions, or editorial reviews. Extract and return the ORIGINAL publisher text verbatim — do NOT rephrase, summarize, or write your own version. IMPORTANT: Search result snippets are often truncated mid-sentence. If the description you find appears cut off, ends mid-sentence, or is clearly incomplete, return null instead — a missing description is better than a broken one. Only return a description if it reads as a complete, coherent passage. This is separate from the "summary" field.

Respond with ONLY valid JSON matching this exact schema (no markdown, no code fences):
{
  "summary": "string",
  "description": "string | null",
  "isFiction": boolean,
  "language": "string",
  "supplementalTags": ["string"],
  "series": { "name": "string", "position": number | null } | null,
  "ratings": [
    { "categoryKey": "string", "intensity": number, "notes": "string" }
  ]
}`;
}

export async function analyzeBookContent(
  context: BookContext
): Promise<EnrichmentResult> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    throw new Error("[enrichment] XAI_API_KEY not set");
  }

  const client = new OpenAI({
    baseURL: "https://api.x.ai/v1",
    apiKey,
  });

  let response;
  try {
    // 90-second timeout to prevent hanging on stuck API calls
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    response = await client.chat.completions.create(
      {
        model: "grok-3",
        messages: [
          {
            role: "user",
            content: buildPrompt(context),
          },
        ],
        temperature: 0.3,
      },
      { signal: controller.signal }
    );
    clearTimeout(timeout);
  } catch (err: unknown) {
    const status = (err as { status?: number }).status;
    if (status === 429 || status === 402 || status === 403) {
      const error = new Error(`Grok API exhausted (${status})`);
      (error as Error & { code: string }).code = "API_EXHAUSTED";
      throw error;
    }
    if ((err as Error).name === "AbortError") {
      throw new Error("Grok API call timed out after 90 seconds");
    }
    throw err;
  }

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("[enrichment] Empty response from Grok");
  }

  // Strip any markdown code fences if present
  const cleaned = content.replace(/^```(?:json)?\n?/g, "").replace(/\n?```$/g, "").trim();

  const result: EnrichmentResult = JSON.parse(cleaned);

  // Validate all taxonomy keys are present
  const returnedKeys = new Set(result.ratings.map((r) => r.categoryKey));
  for (const key of TAXONOMY_KEYS) {
    if (!returnedKeys.has(key)) {
      result.ratings.push({
        categoryKey: key,
        intensity: 0,
        notes: "No information found",
      });
    }
  }

  // Clamp intensities to 0-4
  for (const rating of result.ratings) {
    rating.intensity = Math.max(0, Math.min(4, Math.round(rating.intensity)));
  }

  // Enforce summary length limit (190 chars max)
  if (result.summary && result.summary.length > 190) {
    console.warn(
      `[enrichment] Summary too long (${result.summary.length} chars), truncating to last complete sentence under 190`
    );
    const text = result.summary;
    // Find the last sentence boundary within 190 chars
    const truncated = text.slice(0, 191);
    const lastSentenceEnd = Math.max(
      truncated.lastIndexOf(". "),
      truncated.lastIndexOf("? "),
      truncated.lastIndexOf("! "),
      truncated.endsWith(".") ? truncated.length - 1 : -1,
      truncated.endsWith("?") ? truncated.length - 1 : -1,
      truncated.endsWith("!") ? truncated.length - 1 : -1,
    );
    if (lastSentenceEnd > 60) {
      result.summary = truncated.slice(0, lastSentenceEnd + 1);
    } else {
      // No good sentence break — use first complete sentence from full text
      const firstSentence = text.match(/^[^.!?]+[.!?]/);
      if (firstSentence && firstSentence[0].length <= 190) {
        result.summary = firstSentence[0];
      } else {
        // Absolute fallback: truncate at last word boundary, add period
        const lastSpace = text.slice(0, 189).lastIndexOf(" ");
        result.summary = lastSpace > 60
          ? text.slice(0, lastSpace).replace(/[,;:\-–—]$/, "").trimEnd() + "."
          : text.slice(0, 188).trimEnd() + ".";
      }
    }
  }

  // Fix common grammar: "a" before vowel sounds → "an"
  if (result.summary) {
    result.summary = result.summary.replace(/\ba\s+([aeiou])/gi, (match, vowel) => {
      return match[0] === "A" ? `An ${vowel}` : `an ${vowel}`;
    });
  }

  return result;
}
