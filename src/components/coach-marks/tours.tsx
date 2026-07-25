"use client";

// The three first-run tours, copy identical to the iOS twins
// (AppShell/SettingsView/BookDetailView .guidedTour calls). Key names match
// the iOS AppStorage keys so a copy revision bumps both platforms together.

import { usePathname, useRouter } from "next/navigation";
import { GuidedTour } from "./guided-tour";

/** Single mount point for all web tours, rendered from the root layout for
 *  signed-in users. Mounting from the layout shell matters: it hydrates with
 *  the nav immediately, while page bodies stream in and hydrate lazily —
 *  a tour mounted inside a streamed subtree may never wake up (the anchors
 *  are found by document query, so where the tour mounts is independent of
 *  where its targets live). Route decides which tour is eligible; the
 *  engine's anchor poll + one-shot localStorage keys handle the rest. */
export function CoachMarksTours() {
  const pathname = usePathname();
  if (pathname === "/") return <HomeTour />;
  if (pathname === "/settings") return <SettingsTour />;
  // Book tour: the whats-inside anchor only renders when the book has
  // ratings, so the anchor poll self-gates on ratings-less books.
  if (pathname.startsWith("/book/")) return <BookTour />;
  return null;
}

/** Home: where imports + settings live. CTA chains into the settings tour
 *  (navigating there is enough — the settings tour self-starts if unseen). */
export function HomeTour() {
  const router = useRouter();
  return (
    <GuidedTour
      tourKey="home-r2"
      steps={[
        {
          anchor: "tour-menu",
          title: "Start here",
          text: "This menu is home base: Import Your Library brings your whole Goodreads or StoryGraph history over in about a minute, and Settings holds your privacy and content preferences.",
        },
      ]}
      ctaLabel="Go to Settings"
      onCTA={() => router.push("/settings")}
    />
  );
}

/** Settings: genres → comfort zone → privacy. The accordion the step teaches
 *  auto-opens (closes when moving on) via the event the preferences editor
 *  listens for. */
export function SettingsTour() {
  return (
    <GuidedTour
      tourKey="settings-r3"
      steps={[
        {
          anchor: "tour-genres",
          title: "Pick your genres",
          text: "Tap a genre once to heart it, twice to hide it. Your picks shape what search and Discover recommend — more of what you love, none of what you don't.",
        },
        {
          anchor: "tour-comfort-zone",
          title: "Your Content Comfort Zone",
          text: "The heart of tbr*a. Set the most you're okay with for violence, language, sexual content, and more. Books beyond your limits become less likely to be recommended — and any book that crosses them shows a clear flag right on its page.",
        },
        {
          anchor: "tour-privacy",
          title: "Your privacy",
          text: "Your profile is public under your username, so choose what you share. Control who can see your location here — everything else, like notes to self, stays private to you.",
        },
      ]}
      onStep={(step) => {
        const section =
          step.anchor === "tour-genres"
            ? "genres"
            : step.anchor === "tour-comfort-zone"
              ? "content"
              : null;
        window.dispatchEvent(
          new CustomEvent("tbra-coach-open-section", { detail: section })
        );
      }}
    />
  );
}

/** Book page: content details, then reporting. Mount only when the book has
 *  ratings — the What's Inside anchor must actually be on screen. */
export function BookTour() {
  return (
    <GuidedTour
      tourKey="book-r3"
      steps={[
        {
          anchor: "whats-inside",
          title: "What's Inside",
          text: "Every book's content profile lives here — category-by-category ratings for violence, language, sexual content, and more, so you know exactly what you're picking up.",
        },
        {
          anchor: "tour-report",
          title: "See something off?",
          text: "tbr*a is new — if a cover, rating, or detail looks wrong, tap Report an issue and we'll fix it fast.",
        },
      ]}
    />
  );
}
