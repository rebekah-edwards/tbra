import { getCurrentUser, isPremium } from "@/lib/auth";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Upgrade to Based Reader",
  description: "Unlock premium features on tbr*a",
};

const PREMIUM_FEATURES = [
  {
    title: "Custom Shelves",
    description: "Create your own book lists beyond TBR, Reading, and Finished.",
    icon: "shelves",
  },
  {
    title: "Custom Themes",
    description: "Personalize your app with unique color schemes, fonts, and visual styles.",
    icon: "palette",
  },
  {
    title: "Family Accounts",
    description: "Up to 4 reader profiles per account — perfect for managing your kids' reading without mixing recommendations.",
    icon: "users",
  },
  {
    title: "Buddy Reads",
    description: "Read together with friends and track your progress side by side.",
    icon: "heart",
  },
  {
    title: "Reading Challenges",
    description: "Join structured reading challenges with rewards from our partners.",
    icon: "trophy",
  },
  {
    title: "Advanced Stats",
    description: "Deeper reading analytics, trends, and insights about your reading habits.",
    icon: "chart",
  },
  {
    title: "Custom App Icons",
    description: "Choose from alternative app icon designs to make tbr*a yours.",
    icon: "zap",
  },
  {
    title: "Profile Customization",
    description: "More control over how your public profile looks and what it shows.",
    icon: "user",
  },
  {
    title: "Full Data Exports",
    description: "Export all your reading data — books, reviews, notes, stats, and more.",
    icon: "download",
  },
  {
    title: "Priority Support",
    description: "Your issue reports and content detail submissions get processed first.",
    icon: "zap",
  },
];

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

  return (
    <div className="lg:w-[60%] lg:mx-auto">
      <div className="text-center mb-8">
        <h1 className="font-heading text-2xl font-bold text-foreground">
          {userIsPremium ? "You're a Based Reader" : "Become a Based Reader"}
        </h1>
        <p className="mt-2 text-muted">
          {userIsPremium
            ? "You have access to all premium features."
            : "Unlock the full tbr*a experience with premium features."}
        </p>
      </div>

      {/* Current plan indicator */}
      <div className="rounded-xl border border-border bg-surface p-4 mb-6 flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">Current plan</p>
          <p className="text-xs text-muted mt-0.5">
            {userIsPremium ? "Based Reader (Premium)" : "Free Reader"}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            userIsPremium
              ? "bg-neon-purple/15 text-neon-purple border border-neon-purple/30"
              : "bg-surface-alt text-muted border border-border"
          }`}
        >
          {userIsPremium ? "Active" : "Free"}
        </span>
      </div>

      {/* Features grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
        {PREMIUM_FEATURES.map((feature) => (
          <div
            key={feature.title}
            className="rounded-xl border border-border bg-surface p-4 flex gap-3"
          >
            <div className="flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-lg bg-neon-purple/15 text-neon-purple">
              <FeatureIcon icon={feature.icon} />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">{feature.title}</h3>
              <p className="text-xs text-muted mt-0.5">{feature.description}</p>
            </div>
          </div>
        ))}
      </div>

      {/* CTA */}
      {!userIsPremium && (
        <div className="rounded-xl border border-neon-purple/30 bg-neon-purple/5 p-6 text-center">
          <p className="font-heading text-lg font-bold text-foreground mb-2">
            Coming Soon
          </p>
          <p className="text-sm text-muted max-w-md mx-auto">
            Premium subscriptions are launching soon. We'll notify you when Based Reader is available
            for purchase.
          </p>
        </div>
      )}
    </div>
  );
}
