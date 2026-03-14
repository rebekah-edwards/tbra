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
0 = Not present. Use notes like "No sexual content" if you're confident, or "No information found" if you simply couldn't find data.
1 = Minor — brief, background, or fleeting
2 = Moderate — recurring but not dominant
3 = Major — frequent or central to the story
4 = Extreme — graphic, pervasive, or defining

RULES:
- Be comprehensive: rate ALL 12 categories, no exceptions.
- Be descriptive, not prescriptive: describe what's in the book without judging it as good or bad.
- If you're confident a category is absent, say so clearly (e.g., "No substance use depicted").
- If you can't find information about a category, rate it 0 with notes "No information found".
- Keep notes concise (1-2 sentences max per category).
- For the "user_added" category, always rate 0 with notes "No information found" — this is reserved for user submissions.
- The summary should be 1-2 punchy sentences capturing the book's premise, NOT publisher marketing copy.
- For supplementalTags, suggest community genre labels not in the existing genres (e.g., LitRPG, progression fantasy, cozy mystery, dark academia, romantasy). Only include tags that clearly apply. Return an empty array if no supplemental tags are needed.
- Verify the fiction/nonfiction classification is correct.

Respond with ONLY valid JSON matching this exact schema (no markdown, no code fences):
{
  "summary": "string",
  "isFiction": boolean,
  "supplementalTags": ["string"],
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

  const response = await client.chat.completions.create({
    model: "grok-3-mini",
    messages: [
      {
        role: "user",
        content: buildPrompt(context),
      },
    ],
    temperature: 0.3,
  });

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

  return result;
}
