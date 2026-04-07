import type { Metadata } from "next";
export const revalidate = 3600;


export const metadata: Metadata = {
  title: "How We Rate Books | The Based Reader App",
  description: "Learn how tbr*a rates books across content categories with our transparent methodology, intensity scale, and evidence-based approach.",
  openGraph: {
    title: "How We Rate Books | The Based Reader App",
    description: "Learn how tbr*a rates books across content categories with our transparent methodology, intensity scale, and evidence-based approach.",
  },
};

const INTENSITY_LEVELS = [
  { level: 0, label: "None", description: "Not present in the book", color: "bg-intensity-0" },
  { level: 1, label: "Minor", description: "Brief, background, or fleeting", color: "bg-intensity-1" },
  { level: 2, label: "Moderate", description: "Recurring but not dominant", color: "bg-intensity-2" },
  { level: 3, label: "Major", description: "Frequent or central to the story", color: "bg-intensity-3" },
  { level: 4, label: "Extreme", description: "Graphic, pervasive, or defining", color: "bg-intensity-4" },
];

const CATEGORIES = [
  {
    name: "Sexual content",
    description: "On-page vs fade-to-black sexual scenes, explicitness, and frequency.",
  },
  {
    name: "Violence & gore",
    description: "Body horror, torture, graphic depictions, and the intensity of violent scenes.",
  },
  {
    name: "Profanity / language",
    description: "Frequency and severity of profanity and strong language.",
  },
  {
    name: "Substance use",
    description: "Alcohol and drug use — glamorized vs cautionary portrayal, addiction themes.",
  },
  {
    name: "LGBTQ+ representation",
    description: "Presence and centrality of LGBTQ+ characters, relationships, and identity themes.",
  },
  {
    name: "Religious content",
    description: "Overt religiosity, clergy/rituals, conversion themes, devotional framing.",
  },
  {
    name: "Witchcraft / occult",
    description: "Magic-as-occult framing vs fantasy spellcasting; rituals, summoning, demonology.",
  },
  {
    name: "Political & ideological content",
    description: "Political, social, or cultural messaging. Notes are always descriptive, never evaluative.",
  },
  {
    name: "Self-harm / suicide",
    description: "Ideation vs attempt, on-page depiction of self-harm or suicide.",
  },
  {
    name: "Sexual assault / coercion",
    description: "Threat, coercion, assault, and aftermath.",
  },
  {
    name: "Abuse & suffering",
    description: "Child abuse, domestic violence, animal abuse, slavery, and other forms of cruelty or systemic suffering.",
  },
  {
    name: "User-added",
    description: "Additional content warnings submitted by users that don't fit neatly into other categories.",
  },
];

export default function MethodologyPage() {
  return (
    <div className="pb-12">
      <h1 className="text-foreground text-2xl font-bold sm:text-3xl">How We Rate Books</h1>
      <p className="mt-4 text-base leading-relaxed text-foreground/80">
        tbr*a provides detailed, structured content information for books — not
        star ratings, not subjective reviews. We tell you exactly what&apos;s in
        a book so you can decide what matters to you.
      </p>

      {/* Philosophy */}
      <section className="mt-10">
        <h2 className="section-heading text-xl">Our Approach</h2>
        <div className="mt-4 space-y-3 text-sm leading-relaxed text-foreground/80">
          <p>
            <strong className="text-foreground">Descriptive, not prescriptive.</strong>{" "}
            We describe what&apos;s in a book without telling you whether
            it&apos;s good or bad. &ldquo;Contains progressive gender
            themes&rdquo; is information. &ldquo;Contains traditional family
            values&rdquo; is information. The reader decides what matters.
          </p>
          <p>
            <strong className="text-foreground">Intensity + specificity.</strong>{" "}
            Not just &ldquo;violence present&rdquo; but how much, how graphic,
            and in what context. Every category gets a 0&ndash;4 intensity
            rating plus descriptive notes for anything above minor.
          </p>
          <p>
            <strong className="text-foreground">Transparent sourcing.</strong>{" "}
            Every content claim carries an evidence level so you know how
            confident we are. AI-assisted first passes are refined by human
            editors who&apos;ve actually read the book.
          </p>
        </div>
      </section>

      {/* Intensity Scale */}
      <section className="mt-10">
        <h2 className="section-heading text-xl">Intensity Scale</h2>
        <p className="mt-2 text-sm text-foreground/80">
          Each category is rated on a 0&ndash;4 scale. Descriptive notes are
          required for any rating of 2 or higher.
        </p>
        <div className="mt-4 space-y-2">
          {INTENSITY_LEVELS.map((level) => (
            <div key={level.level} className="flex items-start gap-3">
              <div className="mt-1 flex w-20 gap-0.5 flex-shrink-0">
                {[0, 1, 2, 3].map((segment) => (
                  <div
                    key={segment}
                    className={`h-1.5 flex-1 rounded-full ${
                      segment < level.level ? level.color : "bg-surface-alt"
                    }`}
                  />
                ))}
              </div>
              <div>
                <span className="text-sm font-medium">{level.level} &mdash; {level.label}</span>
                <p className="text-xs text-muted">{level.description}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Evidence Levels */}
      <section className="mt-10">
        <h2 className="section-heading text-xl">Evidence Levels</h2>
        <p className="mt-2 text-sm text-foreground/80">
          Every content claim is tagged with how we know it.
        </p>
        <div className="mt-4 space-y-3">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex flex-shrink-0 rounded-full bg-surface-alt px-2 py-0.5 text-[10px] font-medium text-muted">
              AI
            </span>
            <div>
              <span className="text-sm font-medium">AI Inferred</span>
              <p className="text-xs text-muted">
                Derived from summaries, reviews, and excerpts. Useful as a
                starting point but may contain inaccuracies.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex flex-shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent-dark">
              Verified
            </span>
            <div>
              <span className="text-sm font-medium">Human Verified</span>
              <p className="text-xs text-muted">
                A team member read the full book and confirmed or updated the
                content profile. This is the gold standard.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="mt-10">
        <h2 className="section-heading text-xl">What We Track</h2>
        <p className="mt-2 text-sm text-foreground/80">
          Every book is evaluated across 12 content categories.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {CATEGORIES.map((cat) => (
            <div
              key={cat.name}
              className="rounded-lg border border-border bg-surface p-4"
            >
              <h3 className="text-sm font-semibold" style={{ fontFamily: "var(--font-body), system-ui, sans-serif" }}>
                {cat.name}
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-muted">
                {cat.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Spoiler Policy */}
      <section className="mt-10">
        <h2 className="section-heading text-xl">Spoiler Policy</h2>
        <p className="mt-2 text-sm leading-relaxed text-foreground/80">
          Content details are hidden behind a spoiler wall by default. Category
          names and intensity bars are visible, but descriptive notes — which
          may reference specific plot points — require you to tap &ldquo;Reveal
          Content Details&rdquo; first. We keep notes as spoiler-free as
          possible, but some specificity is necessary for the information to be
          useful.
        </p>
      </section>

      {/* CTA */}
      <section className="mt-12 rounded-lg border border-border bg-surface p-6 text-center">
        <p className="text-sm text-muted">
          Have feedback on our methodology?
        </p>
        <p className="mt-1 text-xs text-muted">
          We&apos;re actively refining how we classify content. Reach out at{" "}
          <span className="font-medium text-foreground">hello@thebasedreader.app</span>
        </p>
      </section>
    </div>
  );
}
