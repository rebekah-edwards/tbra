/**
 * "What's New" notes for the native iOS app, one per build that has something
 * worth telling readers about.
 *
 * The app asks GET /api/v1/whats-new?build=<its build> once per launch and
 * shows the newest note at or below that build if it has not shown it yet
 * (it remembers the note's build number on the device). Because the text lives
 * here and not in the app, wording can be fixed, or a note added for a build
 * that is already out, with a web deploy alone.
 *
 * To announce a new build: add an entry with that build's number. Builds with
 * no entry simply show nothing new. This is text shown to readers in
 * Rebekah's name — she signs off on the wording before it ships.
 *
 * `icon` is an SF Symbol name (line icons, never emoji). An unknown name
 * falls back to a sparkle in the app, so a typo cannot break the screen.
 */
export type WhatsNewItem = { icon?: string; heading: string; body: string };

export type WhatsNewNote = {
  /** The first build this note applies to (CFBundleVersion). */
  build: number;
  title: string;
  items: WhatsNewItem[];
  footer?: string;
};

export const WHATS_NEW_NOTES: WhatsNewNote[] = [
  {
    // Build 20 (TestFlight, 2026-11-19). Wording approved by Rebekah.
    build: 20,
    title: "What's new",
    items: [
      {
        icon: "target",
        heading: "Custom goals (Based Readers)",
        body: "Set goals for pages read, hours listened, days read, or books in a genre. Books you're reading count as you go, and you can fill in a missing page count or audiobook length yourself. Find them on Stats.",
      },
      {
        icon: "arrow.clockwise",
        heading: "Reading goal",
        body: "Re-reads now count toward your goal. Edit your goal right from the Stats card.",
      },
      {
        icon: "person.crop.circle",
        heading: "Profiles",
        body: "A new look for your profile and everyone else's, with your latest covers on the Read, Reading and TBR cards.",
      },
      {
        icon: "books.vertical",
        heading: "Shelves",
        body: "Shelves look like real bookshelves again, and Top Shelf has an Add Books button.",
      },
      {
        icon: "person.2",
        heading: "Buddy Reads",
        body: "A new look, and the list shows who's actually hosting.",
      },
      {
        icon: "photo",
        heading: "Profile pictures",
        body: "Profile pictures load reliably again.",
      },
    ],
    footer: "Tell us what you think with the flag button.",
  },
  {
    // Build 19 is the first build that can show a note, so this one also
    // carries what arrived in build 18.
    build: 19,
    title: "What's new",
    items: [
      {
        icon: "eye.slash",
        heading: "Goal & Streak",
        body: "Not a goals person? You can now hide the reading goal, the streak, or both. Go to Settings, then Display, or press and hold either tile on Home.",
      },
      {
        icon: "square.grid.2x2",
        heading: "Up Next",
        body: "Book titles show in full, and reordering is one move. Hold a book, drag it, let go. Shelves, Top Shelf and the books on a shelf reorder the same way.",
      },
      {
        icon: "house",
        heading: "Home",
        body: "Tap your reading goal to see the books you finished this year. Pick From Your Shelf has a new look, and Reading Now cards are roomier.",
      },
      {
        icon: "person.2",
        heading: "Friends Activity",
        body: "A new look, with “See more” opening the full list. You can share a reading note with friends; it stays private unless you switch sharing on for that note.",
      },
      {
        icon: "note.text",
        heading: "Book pages",
        body: "Your note to self now shows on the book page.",
      },
      {
        icon: "chart.bar",
        heading: "Stats",
        body: "A fuller reading goal card and a new streak card.",
      },
      {
        icon: "paintbrush",
        heading: "Design refresh",
        body: "The new look now covers Shelves, series pages, sign-in and the welcome screens.",
      },
    ],
    footer: "Tell us what you think with the flag button.",
  },
];

/** The newest note at or below `build`, or null when there is none. */
export function whatsNewForBuild(build: number): WhatsNewNote | null {
  if (!Number.isFinite(build) || build <= 0) return null;
  let best: WhatsNewNote | null = null;
  for (const note of WHATS_NEW_NOTES) {
    if (note.build <= build && (!best || note.build > best.build)) best = note;
  }
  return best;
}
