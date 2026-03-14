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
    key: "lgbtqia_representation",
    name: "LGBTQIA+ representation",
    description:
      "Presence and centrality of LGBTQIA+ characters, relationships, and identity themes.",
  },
  {
    key: "religious_content",
    name: "Religious content",
    description:
      "Overt religiosity, clergy/rituals, conversion themes, devotional framing.",
  },
  {
    key: "witchcraft_occult",
    name: "Witchcraft / occult",
    description:
      "Magic-as-occult framing vs fantasy spellcasting; rituals, summoning, demonology.",
  },
  {
    key: "sexual_content",
    name: "Sexual content",
    description:
      "On-page vs fade-to-black sexual scenes, explicitness, and frequency.",
  },
  {
    key: "violence_gore",
    name: "Violence & gore",
    description:
      "Body horror, torture, graphic description, sexualized violence.",
  },
  {
    key: "political_ideological",
    name: "Political & ideological content",
    description:
      "Political, social, or cultural messaging outside religion. Notes should be descriptive.",
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
    key: "self_harm_suicide",
    name: "Self-harm / suicide",
    description:
      "Ideation vs attempt, on-page depiction of self-harm or suicide.",
  },
  {
    key: "sexual_assault_coercion",
    name: "Sexual assault / coercion",
    description:
      "Threat, coercion, assault, aftermath. Notes kept minimal but clear.",
  },
  {
    key: "abuse_suffering",
    name: "Abuse & suffering",
    description:
      "Child abuse, domestic violence, animal abuse, slavery, and other forms of cruelty or systemic suffering.",
  },
  {
    key: "user_added",
    name: "User-added \u26A0\uFE0F",
    description:
      "Additional content warnings submitted by users that don't fit neatly into other categories.",
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
