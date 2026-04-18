import Link from "next/link";

interface ContentRating {
  categoryKey: string;
  categoryName: string;
  intensity: number;
}

interface FeaturedBook {
  title: string;
  slug: string;
  coverImageUrl: string;
  ratings: ContentRating[];
}

interface CoverBook {
  id: string;
  title: string;
  coverImageUrl: string;
  slug: string | null;
}

interface LandingPageProps {
  featuredBook: FeaturedBook | null;
  coverBooks: CoverBook[];
  bookCount: number;
  copy?: Record<string, string>;
}

const INTENSITY_LABELS = ["None", "Mild", "Moderate", "Significant", "Extreme"];
const INTENSITY_COLORS = [
  "bg-intensity-0",
  "bg-intensity-1",
  "bg-intensity-2",
  "bg-intensity-3",
  "bg-intensity-4",
];

const SHORT_NAMES: Record<string, string> = {
  romance_sex: "Romance & sex",
  lgbtqia_representation: "LGBTQ+ Rep.",
  profanity_language: "Profanity",
  political_ideological: "Political content",
  magic_witchcraft: "Magic & witchcraft",
  occult_demonology: "Occult / demonology",
  abuse_suffering: "Abuse & suffering",
};

// Categories to show in the landing page showcase (skip "other", skip 0-intensity)
const SHOWCASE_CATEGORIES = [
  "romance_sex",
  "violence_gore",
  "profanity_language",
  "substance_use",
  "religious_content",
  "self_harm_suicide",
  "occult_demonology",
  "abuse_suffering",
];

function SignUpButton({ size = "lg" }: { size?: "lg" | "md" }) {
  const cls = size === "lg"
    ? "px-8 py-4 text-lg font-bold rounded-2xl"
    : "px-6 py-3 text-base font-bold rounded-xl";
  return (
    <Link
      href="/signup"
      className={`inline-block bg-accent text-black ${cls} shadow-[0_0_24px_rgba(163,230,53,0.3)] hover:brightness-110 transition-all`}
    >
      Sign Up Free
    </Link>
  );
}

export function LandingPage({ featuredBook, coverBooks, bookCount, copy = {} }: LandingPageProps) {
  // Helper: get copy from DB or fall back to default
  const c = (key: string, fallback: string) => copy[key] ?? fallback;

  return (
    <div className="space-y-16 lg:space-y-24 pb-16">
      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden rounded-3xl -mx-4 lg:-mx-0">
        {/* Book cover mosaic background */}
        <div className="absolute inset-0 grid grid-cols-5 lg:grid-cols-8 gap-1 landing-hero-mosaic p-2">
          {coverBooks.map((book, i) => (
            <div key={book.id} className="relative aspect-[2/3] overflow-hidden rounded-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={book.coverImageUrl}
                alt=""
                aria-hidden
                width={120}
                height={180}
                className="w-full h-full object-cover"
                loading={i < 10 ? "eager" : "lazy"}
              />
            </div>
          ))}
        </div>
        <div className="absolute inset-0 bg-gradient-to-b from-[var(--background)]/60 via-[var(--background)]/80 to-[var(--background)]" />

        <div className="relative z-10 px-6 py-16 lg:py-24 lg:px-12 text-center lg:text-left lg:max-w-3xl">
          <h1 className="font-heading text-4xl lg:text-6xl font-bold text-foreground tracking-tight leading-tight">
            {c("hero_headline", "Know what's in a book before you read it.")}
          </h1>
          <p className="mt-4 text-lg lg:text-xl text-muted max-w-xl mx-auto lg:mx-0">
            {c("hero_subheadline", "Detailed content ratings, smart recommendations, and reading tools — built for readers who care about what they read.")}
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center gap-4 justify-center lg:justify-start">
            <SignUpButton />
            <span className="text-sm text-muted">
              Already have an account?{" "}
              <Link href="/login" className="text-neon-blue hover:underline transition-colors">
                Sign in
              </Link>
            </span>
          </div>
        </div>
      </section>

      {/* ─── Avatar Cards: Who is this for? ─── */}
      <section>
        <h2 className="font-heading text-2xl lg:text-3xl font-bold text-foreground text-center mb-8">
          {c("avatars_heading", "Built for readers who want to know more.")}
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-6">
          {/* Conscientious Reader */}
          <div className="landing-glass-card rounded-2xl p-6 lg:p-8">
            <div className="flex items-center gap-3 mb-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/15 text-accent text-lg">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" /><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" /></svg>
              </span>
              <h3 className="font-heading text-lg font-bold text-foreground">{c("avatar_readers_title", "For Readers")}</h3>
            </div>
            <p className="text-muted leading-relaxed">
              {c("avatar_readers_body", "Ever been blindsided by content you didn't want to read? tbr*a gives you detailed, structured content information for every book — so you can read with confidence and choose books that match your values.")}
            </p>
          </div>

          {/* Conscientious Parent */}
          <div className="landing-glass-card rounded-2xl p-6 lg:p-8">
            <div className="flex items-center gap-3 mb-4">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-neon-purple/15 text-neon-purple text-lg">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
              </span>
              <h3 className="font-heading text-lg font-bold text-foreground">{c("avatar_parents_title", "For Parents")}</h3>
            </div>
            <p className="text-muted leading-relaxed">
              {c("avatar_parents_body", "Not sure what's in the book your kid wants to read? tbr*a breaks down exactly how sensitive topics are handled — from mild to intense — so you can make informed decisions without reading every page yourself.")}
            </p>
          </div>
        </div>
      </section>

      {/* ─── What's Inside Showcase ─── */}
      {featuredBook && (
        <section>
          <h2 className="font-heading text-2xl lg:text-3xl font-bold text-foreground text-center mb-3">
            {c("showcase_heading", "See exactly what's inside.")}
          </h2>
          <p className="text-muted text-center mb-8 max-w-lg mx-auto">
            {c("showcase_subheading", "Every book on tbr*a comes with a detailed content breakdown. No surprises, no guessing.")}
          </p>

          <div className="rounded-2xl border border-border bg-surface overflow-hidden lg:flex lg:items-stretch">
            {/* Book cover + title */}
            <div className="relative p-6 lg:p-8 lg:w-64 flex flex-col items-center justify-center lg:border-r lg:border-border">
              <Link href={`/book/${featuredBook.slug}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={featuredBook.coverImageUrl}
                  alt={featuredBook.title}
                  // Height-locked, auto-width preserves cover's native ratio.
                  className="h-40 lg:h-52 w-auto rounded-lg shadow-lg"
                />
              </Link>
              <p className="mt-3 text-sm font-semibold text-foreground text-center">{featuredBook.title}</p>
            </div>

            {/* Content ratings */}
            <div className="flex-1 p-6 lg:p-8">
              <p className="text-xs font-semibold uppercase tracking-wide text-neon-blue mb-4">What&apos;s Inside</p>
              <div className="space-y-2.5">
                {featuredBook.ratings
                  .filter(r => SHOWCASE_CATEGORIES.includes(r.categoryKey))
                  .map((rating) => {
                    const name = SHORT_NAMES[rating.categoryKey] ?? rating.categoryName;
                    return (
                      <div key={rating.categoryKey} className="flex items-center gap-3">
                        <span className="text-xs text-muted w-32 lg:w-40 flex-shrink-0 truncate">{name}</span>
                        <div className="flex-1 flex items-center gap-1.5">
                          {[0, 1, 2, 3].map((level) => (
                            <div
                              key={level}
                              className={`h-2.5 flex-1 rounded-full ${
                                level < rating.intensity
                                  ? INTENSITY_COLORS[rating.intensity]
                                  : "bg-border/50"
                              }`}
                            />
                          ))}
                        </div>
                        <span className="text-[10px] text-muted w-16 text-right">{INTENSITY_LABELS[rating.intensity]}</span>
                      </div>
                    );
                  })}
              </div>
              <Link
                href={`/book/${featuredBook.slug}#whats-inside`}
                className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-neon-blue hover:underline transition-colors"
              >
                See full descriptions
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ─── Feature Cards ─── */}
      <section>
        <h2 className="font-heading text-2xl lg:text-3xl font-bold text-foreground text-center mb-8">
          {c("features_heading", "Everything you need to read smarter.")}
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
          <FeatureCard
            icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" /></svg>}
            iconColor="bg-accent/15 text-accent"
            title={c("feature_recs_title", "Smart Recommendations")}
            description={c("feature_recs_body", "Personalized picks based on your reading history. Filtered by your content comfort zone. Always respects series order.")}
          />
          <FeatureCard
            icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>}
            iconColor="bg-neon-purple/15 text-neon-purple"
            title={c("feature_discover_title", "Discover by Mood")}
            description={c("feature_discover_body", "Looking for something cozy? Dark and thrilling? Filter by mood, length, and genre to find your next perfect read.")}
          />
          <FeatureCard
            icon={<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>}
            iconColor="bg-neon-blue/15 text-neon-blue"
            title={c("feature_tracking_title", "Track Your Reading")}
            description={c("feature_tracking_body", "Reading goals, streaks, stats, and a private reading journal. See your habits grow over time.")}
          />
        </div>
      </section>

      {/* ─── Book Cover Parade ─── */}
      <section className="text-center">
        <h2 className="font-heading text-2xl lg:text-3xl font-bold text-foreground mb-2">
          {c("parade_heading", "{count}+ books and growing.").replace("{count}", bookCount.toLocaleString())}
        </h2>
        <p className="text-muted mb-6">
          {c("parade_subheading", "From bestsellers to hidden gems — every one has content details.")}
        </p>
        <div className="flex items-end gap-3 overflow-x-auto pb-2 -mx-4 px-4 pr-12 no-scrollbar mask-fade-right">
          {coverBooks.slice(0, 16).map((book) => (
            <Link key={book.id} href={`/book/${book.slug || book.id}`} className="flex-shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={book.coverImageUrl}
                alt={book.title}
                // Fix the HEIGHT, let width follow the cover's own aspect
                // ratio. `min-w-24` (96px) stops the img from collapsing
                // to 0px while loading — that collapse is what produced
                // the "random extra space" between covers.
                className="h-36 lg:h-44 w-auto min-w-24 rounded-lg shadow-md hover:scale-105 transition-transform"
                loading="lazy"
              />
            </Link>
          ))}
        </div>
      </section>

      {/* ─── Final CTA ─── */}
      <section className="text-center py-8">
        <h2 className="font-heading text-2xl lg:text-3xl font-bold text-foreground mb-4">
          {c("cta_heading", "Start reading with confidence.")}
        </h2>
        <p className="text-muted mb-8 max-w-md mx-auto">
          {c("cta_subheading", "Free to use. No ads. No algorithms selling you things.")}
        </p>
        <SignUpButton />
        <p className="mt-4 text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="text-neon-blue hover:underline transition-colors">
            Sign in
          </Link>
        </p>
      </section>
    </div>
  );
}

function FeatureCard({
  icon,
  iconColor,
  title,
  description,
}: {
  icon: React.ReactNode;
  iconColor: string;
  title: string;
  description: string;
}) {
  return (
    <div className="landing-glass-card rounded-2xl p-6">
      <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${iconColor} mb-4`}>
        {icon}
      </span>
      <h3 className="font-heading text-lg font-bold text-foreground mb-2">{title}</h3>
      <p className="text-sm text-muted leading-relaxed">{description}</p>
    </div>
  );
}
