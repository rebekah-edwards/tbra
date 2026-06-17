/**
 * Authoritative genre → top-level-root mapping for the Option-A hierarchy backfill.
 *
 * CANONICAL_ROOTS are the ~50 genres that become the tree roots (parent = NULL).
 * Everything else is classified to exactly one root via classifyToRoot().
 *
 * classifyToRoot uses an ORDERED rule list — first match wins — so priority is
 * encoded by position. Guiding principles:
 *   - Narrative genre beats topic   ("Sports Romance" → Romance, not Sports)
 *   - Narrative genre beats age      ("Young Adult Fantasy" → Fantasy, not YA)
 *   - Format (comics) is a shelf     ("Horror Comics" → Graphic Novel)  [see note]
 *   - Pure age/format tags map to the age root ("Picture Book" → Picture Books)
 *
 * Every choice here is meant to be auditable: the manifest records which rule
 * fired for each genre so a human can spot-check before anything is written.
 */

export const CANONICAL_ROOTS = [
  // ── Fiction ──
  "Literary Fiction", "Contemporary Fiction", "Mystery", "Thriller", "Suspense",
  "Crime", "Horror", "Romance", "Fantasy", "Sci-Fi", "LitRPG", "Historical Fiction",
  "Speculative Fiction", "Dystopian", "Adventure", "Western", "Humor", "Satire",
  "Christian Fiction", "Amish Fiction", "Graphic Novel", "Short Stories", "Anthology",
  "Drama", "Poetry", "Classics", "Magical Realism", "Superhero", "Women's Fiction",
  "New Adult", "Erotica", "Urban Fiction",
  // shared (fiction + nonfiction)
  "Mythology", "Sports",
  // ── Non-fiction ──
  "Biography", "Memoir", "History", "Politics", "Religion", "Christian Nonfiction",
  "Philosophy", "Psychology", "Self-Help", "Business", "Economics", "Science",
  "Technology", "Nature", "Health", "Cookbooks", "Travel", "True Crime", "Essays",
  "Arts", "Music", "Film", "Education", "Reference", "Parenting", "Society",
  // ── Children's age categories ──
  "Picture Books", "Early Readers", "Chapter Books", "Middle Grade", "Young Adult",
  "Children's",
] as const;

export type Root = (typeof CANONICAL_ROOTS)[number];
const ROOT_SET = new Set<string>(CANONICAL_ROOTS);

// Variant spellings of a ROOT name → the canonical root. Applied to the genre's
// OWN name first (so "Science Fiction" the row becomes the Sci-Fi root, etc.).
export const ROOT_ALIASES: Record<string, Root> = {
  "Science Fiction": "Sci-Fi", "science fiction": "Sci-Fi", "SciFi": "Sci-Fi",
  "Dystopia": "Dystopian", "Crime Fiction": "Crime", "Comics": "Graphic Novel",
  "Graphic Novels": "Graphic Novel", "Comic Book": "Graphic Novel", "Comic": "Graphic Novel",
  "Manga": "Graphic Novel", "Nonfiction": "Society", "Non-Fiction": "Society",
  "Children's Literature": "Children's", "Picture Book": "Picture Books",
  "Early Reader": "Early Readers", "Chapter Book": "Chapter Books",
  "Autobiography": "Memoir", "Cookbook": "Cookbooks", "Self Help": "Self-Help",
  "GameLit": "LitRPG", "Gamelit": "LitRPG", "Sci-Fi": "Sci-Fi",
};

// Ordered rules. First regex to match the genre name wins.
const RULES: [RegExp, Root][] = [
  // 0. Romantasy / afrofuturism — pin before broad families
  [/romantasy/i, "Fantasy"],
  [/afro-?futurism|african-?futurism/i, "Sci-Fi"],

  // 1. LitRPG / progression / light novel — most specific
  [/litrpg|gamelit|\brpg\b|dungeons? ?& ?dragons|tabletop|game ?supplement|progression fantasy|isekai|light novel/i, "LitRPG"],

  // 2. Format: comics / graphic novels / manga (NOT "comic fantasy"=humorous)
  [/\bcomics\b|graphic novel|\bmanga\b|comic book|comic strip|comic art|webcomic|seinen|shonen|shoujo/i, "Graphic Novel"],

  // 3. Romance (wins over everything: "Historical Romance", "Sports Romance", "Romantic Comedy"…)
  [/romance|romantic|rom-?com|enemies.?to.?lovers|friends.?to.?lovers|second.?chance|fake (dating|relationship|marriage)|forced proximity|forbidden (love|romance)|slow ?burn|grumpy.?sunshine|opposites attract|reverse harem|age gap|marriage of convenience|billionaire|mafia|shifter romance|\bmm\b|chick lit/i, "Romance"],

  // 4. Mystery / Thriller / Crime / Suspense family
  [/\bthriller\b|espionage|\bspy\b|techno-?thriller|conspiracy/i, "Thriller"],
  [/mystery|detective|sleuth|whodunit|police procedural|locked.?room|murder mystery|cozy mystery|amateur sleuth/i, "Mystery"],
  [/\bnoir\b|hard-?boiled|true crime/i, "True Crime"], // refined below for fiction-noir
  [/\bcrime\b|organized crime|criminal|heist|mafia/i, "Crime"],
  [/suspense/i, "Suspense"],

  // 5. Horror / supernatural
  [/horror|gothic|slasher|splatterpunk|lovecraft|zombie|vampire|werewolf|\bghost|haunted|supernatural|monster|kaiju|creature feature|occult|witchcraft|eldritch/i, "Horror"],

  // 6. Dystopian / post-apocalyptic
  [/dystopia|post-?apocalyp|apocalyp/i, "Dystopian"],

  // 7. Sci-Fi
  [/sci-?fi|science ?fiction|\bspace\b|cyberpunk|\balien|robot|mecha|android|cyborg|time travel|time loop|multiverse|virtual reality|transhuman|first contact|interstellar|galactic|martian|steampunk|climate fiction|cli-?fi|eco-?fiction|near-?future|genetic engineering|artificial intelligence/i, "Sci-Fi"],

  // 8. Mythology / folklore (before Fantasy so "Greek Mythology" → Mythology)
  [/mytholog|\bmyth\b|folklore|folktale|fairy ?tale|fairytale|legend|arthurian|norse|fable|nursery rhyme/i, "Mythology"],

  // 9. Superhero
  [/superhero|super-?hero|\bmarvel\b|\bx-men\b|mutant|vigilante|super-?power|kaiju/i, "Superhero"],

  // 10. Fantasy
  [/fantasy|grimdark|sword ?(and|&) ?(sorcery|planet)|\bmagic|dragon|\bfae\b|faerie|\belf\b|elves|wizard|witch|paranormal|urban fantasy|epic fantasy|portal/i, "Fantasy"],

  // 11. Western
  [/western|cowboy|frontier|weird west|pioneer/i, "Western"],

  // 12. Children's: pure age / format (genre combos already handled above)
  [/picture book|board book|early reader|easy reader|chapter book|bedtime|nursery|sticker book|coloring book|activity book|early learning|early childhood|toddler|sing-?along|rhyming|young readers|juvenile|all.?ages|interactive (book|story|storybook|journal|learning|fiction)/i, "Children's"],
  [/middle grade/i, "Middle Grade"],
  [/young adult|\bya\b|\bteen\b|new adult/i, "Young Adult"], // NA folded to YA unless pure "New Adult"
  [/children'?s|kids|for kids|school stor/i, "Children's"],

  // 13. Christian — fiction vs nonfiction
  [/(christian|biblical|bible|scripture).*(?<!non-?)(?<!non )fiction|(christian|biblical|bible|scripture).*(allegory|retelling|parable)|christian (fiction|allegory)|biblical fiction|religious fiction|spiritual fiction|inspirational fiction/i, "Christian Fiction"],
  [/christian|biblical|\bbible\b|devotional|theolog|gospel|scripture|sermon|prayer|ministry|discipleship|evangel|apologetic|missionary|missions\b|prophetic|eschatolog|revival|charismatic|\bchurch\b|spiritual (growth|warfare|guidance|journey|memoir|healing|literature|self-help)|biblical (studies|commentary|criticism|analysis|retelling)|spiritual (?!fiction)/i, "Christian Nonfiction"],
  [/religion|religious|islam|judaism|buddhis|hindu|jewish (studies|literature)|comparative religion|mysticism|occult(?!.*fiction)|new age|metaphysical|esoteric/i, "Religion"],

  // 14. History (fiction combos already handled)
  [/historical fiction|historical (drama|literature|saga)/i, "Historical Fiction"],
  [/history|historical|civil war|world war|wwi|wwii|ancient|medieval (history|studies|literature)|colonial|renaissance|holocaust|prehistoric|\bcentury\b|civilizations?/i, "History"],

  // 15. Biography / Memoir
  [/memoir|autobiograph/i, "Memoir"],
  [/biograph/i, "Biography"],

  // 16. Poetry  (\bverse\b so "Universe" doesn't match)
  [/poetry|\bpoem|\bverse\b|sonnet|haiku/i, "Poetry"],

  // 17. Cookbooks / food
  [/cookbook|recipe|culinary (arts)?|cooking|baking|food (writing|history|& ?drink|and drink)/i, "Cookbooks"],

  // 18. Sports
  [/\bsports?\b|baseball|basketball|\bfootball\b|soccer|\bracing\b|motorsport|martial arts/i, "Sports"],

  // 19. Science / Nature / Health
  [/wildlife|nature writing|conservation|sustainability|ecolog|environmentalis|environmental (science|studies|education|nonfiction|literature)|natural history|botany|marine (biology|life)|zoolog|animals?\b|\bpets?\b/i, "Nature"],
  [/health|nutrition|\bdiet\b|fitness|exercise|wellness|mental health|medical(?! (thriller|drama|fiction))|medicine|nursing|recovery|addiction|mindfulness|meditation|therapy|grief|trauma|self-?care|healthy eating/i, "Health"],
  [/science|scientific|physics|chemistry|biology|astronomy|geology|paleontolog|neuroscience|genetics?|mathematics|engineering|astrophysics|earth science|cryptozoolog|cartography|geography|aviation(?! history)/i, "Science"],

  // 20. Technology
  [/technolog|computer science|programming|software|cybersecurity|gaming(?! fiction)|game design|artificial intelligence|automotive|transportation|trains|firearms/i, "Technology"],

  // 21. Psychology / Self-Help  (narrow: don't grab "Psychological Drama/Fiction")
  [/psychology|psychological (research|study|studies|profile|analysis)|behavioral (science|economics|psychology)|social psychology|cognitive|popular psychology|forensic psychology|criminal psychology|parapsychology/i, "Psychology"],
  [/self-?help|personal (development|growth|narrative|essays?|finance)|motivational|productivity|habits|empowerment|relationship advice|dating advice|marriage (advice|counseling)|career (guide|development|advice)|communication skills|conflict resolution|emotional intelligence|counseling|life coaching/i, "Self-Help"],

  // 22. Business / Economics
  [/economic|behavioral economics/i, "Economics"],
  [/business|entrepreneur|management|leadership|marketing|investing|\bfinance\b|personal finance|negotiation|organizational|human resources|innovation|\bstrateg|workplace(?! romance)/i, "Business"],

  // 23. Politics / Society
  [/politic|public policy|international relations|civil rights|social justice|activism|feminis|gender studies|race studies|human rights|criminolog|criminal justice|law enforcement|public affairs|current (affairs|events)|war\b(?! (fiction|story|stories|drama|comics|literature))/i, "Politics"],
  [/sociolog|anthropolog|cultural (studies|criticism|analysis|critique|commentary|identity|heritage|diversity|conflict|exploration)|urban studies|media studies|social (science|history|realism)|ethnograph|genealog|community|immigrant|immigration|diversity|multicultural|society|social issues|relationships?\b|family & relationships|marriage\b|parenting|\bfamily\b(?! (drama|saga|story|stories|adventure|activities|themes))/i, "Society"],

  // 24. Arts / Music / Film
  [/\bart\b|art (history|book|instruction|criticism|therapy|and design)|visual arts|fine art|illustration|\bdesign\b|architecture|photograph|painting|drawing|typography|crafts?|diy|hobby|hobbies|gardening|sewing|knitting/i, "Arts"],
  [/\bmusic|country music|musical(?! tie)|opera|jazz|classical music|songwrit/i, "Music"],
  [/\bfilm\b|cinema|\bmovie|hollywood|television|\btv\b|theatre|theater|performing arts|\bdance\b|screenwrit|entertainment|celebrity/i, "Film"],

  // 25. Reference / Education
  [/reference|textbook|study guide|exam|test prep|encyclopedia|dictionary|\bmanual\b|handbook|how-?to|instructional|tutorial|language learning|linguistics|writing (guide|craft|advice)|academic (writing|research|text|study|criticism|nonfiction)|technical (guide|manual|reference)|legal (guide|reference|nonfiction|education|studies|history)|career guide|professional (development|guide)/i, "Reference"],
  [/education|teaching|homeschool|curriculum|stem\b|classroom|child development|learning|pedagog|exam preparation/i, "Education"],

  // 26. Travel
  [/travel|travelogue/i, "Travel"],

  // 27. Essays / literary nonfiction / journalism
  [/essays?|literary (criticism|analysis|nonfiction|essays)|critical analysis|creative nonfiction|journalism|investigative|interviews|personal essays|book discussion|books about books|bibliophil/i, "Essays"],

  // 28. Philosophy  (don't grab "Philosophical Fiction")
  [/philosophy|philosophical (?!fiction)|ethics|bioethics|existential(?!.*fiction)|metaphysics|moral philosophy|political (philosophy|theory)/i, "Philosophy"],

  // 29. Humor / Satire
  [/satir|parody/i, "Satire"],
  [/comedy|humor|humorous|comic (fantasy|fiction)|absurdis|slapstick|farce|witty|joke book|trivia|brain teaser|word game|puzzle/i, "Humor"],

  // 30. Drama (after Romance/History/Medical-as-Health handled)
  [/drama|melodrama|tragedy|tragic|courtroom|teleplay|stage play|playscript/i, "Drama"],

  // 31. Adventure / Action / Survival
  [/adventure|\baction\b|survival|exploration|swashbuckl|pirate|\bquest\b|nautical|maritime|treasure|expedition|disaster/i, "Adventure"],

  // 32. Erotica
  [/erotic|erotica/i, "Erotica"],

  // 33. Urban / Women's
  [/women'?s fiction|domestic fiction/i, "Women's Fiction"],
  [/women'?s (issues|studies|history|spirituality|ministry)/i, "Society"],
  [/urban fiction|urban drama|street lit/i, "Urban Fiction"],

  // 33b. War / military fiction (genre combos already routed above)
  [/military fiction|war (fiction|story|stories|literature)|\bmilitary\b/i, "Historical Fiction"],

  // 33c. Media tie-ins / adaptations
  [/comic (adaptation|inspired)|crossover/i, "Graphic Novel"],
  [/tie-?in|adaptation|cartoon|animated|\bdisney\b|star wars|star trek|behind-the-scenes|\bcompanion\b|nostalgia/i, "Film"],

  // 33d. Retellings → Mythology (fairy-tale/myth retellings dominate)
  [/retelling/i, "Mythology"],

  // 33e. Kid-leaning formats / themes
  [/anthropomorphic|princess stor|school (life|story|stories)|illustrated|interactive|animal (characters?|protagonists?)|friendship/i, "Children's"],

  // 33f. Spirituality (non-Christian-specific)
  [/spiritualit|\bspiritual\b/i, "Religion"],

  // 34. Literary catch-alls
  [/literary fiction|metafiction|postmodern|modernist|experimental|avant-?garde|bildungsroman|magical realism|surreal|allegor|epistolary|character (study|driven)|philosophical fiction|social commentary|coming.?of.?age|dark academia|family saga|stream of consciousness|picaresque|antihero|anti-?hero/i, "Literary Fiction"],

  // 35. Short form
  [/novella|short stor|short fiction/i, "Short Stories"],
  [/anthology|collection|omnibus/i, "Anthology"],

  // 36. Classics
  [/classic|canon\b/i, "Classics"],

  // 37. LGBTQ+ (no clearer genre signal) → Literary Fiction by default
  [/lgbtq|queer|gay\b|lesbian/i, "Literary Fiction"],

  // 38. Generic "fiction"/"drama-ish" residue → Contemporary Fiction
  [/contemporary|realistic fiction|domestic|slice of life|small ?town|rural|regional fiction|southern fiction|heartwarming|emotional|cozy|beach read|book club|women'?s|holiday/i, "Contemporary Fiction"],

  // 33g. Final niche mappings (clearly-placeable low-frequency tags)
  [/\bamish\b/i, "Amish Fiction"],
  [/halloween|spooky|creepy/i, "Horror"],
  [/christmas|holiday/i, "Contemporary Fiction"],
  [/role-?playing game/i, "LitRPG"],
  [/mythical creature|lost world|court intrigue|new weird|royal(ty)?/i, "Fantasy"],
  [/futurism/i, "Sci-Fi"],
  [/outdoor|wilderness/i, "Nature"],
  [/environmental|climate/i, "Nature"],
  [/creative writing|\bwriting\b/i, "Reference"],
  [/communication|social skills/i, "Self-Help"],
  [/home improvement|interior design/i, "Arts"],
  [/men'?s issues|social criticism|diversity/i, "Society"],
  [/\blaw\b|legal/i, "Reference"],
  [/comic-?inspired|origin story/i, "Graphic Novel"],
  [/prophecy|prophetic|redemption|scripture/i, "Christian Nonfiction"],
  [/family (stories|story|themes|activities|dynamics)|moral tale|nursery|rhyme/i, "Children's"],
  [/medieval|american revolution|victorian era|\bera\b|dynasty/i, "History"],
  [/dinosaur|prehistoric/i, "Science"],
  [/\bstories?\b/i, "Children's"], // last-resort: bare "X Stories" → Children's

  // 39. Broadest catch-alls — must stay LAST so specific rules win.
  [/literature/i, "Literary Fiction"],         // "American/Victorian/Irish… Literature"
  [/\bstudies\b|\bstudy\b/i, "Society"],         // "X Studies"
  [/\bguide\b|guidebook|nonfiction guide/i, "Reference"],
  [/\bfiction\b/i, "Contemporary Fiction"],     // any remaining "X Fiction"
  [/\bnonfiction\b|non-?fiction/i, "Society"],   // any remaining "X Nonfiction"
];

// Hard overrides for high-traffic tags where the generic rule would mis-fire.
// (book counts noted; reviewed by hand)
export const OVERRIDES: Record<string, Root> = {
  "Action": "Adventure",              // 4649
  "Action Adventure": "Adventure",
  "Action-Adventure": "Adventure",
  "Educational": "Education",         // 2679
  "Children's Nonfiction": "Children's", // 1587
  "Children's Fiction": "Children's",
  "Noir": "Crime",                    // 639 — fiction-noir, not True Crime
  "Crime Noir": "Crime", "Neo-Noir": "Crime", "Nordic Noir": "Crime", "Southern Noir": "Crime",
  "Hardboiled": "Crime", "Hard-Boiled": "Crime", "Hardboiled Mystery": "Mystery",
  "Family Drama": "Drama",            // 943
  "New Adult": "New Adult",           // 555 — keep distinct root
  "Mythology": "Mythology",
  "Superhero": "Superhero", "Superheroes": "Superhero", "Superhero Fiction": "Superhero",
  "Comedy": "Humor", "Dark Comedy": "Humor", "Dark Humor": "Humor", "Black Comedy": "Humor",
  "Media Tie-in": "Graphic Novel", "Media Tie-In": "Graphic Novel",
  "Animal Stories": "Children's", "Animal Story": "Children's", "Animal Books": "Children's",
  "Pulp Fiction": "Crime", "Pulp": "Adventure", "Pulp Adventure": "Adventure",
  "Found Family": "Contemporary Fiction", // trope, no genre signal
  "Inspirational": "Christian Fiction",  // 2141 — consistent w/ existing taxonomy
  "Spirituality": "Religion",            // 923
  "Dark Fiction": "Literary Fiction",    // 419
  "Academic": "Reference",               // 247
  "Pop Culture": "Society",              // 213
  "Epic": "Fantasy", "Epic Saga": "Fantasy", "Epic Fiction": "Fantasy", // epics ≈ fantasy here
  "Archaeology": "History",              // 62
  "Creativity": "Self-Help", "Lifestyle": "Health", "Counterculture": "Society",
  "Afrofuturism": "Sci-Fi", "Africanfuturism": "Sci-Fi",
  "Team Dynamics": "Society", "Teamwork": "Society", "Team-Up": "Superhero",
  "Political Science": "Politics",       // not Science
  "Biographical Fiction": "Literary Fiction", "Biographical Novel": "Literary Fiction",
  "Autobiographical Fiction": "Literary Fiction",
  "Heist Fantasy": "Fantasy",
  "Historical": "Historical Fiction", "Historical Adventure": "Historical Fiction",
  "Historical Biography": "Biography",
  "Environmental Fiction": "Sci-Fi", "Eco-Fiction": "Sci-Fi",
  "Psychological Fiction": "Literary Fiction", "Psychological Drama": "Drama",
  "Philosophical Fiction": "Literary Fiction",
  "Classical Studies": "History", "Classical Literature": "Classics",
};

/**
 * Classify a genre name to a canonical root.
 * Returns { root, source }. source ∈ root | alias | override | rule | null.
 */
export function classifyToRoot(name: string): {
  root: Root | null;
  source: "root" | "alias" | "override" | "rule" | "unmapped";
} {
  if (ROOT_SET.has(name)) return { root: name as Root, source: "root" };
  if (ROOT_ALIASES[name]) return { root: ROOT_ALIASES[name], source: "alias" };
  if (OVERRIDES[name]) return { root: OVERRIDES[name], source: "override" };
  for (const [re, root] of RULES) {
    if (re.test(name)) return { root, source: "rule" };
  }
  return { root: null, source: "unmapped" };
}
