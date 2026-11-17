import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Use | The Based Reader App",
  description: "The rules for using The Based Reader App (tbr*a), in plain language.",
};

// Required for the App Store (guideline 1.2: apps with user-generated content
// need terms users agree to, with zero tolerance for objectionable content)
// and linked from signup. Plain language on purpose, like /privacy. Keep it
// in step with what the app actually does — especially the reporting,
// blocking and subscription sections.
const LAST_UPDATED = "November 16, 2026";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="section-heading text-lg">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-foreground/90">{children}</div>
    </section>
  );
}

export default function TermsPage() {
  return (
    <div className="space-y-8 lg:w-[60%] lg:mx-auto">
      <div>
        <h1 className="text-foreground text-2xl font-bold tracking-tight">Terms of Use</h1>
        <p className="text-sm text-muted mt-1">
          The Based Reader App (tbr*a) · Last updated {LAST_UPDATED}
        </p>
      </div>

      <Section title="The short version">
        <p>
          tbr*a is a place to track your reading and decide what you want to read. Be honest, be
          kind to other readers, and don&rsquo;t post anything hateful, harassing, explicit or
          illegal. We remove that kind of content and the accounts that post it. By creating an
          account or using tbr*a you agree to these terms and to our{" "}
          <Link href="/privacy" className="text-neon-blue hover:text-neon-blue/80">Privacy Policy</Link>.
        </p>
      </Section>

      <Section title="Who can use tbr*a">
        <p>
          You must be at least 13 years old. If you are under 18, you need a parent or
          guardian&rsquo;s permission. Book pages can describe mature themes, because helping you
          know what is in a book before you read it is the point of the app.
        </p>
      </Section>

      <Section title="Your account">
        <p>
          Give us accurate information, keep your password to yourself, and tell us if you think
          someone else has used your account. You are responsible for what happens under it. One
          person per account, and no creating accounts to get around a block or a suspension.
        </p>
      </Section>

      <Section title="What you post">
        <p>
          Your reviews, ratings, notes, shelves and profile are yours. By posting them publicly
          you give us permission to store and display them in tbr*a, on the website and in the
          apps, for as long as they stay up. You can edit or delete them at any time, and you can
          export or delete your whole account from Settings.
        </p>
        <p>
          You are responsible for what you post. Only post things you have the right to share.
        </p>
      </Section>

      <Section title="Community rules">
        <p>We have zero tolerance for objectionable content and abusive behaviour. Do not post or send:</p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Harassment, bullying, threats, or attacks on another reader</li>
          <li>Hate speech, or content that demeans people for who they are</li>
          <li>Sexually explicit content, or anything sexual involving minors</li>
          <li>Spam, advertising, scams, or fake reviews</li>
          <li>Someone else&rsquo;s private information</li>
          <li>Content that is illegal or that infringes someone else&rsquo;s rights</li>
          <li>Major spoilers without marking them as spoilers</li>
        </ul>
        <p>
          Honest criticism of a book is welcome. Attacks on its author or on other readers are not.
        </p>
      </Section>

      <Section title="Reporting and blocking">
        <p>
          Every review and profile has a menu with <strong>Report</strong> and{" "}
          <strong>Block</strong>. Reports go to us; we review them within 24 hours and remove
          content that breaks these rules. Blocking a reader hides you from each other: you stop
          seeing each other&rsquo;s reviews, profiles and buddy-read messages. They are not told,
          and you can unblock them in Settings.
        </p>
        <p>
          We may remove content, and suspend or close accounts, when these rules are broken. For
          serious or repeated violations we do that without warning.
        </p>
      </Section>

      <Section title="Book information and content ratings">
        <p>
          Our content ratings, summaries and other book details are gathered from many sources and
          are offered as a guide. They can be incomplete or wrong, and they are no substitute for
          your own judgement about what is right for you or your family. If you spot a mistake,
          use the flag button to tell us.
        </p>
      </Section>

      <Section title="Based Reader subscriptions">
        <p>
          Most of tbr*a is free. Based Reader is an optional paid membership. Subscriptions bought
          in the iPhone app are billed by Apple to your Apple Account; subscriptions bought on the
          website are billed through Stripe. Either way the membership renews automatically at the
          price shown when you subscribed, until you cancel.
        </p>
        <p>
          You can cancel at any time and keep your membership until the end of the period you paid
          for. Cancel an Apple subscription in your Apple Account settings, and a website
          subscription from the Based Reader page. Refunds for Apple purchases are handled by
          Apple under its policies.
        </p>
      </Section>

      <Section title="Closing your account">
        <p>
          You can delete your account from Settings at any time, which permanently removes your
          data as described in the Privacy Policy. We can suspend or close an account that breaks
          these terms.
        </p>
      </Section>

      <Section title="Links and purchases elsewhere">
        <p>
          Book pages may link to retailers. Some of those links are affiliate links, which means we
          may earn a small commission if you buy something, at no extra cost to you. We are not
          responsible for other companies&rsquo; sites or services.
        </p>
      </Section>

      <Section title="No warranties">
        <p>
          tbr*a is provided as it is. We work hard to keep it running and accurate, but we do not
          promise it will always be available, error-free, or right about every book. To the
          extent the law allows, we are not liable for indirect or consequential losses from
          using it.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          We may update these terms as the app changes. When we make a meaningful change we will
          update the date above and tell you in the app or by email. Continuing to use tbr*a after
          that means you accept the new terms.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          Questions, or something to report that the in-app tools don&rsquo;t cover? Email{" "}
          <span className="text-foreground font-medium">hello@thebasedreader.app</span> or use the{" "}
          <Link href="/contact" className="text-neon-blue hover:text-neon-blue/80">contact form</Link>.
        </p>
      </Section>
    </div>
  );
}
