import { getCurrentUser, isPremium } from "@/lib/auth";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { SubscribeButtons } from "@/components/upgrade/subscribe-buttons";

export const metadata: Metadata = {
  title: "Upgrade to Based Reader",
  description: "Unlock premium features on tbr*a",
};

const LIVE_FEATURES = [
  {
    title: "Unlimited Find My Next Read",
    description: "Mood-based book discovery with no limits. Free accounts get 3 searches a month.",
    icon: "zap",
    tint: "lime",
  },
  {
    title: "Custom Shelves",
    description: "Create your own book lists beyond TBR, Reading, and Finished. Everyone keeps Top Shelf Reads.",
    icon: "shelves",
    tint: "purple",
  },
  {
    title: "Buddy Reads",
    description: "Read together with friends and track your progress side by side.",
    icon: "heart",
    tint: "blue",
  },
  {
    title: "Notes to Self",
    description: "Leave a private note on any TBR book so future-you remembers why it's there.",
    icon: "user",
    tint: "purple",
  },
  {
    title: "Ad-Free Forever",
    description: "tbr*a stays clean and distraction-free for Based Readers, always.",
    icon: "trophy",
    tint: "lime",
  },
];

const COMING_SOON = [
  {
    title: "Family Accounts",
    description: "Reader profiles for your kids — track their TBRs without mixing recommendations.",
    icon: "users",
  },
  {
    title: "Advanced Stats",
    description: "Deeper reading analytics, trends, and insights.",
    icon: "chart",
  },
  {
    title: "Custom App Icons",
    description: "Alternative app icon designs to make tbr*a yours.",
    icon: "palette",
  },
];

const TINTS: Record<string, string> = {
  lime: "bg-accent/15 text-accent",
  purple: "bg-neon-purple/15 text-neon-purple",
  blue: "bg-neon-blue/15 text-neon-blue",
};

function FeatureIcon({ icon }: { icon: string }) {
  switch (icon) {
    case "shelves":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
          <path d="M8 7h6" />
        </svg>
      );
    case "trophy":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
          <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
          <path d="M4 22h16" />
          <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
          <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
          <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
        </svg>
      );
    case "chart":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 3v18h18" />
          <path d="m19 9-5 5-4-4-3 3" />
        </svg>
      );
    case "zap":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      );
    case "palette":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" /><circle cx="17.5" cy="10.5" r=".5" fill="currentColor" /><circle cx="8.5" cy="7.5" r=".5" fill="currentColor" /><circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
          <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
        </svg>
      );
    case "users":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    case "heart":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
        </svg>
      );
    case "user":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
        </svg>
      );
    case "download":
      return (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" x2="12" y1="15" y2="3" />
        </svg>
      );
    default:
      return null;
  }
}

export default async function UpgradePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const userIsPremium = isPremium(user);
  const isStaff = !["reader", "premium"].includes(user.accountType);

  return (
    // overflow-x-clip: the aurora bleeds 32px past both edges (-inset-x-8)
    // and was widening the page into a horizontal scroll on phones.
    <div className="relative overflow-x-clip lg:w-[60%] lg:mx-auto">
      {/* Aurora backdrop — breathes slowly, purple-led (the premium color) */}
      <div className="upgrade-aurora pointer-events-none absolute -inset-x-8 -top-16 h-[560px]" aria-hidden />

      <div className="relative">
        {/* Hero */}
        <div className="text-center pt-6 mb-10">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-neon-purple/30 bg-neon-purple/10 px-3 py-1 text-[11px] font-bold tracking-[0.14em] text-neon-purple uppercase">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 6.2L21 9l-5 4.4L17.5 20 12 16.4 6.5 20 8 13.4 3 9l6.6-.8L12 2z" /></svg>
            Premium
          </span>
          <h1 className="mt-4 font-heading text-4xl font-extrabold leading-tight text-foreground">
            Become a<br />
            <span className="upgrade-gradient-text">Based Reader</span>
          </h1>
          <p className="mt-3 text-sm text-muted max-w-sm mx-auto">
            {userIsPremium
              ? "You have access to everything below. Thanks for backing tbr*a."
              : "Every tool we build for readers who take their shelves seriously."}
          </p>
          {/* Current plan chip */}
          <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-border bg-surface/70 px-3.5 py-1.5 backdrop-blur-sm">
            <span className="text-[11px] text-muted">Current plan</span>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                userIsPremium
                  ? "bg-neon-purple/15 text-neon-purple"
                  : "bg-surface-alt text-muted"
              }`}
            >
              {userIsPremium ? "Based Reader" : isStaff ? user.accountType.replace("_", " ") : "Free Reader"}
            </span>
          </div>
        </div>

        {/* Pricing — first, before the pitch */}
        <SubscribeButtons isPremium={userIsPremium} preview={isStaff} />

        {/* Live features */}
        <h2 className="section-heading text-sm mt-12 mb-4">Everything you unlock</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {LIVE_FEATURES.map((feature) => (
            <div
              key={feature.title}
              className="rounded-2xl border border-border bg-surface/70 p-4 flex gap-3 backdrop-blur-sm"
            >
              <div className={`flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-xl ${TINTS[feature.tint]}`}>
                <FeatureIcon icon={feature.icon} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">{feature.title}</h3>
                <p className="text-xs text-muted mt-0.5 leading-relaxed">{feature.description}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Roadmap */}
        <h2 className="section-heading text-sm mt-10 mb-4">On the roadmap</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {COMING_SOON.map((feature) => (
            <div
              key={feature.title}
              className="relative rounded-2xl border border-dashed border-border/80 bg-surface/40 p-4"
            >
              <span className="absolute top-3 right-3 rounded-full bg-surface-alt px-2 py-0.5 text-[10px] font-semibold text-muted">
                Soon
              </span>
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-alt text-muted/70">
                <FeatureIcon icon={feature.icon} />
              </div>
              <h3 className="mt-2.5 text-sm font-semibold text-foreground/80">{feature.title}</h3>
              <p className="text-xs text-muted/80 mt-0.5 leading-relaxed">{feature.description}</p>
            </div>
          ))}
        </div>

        {/* Trust row */}
        <div className="mt-10 mb-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-[11px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect width="18" height="11" x="3" y="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
            Secure checkout by Stripe
          </span>
          <span>Cancel anytime</span>
          <a href="mailto:hello@thebasedreader.app" className="text-neon-blue hover:text-neon-blue/80">
            Questions? hello@thebasedreader.app
          </a>
        </div>
      </div>
    </div>
  );
}
