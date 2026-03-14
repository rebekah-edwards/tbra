import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import {
  books,
  authors,
  bookAuthors,
  bookCategoryRatings,
  taxonomyCategories,
  genres,
  bookGenres,
  series,
  bookSeries,
} from "./schema";
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

const db = drizzle(sqlite, {
  schema: { books, authors, bookAuthors, bookCategoryRatings, taxonomyCategories, genres, bookGenres, series, bookSeries },
});

const OL_BASE = "https://openlibrary.org";
const COVERS_BASE = "https://covers.openlibrary.org";
const USER_AGENT = "tbra/0.1.0 (https://github.com/rebekah-edwards/tbra)";

// 15 original books + 7 DCC series books
const SEED_QUERIES = [
  "Beloved Toni Morrison",
  "The Great Gatsby",
  "The Hunger Games Suzanne Collins",
  "Dune Frank Herbert",
  "Pride and Prejudice",
  "The Fault in Our Stars John Green",
  "Circe Madeline Miller",
  "The Road Cormac McCarthy",
  "Brave New World",
  "Slaughterhouse-Five Kurt Vonnegut",
  "Jane Eyre",
  "Kindred Octavia Butler",
  "Mexican Gothic Silvia Moreno-Garcia",
  "An American Marriage Tayari Jones",
  "The House in the Cerulean Sea TJ Klune",
  "Dungeon Crawler Carl Matt Dinniman",
  "Carl's Doomsday Scenario Matt Dinniman",
  "The Dungeon Anarchist's Cookbook Matt Dinniman",
  "The Gate of the Feral Gods Matt Dinniman",
  "The Butcher's Masquerade Matt Dinniman",
  "The Eye of the Bedlam Bride Matt Dinniman",
  "The Cage of Dark Hours Matt Dinniman",
];

// Summaries (1-3 sentences each, written from book descriptions)
const BOOK_SUMMARIES: Record<string, string> = {
  "Beloved": "A formerly enslaved woman is haunted by the ghost of her dead daughter in post-Civil War Ohio. Toni Morrison's Pulitzer Prize-winning novel confronts the brutal legacy of slavery and the impossible choices it forced on those who survived it.",
  "The Great Gatsby": "A mysterious millionaire throws extravagant parties on Long Island in the 1920s, all to recapture a lost love. F. Scott Fitzgerald's jazz-age masterpiece exposes the hollowness of the American Dream.",
  "The Hunger Games": "In a dystopian future, sixteen-year-old Katniss Everdeen volunteers to fight to the death in a televised arena to save her younger sister. What begins as survival becomes the spark for a revolution.",
  "Dune": "On a desert planet that produces the most valuable substance in the universe, a young noble must navigate political treachery, religious prophecy, and ecological warfare. Frank Herbert built one of science fiction's most complex and enduring worlds.",
  "Pride and Prejudice": "Five sisters in Regency England navigate love, class, and misunderstanding, anchored by the sharp-witted Elizabeth Bennet and the proud Mr. Darcy. Jane Austen's most beloved comedy of manners.",
  "The Fault in Our Stars": "Two teenagers meet at a cancer support group and fall in love while grappling with mortality, meaning, and the legacy they'll leave behind. A funny and heartbreaking story about the short, beautiful lives we're given.",
  "Circe": "The daughter of the sun god Helios discovers her power of witchcraft and is banished to a remote island, where she encounters legendary figures from Greek mythology. Madeline Miller reimagines Circe's story as one of female defiance and self-discovery.",
  "The Road": "A father and son walk through a burned-out American landscape, pushing a shopping cart and trying to survive. Cormac McCarthy's spare, devastating novel asks what remains of humanity when civilization is gone.",
  "Brave New World": "In a future where humans are engineered, conditioned, and drugged into perfect contentment, one man raised outside the system threatens everything. Aldous Huxley's vision of dystopia through pleasure rather than pain.",
  "Slaughterhouse-Five": "Billy Pilgrim becomes unstuck in time, bouncing between his life as a POW in Dresden during the firebombing and his abduction by aliens. Kurt Vonnegut's darkly comic, anti-war classic.",
  "Jane Eyre": "An orphaned governess falls in love with her brooding employer, only to discover a devastating secret hidden in his house. Charlotte Brontë's gothic romance is a fierce declaration of female independence.",
  "Kindred": "A modern Black woman is repeatedly pulled back in time to antebellum Maryland, where she must protect the life of a white slaveholder to ensure her own existence. Octavia Butler's genre-defying novel makes the horrors of slavery viscerally immediate.",
  "Mexican Gothic": "A glamorous socialite travels to a decaying English mansion in 1950s Mexico to rescue her cousin from a mysterious illness — and discovers something far more sinister growing in the walls. A lush, creepy gothic horror.",
  "An American Marriage": "A young Black couple's life is shattered when the husband is wrongfully convicted of a crime he didn't commit. Tayari Jones explores love, loyalty, and injustice through the intimate lens of a marriage under impossible pressure.",
  "The House in the Cerulean Sea": "A caseworker for a government agency that oversees magical children is sent to evaluate an orphanage on a remote island — where he finds a found family and an unexpected love. A warm, queer-positive fantasy about choosing kindness over fear.",
  "Dungeon Crawler Carl": "When aliens destroy every building on Earth and force the survivors into a lethal, televised dungeon crawl, Carl and his ex-girlfriend's cat must fight their way through increasingly bizarre and deadly floors. A darkly hilarious LitRPG with surprising emotional depth.",
  "Carl's Doomsday Scenario": "Carl and Princess Donut descend to the third floor of the dungeon, where the challenges grow deadlier and the alien audience hungrier for spectacle. The game show dynamics intensify as alliances form and shatter.",
  "The Dungeon Anarchist's Cookbook": "The crawlers reach the fourth floor where the rules change entirely, forcing Carl to navigate faction politics and increasingly absurd combat encounters. The stakes — and the body count — keep rising.",
  "The Gate of the Feral Gods": "Floor five brings open-world exploration and god-tier monsters that push Carl and his allies to their absolute limits. Matt Dinniman expands the world while raising the emotional stakes.",
  "The Butcher's Masquerade": "Carl faces the sixth floor's nightmarish carnival of horrors while the political machinations of the alien producers threaten to destroy everything from the outside. The series hits its darkest and most intense chapter.",
  "The Eye of the Bedlam Bride": "On the seventh floor, Carl confronts the dungeon's most psychologically twisted challenges yet as the truth about the crawl's architects begins to emerge.",
  "The Cage of Dark Hours": "The eighth floor pushes Carl into an entirely new kind of danger as the endgame approaches and the galaxy watches. Everything has been building to this.",
};

// Genre mapping per book
const BOOK_GENRES: Record<string, string[]> = {
  "Beloved": ["Literary Fiction", "Historical Fiction", "Gothic"],
  "The Great Gatsby": ["Literary Fiction", "Classics"],
  "The Hunger Games": ["Young Adult", "Dystopia", "Sci-Fi"],
  "Dune": ["Sci-Fi", "Epic Fantasy", "Adventure"],
  "Pride and Prejudice": ["Romance", "Classics", "Literary Fiction"],
  "The Fault in Our Stars": ["Young Adult", "Romance", "Contemporary"],
  "Circe": ["Fantasy", "Mythology", "Literary Fiction"],
  "The Road": ["Literary Fiction", "Dystopia", "Survival"],
  "Brave New World": ["Sci-Fi", "Dystopia", "Classics"],
  "Slaughterhouse-Five": ["Sci-Fi", "Satire", "War"],
  "Jane Eyre": ["Gothic", "Romance", "Classics"],
  "Kindred": ["Sci-Fi", "Historical Fiction", "Afrofuturism"],
  "Mexican Gothic": ["Horror", "Gothic", "Historical Fiction"],
  "An American Marriage": ["Literary Fiction", "Contemporary", "Romance"],
  "The House in the Cerulean Sea": ["Fantasy", "Romance", "Contemporary"],
  "Dungeon Crawler Carl": ["Fantasy", "Adventure", "Humor", "Sci-Fi"],
  "Carl's Doomsday Scenario": ["Fantasy", "Adventure", "Humor", "Sci-Fi"],
  "The Dungeon Anarchist's Cookbook": ["Fantasy", "Adventure", "Humor", "Sci-Fi"],
  "The Gate of the Feral Gods": ["Fantasy", "Adventure", "Humor", "Sci-Fi"],
  "The Butcher's Masquerade": ["Fantasy", "Adventure", "Humor", "Sci-Fi"],
  "The Eye of the Bedlam Bride": ["Fantasy", "Adventure", "Humor", "Sci-Fi"],
  "The Cage of Dark Hours": ["Fantasy", "Adventure", "Humor", "Sci-Fi"],
};

// All 11 categories for all books
type R = { categoryKey: string; intensity: number; notes: string; evidence: string };

const SAMPLE_RATINGS: Record<string, R[]> = {
  "Beloved": [
    { categoryKey: "lgbtqia_representation", intensity: 0, notes: "No LGBTQIA+ content", evidence: "ai_inferred" },
    { categoryKey: "religious_content", intensity: 1, notes: "Spiritual themes, baby ghost/haunting with religious undertones", evidence: "ai_inferred" },
    { categoryKey: "witchcraft_occult", intensity: 2, notes: "Supernatural haunting, ghost possession central to plot", evidence: "cited" },
    { categoryKey: "sexual_content", intensity: 1, notes: "Some sexual content, mostly implied", evidence: "ai_inferred" },
    { categoryKey: "violence_gore", intensity: 4, notes: "Graphic depictions of slavery violence including whipping, beating, and murder", evidence: "cited" },
    { categoryKey: "political_ideological", intensity: 3, notes: "Deep exploration of slavery's legacy, racial trauma, and dehumanization", evidence: "human_verified" },
    { categoryKey: "profanity_language", intensity: 2, notes: "Moderate strong language, racial slurs in historical context", evidence: "ai_inferred" },
    { categoryKey: "substance_use", intensity: 0, notes: "No significant substance use", evidence: "ai_inferred" },
    { categoryKey: "self_harm_suicide", intensity: 3, notes: "Infanticide as an act of mercy/desperation is central to the plot", evidence: "human_verified" },
    { categoryKey: "sexual_assault_coercion", intensity: 3, notes: "Sexual violence under slavery depicted and discussed", evidence: "cited" },
    { categoryKey: "abuse_suffering", intensity: 4, notes: "Infanticide is central to the plot; children suffer under slavery", evidence: "human_verified" },
  ],
  "The Great Gatsby": [
    { categoryKey: "lgbtqia_representation", intensity: 0, notes: "No explicit LGBTQIA+ content", evidence: "ai_inferred" },
    { categoryKey: "religious_content", intensity: 0, notes: "No religious content", evidence: "ai_inferred" },
    { categoryKey: "witchcraft_occult", intensity: 0, notes: "No occult content", evidence: "ai_inferred" },
    { categoryKey: "sexual_content", intensity: 1, notes: "Implied affairs, nothing explicit", evidence: "ai_inferred" },
    { categoryKey: "violence_gore", intensity: 2, notes: "Hit-and-run death, shooting, not graphically described", evidence: "cited" },
    { categoryKey: "political_ideological", intensity: 2, notes: "Critique of American Dream and class inequality", evidence: "ai_inferred" },
    { categoryKey: "profanity_language", intensity: 1, notes: "Mild language for the era", evidence: "ai_inferred" },
    { categoryKey: "substance_use", intensity: 3, notes: "Heavy alcohol consumption throughout; Prohibition-era parties", evidence: "human_verified" },
    { categoryKey: "self_harm_suicide", intensity: 1, notes: "One character's death has suicidal undertones", evidence: "ai_inferred" },
    { categoryKey: "sexual_assault_coercion", intensity: 1, notes: "Tom's controlling behavior, implied domestic abuse", evidence: "ai_inferred" },
    { categoryKey: "abuse_suffering", intensity: 0, notes: "No abuse or suffering depicted", evidence: "ai_inferred" },
  ],
  "The Hunger Games": [
    { categoryKey: "lgbtqia_representation", intensity: 0, notes: "No LGBTQIA+ content", evidence: "ai_inferred" },
    { categoryKey: "religious_content", intensity: 0, notes: "No religious content", evidence: "ai_inferred" },
    { categoryKey: "witchcraft_occult", intensity: 0, notes: "No occult content", evidence: "ai_inferred" },
    { categoryKey: "sexual_content", intensity: 0, notes: "Kissing only, no sexual content", evidence: "ai_inferred" },
    { categoryKey: "violence_gore", intensity: 3, notes: "Arena combat, child-on-child violence, tracker jacker attacks, burns", evidence: "cited" },
    { categoryKey: "political_ideological", intensity: 2, notes: "Dystopian government critique, class warfare, media manipulation", evidence: "ai_inferred" },
    { categoryKey: "profanity_language", intensity: 0, notes: "No profanity", evidence: "ai_inferred" },
    { categoryKey: "substance_use", intensity: 1, notes: "Haymitch's alcoholism is a character trait", evidence: "ai_inferred" },
    { categoryKey: "self_harm_suicide", intensity: 1, notes: "Brief suicidal ideation during the games", evidence: "ai_inferred" },
    { categoryKey: "sexual_assault_coercion", intensity: 0, notes: "No sexual assault", evidence: "ai_inferred" },
    { categoryKey: "abuse_suffering", intensity: 3, notes: "Children forced to fight to the death; young tributes killed on-page", evidence: "human_verified" },
  ],
  "Dune": [
    { categoryKey: "lgbtqia_representation", intensity: 0, notes: "No LGBTQIA+ content", evidence: "ai_inferred" },
    { categoryKey: "religious_content", intensity: 3, notes: "Messianic prophecy, religious manipulation, Bene Gesserit as quasi-religious order", evidence: "human_verified" },
    { categoryKey: "witchcraft_occult", intensity: 2, notes: "Prescience, Voice, Bene Gesserit abilities border on mystical", evidence: "ai_inferred" },
    { categoryKey: "sexual_content", intensity: 1, notes: "Implied sexual relationships, concubinage, nothing explicit", evidence: "ai_inferred" },
    { categoryKey: "violence_gore", intensity: 3, notes: "Knife fights, war battles, political assassinations", evidence: "cited" },
    { categoryKey: "political_ideological", intensity: 3, notes: "Complex political intrigue, colonialism, resource exploitation themes", evidence: "human_verified" },
    { categoryKey: "profanity_language", intensity: 1, notes: "Mild language", evidence: "ai_inferred" },
    { categoryKey: "substance_use", intensity: 3, notes: "Spice melange is a drug central to the universe — addictive, mind-altering", evidence: "human_verified" },
    { categoryKey: "self_harm_suicide", intensity: 1, notes: "Some characters face death willingly", evidence: "ai_inferred" },
    { categoryKey: "sexual_assault_coercion", intensity: 1, notes: "Bene Gesserit breeding program involves coercive reproduction", evidence: "ai_inferred" },
    { categoryKey: "abuse_suffering", intensity: 1, notes: "Paul is 15 and faces mortal danger throughout", evidence: "ai_inferred" },
  ],
  "Pride and Prejudice": [
    { categoryKey: "lgbtqia_representation", intensity: 0, notes: "No LGBTQIA+ content", evidence: "ai_inferred" },
    { categoryKey: "religious_content", intensity: 1, notes: "Mr. Collins is a clergyman; church attendance is part of social life", evidence: "ai_inferred" },
    { categoryKey: "witchcraft_occult", intensity: 0, notes: "No occult content", evidence: "ai_inferred" },
    { categoryKey: "sexual_content", intensity: 0, notes: "No sexual content; Lydia's elopement is the scandal", evidence: "ai_inferred" },
    { categoryKey: "violence_gore", intensity: 0, notes: "No violence", evidence: "ai_inferred" },
    { categoryKey: "political_ideological", intensity: 1, notes: "Class consciousness and gender roles explored through social comedy", evidence: "ai_inferred" },
    { categoryKey: "profanity_language", intensity: 0, notes: "No profanity", evidence: "ai_inferred" },
    { categoryKey: "substance_use", intensity: 0, notes: "Social drinking only", evidence: "ai_inferred" },
    { categoryKey: "self_harm_suicide", intensity: 0, notes: "No self-harm themes", evidence: "ai_inferred" },
    { categoryKey: "sexual_assault_coercion", intensity: 1, notes: "Wickham's seduction of 15-year-old Lydia, predatory behavior", evidence: "cited" },
    { categoryKey: "abuse_suffering", intensity: 0, notes: "No abuse or suffering depicted", evidence: "ai_inferred" },
  ],
  "The Fault in Our Stars": [
    { categoryKey: "lgbtqia_representation", intensity: 0, notes: "No LGBTQIA+ content", evidence: "ai_inferred" },
    { categoryKey: "religious_content", intensity: 1, notes: "Characters discuss God and meaning of suffering", evidence: "ai_inferred" },
    { categoryKey: "witchcraft_occult", intensity: 0, notes: "No occult content", evidence: "ai_inferred" },
    { categoryKey: "sexual_content", intensity: 2, notes: "One sex scene, tastefully written but present", evidence: "cited" },
    { categoryKey: "violence_gore", intensity: 0, notes: "No violence", evidence: "ai_inferred" },
    { categoryKey: "political_ideological", intensity: 0, notes: "No political content", evidence: "ai_inferred" },
    { categoryKey: "profanity_language", intensity: 2, notes: "Moderate profanity, teenagers swearing naturally", evidence: "ai_inferred" },
    { categoryKey: "substance_use", intensity: 1, notes: "Brief cigarette metaphor, some social drinking", evidence: "ai_inferred" },
    { categoryKey: "self_harm_suicide", intensity: 0, notes: "No self-harm; focuses on terminal illness rather than self-inflicted harm", evidence: "ai_inferred" },
    { categoryKey: "sexual_assault_coercion", intensity: 0, notes: "No sexual assault", evidence: "ai_inferred" },
    { categoryKey: "abuse_suffering", intensity: 2, notes: "Teenagers dying of cancer; emotionally intense depiction of youth suffering", evidence: "human_verified" },
  ],
  "Circe": [
    { categoryKey: "lgbtqia_representation", intensity: 0, notes: "No LGBTQIA+ content", evidence: "ai_inferred" },
    { categoryKey: "religious_content", intensity: 1, notes: "Greek gods are characters, but treated as mythology not devotion", evidence: "ai_inferred" },
    { categoryKey: "witchcraft_occult", intensity: 3, notes: "Witchcraft is central — Circe is a witch who practices pharmakeia", evidence: "human_verified" },
    { categoryKey: "sexual_content", intensity: 2, notes: "Some romantic/sexual scenes, not highly explicit", evidence: "ai_inferred" },
    { categoryKey: "violence_gore", intensity: 2, notes: "Mythological violence — monsters, battles, transformations", evidence: "ai_inferred" },
    { categoryKey: "political_ideological", intensity: 1, notes: "Feminist retelling of mythology, themes of female autonomy", evidence: "ai_inferred" },
    { categoryKey: "profanity_language", intensity: 1, notes: "Minimal profanity", evidence: "ai_inferred" },
    { categoryKey: "substance_use", intensity: 1, notes: "Wine drinking as part of ancient Greek culture", evidence: "ai_inferred" },
    { categoryKey: "self_harm_suicide", intensity: 0, notes: "No self-harm themes", evidence: "ai_inferred" },
    { categoryKey: "sexual_assault_coercion", intensity: 2, notes: "Sexual assault occurs; Circe is raped, motivating her to transform men into pigs", evidence: "cited" },
    { categoryKey: "abuse_suffering", intensity: 1, notes: "Circe's son faces danger; mythological children sometimes threatened", evidence: "ai_inferred" },
  ],
  "The Road": [
    { categoryKey: "lgbtqia_representation", intensity: 0, notes: "No LGBTQIA+ content", evidence: "ai_inferred" },
    { categoryKey: "religious_content", intensity: 1, notes: "Subtle spiritual themes — the boy as a symbol of hope/goodness", evidence: "ai_inferred" },
    { categoryKey: "witchcraft_occult", intensity: 0, notes: "No occult content", evidence: "ai_inferred" },
    { categoryKey: "sexual_content", intensity: 0, notes: "No sexual content", evidence: "ai_inferred" },
    { categoryKey: "violence_gore", intensity: 4, notes: "Post-apocalyptic brutality, cannibalism, corpses described in detail", evidence: "cited" },
    { categoryKey: "political_ideological", intensity: 1, notes: "Subtle environmental/civilizational collapse themes", evidence: "ai_inferred" },
    { categoryKey: "profanity_language", intensity: 1, notes: "Sparse language overall, minimal dialogue", evidence: "ai_inferred" },
    { categoryKey: "substance_use", intensity: 0, notes: "No substance use", evidence: "ai_inferred" },
    { categoryKey: "self_harm_suicide", intensity: 2, notes: "Father contemplates killing himself and his son as mercy; suicidal ideation is a theme", evidence: "ai_inferred" },
    { categoryKey: "sexual_assault_coercion", intensity: 1, notes: "Implied threats in the lawless world", evidence: "ai_inferred" },
    { categoryKey: "abuse_suffering", intensity: 2, notes: "Child in constant danger but not directly harmed on-page", evidence: "ai_inferred" },
  ],
  "Brave New World": [
    { categoryKey: "lgbtqia_representation", intensity: 0, notes: "No LGBTQIA+ content", evidence: "ai_inferred" },
    { categoryKey: "religious_content", intensity: 2, notes: "Ford as deity replacement; organized religion abolished in-world", evidence: "cited" },
    { categoryKey: "witchcraft_occult", intensity: 0, notes: "No occult content", evidence: "ai_inferred" },
    { categoryKey: "sexual_content", intensity: 3, notes: "Casual sex is a societal norm, discussed openly and frequently", evidence: "cited" },
    { categoryKey: "violence_gore", intensity: 1, notes: "Minimal violence; John's self-flagellation", evidence: "ai_inferred" },
    { categoryKey: "political_ideological", intensity: 3, notes: "Heavy dystopian social commentary on consumerism, conformity, and freedom", evidence: "cited" },
    { categoryKey: "profanity_language", intensity: 1, notes: "Mild language", evidence: "ai_inferred" },
    { categoryKey: "substance_use", intensity: 3, notes: "Soma use is central to the plot — state-issued drug for happiness", evidence: "human_verified" },
    { categoryKey: "self_harm_suicide", intensity: 2, notes: "Character commits suicide at the end", evidence: "cited" },
    { categoryKey: "sexual_assault_coercion", intensity: 1, notes: "Social pressure to be sexually available, conditioning of children", evidence: "ai_inferred" },
    { categoryKey: "abuse_suffering", intensity: 2, notes: "Children conditioned/programmed from birth; sexual play among children normalized in-world", evidence: "cited" },
  ],
  "Slaughterhouse-Five": [
    { categoryKey: "lgbtqia_representation", intensity: 0, notes: "No LGBTQIA+ content", evidence: "ai_inferred" },
    { categoryKey: "religious_content", intensity: 1, notes: "Brief religious references, prayer", evidence: "ai_inferred" },
    { categoryKey: "witchcraft_occult", intensity: 0, notes: "No occult content (alien abduction is sci-fi)", evidence: "ai_inferred" },
    { categoryKey: "sexual_content", intensity: 2, notes: "Some sexual scenes including alien zoo scenario", evidence: "cited" },
    { categoryKey: "violence_gore", intensity: 3, notes: "Firebombing of Dresden, war atrocities, death described with dark humor", evidence: "human_verified" },
    { categoryKey: "political_ideological", intensity: 3, notes: "Strong anti-war message; critique of American exceptionalism", evidence: "human_verified" },
    { categoryKey: "profanity_language", intensity: 2, notes: "Moderate profanity throughout", evidence: "ai_inferred" },
    { categoryKey: "substance_use", intensity: 1, notes: "Some drinking", evidence: "ai_inferred" },
    { categoryKey: "self_harm_suicide", intensity: 1, notes: "Fatalistic attitude toward death, 'So it goes'", evidence: "ai_inferred" },
    { categoryKey: "sexual_assault_coercion", intensity: 0, notes: "No sexual assault", evidence: "ai_inferred" },
    { categoryKey: "abuse_suffering", intensity: 1, notes: "Young soldiers, barely adults, in wartime", evidence: "ai_inferred" },
  ],
  "Jane Eyre": [
    { categoryKey: "lgbtqia_representation", intensity: 0, notes: "No LGBTQIA+ content", evidence: "ai_inferred" },
    { categoryKey: "religious_content", intensity: 2, notes: "St. John Rivers' missionary zeal; Jane's personal faith; Brocklehurst's hypocrisy", evidence: "cited" },
    { categoryKey: "witchcraft_occult", intensity: 1, notes: "Gothic atmosphere, mysterious voices, but no actual occult", evidence: "ai_inferred" },
    { categoryKey: "sexual_content", intensity: 1, notes: "Passionate but restrained; Victorian sensibility", evidence: "ai_inferred" },
    { categoryKey: "violence_gore", intensity: 1, notes: "Bertha's attacks, the fire; not graphically described", evidence: "ai_inferred" },
    { categoryKey: "political_ideological", intensity: 2, notes: "Class inequality, women's independence, colonialism (Bertha's background)", evidence: "ai_inferred" },
    { categoryKey: "profanity_language", intensity: 0, notes: "No profanity", evidence: "ai_inferred" },
    { categoryKey: "substance_use", intensity: 0, notes: "No substance use", evidence: "ai_inferred" },
    { categoryKey: "self_harm_suicide", intensity: 0, notes: "No self-harm", evidence: "ai_inferred" },
    { categoryKey: "sexual_assault_coercion", intensity: 1, notes: "Rochester's attempted bigamy is a form of deception/coercion", evidence: "ai_inferred" },
    { categoryKey: "abuse_suffering", intensity: 2, notes: "Jane abused as a child at Gateshead and Lowood; Helen Burns dies young", evidence: "human_verified" },
  ],
  "Kindred": [
    { categoryKey: "lgbtqia_representation", intensity: 0, notes: "No LGBTQIA+ content", evidence: "ai_inferred" },
    { categoryKey: "religious_content", intensity: 0, notes: "No significant religious content", evidence: "ai_inferred" },
    { categoryKey: "witchcraft_occult", intensity: 0, notes: "Time travel is unexplained but not occult", evidence: "ai_inferred" },
    { categoryKey: "sexual_content", intensity: 1, notes: "Interracial marriage discussed; some implied sexuality", evidence: "ai_inferred" },
    { categoryKey: "violence_gore", intensity: 4, notes: "Whipping, beating, slavery violence depicted graphically and unflinchingly", evidence: "human_verified" },
    { categoryKey: "political_ideological", intensity: 3, notes: "Slavery, racial dynamics, complicity, and survival explored in depth", evidence: "human_verified" },
    { categoryKey: "profanity_language", intensity: 2, notes: "Racial slurs in historical context, moderate profanity", evidence: "ai_inferred" },
    { categoryKey: "substance_use", intensity: 0, notes: "No significant substance use", evidence: "ai_inferred" },
    { categoryKey: "self_harm_suicide", intensity: 1, notes: "Characters consider death preferable to slavery", evidence: "ai_inferred" },
    { categoryKey: "sexual_assault_coercion", intensity: 3, notes: "Sexual coercion of enslaved women is a major theme; Rufus assaults Alice", evidence: "cited" },
    { categoryKey: "abuse_suffering", intensity: 2, notes: "Children born into slavery; protagonist protects a child slaveholder", evidence: "ai_inferred" },
  ],
  "Mexican Gothic": [
    { categoryKey: "lgbtqia_representation", intensity: 0, notes: "No LGBTQIA+ content", evidence: "ai_inferred" },
    { categoryKey: "religious_content", intensity: 1, notes: "Catholic references in Mexican setting", evidence: "ai_inferred" },
    { categoryKey: "witchcraft_occult", intensity: 3, notes: "Mycological horror, mind control, eugenics rituals, supernatural possession", evidence: "human_verified" },
    { categoryKey: "sexual_content", intensity: 2, notes: "Some sexual content and disturbing sexual imagery in hallucinations", evidence: "cited" },
    { categoryKey: "violence_gore", intensity: 3, notes: "Body horror, murder, decomposition, fungal infections described vividly", evidence: "human_verified" },
    { categoryKey: "political_ideological", intensity: 2, notes: "Colonialism, eugenics, racism of English family toward Mexican protagonist", evidence: "cited" },
    { categoryKey: "profanity_language", intensity: 1, notes: "Mild language", evidence: "ai_inferred" },
    { categoryKey: "substance_use", intensity: 2, notes: "Drugged food/drink used to control protagonist", evidence: "cited" },
    { categoryKey: "self_harm_suicide", intensity: 1, notes: "Character driven to despair, implied suicidal thoughts", evidence: "ai_inferred" },
    { categoryKey: "sexual_assault_coercion", intensity: 2, notes: "Coercive marriage, non-consensual drugging, attempted forced breeding", evidence: "cited" },
    { categoryKey: "abuse_suffering", intensity: 1, notes: "References to children in eugenics context", evidence: "ai_inferred" },
  ],
  "An American Marriage": [
    { categoryKey: "lgbtqia_representation", intensity: 0, notes: "No LGBTQIA+ content", evidence: "ai_inferred" },
    { categoryKey: "religious_content", intensity: 1, notes: "Southern church culture referenced", evidence: "ai_inferred" },
    { categoryKey: "witchcraft_occult", intensity: 0, notes: "No occult content", evidence: "ai_inferred" },
    { categoryKey: "sexual_content", intensity: 2, notes: "Sexual scenes between married and extramarital partners", evidence: "cited" },
    { categoryKey: "violence_gore", intensity: 1, notes: "Implied violence in prison; not graphically depicted", evidence: "ai_inferred" },
    { categoryKey: "political_ideological", intensity: 3, notes: "Wrongful incarceration of Black man, systemic racism, criminal justice critique", evidence: "human_verified" },
    { categoryKey: "profanity_language", intensity: 2, notes: "Moderate profanity", evidence: "ai_inferred" },
    { categoryKey: "substance_use", intensity: 1, notes: "Social drinking", evidence: "ai_inferred" },
    { categoryKey: "self_harm_suicide", intensity: 0, notes: "No self-harm", evidence: "ai_inferred" },
    { categoryKey: "sexual_assault_coercion", intensity: 2, notes: "Rape accusation is central to plot; prison sexual violence implied", evidence: "cited" },
    { categoryKey: "abuse_suffering", intensity: 0, notes: "No abuse or suffering depicted", evidence: "ai_inferred" },
  ],
  "The House in the Cerulean Sea": [
    { categoryKey: "lgbtqia_representation", intensity: 3, notes: "Gay romance central to the story; positive, affirming portrayal", evidence: "human_verified" },
    { categoryKey: "religious_content", intensity: 0, notes: "No religious content", evidence: "ai_inferred" },
    { categoryKey: "witchcraft_occult", intensity: 1, notes: "Magical children with powers; one child is literally the Antichrist (played for warmth)", evidence: "ai_inferred" },
    { categoryKey: "sexual_content", intensity: 0, notes: "Romantic but chaste; no sexual scenes", evidence: "ai_inferred" },
    { categoryKey: "violence_gore", intensity: 0, notes: "Cozy, no violence", evidence: "ai_inferred" },
    { categoryKey: "political_ideological", intensity: 2, notes: "Allegory for discrimination, bureaucracy, found family vs institutional control", evidence: "human_verified" },
    { categoryKey: "profanity_language", intensity: 0, notes: "Clean language throughout", evidence: "ai_inferred" },
    { categoryKey: "substance_use", intensity: 0, notes: "Tea drinking only", evidence: "ai_inferred" },
    { categoryKey: "self_harm_suicide", intensity: 0, notes: "No self-harm themes", evidence: "ai_inferred" },
    { categoryKey: "sexual_assault_coercion", intensity: 0, notes: "No sexual assault", evidence: "ai_inferred" },
    { categoryKey: "abuse_suffering", intensity: 1, notes: "Children face institutional prejudice and fear; emotionally affecting but not violent", evidence: "ai_inferred" },
  ],
  "Dungeon Crawler Carl": [
    { categoryKey: "lgbtqia_representation", intensity: 1, notes: "Minor LGBTQIA+ side characters", evidence: "ai_inferred" },
    { categoryKey: "religious_content", intensity: 0, notes: "No religious content", evidence: "ai_inferred" },
    { categoryKey: "witchcraft_occult", intensity: 1, notes: "Fantasy/game magic system, not occult framing", evidence: "ai_inferred" },
    { categoryKey: "sexual_content", intensity: 1, notes: "Occasional innuendo, nothing explicit", evidence: "ai_inferred" },
    { categoryKey: "violence_gore", intensity: 4, notes: "Extremely graphic combat, body horror, monster kills described in vivid detail", evidence: "human_verified" },
    { categoryKey: "political_ideological", intensity: 2, notes: "Satire of reality TV and exploitation of suffering for entertainment", evidence: "ai_inferred" },
    { categoryKey: "profanity_language", intensity: 4, notes: "Constant strong profanity throughout — Carl swears relentlessly", evidence: "human_verified" },
    { categoryKey: "substance_use", intensity: 1, notes: "In-game potions and consumables only", evidence: "ai_inferred" },
    { categoryKey: "self_harm_suicide", intensity: 1, notes: "Characters face hopeless situations, minor ideation", evidence: "ai_inferred" },
    { categoryKey: "sexual_assault_coercion", intensity: 0, notes: "No sexual assault content", evidence: "ai_inferred" },
    { categoryKey: "abuse_suffering", intensity: 2, notes: "Children are present in the dungeon and face real danger", evidence: "ai_inferred" },
  ],
};

// DCC series — books 1-7, matched by query prefix
const DCC_SERIES_ORDER: Record<string, number> = {
  "Dungeon Crawler Carl": 1,
  "Carl's Doomsday Scenario": 2,
  "The Dungeon Anarchist's Cookbook": 3,
  "The Gate of the Feral Gods": 4,
  "The Butcher's Masquerade": 5,
  "The Eye of the Bedlam Bride": 6,
  "The Cage of Dark Hours": 7,
};

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function olFetch(url: string) {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!res.ok) throw new Error(`OL fetch failed: ${res.status} ${url}`);
  return res.json();
}

async function findOrCreateAuthor(name: string): Promise<string> {
  const existing = db
    .select()
    .from(authors)
    .where(eq(authors.name, name))
    .get();
  if (existing) return existing.id;
  const [created] = await db.insert(authors).values({ name }).returning();
  return created.id;
}

async function findOrCreateGenre(name: string): Promise<string> {
  const existing = db
    .select()
    .from(genres)
    .where(eq(genres.name, name))
    .get();
  if (existing) return existing.id;
  const [created] = await db.insert(genres).values({ name }).returning();
  return created.id;
}

async function seed() {
  console.log("Seeding books from Open Library...\n");

  // First pass: import books
  const bookIds: Record<string, string> = {}; // ratingKey -> bookId

  for (const query of SEED_QUERIES) {
    await delay(350);
    const params = new URLSearchParams({
      q: query,
      limit: "1",
      fields: "key,title,author_name,first_publish_year,cover_i,number_of_pages_median",
    });
    const searchData = await olFetch(`${OL_BASE}/search.json?${params}`);
    const hit = searchData.docs?.[0];
    if (!hit) {
      console.log(`  Not found: ${query}`);
      continue;
    }

    const key: string = hit.key;
    const ratingKey = Object.keys(SAMPLE_RATINGS).find((k) => query.startsWith(k))
      ?? Object.keys(BOOK_SUMMARIES).find((k) => query.startsWith(k));

    const existing = db
      .select()
      .from(books)
      .where(eq(books.openLibraryKey, key))
      .get();
    if (existing) {
      console.log(`  Already exists: ${existing.title}`);
      if (ratingKey) bookIds[ratingKey] = existing.id;
      continue;
    }

    await delay(350);
    const work = await olFetch(`${OL_BASE}${key}.json`);

    let description: string | null = null;
    if (work.description) {
      description =
        typeof work.description === "string"
          ? work.description
          : work.description.value ?? null;
    }

    const coverId = hit.cover_i ?? work.covers?.[0];
    const coverUrl = coverId ? `${COVERS_BASE}/b/id/${coverId}-L.jpg` : null;
    const title = hit.title || work.title;
    if (!title) {
      console.log(`  No title for: ${query}`);
      continue;
    }

    // Find summary
    const summaryKey = Object.keys(BOOK_SUMMARIES).find((k) => query.startsWith(k));
    const summary = summaryKey ? BOOK_SUMMARIES[summaryKey] : null;

    const [book] = await db
      .insert(books)
      .values({
        title,
        description,
        summary,
        publicationYear: hit.first_publish_year ?? null,
        pages: hit.number_of_pages_median ?? null,
        coverImageUrl: coverUrl,
        openLibraryKey: key,
      })
      .returning();

    const authorNames: string[] = hit.author_name ?? [];
    for (const name of authorNames) {
      const authorId = await findOrCreateAuthor(name);
      await db.insert(bookAuthors).values({ bookId: book.id, authorId }).onConflictDoNothing();
    }

    console.log(`  Added: ${book.title}${authorNames.length ? ` by ${authorNames.join(", ")}` : ""}`);
    if (ratingKey) bookIds[ratingKey] = book.id;
  }

  // Second pass: update summaries for existing books that don't have them
  console.log("\nUpdating summaries...");
  for (const [summaryKey, summary] of Object.entries(BOOK_SUMMARIES)) {
    const bookId = bookIds[summaryKey];
    if (!bookId) continue;
    const book = db.select().from(books).where(eq(books.id, bookId)).get();
    if (book && !book.summary) {
      db.update(books).set({ summary }).where(eq(books.id, bookId)).run();
      console.log(`  Updated summary for ${summaryKey}`);
    }
  }

  // Third pass: genres
  console.log("\nSeeding genres...");
  for (const [ratingKey, bookId] of Object.entries(bookIds)) {
    const genreKey = Object.keys(BOOK_GENRES).find((k) => ratingKey.startsWith(k)) ?? ratingKey;
    const genreNames = BOOK_GENRES[genreKey];
    if (!genreNames) continue;

    const existingGenres = db.select().from(bookGenres).where(eq(bookGenres.bookId, bookId)).all();
    if (existingGenres.length > 0) {
      console.log(`  Genres already set for ${ratingKey}`);
      continue;
    }

    for (const genreName of genreNames) {
      const genreId = await findOrCreateGenre(genreName);
      await db.insert(bookGenres).values({ bookId, genreId }).onConflictDoNothing();
    }
    console.log(`  + ${genreNames.length} genres for ${ratingKey}`);
  }

  // Fourth pass: ratings
  console.log("\nSeeding content ratings...");
  for (const [ratingKey, bookId] of Object.entries(bookIds)) {
    const sampleRatings = SAMPLE_RATINGS[ratingKey];
    if (!sampleRatings) continue;

    db.delete(bookCategoryRatings).where(eq(bookCategoryRatings.bookId, bookId)).run();

    let count = 0;
    for (const rating of sampleRatings) {
      const category = db
        .select()
        .from(taxonomyCategories)
        .where(eq(taxonomyCategories.key, rating.categoryKey))
        .get();
      if (category) {
        await db.insert(bookCategoryRatings).values({
          bookId,
          categoryId: category.id,
          intensity: rating.intensity,
          notes: rating.notes,
          evidenceLevel: rating.evidence,
        });
        count++;
      }
    }
    console.log(`  + ${count} ratings for ${ratingKey}`);
  }

  // Fifth pass: DCC series
  console.log("\nSeeding DCC series...");
  let dccSeries = db.select().from(series).where(eq(series.name, "Dungeon Crawler Carl")).get();
  if (!dccSeries) {
    [dccSeries] = await db.insert(series).values({ name: "Dungeon Crawler Carl" }).returning();
    console.log("  Created series: Dungeon Crawler Carl");
  }

  for (const [prefix, position] of Object.entries(DCC_SERIES_ORDER)) {
    const bookId = bookIds[prefix];
    if (!bookId) {
      console.log(`  Skipping series entry for ${prefix} — not found in DB`);
      continue;
    }

    const existingLink = db
      .select()
      .from(bookSeries)
      .where(eq(bookSeries.bookId, bookId))
      .get();
    if (existingLink) {
      console.log(`  Series link already exists for ${prefix}`);
      continue;
    }

    await db.insert(bookSeries).values({
      bookId,
      seriesId: dccSeries.id,
      positionInSeries: position,
    });
    console.log(`  Linked ${prefix} as Book ${position}`);
  }

  console.log("\nDone!");
  sqlite.close();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
