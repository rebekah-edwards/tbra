import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { taxonomyCategories } from "./schema";
import path from "path";
import fs from "fs";

const dataDir = path.join(process.cwd(), "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "tbra.db");
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

const db = drizzle(sqlite);

const categories = [
  {
    key: "romance_sex",
    name: "Romance & sex",
    description:
      "On-page vs fade-to-black romantic and sexual content, including explicitness and frequency. Notes may include sexual-assault context where relevant.",
  },
  {
    key: "violence_gore",
    name: "Violence & gore",
    description:
      "Body horror, torture, graphic description, sexualized violence.",
  },
  {
    key: "profanity_language",
    name: "Profanity / language",
    description: "Frequency and severity of profanity and strong language.",
  },
  {
    key: "substance_use",
    name: "Substance use",
    description:
      "Alcohol/drugs: glamorized vs cautionary portrayal, addiction themes.",
  },
  {
    key: "lgbtqia_representation",
    name: "LGBTQ+ representation",
    description:
      "Presence and centrality of LGBTQ+ characters, relationships, and identity themes.",
  },
  {
    key: "religious_content",
    name: "Religious content",
    description:
      "Overt religiosity, clergy/rituals, conversion themes, devotional framing.",
  },
  {
    key: "magic_witchcraft",
    name: "Magic & witchcraft",
    description:
      "Fantasy magic, witchcraft, and spellcasting as story elements (e.g., Harry Potter). Does not include real-world occult or demonology — see Occult / Demonology.",
  },
  {
    key: "occult_demonology",
    name: "Occult / demonology",
    description:
      "Real-world occult content, Wicca, demons, demonology, rituals, séances, divination, or ritual magic. Distinct from fantasy magic — see Magic / Witchcraft.",
  },
  {
    key: "political_ideological",
    name: "Political & ideological content",
    description:
      "Political, social, or cultural messaging outside religion. Notes should be descriptive.",
  },
  {
    key: "self_harm_suicide",
    name: "Self-harm / suicide",
    description:
      "Ideation vs attempt, on-page depiction of self-harm or suicide.",
  },
  {
    key: "abuse_suffering",
    name: "Abuse & suffering",
    description:
      "Child abuse, domestic violence, animal abuse, slavery, sexual assault, and other forms of cruelty or systemic suffering.",
  },
  {
    key: "other",
    name: "Other",
    description:
      "Additional content details and trigger warnings that don't fit the other categories (e.g., eating disorders, anti-obesity content, medical trauma).",
  },
  // Retained inactive for historical rows; the 2026-04-17 migration consolidated
  // sexual-assault context into abuse_suffering and romance_sex notes.
  {
    key: "sexual_assault_coercion",
    name: "Sexual assault / coercion (archived)",
    description:
      "Archived 2026-04-17. Content merged into Romance & Sex and Abuse & suffering notes.",
    active: false,
  },
];

async function seed() {
  console.log("Seeding taxonomy categories...");

  for (const cat of categories) {
    await db
      .insert(taxonomyCategories)
      .values(cat)
      .onConflictDoNothing({ target: taxonomyCategories.key });
  }

  console.log(`Seeded ${categories.length} taxonomy categories.`);
  sqlite.close();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
