import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | The Based Reader App",
  description: "How The Based Reader App (tbr*a) collects, uses, and protects your information.",
};

// Required for the Google Play listing (and app-store reviews generally).
// Keep this honest and in sync with actual practice — it is intentionally
// written in plain language, not boilerplate.
const LAST_UPDATED = "July 17, 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="section-heading text-lg">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-foreground/90">{children}</div>
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="space-y-8 lg:w-[60%] lg:mx-auto">
      <div>
        <h1 className="text-foreground text-2xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="text-sm text-muted mt-1">
          The Based Reader App (tbr*a) · Last updated {LAST_UPDATED}
        </p>
      </div>

      <Section title="The short version">
        <p>
          We collect what we need to run a book-tracking app and nothing more. We don&rsquo;t sell
          your data, we don&rsquo;t show your private notes to anyone, and you can export or delete
          everything yourself from Settings at any time.
        </p>
      </Section>

      <Section title="What we collect">
        <p>
          <strong>Account information.</strong> Your email address, a display name and username, and
          a password (stored only as a salted hash — we cannot see it). If you sign in with Google,
          we receive your name, email address, and profile picture from Google instead of a password.
        </p>
        <p>
          <strong>Reading activity.</strong> The books you shelve, your reading states, sessions,
          goals, streaks, ratings, reviews, shelves, buddy reads, notes, and preferences (including
          your Content Comfort Zone settings). This is the product — it exists so the app can work
          for you.
        </p>
        <p>
          <strong>Optional profile details.</strong> A profile photo and a location, if you choose to
          add them. You control who can see your location (everyone or followers only).
        </p>
        <p>
          <strong>Usage analytics.</strong> We use Google Analytics to understand aggregate usage
          (pages visited, general region, device type). We do not use it to build advertising
          profiles.
        </p>
      </Section>

      <Section title="What's public and what's private">
        <p>
          Your public profile (username, display name, photo, reviews, Top Shelf, public custom
          shelves, and follower lists) is visible to others. Your notes to self, TBR notes, email
          address, content preferences, and reading statistics settings are private to you. Reviews
          you post are public by design.
        </p>
      </Section>

      <Section title="Payments">
        <p>
          Premium subscriptions are processed by Stripe. Your card details go directly to Stripe and
          never touch our servers; we store only your subscription status and a Stripe customer
          reference.
        </p>
      </Section>

      <Section title="Emails">
        <p>
          We send account emails (verification, password reset) and, if enabled in Settings,
          notification emails such as new-follower alerts and a weekly digest. Every notification
          type can be turned off in Settings. Transactional email is delivered via Resend.
        </p>
      </Section>

      <Section title="Where your data lives">
        <p>
          The app is hosted on Vercel, and data is stored in a Turso (libSQL) database. Book covers
          and profile images are stored on Vercel Blob storage. All traffic is encrypted in transit
          over HTTPS.
        </p>
      </Section>

      <Section title="Third-party services we rely on">
        <p>
          Stripe (payments), Google (optional sign-in, analytics), Resend (email), Vercel (hosting
          and image storage), and Turso (database). Book metadata comes from public catalog sources
          (OpenLibrary, ISBNdb, Google Books, Library of Congress, the New York Times Books API).
          Amazon links on book pages are affiliate links — as an Amazon Associate, tbr*a earns from
          qualifying purchases; Amazon sets its own cookies when you visit their site.
        </p>
      </Section>

      <Section title="Your controls">
        <p>
          From Settings you can export your full library (CSV, or JSON for subscribers), change your
          email preferences, hide books, reset your library, or permanently delete your account.
          Account deletion removes your personal data — profile, reading activity, reviews, notes,
          shelves, and preferences — immediately and irreversibly.
        </p>
      </Section>

      <Section title="Children">
        <p>
          tbr*a is not directed at children under 13, and we do not knowingly collect personal
          information from them. If you believe a child under 13 has created an account, contact us
          and we will delete it.
        </p>
      </Section>

      <Section title="Changes and contact">
        <p>
          If this policy changes materially, we&rsquo;ll update the date at the top and note the
          change on this page. Questions or requests:{" "}
          <a href="mailto:hello@thebasedreader.app" className="text-neon-blue">
            hello@thebasedreader.app
          </a>
          .
        </p>
      </Section>
    </div>
  );
}
