import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import { Space_Grotesk } from "next/font/google";
import Link from "next/link";
import { ThemeProvider } from "@/components/theme-provider";
import { ThemeToggle } from "@/components/theme-toggle";
import { getCurrentUser } from "@/lib/auth";
import { MobileMenu } from "@/components/nav/mobile-menu";
import { SearchBar } from "@/components/nav/search-bar";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import "./globals.css";

const dmSans = DM_Sans({
  variable: "--font-body",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-heading",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "tbr(a) — The Based Reader App",
  description: "Detailed, structured content information for books.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await getCurrentUser();

  let userRecord: { displayName: string | null; avatarUrl: string | null } | null = null;
  if (session) {
    const row = await db
      .select({ displayName: users.displayName, avatarUrl: users.avatarUrl })
      .from(users)
      .where(eq(users.id, session.userId))
      .get();
    userRecord = row ?? null;
  }

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${dmSans.variable} ${spaceGrotesk.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider>
          <nav className="sticky top-0 z-50 overflow-visible border-b border-border bg-surface shadow-sm">
            <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-6 py-3">
              <Link href="/" className="neon-heading text-xl tracking-tight flex-shrink-0" style={{ fontFamily: "var(--font-heading), system-ui, sans-serif" }}>
                tbr(a)
              </Link>

              <div className="flex items-center gap-2">
                {/* Search bar with dropdown */}
                <SearchBar isLoggedIn={!!session} />

                {/* Desktop-only theme toggle */}
                <div className="hidden sm:block">
                  <ThemeToggle />
                </div>

                {session ? (
                  <MobileMenu
                    email={session.email}
                    avatarUrl={userRecord?.avatarUrl}
                    displayName={userRecord?.displayName}
                  />
                ) : (
                  <Link
                    href="/login"
                    className="text-sm text-muted hover:text-foreground transition-colors"
                  >
                    Sign in
                  </Link>
                )}
              </div>
            </div>
          </nav>
          <main className="relative z-0 mx-auto max-w-3xl px-6 py-8">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
